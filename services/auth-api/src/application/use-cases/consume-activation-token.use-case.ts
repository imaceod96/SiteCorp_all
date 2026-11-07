import { randomUUID } from "node:crypto";
import {
  ActivationToken,
  PasswordPolicy,
  TokenExpiredError,
  TokenInvalidError,
  UserDeletedError,
  UserNotFoundError,
  UserSuspendedError,
  WeakPasswordError,
} from "../../domain";
import {
  IActivationTokenRepository,
  ICredentialRepository,
  IPasswordHasher,
  ISecurityAuditService,
  ISessionRepository,
  ITransactionManager,
  IUserRepository,
} from "../../interfaces";
import {
  ConsumeActivationTokenDto,
  ConsumeActivationTokenResult,
} from "../dto";
import { IConsumeActivationTokenUseCase } from "../use-cases.interface";

export class ConsumeActivationTokenUseCase implements IConsumeActivationTokenUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credRepo: ICredentialRepository,
    private readonly tokenRepo: IActivationTokenRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: ISecurityAuditService,
    private readonly txManager: ITransactionManager
  ) {}

  async execute(dto: ConsumeActivationTokenDto): Promise<ConsumeActivationTokenResult> {
    const rawToken = (dto.rawToken ?? "").trim();
    if (!rawToken || rawToken.length < 16) {
      throw new TokenInvalidError("El token de activación o restablecimiento no es válido.");
    }

    const tokenHash = ActivationToken.hashToken(rawToken);
    const token = await this.tokenRepo.findByTokenHash(tokenHash);

    if (!token) {
      throw new TokenInvalidError("El enlace o token de activación no existe o es inválido.");
    }

    const now = new Date();

    if (token.isUsed()) {
      token.markUsed(now); // Lanza ActivationTokenAlreadyUsedError
    }

    if (token.isExpired(now)) {
      throw new TokenExpiredError("El enlace de activación ha caducado. Por favor, solicita uno nuevo.");
    }

    if (dto.tokenType && token.tokenType !== dto.tokenType) {
      throw new TokenInvalidError("El tipo de token suministrado no coincide con la operación solicitada.");
    }

    // 1. Validar la nueva contraseña contra la política de seguridad
    const validation = PasswordPolicy.validate(dto.newPassword);
    if (!validation.isValid) {
      throw new WeakPasswordError(validation.errors);
    }

    // 2. Obtener el usuario asociado
    const user = await this.userRepo.findById(token.userId);
    if (!user) {
      throw new UserNotFoundError(token.userId);
    }

    if (user.status === "deleted" || user.deletedAt !== null) {
      throw new UserDeletedError("La cuenta de usuario ha sido dada de baja.");
    }

    if (user.status === "suspended") {
      throw new UserSuspendedError("La cuenta de usuario se encuentra suspendida. Contacte al administrador.");
    }

    // 3. Hashear la nueva contraseña con Argon2id
    const newPasswordHash = await this.passwordHasher.hash(dto.newPassword);

    // 4. Ejecución atómica en una única transacción ACID
    await this.txManager.runInTransaction(async () => {
      // A. Marcar el token como consumido
      token.markUsed(now, dto.ipAddress, dto.userAgent);
      await this.tokenRepo.markUsed(token.id, now, dto.ipAddress, dto.userAgent);

      // B. Actualizar o crear credencial Argon2id
      const currentCred = await this.credRepo.findByUserId(user.id);
      const newVersion = currentCred ? currentCred.version + 1 : 1;

      await this.credRepo.save({
        id: currentCred?.id ?? randomUUID(),
        userId: user.id,
        algorithm: this.passwordHasher.algorithm,
        passwordHash: newPasswordHash,
        version: newVersion,
        createdAt: now,
      });

      // C. Actualizar estado del usuario
      user.markPasswordChanged(now);
      await this.userRepo.save(user);

      // D. Revocar todas las sesiones existentes para este usuario
      await this.sessionRepo.revokeAllUserSessions(user.id);

      // E. Registrar auditoría de seguridad
      const eventType =
        token.tokenType === "password_reset"
          ? "PASSWORD_RESET_COMPLETED"
          : "USER_ACTIVATED";

      await this.auditService.recordEvent({
        id: randomUUID(),
        userId: user.id,
        eventType,
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
        metadata: {
          tokenId: token.id,
          tokenType: token.tokenType,
          credentialVersion: newVersion,
        },
        createdAt: now,
      });

      await this.auditService.recordEvent({
        id: randomUUID(),
        userId: user.id,
        eventType: "PASSWORD_CHANGED",
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
        metadata: {
          method: token.tokenType === "password_reset" ? "token_reset" : "activation_token",
        },
        createdAt: now,
      });
    });

    return {
      success: true,
      userId: user.id,
      email: user.email,
      status: user.status,
    };
  }
}
