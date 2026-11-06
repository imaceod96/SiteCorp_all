import {
  AuthUser,
  SecurityEvent,
  createUserId,
  createEmail,
  PasswordPolicy,
  ForbiddenError,
} from "../../domain";
import {
  IUserRepository,
  ICredentialRepository,
  ISessionRepository,
  IPasswordHasher,
  ISecurityAuditService,
  AuthenticatedPrincipal,
  IAuthorizationPolicyService,
} from "../../interfaces";
import {
  IAdminCreateUserUseCase,
  IAdminUpdateStatusUseCase,
} from "../use-cases.interface";
import { AdminCreateUserDto, AdminUpdateStatusDto } from "../dto";
import { randomUUID } from "node:crypto";

export class AdminCreateUserUseCase implements IAdminCreateUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly credentialRepo: ICredentialRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly auditService: ISecurityAuditService,
    private readonly authPolicy: IAuthorizationPolicyService
  ) {}

  async execute(
    dto: AdminCreateUserDto,
    operator?: AuthenticatedPrincipal
  ): Promise<AuthUser> {
    const now = new Date();

    // 1. Autorización: verificar que el operador tiene privilegios administrativos
    if (!operator || !this.authPolicy.canManageUsers(operator)) {
      throw new ForbiddenError(
        "Se requiere el permiso de administración de usuarios para crear cuentas."
      );
    }

    const email = createEmail(dto.email);
    const userId = createUserId(randomUUID());

    // 2. Definir contraseña inicial (provista o por defecto segura)
    const initialPassword = dto.initialPassword ?? `SiteCorp.${randomUUID().substring(0, 8)}!2026`;
    PasswordPolicy.assertValid(initialPassword);

    // 3. Crear entidad de usuario
    const user = AuthUser.create(userId, email, {
      status: "pending_password_change",
      mustChangePassword: dto.mustChangePassword ?? true,
      now,
    });

    await this.userRepo.save(user);

    // 4. Crear credencial inicial
    const hash = await this.passwordHasher.hash(initialPassword);
    await this.credentialRepo.save({
      id: `cred_${randomUUID()}`,
      userId: user.id,
      algorithm: this.passwordHasher.algorithm,
      passwordHash: hash,
      version: 1,
      createdAt: now,
    });

    // 5. Auditoría
    await this.auditService.recordEvent(
      SecurityEvent.create(randomUUID(), "USER_CREATED", {
        userId: user.id,
        metadata: {
          createdByOperatorId: operator.userId,
          mustChangePassword: user.mustChangePassword,
        },
        now,
      })
    );

    return user;
  }
}

export class AdminUpdateStatusUseCase implements IAdminUpdateStatusUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly sessionRepo: ISessionRepository,
    private readonly auditService: ISecurityAuditService,
    private readonly authPolicy: IAuthorizationPolicyService
  ) {}

  async execute(
    dto: AdminUpdateStatusDto,
    operator?: AuthenticatedPrincipal
  ): Promise<AuthUser> {
    const now = new Date();

    // 1. Autorización: verificar permisos para suspender/reactivar al usuario objetivo
    if (!operator || !this.authPolicy.canSuspendUser(operator, dto.userId)) {
      throw new ForbiddenError(
        "Se requiere el permiso de administración para modificar el estado de esta cuenta."
      );
    }

    const user = await this.userRepo.findById(dto.userId);
    if (!user) {
      throw new Error(`Usuario con ID '${dto.userId}' no encontrado.`);
    }

    if (dto.status === "suspended") {
      user.suspend(now);
      await this.userRepo.update(user);
      // Revocar inmediatamente todas las sesiones y tokens del usuario suspendido
      await this.sessionRepo.revokeAllUserSessions(user.id);

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "USER_SUSPENDED", {
          userId: user.id,
          metadata: { suspendedByOperatorId: operator.userId },
          now,
        })
      );
    } else if (dto.status === "active") {
      user.reactivate(now);
      await this.userRepo.update(user);

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "USER_ACTIVATED", {
          userId: user.id,
          metadata: { activatedByOperatorId: operator.userId },
          now,
        })
      );
    }

    return user;
  }
}
