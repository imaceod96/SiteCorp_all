/**
 * Control de acceso — Interfaz pública del dominio.
 *
 * Punto único de entrada para los consumidores (páginas y componentes):
 *   import { loadRoleScopeWorkspace } from "@/domains/access-control"
 *
 * Estructura:
 *   domain/entities.ts               → tipos y contratos
 *   domain/permissions.catalog.ts    → catálogos de permisos (etiquetas y agrupación)
 *   domain/roles.rules.ts            → reglas de roles (protección, ámbito, errores)
 *   domain/access.rules.ts           → reglas de acceso de usuarios
 *   application/                     → consultas y comandos (roles, usuarios, accesos)
 *   infrastructure/                  → Supabase y RPC
 *
 * Contexto propio y DELIMITADO: roles, permisos y acceso de usuarios. No depende de
 * ningún otro dominio (la dependencia va siempre presentación → dominio → Supabase),
 * por lo que no puede formarse un ciclo. La autorización efectiva sigue siendo del
 * backend: RLS, `can_access_entity`, `has_platform_permission` y los RPC de roles y accesos.
 *
 * Es el ÚNICO lugar desde el que se preguntan las dos familias de permisos: los internos
 * de una entidad (`can_access_entity` / `can_view_entity` / `list_entity_permissions`) y los
 * de plataforma (`has_platform_permission`). Los consumidores —incluido el proveedor de
 * autenticación— delegan aquí y no mantienen envoltorios propios.
 */

/* Tipos y contratos */
export type {
  AccessScope,
  AssignEntityAccessInput,
  ClientMembership,
  EntityAccessOverview,
  EntityAccessRow,
  EntityAccessWorkspace,
  EntityPermission,
  EntityRoleOption,
  InviteToEntityInput,
  PermissionOption,
  PlatformPermission,
  RoleForm,
  RolePermissionGroup,
  RoleRecord,
  RoleScope,
  RoleScopeWorkspace,
  SaveRoleInput,
  UserProfile,
} from "./domain/entities"

/* Catálogos de permisos (reglas puras) */
export {
  ENTITY_PERMISSION_GROUPS,
  ENTITY_PERMISSION_LABELS,
  LEGACY_PERMISSION_PATTERN,
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_PERMISSION_LABELS,
  entityPermissionLabel,
  groupEntityPermissions,
  groupPlatformPermissions,
  isInternalPermissionCode,
  platformPermissionLabel,
} from "./domain/permissions.catalog"

/* Reglas de roles */
export {
  friendlyRoleSaveError,
  isProtectedRole,
  permissionGroupsFor,
  selectablePermissionsFor,
} from "./domain/roles.rules"

/* Reglas de acceso de usuarios */
export {
  ACCESS_SCOPE_LABELS,
  INVITATION_VALIDITY_DAYS,
  accessDisplayName,
  accessRowsByOwnership,
  accessUsername,
  friendlyAccessError,
  invitationExpiresAt,
  membershipLabel,
} from "./domain/access.rules"

/* Consultas */
export {
  canViewEntity,
  loadEntityAccessOverview,
  loadEntityAccessWorkspace,
  loadEntityPermission,
  loadEntityPermissionCodes,
  loadEntityPermissionSafe,
  loadEntityPermissions,
  loadEntityUserAccess,
} from "./application/entity-access.queries"

/* Permisos de PLATAFORMA (Nivel 1 — Administración global de SiteCorp) */
export {
  loadPlatformPermission,
  loadPlatformPermissionSafe,
} from "./application/platform-permissions.queries"
export { loadRoleScopeWorkspace } from "./application/roles.queries"

/* Comandos */
export {
  assignEntityAccess,
  deactivateEntityAccess,
  inviteToEntity,
} from "./application/entity-access.commands"
export { deleteRole, saveRole } from "./application/roles.commands"

/* Repositorio de catálogos (único acceso a la tabla de permisos) */
export {
  fetchEntityPermissionCatalog,
  fetchPlatformPermissionCatalog,
} from "./infrastructure/permissions.repository"
