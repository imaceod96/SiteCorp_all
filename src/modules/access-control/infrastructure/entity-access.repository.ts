import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectQuery,
  tableName,
} from "@/integrations/supabase/schema-target"
import type {
  AssignEntityAccessInput,
  ClientMembership,
  EntityAccessRow,
  EntityPermissionCodeRow,
  EntityRoleOption,
  InviteToEntityInput,
  UserProfile,
} from "../domain/entities"

/**
 * Control de acceso — Repositorio de usuarios y accesos (infraestructura).
 *
 * Único punto que habla con Supabase para el acceso de usuarios a una entidad.
 * Nombres de tabla y columna se resuelven con la FRONTERA DE NOMENCLATURA, así que las
 * claves de JavaScript (`tenant_membership_id`, `tenant_role_id`, `tenant_id`) siguen
 * siendo las mismas que devuelven las funciones SQL.
 *
 * La VISIBILIDAD no se calcula aquí: `list_entity_user_access` (SECURITY DEFINER) es la
 * que decide qué usuarios ve el solicitante y cuáles son accesos directos o heredados,
 * respetando el aislamiento entre clientes. Las escrituras quedan sujetas a RLS y a los
 * permisos `users.manage` / `users.invite` del backend.
 */

/**
 * Comprueba un permiso interno del solicitante en una entidad concreta.
 *
 * Es el ÚNICO envoltorio de `can_access_entity` de toda la aplicación: ningún otro
 * dominio ni la presentación invocan esa RPC. Los parámetros
 * (`target_entity_id`, `permission_code`) y el código del permiso son el contrato del
 * backend y no cambian.
 */
export async function rpcCanAccessEntity(
  entityId: string,
  permissionCode: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_access_entity", {
    target_entity_id: entityId,
    permission_code: permissionCode,
  })
  if (error) throw error
  return Boolean(data)
}

/**
 * Acceso de LECTURA a una entidad (`can_view_entity`, SECURITY DEFINER): responde si el
 * solicitante puede ver la entidad, sin pedir un permiso concreto. No concede nada por sí
 * sola; el backend sigue decidiendo en cada operación.
 */
export async function rpcCanViewEntity(entityId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_view_entity", {
    target_entity_id: entityId,
  })
  if (error) throw error
  return Boolean(data)
}

/**
 * Códigos de permiso EFECTIVOS del solicitante en una entidad.
 *
 * La resolución es del backend (`list_entity_permissions`): aplica exactamente la misma
 * regla que las políticas RLS (acceso a la entidad, pertenencia del rol, jerarquía y
 * alcance SELF / SELF_AND_DESCENDANTS). El frontend nunca decide el acceso por sí solo.
 */
export async function rpcListEntityPermissionCodes(
  entityId: string
): Promise<EntityPermissionCodeRow[]> {
  const { data, error } = await supabase.rpc("list_entity_permissions", {
    target_entity_id: entityId,
  })
  if (error) throw error
  return (data as EntityPermissionCodeRow[] | null) || []
}

/** Usuarios con acceso a la entidad (directo o heredado), tal como los ve el solicitante. */
export async function rpcListEntityUserAccess(entityId: string): Promise<EntityAccessRow[]> {
  const { data, error } = await supabase.rpc("list_entity_user_access", {
    target_entity_id: entityId,
  })
  if (error) throw error
  return (data as EntityAccessRow[] | null) || []
}

/** Membresías activas del cliente: los usuarios que pueden recibir acceso. */
export async function selectClientMemberships(clientId: string): Promise<ClientMembership[]> {
  const { data, error } = await supabase
    .from(tableName("memberships"))
    .select(selectQuery(`id,user_id,${selectColumn("clientId")},is_active`))
    .eq(columnName("clientId"), clientId)
    .eq("is_active", true)

  if (error) throw error
  return (data as ClientMembership[] | null) || []
}

/** Perfiles de los usuarios indicados (nunca se consulta el catálogo completo). */
export async function selectUserProfiles(userIds: string[]): Promise<UserProfile[]> {
  if (userIds.length === 0) return []

  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,username,is_active")
    .in("id", userIds)

  if (error) throw error
  return (data as UserProfile[] | null) || []
}

/**
 * Roles PROPIOS de esta entidad (activos). Un rol de otra entidad del mismo cliente
 * nunca es asignable aquí y el backend lo rechaza además.
 */
export async function selectEntityRoleOptions(entityId: string): Promise<EntityRoleOption[]> {
  const { data, error } = await supabase
    .from(tableName("roles"))
    .select("id,name,is_active")
    .eq("organization_entity_id", entityId)
    .eq("is_active", true)
    .order("name")

  if (error) throw error
  return (data as EntityRoleOption[] | null) || []
}

/** Alta de un acceso DIRECTO de un usuario a la entidad, con su rol y alcance. */
export async function insertEntityUserAccess(input: AssignEntityAccessInput): Promise<void> {
  const { error } = await supabase.from("entity_user_access").insert({
    [columnName("membershipId")]: input.membershipId,
    organization_entity_id: input.entityId,
    [columnName("roleId")]: input.roleId,
    access_scope: input.accessScope,
    is_active: true,
    assigned_by: input.assignedBy,
  })

  if (error) throw error
}

/** Revocación de un acceso directo (se desactiva; el histórico no se borra). */
export async function deactivateEntityUserAccess(accessId: string): Promise<void> {
  const { error } = await supabase
    .from("entity_user_access")
    .update({ is_active: false })
    .eq("id", accessId)

  if (error) throw error
}

/**
 * Registro de una invitación a la entidad. Se fija el cliente propietario y el rol
 * interno de la entidad; al aceptarse se crea o activa la membresía y el acceso.
 */
export async function insertEntityInvitation(
  input: InviteToEntityInput,
  expiresAt: string
): Promise<void> {
  const { error } = await supabase.from(tableName("invitations")).insert({
    [columnName("clientId")]: input.clientId,
    email: input.email,
    [columnName("roleId")]: input.roleId,
    organization_entity_id: input.entityId,
    access_scope: input.accessScope,
    invited_by: input.invitedBy,
    status: "pending",
    expires_at: expiresAt,
  })

  if (error) throw error
}
