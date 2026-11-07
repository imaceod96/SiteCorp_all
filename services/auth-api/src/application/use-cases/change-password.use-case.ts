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
  ITransactionManager,
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

export class ConcurrentCredentialModificationError extends DomainError {
  public readonly code = "CONCURRENT_CREDENTIAL_MODIFICATION";
  constructor() {
    super(
      "La credencial fue modificada concurrentemente por otra operación. Por favor, inicie sesión nuevamente."
    );
  }
}

export class ChangePasswordUseCase implements IChangePasswordUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: ISecurityAuditService,
    private readonly txManager?: ITransactionManager
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(dto: ChangePasswordDto): Promise<void> {
    const now = new Date();

    // 1. Validar política estricta de la nueva contraseña
    PasswordPolicy.assertValid(dto.newPassword);

    // 2. Verificar existencia y estado inicial del usuario (lectura fuera de transacción)
    const user = await this.userRepo.findById(dto.userId);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    user.ensureCanAuthenticate(now);

    // 3. Buscar credenciales actuales y verificar contraseña actual FUERA de la transacción SQL
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
          metadata: {
            action: "CHANGE_PASSWORD_FAILED",
            reason: "CURRENT_PASSWORD_MISMATCH",
          },
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

    // 5. Hashear nueva contraseña FUERA de la transacción SQL (Argon2id CPU-bound)
    const newHash = await this.passwordHasher.hash(dto.newPassword);

    // 6. Transacción ACID compartida:
    //    Nivel 1 (`users`) -> Nivel 2 (`user_credentials`) -> Nivel 3 y 4 (`sessions` y `refresh_tokens`) -> Nivel 5 (`audit`)
    await this.executeInTx(async () => {
      // 6.1 Revalidar usuario bajo bloqueo (Nivel 1)
      const lockedUser = this.userRepo.findByIdForUpdate
        ? await this.userRepo.findByIdForUpdate(user.id)
        : await this.userRepo.findById(user.id);

      if (
        !lockedUser ||
        lockedUser.status === "deleted" ||
        lockedUser.deletedAt !== null
      ) {
        throw new InvalidCredentialsError();
      }
      lockedUser.ensureCanAuthenticate(now);

      // 6.2 Revalidar credencial y versión bajo bloqueo (Nivel 2)
      const lockedCred = this.credentialRepo.findByUserIdForUpdate
        ? await this.credentialRepo.findByUserIdForUpdate(lockedUser.id)
        : await this.credentialRepo.findByUserId(lockedUser.id);

      if (!lockedCred) {
        throw new InvalidCredentialsError();
      }
      if (lockedCred.version !== credential.version) {
        throw new ConcurrentCredentialModificationError();
      }

      const nextVersion = lockedCred.version + 1;

      // 6.3 Actualizar credencial
      await this.credentialRepo.update({
        id: lockedCred.id,
        userId: lockedUser.id,
        algorithm: this.passwordHasher.algorithm,
        passwordHash: newHash,
        version: nextVersion,
        createdAt: now,
      });

      // 6.4 Actualizar usuario (limpia mustChangePassword y status pending_password_change)
      lockedUser.markPasswordChanged(now);
      await this.userRepo.update(lockedUser);

      // 6.5 Revocar todas las sesiones y refresh tokens previos del usuario (Nivel 3 y Nivel 4)
      await this.sessionRepo.revokeAllUserSessions(lockedUser.id);

      // 6.6 Registrar auditoría de seguridad (Nivel 5)
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "PASSWORD_CHANGED", {
          userId: lockedUser.id,
          metadata: { newCredentialVersion: nextVersion },
          now,
        })
      );
    });
  }
}
