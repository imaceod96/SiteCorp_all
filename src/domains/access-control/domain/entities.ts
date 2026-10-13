/**
 * Control de acceso — Entidades del dominio.
 *
 * Dos niveles, con la misma separación que impone la base de datos:
 *   NIVEL 1 — PLATAFORMA SITECORP → `platform_roles` / `platform_permissions`
 *   NIVEL 2 — ENTIDAD             → `tenant_roles` / `tenant_permissions`
 *
 * Un ROL pertenece a UN ámbito y define QUÉ puede hacer un usuario. El ACCESO a una
 * entidad define DÓNDE puede hacerlo (directo o heredado desde un ancestro).
 *
 * Las claves se conservan con la nomenclatura que devuelven las funciones SQL
 * (`tenant_membership_id`, `tenant_role_id`…): son columnas de salida de las RPC y
 * por tanto parte del contrato, tal como documenta la frontera de nomenclatura.
 */

/** Ámbito de un rol: plataforma (SiteCorp) o una entidad organizativa. */
export type RoleScope = "platform" | "organization"

/** Alcance de un acceso: sólo la entidad o ella y sus descendientes. */
export type AccessScope = "SELF" | "SELF_AND_DESCENDANTS"

/** Permiso del catálogo (interno de entidad o de plataforma). */
export interface PermissionOption {
  id: string
  code: string
  description: string | null
  /** Sólo en el ámbito de plataforma: grupo del catálogo. */
  category?: string | null
  /** Sólo en el ámbito de plataforma: pertenece al catálogo global de SiteCorp. */
  is_platform_scope?: boolean
}

/** Permiso interno de entidad (catálogo global de permisos internos). */
export interface EntityPermission {
  id: string
  code: string
  description: string | null
}

/** Permiso de plataforma (catálogo global de SiteCorp). */
export interface PlatformPermission extends PermissionOption {
  category: string | null
  is_platform_scope: boolean
}

/** Grupo de permisos para la interfaz (título + códigos que lo componen). */
export interface RolePermissionGroup {
  title: string
  codes: string[]
}

/** Rol con sus permisos y el número de usuarios que lo tienen asignado. */
export interface RoleRecord {
  id: string
  name: string
  description: string | null
  is_system_role: boolean
  is_active: boolean
  created_at: string
  permissionIds: string[]
  permissionCodes: string[]
  assignedUserCount: number
  organizationEntityId: string | null
}

/** Datos editables de un rol. */
export interface RoleForm {
  name: string
  description: string
  is_active: boolean
}

/** Carga completa de un ámbito de roles: los roles y el catálogo que admite. */
export interface RoleScopeWorkspace {
  roles: RoleRecord[]
  permissions: PermissionOption[]
}

/** Comando de alta/edición de un rol (incluye el cambio de estado y de permisos). */
export interface SaveRoleInput {
  scope: RoleScope
  /** Obligatorio en el ámbito de entidad: el rol pertenece a UNA entidad. */
  organizationEntityId?: string
  roleId: string | null
  name: string
  description: string
  isActive: boolean
  permissionIds: string[]
}

/* ------------------------------------------------------------------ */
/* Usuarios y accesos a una entidad                                    */
/* ------------------------------------------------------------------ */

/**
 * Fila de acceso devuelta por `list_entity_user_access`: incluye TANTO los accesos
 * directos como los heredados de un ancestro con alcance a descendientes.
 */
export interface EntityAccessRow {
  access_id: string
  tenant_membership_id: string
  user_id: string
  full_name: string | null
  username: string | null
  profile_is_active: boolean
  tenant_role_id: string
  role_name: string
  source_entity_id: string
  source_entity_name: string
  access_scope: AccessScope
  is_direct: boolean
}

/**
 * Fila de `list_entity_permissions`: el CÓDIGO de permiso efectivo del solicitante en
 * una entidad, tal como lo resuelve el backend (jerarquía, alcance y ámbito del rol).
 */
export interface EntityPermissionCodeRow {
  permission_code: string
}

/** Membresía del cliente (la columna física la resuelve la frontera de nomenclatura). */
export interface ClientMembership {
  id: string
  user_id: string
  tenant_id: string
  is_active: boolean
}

/** Rol interno de la entidad, como opción asignable. */
export interface EntityRoleOption {
  id: string
  name: string
  is_active: boolean
}

/** Perfil del usuario (nombre y nombre de usuario para mostrar). */
export interface UserProfile {
  id: string
  full_name: string | null
  username: string | null
  is_active: boolean
}

/** Todo lo que necesita la gestión de usuarios de una entidad. */
export interface EntityAccessWorkspace {
  accessRows: EntityAccessRow[]
  memberships: ClientMembership[]
  profiles: UserProfile[]
  roles: EntityRoleOption[]
  canManage: boolean
  canInvite: boolean
}

/** Vista de sólo lectura del acceso a una entidad (pantalla de usuarios). */
export interface EntityAccessOverview {
  accessRows: EntityAccessRow[]
  canManage: boolean
}

/** Alta de un acceso directo de un usuario a una entidad. */
export interface AssignEntityAccessInput {
  entityId: string
  membershipId: string
  roleId: string
  accessScope: AccessScope
  /** Usuario que autoriza la asignación (se registra en `assigned_by`). */
  assignedBy: string
}

/** Invitación a una entidad concreta (crea acceso sólo a esa entidad al aceptarse). */
export interface InviteToEntityInput {
  clientId: string
  entityId: string
  email: string
  roleId: string
  accessScope: AccessScope
  /** Usuario que invita (se registra en `invited_by`). */
  invitedBy: string
}
