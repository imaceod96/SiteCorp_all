import {
  PasswordPolicy,
  SecurityEvent,
  InvalidCredentialsError,
  DomainError,
} from "../../domain";
import {
  IUserRepository,
  ICredentialRepository,
  ISessionRepository,
  IPasswordHasher,
  ISecurityAuditService,
} from "../../interfaces";
import { IChangePasswordUseCase } from "../use-cases.interface";
import { ChangePasswordDto } from "../dto";
import { randomUUID } from "node:crypto";

export class SamePasswordError extends DomainError {
  public readonly code = "SAME_PASSWORD";
  constructor() {
    super("La nueva contraseña debe ser diferente a la contraseña actual.");
  }
}

export class ChangePasswordUseCase implements IChangePasswordUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: ISecurityAuditService
  ) {}

  async execute(dto: ChangePasswordDto): Promise<void> {
    const now = new Date();

    // 1. Validar política estricta de la nueva contraseña
    PasswordPolicy.assertValid(dto.newPassword);

    // 2. Verificar existencia y estado del usuario
    const user = await this.userRepo.findById(dto.userId);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    user.ensureCanAuthenticate(now);

    // 3. Buscar credenciales actuales y verificar contraseña actual
    const credential = await this.credentialRepo.findByUserId(user.id);
    if (!credential) {
      throw new InvalidCredentialsError();
    }

    const isCurrentValid = await this.passwordHasher.verify(
      dto.currentPassword,
      credential.passwordHash
    );
    if (!isCurrentValid) {
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGIN_FAILED", {
          userId: user.id,
          metadata: { action: "CHANGE_PASSWORD_FAILED", reason: "CURRENT_PASSWORD_MISMATCH" },
          now,
        })
      );
      throw new InvalidCredentialsError("La contraseña actual proporcionada es incorrecta.");
    }

    // 4. Comprobar que no sea idéntica
    const isSameAsOld = await this.passwordHasher.verify(
      dto.newPassword,
      credential.passwordHash
    );
    if (isSameAsOld) {
      throw new SamePasswordError();
    }

    // 5. Hashear nueva contraseña y actualizar credencial
    const newHash = await this.passwordHasher.hash(dto.newPassword);
    await this.credentialRepo.update({
      id: credential.id,
      userId: user.id,
      algorithm: this.passwordHasher.algorithm,
      passwordHash: newHash,
      version: credential.version + 1,
      createdAt: now,
    });

    // 6. Actualizar usuario (limpia mustChangePassword y status pending_password_change)
    user.markPasswordChanged(now);
    await this.userRepo.update(user);

    // 7. Revocar todas las sesiones previas del usuario por seguridad
    await this.sessionRepo.revokeAllUserSessions(user.id);

    // 8. Registrar auditoría de seguridad
    await this.auditService.recordEvent(
      SecurityEvent.create(randomUUID(), "PASSWORD_CHANGED", {
        userId: user.id,
        metadata: { newCredentialVersion: credential.version + 1 },
        now,
      })
    );
  }
}
