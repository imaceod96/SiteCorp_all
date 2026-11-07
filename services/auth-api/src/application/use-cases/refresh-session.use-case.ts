import {
  SecurityEvent,
  TokenInvalidError,
  TokenExpiredError,
  TokenReuseDetectedError,
  SessionInvalidError,
} from "../../domain";
import {
  IUserRepository,
  ISessionRepository,
  ITokenService,
  ISecurityAuditService,
  ITransactionManager,
} from "../../interfaces";
import { IRefreshSessionUseCase } from "../use-cases.interface";
import { RefreshSessionDto, RefreshSessionResult } from "../dto";
import { randomUUID } from "node:crypto";

export class RefreshSessionUseCase implements IRefreshSessionUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService,
    private readonly txManager?: ITransactionManager
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(dto: RefreshSessionDto): Promise<RefreshSessionResult> {
    const now = new Date();

    if (!dto.rawRefreshToken || typeof dto.rawRefreshToken !== "string") {
      throw new TokenInvalidError("El refresh token no ha sido proporcionado.");
    }

    const oldTokenHash = this.tokenService.hashOpaqueToken(dto.rawRefreshToken);

    // Preparar el nuevo token a emitir
    const newOpaque = this.tokenService.generateOpaqueToken();
    const nextTokenId = `rt_${randomUUID()}`;

    // Ejecución dentro de una única transacción controlada:
    // - Si se detecta reuso (ALREADY_REVOKED), revoca familia + sesión y registra TOKEN_REUSE_DETECTED,
    //   retornando normalmente de executeInTx para confirmar (COMMIT) la revocación defensiva antes
    //   de lanzar TokenReuseDetectedError.
    // - Si la rotación tiene éxito pero falla cualquier paso intermedio (revalidación de usuario,
    //   firma de access token o registro de auditoría TOKEN_ROTATED), hace ROLLBACK completo.
    const txOutcome = await this.executeInTx(async () => {
      const result = await this.sessionRepo.rotateRefreshTokenAtomic(
        oldTokenHash,
        newOpaque.tokenHash,
        nextTokenId,
        now
      );

      if (!result.success) {
        if (result.reason === "ALREADY_REVOKED") {
          await this.auditService.recordEvent(
            SecurityEvent.create(randomUUID(), "TOKEN_REUSE_DETECTED", {
              userId: result.session ? result.session.userId : null,
              ipAddress: dto.ipAddress ?? null,
              userAgent: dto.userAgent ?? null,
              metadata: {
                familyId: result.familyId,
                attemptedTokenHashPrefix: oldTokenHash.substring(0, 8),
              },
              now,
            })
          );
        }
        return {
          rotated: false as const,
          failure: result,
        };
      }

      // Rotación exitosa: revalidar bajo bloqueo que el usuario continúa activo
      const session = result.session;
      const user = this.userRepo.findByIdForUpdate
        ? await this.userRepo.findByIdForUpdate(session.userId)
        : await this.userRepo.findById(session.userId);

      if (!user || user.status === "deleted" || user.deletedAt !== null) {
        await this.sessionRepo.revokeSession(session.id);
        return {
          rotated: false as const,
          failure: {
            success: false as const,
            reason: "SESSION_REVOKED" as const,
          },
        };
      }

      user.ensureCanAuthenticate(now);

      // Emitir nuevo access token (restringido si está pendiente de cambio de contraseña)
      const isPendingPasswordChange =
        user.mustChangePassword || user.status === "pending_password_change";
      const signedAccess = await this.tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        role: isPendingPasswordChange
          ? "pending_password_change"
          : "authenticated",
        scope: isPendingPasswordChange ? "auth:change_password" : "api:full",
      });

      // Registrar auditoría de rotación exitosa en la misma transacción
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "TOKEN_ROTATED", {
          userId: user.id,
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: {
            sessionId: session.id,
            familyId: result.newToken.familyId,
          },
          now,
        })
      );

      return {
        rotated: true as const,
        response: {
          accessToken: signedAccess.token,
          tokenType: "Bearer" as const,
          expiresInSeconds: signedAccess.expiresInSeconds,
          newRefreshToken: newOpaque.rawToken,
        },
      };
    });

    if (!txOutcome.rotated) {
      const { failure } = txOutcome;
      if (failure.reason === "ALREADY_REVOKED") {
        throw new TokenReuseDetectedError(failure.familyId);
      }

      if (failure.reason === "EXPIRED") {
        throw new TokenExpiredError();
      }

      if (failure.reason === "NOT_FOUND") {
        throw new TokenInvalidError();
      }

      throw new SessionInvalidError();
    }

    return txOutcome.response;
  }
}
