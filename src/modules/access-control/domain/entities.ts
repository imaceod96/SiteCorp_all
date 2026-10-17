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
  /**
   * Si el solicitante puede consultar la MATRIZ rol↔permiso de este ámbito.
   *
   * En plataforma la matriz sólo la devuelve el backend a quien tiene
   * `platform_roles.manage` efectivo (o es SuperAdmin): `platform_roles.view` permite ver
   * los roles, pero NO sus permisos. Cuando es `false`, los roles llegan SIN permisos y la
   * interfaz debe mostrar el modo consulta en lugar de una lista vacía engañosa.
   */
  canReadPermissionMatrix: boolean
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
  /**
   * Rol asignado, OCULTO (`null`) cuando el solicitante no puede gestionar roles: el
   * backend (`list_entity_user_access`) sólo lo devuelve a quien tiene permisos de
   * gestión de roles en ese ámbito o al propio interesado. `users.view` permite ver los
   * usuarios de la entidad, pero no los roles que tienen asignados.
   */
  tenant_role_id: string | null
  role_name: string | null
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

/* ------------------------------------------------------------------ */
/* CUENTA Y SESIÓN (autenticación)                                     */
/* ------------------------------------------------------------------ */

/**
 * Perfil del usuario autenticado, tal como lo devuelve `public.profiles`.
 *
 * El correo NO vive aquí (está en `auth.users` y no se expone): la sesión lo aporta el
 * objeto de usuario de Supabase Auth. Este módulo NO configura la autenticación ni cambia
 * ninguna política: sólo la consulta.
 */
export interface AuthProfileRecord {
  id: string
  username: string | null
  full_name: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

/** Cliente propietario resumido, embebido en una membresía. */
export interface AuthTenantSummary {
  id: string
  name: string
}

/** Membresía ACTIVA de la sesión con su cliente propietario. */
export interface AuthMembershipRecord {
  id: string
  tenant_id: string
  user_id: string
  is_active: boolean
  tenant: AuthTenantSummary | null
}

/**
 * Identidad completa de la sesión: el perfil, su estado y el nivel de plataforma.
 *
 * Es el resultado de UNA sola secuencia de carga: perfil → estado → (cierre de sesión si el
 * perfil está inactivo) → superadministrador → usuario de plataforma → membresías activas.
 */
export interface AuthenticatedIdentity {
  profile: AuthProfileRecord | null
  isProfileActive: boolean
  isPlatformSuperAdmin: boolean
  isPlatformUser: boolean
  memberships: AuthMembershipRecord[]
  /** La sesión se cerró porque el perfil estaba inactivo (`is_active === false`). */
  signedOut: boolean
}

/**
 * Datos editables por el propio usuario en su cuenta.
 *
 * El avatar no forma parte de este formulario: `profiles.avatar_url` guarda la RUTA del objeto
 * en el bucket privado y la cambia exclusivamente la operación de avatar.
 */
export interface ProfileAccountInput {
  fullName: string
  username: string
}

/** Ruta del objeto de avatar guardada en `profiles.avatar_url` (nunca una URL). */
export type AvatarPath = string

/** URL firmada vigente del avatar, con su caducidad en milisegundos. */
export interface SignedAvatarUrl {
  url: string
  expiresAt: number
}

/* ------------------------------------------------------------------ */
/* ADMINISTRACIÓN DE PLATAFORMA (Nivel 1 — SiteCorp)                   */
/* ------------------------------------------------------------------ */

/** Rol de plataforma, como registro administrable. */
export interface PlatformRole {
  id: string
  name: string
  description: string | null
  is_system_role: boolean
  is_active: boolean
}

/** Rol de plataforma ASIGNADO a un usuario (lo que la tabla muestra como etiqueta). */
export interface PlatformRoleRef {
  name: string
  is_system_role: boolean
}

/**
 * Fila de `platform_user_roles` con su rol embebido. La relación es de a-uno, pero la
 * consulta original la trataba como lista (`.map(...).flat()`): la proyección conserva
 * EXACTAMENTE esa forma para no cambiar el resultado.
 */
export interface PlatformUserRoleRow {
  platform_role_id: string
  platform_roles: PlatformRoleRef[]
}

/**
 * Usuario de plataforma: fila de `profiles` más los roles de plataforma asignados.
 *
 * `email` puede venir ausente porque `public.profiles` no almacena el correo (vive en
 * `auth.users`); es el mismo contrato que ya consumía la pantalla.
 */
export interface PlatformUser {
  id: string
  full_name: string
  username: string
  email?: string
  is_active: boolean
  created_at: string
  roles: PlatformRoleRef[]
}

/**
 * Alta de un usuario de plataforma (la ejecuta la Edge Function del backend).
 *
 * NO incluye contraseña: la genera SIEMPRE el servidor de forma aleatoria y segura. El
 * navegador nunca propone ni conoce la contraseña antes del alta.
 */
export interface CreatePlatformUserInput {
  fullName: string
  username: string
  email: string
  isActive: boolean
  platformRoleId: string | null
}

/**
 * Resultado del alta de un usuario de plataforma.
 *
 * Transporta la CONTRASEÑA INICIAL generada por el servidor, que se muestra UNA SOLA VEZ al
 * administrador autorizado y nunca se persiste. No debe guardarse en almacenamiento
 * persistente ni incluirse en logs o telemetría.
 */
export interface CreatedPlatformUser {
  userId: string
  email: string
  username: string
  fullName: string
  platformRoleId: string | null
  initialPassword: string
}

/** Edición de los datos editables de un usuario (nunca el correo ni la contraseña). */
export interface UpdatePlatformUserInput {
  userId: string
  fullName: string
  username: string
}

/* ------------------------------------------------------------------ */
/* USUARIOS E INVITACIONES DE UN CLIENTE (Nivel 2 — cliente)           */
/* ------------------------------------------------------------------ */

/** Membresía de un cliente (incluye las INACTIVAS: el listado administrativo no filtra). */
export interface ClientMembershipRow {
  id: string
  user_id: string
  tenant_id: string
  is_active: boolean
  created_at: string
}

/** Asignación de rol de cliente a una membresía, con el rol embebido. */
export interface ClientUserRoleRow {
  tenant_membership_id: string
  tenant_role_id: string
  tenant_roles: { name: string | null } | null
}

/** Usuario de un cliente, ya compuesto para el listado administrativo. */
export interface ClientUser {
  id: string
  full_name: string
  username: string
  email: string
  is_active: boolean
  membership_status: string
  invitation_status: string
  role_name: string
  created_at: string
}

/**
 * Fila de `list_company_client_invitations`: la invitación con su rol, ENMASCARADO
 * (`role_id`/`role_name` nulos) cuando el solicitante no puede gestionar roles en el
 * ámbito de la invitación. La consulta de invitaciones NO depende del rol.
 */
export interface ClientInvitationRow {
  invitation_id: string
  email: string
  status: string
  expires_at: string | null
  accepted_at: string | null
  created_at: string
  organization_entity_id: string | null
  access_scope: string | null
  role_id: string | null
  role_name: string | null
}

/** Invitación de un cliente, ya compuesta para el listado. */
export interface ClientInvitation {
  id: string
  email: string
  role_name: string
  status: string
  expires_at: string
  created_at: string
}

/** Alta de una invitación a nivel de CLIENTE (sin entidad ni alcance). */
export interface SendClientInvitationInput {
  clientId: string
  email: string
  /** Rol de cliente; `null` cuando la invitación no lleva rol asignado. */
  roleId: string | null
  /** Usuario que invita. Si falta, la columna no se envía (mismo comportamiento previo). */
  invitedBy?: string
}
