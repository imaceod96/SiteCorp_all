import {
  AuthSession,
  RefreshToken,
  SecurityEvent,
  createEmail,
  isValidEmail,
  InvalidCredentialsError,
  AccountLockedError,
} from "../../domain";
import {
  IUserRepository,
  ICredentialRepository,
  ISessionRepository,
  IPasswordHasher,
  ITokenService,
  ISecurityAuditService,
  ITransactionManager,
} from "../../interfaces";
import { ILoginUseCase } from "../use-cases.interface";
import { LoginDto, LoginResult } from "../dto";
import { randomUUID } from "node:crypto";

/**
 * Hash Argon2id v=19 real, válido y verificable (m=19456 KiB, t=2, p=1, sal CSPRNG de 16 bytes,
 * digest de 32 bytes), utilizado para ejecutar un cómputo real de Argon2id cuando el usuario no
 * existe, está eliminado o suspendido, mitigando diferencias macroscópicas de temporización
 * tanto con Argon2idPasswordHasher como con FakePasswordHasher.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$29RXI0hXtMDRMmbe3/7zdg$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w";

export class LoginUseCase implements ILoginUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService,
    private readonly maxFailedAttempts: number = 5,
    private readonly lockDurationMs: number = 15 * 60 * 1000,
    private readonly txManager?: ITransactionManager
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(dto: LoginDto): Promise<LoginResult> {
    const now = new Date();

    // 1. Validar formato sintáctico de email sin revelar detalles al cliente
    if (!isValidEmail(dto.email)) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    const email = createEmail(dto.email);
    const user = await this.userRepo.findByEmail(email);

    // 2. Si el usuario no existe, ejecutar hash ficticio para mitigar timing attack y lanzar error genérico
    if (!user) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: { reason: "USER_NOT_FOUND" },
          now,
        })
      );
      throw new InvalidCredentialsError();
    }

    // 3. Mitigar enumeración para cuentas eliminadas: ejecutar hash ficticio y lanzar error genérico
    if (user.status === "deleted" || user.deletedAt !== null) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: { reason: "USER_DELETED_ATTEMPT" },
          now,
        })
      );
      throw new InvalidCredentialsError();
    }

    // 4. Verificar estado de la cuenta (bloqueada, suspendida) homogeneizando tiempo de respuesta
    if (user.status === "suspended" || user.isLocked(now)) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
    }
    user.ensureCanAuthenticate(now);

    // 5. Buscar credenciales
    const credential = await this.credentialRepo.findByUserId(user.id);
    if (!credential) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    // 6. Verificar contraseña FUERA de la transacción SQL (operación CPU-bound de Argon2id)
    const isPasswordValid = await this.passwordHasher.verify(
      dto.password,
      credential.passwordHash
    );

    if (!isPasswordValid) {
      // Incremento atómico de intentos fallidos y auditoría dentro de una misma transacción
      const failureOutcome = await this.executeInTx(async () => {
        if (this.userRepo.incrementFailedAttemptsAtomic) {
          const atomicRes = await this.userRepo.incrementFailedAttemptsAtomic(
            user.id,
            this.maxFailedAttempts,
            this.lockDurationMs,
            now
          );
          const isNowLocked =
            atomicRes.lockedUntil !== null &&
            atomicRes.lockedUntil.getTime() > now.getTime();

          await this.auditService.recordEvent(
            SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
              userId: user.id,
              ipAddress: dto.ipAddress ?? null,
              userAgent: dto.userAgent ?? null,
              metadata: {
                reason: "INVALID_PASSWORD",
                failedAttempts: atomicRes.failedLoginAttempts,
                isLocked: isNowLocked,
              },
              now,
            })
          );

          if (isNowLocked && atomicRes.failedLoginAttempts >= this.maxFailedAttempts) {
            await this.auditService.recordEvent(
              SecurityEvent.create(randomUUID(), "ACCOUNT_LOCKED", {
                userId: user.id,
                ipAddress: dto.ipAddress ?? null,
                userAgent: dto.userAgent ?? null,
                metadata: {
                  failedAttempts: atomicRes.failedLoginAttempts,
                  lockedUntil: atomicRes.lockedUntil?.toISOString() ?? null,
                },
                now,
              })
            );
          }

          return {
            isLocked: isNowLocked,
            lockedUntil: atomicRes.lockedUntil,
          };
        }

        user.registerFailedAttempt(this.maxFailedAttempts, this.lockDurationMs, now);
        await this.userRepo.update(user);
        const isNowLocked = user.isLocked(now);

        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
            userId: user.id,
            ipAddress: dto.ipAddress ?? null,
            userAgent: dto.userAgent ?? null,
            metadata: {
              reason: "INVALID_PASSWORD",
              failedAttempts: user.failedLoginAttempts,
              isLocked: isNowLocked,
            },
            now,
          })
        );

        if (isNowLocked && user.failedLoginAttempts >= this.maxFailedAttempts) {
          await this.auditService.recordEvent(
            SecurityEvent.create(randomUUID(), "ACCOUNT_LOCKED", {
              userId: user.id,
              ipAddress: dto.ipAddress ?? null,
              userAgent: dto.userAgent ?? null,
              metadata: {
                failedAttempts: user.failedLoginAttempts,
                lockedUntil: user.lockedUntil?.toISOString() ?? null,
              },
              now,
            })
          );
        }

        return {
          isLocked: isNowLocked,
          lockedUntil: user.lockedUntil,
        };
      });

      if (failureOutcome.isLocked && failureOutcome.lockedUntil) {
        throw new AccountLockedError(failureOutcome.lockedUntil);
      }

      throw new InvalidCredentialsError();
    }

    // 7. Generar material de tokens y sesión
    const sessionId = `sess_${randomUUID()}`;
    const opaqueToken = this.tokenService.generateOpaqueToken();
    const familyId = `fam_${randomUUID()}`;
    const refreshTokenId = `rt_${randomUUID()}`;

    // 8. Transacción atómica: revalidar usuario y credencial bajo bloqueo, reiniciar intentos,
    //    crear sesión, crear refresh token e insertar auditoría.
    const authenticatedUser = await this.executeInTx(async () => {
      const lockedUser = this.userRepo.findByIdForUpdate
        ? await this.userRepo.findByIdForUpdate(user.id)
        : await this.userRepo.findById(user.id);

      if (!lockedUser || lockedUser.status === "deleted" || lockedUser.deletedAt !== null) {
        throw new InvalidCredentialsError();
      }

      // Revalidar que la cuenta no fue suspendida ni bloqueada mientras se calculaba Argon2id
      lockedUser.ensureCanAuthenticate(now);

      // Revalidar que la versión de credencial no cambió concurrentemente durante el login
      const currentCred = this.credentialRepo.findByUserIdForUpdate
        ? await this.credentialRepo.findByUserIdForUpdate(lockedUser.id)
        : await this.credentialRepo.findByUserId(lockedUser.id);

      if (!currentCred || currentCred.version !== credential.version) {
        throw new InvalidCredentialsError();
      }

      lockedUser.resetFailedAttempts(now);
      await this.userRepo.update(lockedUser);

      const session = AuthSession.create(sessionId, lockedUser.id, {
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
        now,
      });
      await this.sessionRepo.createSession(session);

      const refreshToken = RefreshToken.create(
        refreshTokenId,
        session.id,
        opaqueToken.tokenHash,
        familyId,
        { now }
      );
      await this.sessionRepo.createRefreshToken(refreshToken);

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGIN_SUCCESS", {
          userId: lockedUser.id,
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: {
            sessionId: session.id,
            mustChangePassword: lockedUser.mustChangePassword,
          },
          now,
        })
      );

      return lockedUser;
    });

    // 9. Emitir access token (restringido si está pendiente de cambio obligatorio de clave)
    const isPendingPasswordChange =
      authenticatedUser.mustChangePassword ||
      authenticatedUser.status === "pending_password_change";

    const signedAccess = await this.tokenService.signAccessToken({
      sub: authenticatedUser.id,
      email: authenticatedUser.email,
      role: isPendingPasswordChange ? "pending_password_change" : "authenticated",
      scope: isPendingPasswordChange ? "auth:change_password" : "api:full",
      sid: sessionId,
    });

    return {
      user: authenticatedUser,
      accessToken: signedAccess.token,
      tokenType: "Bearer",
      expiresInSeconds: signedAccess.expiresInSeconds,
      refreshToken: opaqueToken.rawToken,
      mustChangePassword: authenticatedUser.mustChangePassword,
    };
  }
}
