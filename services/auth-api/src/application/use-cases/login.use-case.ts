import {
  AuthSession,
  RefreshToken,
  SecurityEvent,
  createEmail,
  isValidEmail,
  InvalidCredentialsError,
} from "../../domain";
import {
  IUserRepository,
  ICredentialRepository,
  ISessionRepository,
  IPasswordHasher,
  ITokenService,
  ISecurityAuditService,
} from "../../interfaces";
import { ILoginUseCase } from "../use-cases.interface";
import { LoginDto, LoginResult } from "../dto";
import { randomUUID } from "node:crypto";

const DUMMY_HASH = "$fake_argon2id$v=19$0000000000000000000000000000000000000000000000000000000000000000";

export class LoginUseCase implements ILoginUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService,
    private readonly maxFailedAttempts: number = 5,
    private readonly lockDurationMs: number = 15 * 60 * 1000
  ) {}

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

    // 4. Verificar estado de la cuenta (bloqueada, suspendida)
    user.ensureCanAuthenticate(now);

    // 5. Buscar credenciales
    const credential = await this.credentialRepo.findByUserId(user.id);
    if (!credential) {
      await this.passwordHasher.verify(dto.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    // 6. Verificar contraseña
    const isPasswordValid = await this.passwordHasher.verify(dto.password, credential.passwordHash);

    if (!isPasswordValid) {
      user.registerFailedAttempt(this.maxFailedAttempts, this.lockDurationMs, now);
      await this.userRepo.update(user);

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
          userId: user.id,
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: {
            reason: "INVALID_PASSWORD",
            failedAttempts: user.failedLoginAttempts,
            isLocked: user.isLocked(now),
          },
          now,
        })
      );

      // Si este intento activó el bloqueo, lanzar excepción de cuenta bloqueada
      if (user.isLocked(now) && user.lockedUntil) {
        user.ensureCanAuthenticate(now);
      }

      throw new InvalidCredentialsError();
    }

    // 7. Login exitoso: restablecer intentos fallidos
    user.resetFailedAttempts(now);
    await this.userRepo.update(user);

    // 8. Crear sesión
    const sessionId = `sess_${randomUUID()}`;
    const session = AuthSession.create(sessionId, user.id, {
      ipAddress: dto.ipAddress ?? null,
      userAgent: dto.userAgent ?? null,
      now,
    });
    await this.sessionRepo.createSession(session);

    // 9. Generar refresh token opaco y familia
    const opaqueToken = this.tokenService.generateOpaqueToken();
    const familyId = `fam_${randomUUID()}`;
    const refreshToken = RefreshToken.create(
      `rt_${randomUUID()}`,
      session.id,
      opaqueToken.tokenHash,
      familyId,
      { now }
    );
    await this.sessionRepo.createRefreshToken(refreshToken);

    // 10. Emitir access token (restringido si está pendiente de cambio obligatorio de clave)
    const isPendingPasswordChange = user.mustChangePassword || user.status === "pending_password_change";
    const signedAccess = await this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      role: isPendingPasswordChange ? "pending_password_change" : "authenticated",
      scope: isPendingPasswordChange ? "auth:change_password" : "api:full",
    });

    // 11. Registrar auditoría de éxito
    await this.auditService.recordEvent(
      SecurityEvent.create(randomUUID(), "LOGIN_SUCCESS", {
        userId: user.id,
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
        metadata: {
          sessionId: session.id,
          mustChangePassword: user.mustChangePassword,
        },
        now,
      })
    );

    return {
      user,
      accessToken: signedAccess.token,
      tokenType: "Bearer",
      expiresInSeconds: signedAccess.expiresInSeconds,
      refreshToken: opaqueToken.rawToken,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
