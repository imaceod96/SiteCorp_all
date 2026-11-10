import {
  AuthUser,
  SecurityEvent,
  createUserId,
  createEmail,
  PasswordPolicy,
  DuplicateEmailError,
  ForbiddenError,
  UserNotFoundError,
} from "../../domain";
import {
  IUserRepository,
  ICredentialRepository,
  ISessionRepository,
  IPasswordHasher,
  ISecurityAuditService,
  AuthenticatedPrincipal,
  IAuthorizationPolicyService,
  ITransactionManager,
  IOperatorPermissionRepository,
} from "../../interfaces";
import {
  IAdminCreateUserUseCase,
  IAdminUpdateStatusUseCase,
} from "../use-cases.interface";
import { AdminCreateUserDto, AdminUpdateStatusDto } from "../dto";
import { randomUUID } from "node:crypto";

async function assertOperatorEligible(
  userRepo: IUserRepository,
  operator: AuthenticatedPrincipal | undefined,
  now: Date
): Promise<AuthenticatedPrincipal> {
  if (!operator) {
    throw new ForbiddenError(
      "Se requiere un operador autenticado con privilegios administrativos."
    );
  }

  if (
    operator.mustChangePassword === true ||
    operator.role === "pending_password_change"
  ) {
    throw new ForbiddenError(
      "El operador debe completar el cambio obligatorio de contraseña antes de ejecutar acciones administrativas."
    );
  }

  const persistedOperator = await userRepo.findById(operator.userId);
  if (persistedOperator) {
    if (
      !persistedOperator.isActive() ||
      persistedOperator.status !== "active" ||
      persistedOperator.mustChangePassword ||
      persistedOperator.isLocked(now)
    ) {
      throw new ForbiddenError(
        "La cuenta del operador administrativo no se encuentra activa o tiene un cambio de contraseña pendiente."
      );
    }
  }

  return operator;
}

export class AdminCreateUserUseCase implements IAdminCreateUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: ISecurityAuditService,
    private readonly authPolicy: IAuthorizationPolicyService,
    private readonly txManager?: ITransactionManager
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(
    dto: AdminCreateUserDto,
    operator?: AuthenticatedPrincipal
  ): Promise<AuthUser> {
    const now = new Date();

    // 1. Autorización: verificar que el operador está activo, sin cambio de clave pendiente y tiene permisos
    const verifiedOperator = await assertOperatorEligible(
      this.userRepo,
      operator,
      now
    );

    if (!this.authPolicy.canManageUsers(verifiedOperator)) {
      throw new ForbiddenError(
        "Se requiere el permiso de administración de usuarios para crear cuentas."
      );
    }

    const email = createEmail(dto.email);
    const userId = createUserId(randomUUID());

    // 2. Definir contraseña inicial y validar política ANTES de consultar BD o Argon2id
    const initialPassword =
      dto.initialPassword ?? `SiteCorp.${randomUUID().substring(0, 8)}!2026`;
    PasswordPolicy.assertValid(initialPassword);

    // 3. Comprobación preliminar de unicidad de email antes de consumir Argon2id
    const existingUser = await this.userRepo.findByEmail(email);
    if (existingUser) {
      throw new DuplicateEmailError(email);
    }

    // 4. Calcular hash Argon2id FUERA de la transacción SQL
    const hash = await this.passwordHasher.hash(initialPassword);

    const mustChange = dto.mustChangePassword ?? true;
    const user = AuthUser.create(userId, email, {
      status: mustChange ? "pending_password_change" : "active",
      mustChangePassword: mustChange,
      now,
    });

    // 5. Transacción ACID compartida: crear usuario, crear credencial e insertar auditoría
    await this.executeInTx(async () => {
      await this.userRepo.save(user);

      await this.credentialRepo.save({
        id: `cred_${randomUUID()}`,
        userId: user.id,
        algorithm: this.passwordHasher.algorithm,
        passwordHash: hash,
        version: 1,
        createdAt: now,
      });

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "USER_CREATED", {
          userId: user.id,
          ipAddress: dto.ipAddress ?? null,
          userAgent: dto.userAgent ?? null,
          metadata: {
            createdByOperatorId: verifiedOperator.userId,
            mustChangePassword: user.mustChangePassword,
          },
          now,
        })
      );
    });

    return user;
  }
}

export class AdminUpdateStatusUseCase implements IAdminUpdateStatusUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly auditService: ISecurityAuditService,
    private readonly authPolicy: IAuthorizationPolicyService,
    private readonly txManager?: ITransactionManager,
    private readonly permissionRepo?: IOperatorPermissionRepository
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(
    dto: AdminUpdateStatusDto,
    operator?: AuthenticatedPrincipal
  ): Promise<AuthUser> {
    const now = new Date();

    // 1. Autorización: verificar estado del operador y permisos específicos según la operación
    const verifiedOperator = await assertOperatorEligible(
      this.userRepo,
      operator,
      now
    );

    if (dto.status === "deleted") {
      if (!this.authPolicy.canDeleteUser(verifiedOperator, dto.userId)) {
        throw new ForbiddenError(
          "Se requiere el permiso de administración de seguridad para dar de baja cuentas de usuario."
        );
      }
    } else if (!this.authPolicy.canSuspendUser(verifiedOperator, dto.userId)) {
      throw new ForbiddenError(
        "Se requiere el permiso de administración para modificar el estado de esta cuenta."
      );
    }

    // 2. Transacción ACID compartida siguiendo el orden canónico de bloqueos:
    //    Nivel 1 (`users`) -> Nivel 3 (`sessions`) -> Nivel 4 (`refresh_tokens`) -> Nivel 5 (`audit`)
    return this.executeInTx(async () => {
      const user = this.userRepo.findByIdForUpdate
        ? await this.userRepo.findByIdForUpdate(dto.userId)
        : await this.userRepo.findById(dto.userId);

      if (!user) {
        throw new UserNotFoundError(dto.userId);
      }

      // Prevención de escalación/neutralización de privilegios:
      // Un operador que solo posee 'users.manage' NO puede suspender ni alterar la cuenta
      // de un operador que posee 'security.admin' o 'security.manage'.
      if (this.permissionRepo) {
        const targetPermissions =
          await this.permissionRepo.findActivePermissionsByUserId(user.id);
        const targetIsSecurityAdmin =
          targetPermissions.includes("security.admin");
        const targetIsSecurityManager =
          targetPermissions.includes("security.manage");
        const operatorIsSecurityAdmin =
          verifiedOperator.isPlatformAdmin === true ||
          verifiedOperator.permissions.has("security.admin");
        const operatorIsSecurityManager =
          operatorIsSecurityAdmin ||
          verifiedOperator.permissions.has("security.manage");

        if (targetIsSecurityAdmin && !operatorIsSecurityAdmin) {
          throw new ForbiddenError(
            "Se requiere el permiso 'security.admin' para modificar el estado de un administrador de seguridad."
          );
        }
        if (targetIsSecurityManager && !operatorIsSecurityManager) {
          throw new ForbiddenError(
            "Se requiere el permiso 'security.manage' o 'security.admin' para modificar el estado de un operador de seguridad."
          );
        }
      }

      if (dto.status === "suspended") {
        user.suspend(now);
        await this.userRepo.update(user);
        await this.sessionRepo.revokeAllUserSessions(user.id);
        if (this.permissionRepo) {
          await this.permissionRepo.revokeAllUserPermissions(
            user.id,
            verifiedOperator.userId,
            now
          );
        }

        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "USER_SUSPENDED", {
            userId: user.id,
            ipAddress: dto.ipAddress ?? null,
            userAgent: dto.userAgent ?? null,
            metadata: { suspendedByOperatorId: verifiedOperator.userId },
            now,
          })
        );
      } else if (dto.status === "deleted") {
        user.softDelete(now);
        await this.userRepo.update(user);
        await this.sessionRepo.revokeAllUserSessions(user.id);
        if (this.permissionRepo) {
          await this.permissionRepo.revokeAllUserPermissions(
            user.id,
            verifiedOperator.userId,
            now
          );
        }

        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "USER_DELETED", {
            userId: user.id,
            ipAddress: dto.ipAddress ?? null,
            userAgent: dto.userAgent ?? null,
            metadata: { deletedByOperatorId: verifiedOperator.userId },
            now,
          })
        );
      } else if (dto.status === "active") {
        user.reactivate(now);
        await this.userRepo.update(user);

        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "USER_ACTIVATED", {
            userId: user.id,
            ipAddress: dto.ipAddress ?? null,
            userAgent: dto.userAgent ?? null,
            metadata: { activatedByOperatorId: verifiedOperator.userId },
            now,
          })
        );
      }

      return user;
    });
  }
}
