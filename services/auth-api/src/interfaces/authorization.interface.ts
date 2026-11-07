import { randomUUID } from "node:crypto";
import {
  AuthUser,
  DomainError,
  ForbiddenError,
  SecurityEvent,
  UserId,
} from "../domain";
import { ISecurityAuditService } from "./security-audit.service.interface";
import { ITransactionManager } from "./transaction.interface";
import { IUserRepository } from "./user.repository.interface";

export type OperatorPermission =
  | "users.manage"
  | "security.manage"
  | "security.admin";

export const ALL_OPERATOR_PERMISSIONS: readonly OperatorPermission[] =
  Object.freeze(["users.manage", "security.manage", "security.admin"]);

export function isValidOperatorPermission(
  value: unknown
): value is OperatorPermission {
  return (
    value === "users.manage" ||
    value === "security.manage" ||
    value === "security.admin"
  );
}

export interface OperatorPermissionRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly permission: OperatorPermission;
  readonly grantedBy: UserId | null;
  readonly grantReason: string | null;
  readonly isRevoked: boolean;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
}

export interface GrantOperatorPermissionInput {
  readonly id?: string;
  readonly userId: UserId;
  readonly permission: OperatorPermission;
  /**
   * Identificador del operador que otorga el permiso.
   * Debe ser distinto de `userId` (prohibida la auto-asignación de permisos).
   * Solo puede ser `null` durante el bootstrap inicial controlado (`InitialAdminBootstrapService`).
   */
  readonly grantedBy: UserId | null;
  readonly grantReason?: string | null;
  readonly allowBootstrapNullGranter?: boolean;
  readonly now?: Date;
}

export interface RevokeOperatorPermissionInput {
  readonly userId: UserId;
  readonly permission: OperatorPermission;
  readonly revokedBy: UserId | null;
  readonly now?: Date;
}

/**
 * Repositorio autoritativo de permisos administrativos persistidos en `sitecorp_auth.operator_permissions`.
 */
export interface IOperatorPermissionRepository {
  /**
   * Devuelve la lista de permisos activos (`is_revoked = false`) para el usuario dado.
   * Se consulta en tiempo real en cada petición administrativa (`IOperatorPrincipalResolver`).
   */
  findActivePermissionsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermission[]>;

  /**
   * Devuelve los registros completos de permisos activos para un usuario.
   */
  findActiveRecordsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermissionRecord[]>;

  /**
   * Otorga un permiso administrativo validando que no exista auto-asignación (`grantedBy !== userId`).
   */
  grantPermission(
    input: GrantOperatorPermissionInput
  ): Promise<OperatorPermissionRecord>;

  /**
   * Revoca de forma inmediata un permiso activo específico de un usuario.
   */
  revokePermission(input: RevokeOperatorPermissionInput): Promise<boolean>;

  /**
   * Revoca todos los permisos administrativos activos de un usuario (p. ej. al suspender o dar de baja su cuenta).
   */
  revokeAllUserPermissions(
    userId: UserId,
    revokedBy: UserId | null,
    now?: Date
  ): Promise<number>;

  /**
   * Cuenta el total de permisos administrativos activos en el sistema (utilizado por `InitialAdminBootstrapService`
   * para garantizar ejecución única fail-closed).
   */
  countActiveOperatorPermissions(): Promise<number>;
}

/**
 * Representa al actor autenticado que invoca un caso de uso protegido o administrativo.
 *
 * IMPORTANTE (Invariante de Seguridad):
 * `AuthUser` NO almacena roles ni permisos en la tabla `sitecorp_auth.users`.
 * Este `AuthenticatedPrincipal` debe ser construido por la capa de aplicación/transporte
 * consultando una fuente autoritativa de permisos (`IOperatorPrincipalResolver`) y NUNCA
 * confiando ciegamente en entradas del cliente ni asumiendo privilegios por defecto.
 */
export interface AuthenticatedPrincipal {
  readonly userId: UserId;
  readonly email: string;
  readonly role?: "authenticated" | "pending_password_change";
  readonly permissions: ReadonlySet<string>;
  readonly isPlatformAdmin?: boolean;
  readonly mustChangePassword?: boolean;
}

export interface IAuthorizationPolicyService {
  canManageUsers(operator: AuthenticatedPrincipal): boolean;
  canSuspendUser(operator: AuthenticatedPrincipal, targetUserId: UserId): boolean;
  canDeleteUser(operator: AuthenticatedPrincipal, targetUserId: UserId): boolean;
}

/**
 * Política de autorización administrativa de producción basada en mínimo privilegio
 * y denegación por defecto (`default deny`).
 *
 * Reglas:
 * 1. Si el operador tiene `mustChangePassword === true` o `role === "pending_password_change"`,
 *    todo permiso administrativo es denegado inmediatamente (`false`).
 * 2. Si el operador no posee permisos explícitos ni `isPlatformAdmin`, se deniega todo (`false`).
 * 3. `canManageUsers`: requiere `'users.manage'`, `'security.manage'` o `'security.admin'`.
 * 4. `canSuspendUser`: prohíbe estrictamente la auto-suspensión (`operator.userId !== targetUserId`)
 *    y requiere `'users.manage'`, `'security.manage'` o `'security.admin'`.
 * 5. `canDeleteUser`: prohíbe estrictamente la auto-eliminación (`operator.userId !== targetUserId`)
 *    y exige un nivel superior de privilegio (`'security.manage'` o `'security.admin'`); un operador
 *    con solo `'users.manage'` NO puede eliminar cuentas lógicamente.
 */
export class AuthorizationPolicyService implements IAuthorizationPolicyService {
  private isEligibleOperator(operator: AuthenticatedPrincipal): boolean {
    if (!operator || typeof operator !== "object") {
      return false;
    }
    if (
      operator.mustChangePassword === true ||
      operator.role === "pending_password_change"
    ) {
      return false;
    }
    return true;
  }

  private hasAnyPermission(
    operator: AuthenticatedPrincipal,
    required: readonly OperatorPermission[]
  ): boolean {
    if (operator.isPlatformAdmin === true) {
      return true;
    }
    if (!operator.permissions || typeof operator.permissions.has !== "function") {
      return false;
    }
    return required.some((perm) => operator.permissions.has(perm));
  }

  public canManageUsers(operator: AuthenticatedPrincipal): boolean {
    if (!this.isEligibleOperator(operator)) {
      return false;
    }
    return this.hasAnyPermission(operator, [
      "users.manage",
      "security.manage",
      "security.admin",
    ]);
  }

  public canSuspendUser(
    operator: AuthenticatedPrincipal,
    targetUserId: UserId
  ): boolean {
    if (!this.isEligibleOperator(operator)) {
      return false;
    }
    if (operator.userId === targetUserId) {
      return false;
    }
    return this.hasAnyPermission(operator, [
      "users.manage",
      "security.manage",
      "security.admin",
    ]);
  }

  public canDeleteUser(
    operator: AuthenticatedPrincipal,
    targetUserId: UserId
  ): boolean {
    if (!this.isEligibleOperator(operator)) {
      return false;
    }
    if (operator.userId === targetUserId) {
      return false;
    }
    return this.hasAnyPermission(operator, [
      "security.manage",
      "security.admin",
    ]);
  }
}

/**
 * Puerto para resolver los privilegios reales (`AuthenticatedPrincipal`) de un `AuthUser`
 * a partir de una fuente autoritativa de permisos en backend.
 */
export interface IOperatorPrincipalResolver {
  resolvePrincipal(user: AuthUser): Promise<AuthenticatedPrincipal>;
}

/**
 * Implementación autoritativa que resuelve en vivo los permisos administrativos del
 * usuario consultando `IOperatorPermissionRepository` en cada petición.
 *
 * Garantiza que:
 * - Un usuario autenticado normal sin registros en `operator_permissions` recibe `permissions: new Set()` (`403 FORBIDDEN`).
 * - Si los permisos de un operador se revocan en base de datos, su siguiente petición HTTP es denegada
 *   de inmediato aunque su access token JWT de 15 minutos aún no haya expirado.
 * - Si el usuario no está `active` o tiene `mustChangePassword === true`, sus permisos efectivos son vacíos.
 */
export class RepositoryOperatorPrincipalResolver
  implements IOperatorPrincipalResolver
{
  constructor(
    private readonly permissionRepo: IOperatorPermissionRepository
  ) {}

  async resolvePrincipal(user: AuthUser): Promise<AuthenticatedPrincipal> {
    if (!user.isActive() || user.mustChangePassword) {
      return Object.freeze({
        userId: user.id,
        email: user.email,
        role: user.mustChangePassword
          ? "pending_password_change"
          : "authenticated",
        permissions: new Set<string>(),
        isPlatformAdmin: false,
        mustChangePassword: user.mustChangePassword,
      });
    }

    const activePermissions =
      await this.permissionRepo.findActivePermissionsByUserId(user.id);
    const permSet: ReadonlySet<string> = new Set(activePermissions);

    return Object.freeze({
      userId: user.id,
      email: user.email,
      role: "authenticated",
      permissions: permSet,
      isPlatformAdmin: permSet.has("security.admin"),
      mustChangePassword: false,
    });
  }
}

/**
 * Implementación segura por defecto (fail-closed):
 * Asigna únicamente el rol básico de sesión sin ningún permiso administrativo (`permissions: new Set()`, `isPlatformAdmin: false`).
 * Garantiza que ningún usuario obtenga capacidades de administración si no existe un catálogo explícito de permisos configurado.
 */
export class FailClosedOperatorPrincipalResolver
  implements IOperatorPrincipalResolver
{
  async resolvePrincipal(user: AuthUser): Promise<AuthenticatedPrincipal> {
    return Object.freeze({
      userId: user.id,
      email: user.email,
      role: user.mustChangePassword
        ? "pending_password_change"
        : "authenticated",
      permissions: new Set<string>(),
      isPlatformAdmin: false,
      mustChangePassword: user.mustChangePassword,
    });
  }
}

export class BootstrapDisabledError extends DomainError {
  public readonly code = "BOOTSTRAP_DISABLED";
  constructor(
    message: string = "El bootstrap inicial de administrador está deshabilitado por defecto."
  ) {
    super(message);
  }
}

export class BootstrapAlreadyInitializedError extends DomainError {
  public readonly code = "BOOTSTRAP_ALREADY_INITIALIZED";
  constructor(
    message: string = "El sistema ya cuenta con permisos administrativos activos; el bootstrap inicial solo puede ejecutarse una vez."
  ) {
    super(message);
  }
}

export interface InitialAdminBootstrapInput {
  readonly targetUserId: UserId;
  /** Debe ser `true` explícitamente además de la bandera de configuración del servicio */
  readonly confirmSingleExecution: boolean;
  readonly reason?: string;
  readonly now?: Date;
}

/**
 * Mecanismo controlado, manual, auditable y deshabilitado por defecto para otorgar
 * el primer conjunto de permisos administrativos (`security.admin`, `security.manage`, `users.manage`)
 * cuando la tabla `sitecorp_auth.operator_permissions` está completamente vacía.
 *
 * Propiedades de seguridad:
 * - Deshabilitado por defecto (`enabled` debe ser `true` y `confirmSingleExecution` debe ser `true`).
 * - Ejecución única (fail-closed): si `countActiveOperatorPermissions() > 0`, aborta con `BootstrapAlreadyInitializedError`.
 * - Exige que el usuario objetivo exista, esté `active` y haya completado su cambio de contraseña (`mustChangePassword === false`).
 * - Registra un evento de auditoría inmutable.
 */
export class InitialAdminBootstrapService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly permissionRepo: IOperatorPermissionRepository,
    private readonly auditService: ISecurityAuditService,
    private readonly options: {
      readonly enabled: boolean;
      readonly txManager?: ITransactionManager;
    } = { enabled: false }
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.options.txManager) {
      return this.options.txManager.runInTransaction(() => work());
    }
    return work();
  }

  public async bootstrapFirstAdmin(
    input: InitialAdminBootstrapInput
  ): Promise<readonly OperatorPermissionRecord[]> {
    if (!this.options.enabled || input.confirmSingleExecution !== true) {
      throw new BootstrapDisabledError();
    }

    const now = input.now ?? new Date();

    return this.executeInTx(async () => {
      const existingCount =
        await this.permissionRepo.countActiveOperatorPermissions();
      if (existingCount > 0) {
        throw new BootstrapAlreadyInitializedError();
      }

      const user = this.userRepo.findByIdForUpdate
        ? await this.userRepo.findByIdForUpdate(input.targetUserId)
        : await this.userRepo.findById(input.targetUserId);

      if (!user || !user.isActive() || user.mustChangePassword) {
        throw new ForbiddenError(
          "El usuario objetivo para bootstrap inicial debe existir, estar activo y no requerir cambio de contraseña pendiente."
        );
      }

      const reason = input.reason?.trim() || "INITIAL_ADMIN_BOOTSTRAP";
      const grantedRecords: OperatorPermissionRecord[] = [];

      for (const permission of ALL_OPERATOR_PERMISSIONS) {
        const record = await this.permissionRepo.grantPermission({
          userId: user.id,
          permission,
          grantedBy: null,
          grantReason: reason,
          allowBootstrapNullGranter: true,
          now,
        });
        grantedRecords.push(record);
      }

      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "USER_ACTIVATED", {
          userId: user.id,
          metadata: {
            action: "INITIAL_ADMIN_BOOTSTRAP",
            grantedPermissions: [...ALL_OPERATOR_PERMISSIONS],
            reason,
          },
          now,
        })
      );

      return Object.freeze(grantedRecords);
    });
  }
}
