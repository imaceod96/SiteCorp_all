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
} from "../../interfaces";
import { IRefreshSessionUseCase } from "../use-cases.interface";
import { RefreshSessionDto, RefreshSessionResult } from "../dto";
import { randomUUID } from "node:crypto";

export class RefreshSessionUseCase implements IRefreshSessionUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService
  ) {}

  async execute(dto: RefreshSessionDto): Promise<RefreshSessionResult> {
    const now = new Date();

    if (!dto.rawRefreshToken || typeof dto.rawRefreshToken !== "string") {
      throw new TokenInvalidError("El refresh token no ha sido proporcionado.");
    }

    const oldTokenHash = this.tokenService.hashOpaqueToken(dto.rawRefreshToken);

    // Preparar el nuevo token a emitir
    const newOpaque = this.tokenService.generateOpaqueToken();
    const nextTokenId = `rt_${randomUUID()}`;

    // Ejecución de la rotación ATÓMICA directa (sin pre-consulta externa)
    const result = await this.sessionRepo.rotateRefreshTokenAtomic(
      oldTokenHash,
      newOpaque.tokenHash,
      nextTokenId,
      now
    );

    if (!result.success) {
      if (result.reason === "ALREADY_REVOKED") {
        // Alerta crítica de reuso: posible ataque de robo de token
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
        throw new TokenReuseDetectedError(result.familyId);
      }

      if (result.reason === "EXPIRED") {
        throw new TokenExpiredError();
      }

      if (result.reason === "NOT_FOUND") {
        throw new TokenInvalidError();
      }

      throw new SessionInvalidError();
    }

    // Rotación exitosa: verificar que el usuario continúa activo
    const session = result.session;
    const user = await this.userRepo.findById(session.userId);
    if (!user) {
      await this.sessionRepo.revokeSession(session.id);
      throw new SessionInvalidError("Usuario de la sesión no encontrado.");
    }

    user.ensureCanAuthenticate(now);

    // Emitir nuevo access token (restringido si está pendiente de cambio de contraseña)
    const isPendingPasswordChange = user.mustChangePassword || user.status === "pending_password_change";
    const signedAccess = await this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      role: isPendingPasswordChange ? "pending_password_change" : "authenticated",
      scope: isPendingPasswordChange ? "auth:change_password" : "api:full",
    });

    // Registrar auditoría de rotación exitosa
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
      accessToken: signedAccess.token,
      tokenType: "Bearer",
      expiresInSeconds: signedAccess.expiresInSeconds,
      newRefreshToken: newOpaque.rawToken,
    };
  }
}
