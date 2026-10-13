import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectQuery,
  tableName,
} from "@/integrations/supabase/schema-target"
import type { RoleScope, SaveRoleInput } from "../domain/entities"

/**
 * Control de acceso — Repositorio de roles (infraestructura).
 *
 * Único punto que habla con Supabase para roles, sus permisos y sus asignaciones.
 * Nombres de tabla y columna se resuelven con la FRONTERA DE NOMENCLATURA
 * (`tenant_roles` → `company_client_roles`), de modo que las claves de JavaScript que
 * consume la interfaz (`tenant_role_id`, `tenant_permission_id`…) no cambian aunque el
 * nombre físico sí.
 *
 * Dos ámbitos, nunca mezclados:
 *   · plataforma → `platform_roles` / `platform_role_permissions` / `platform_user_roles`
 *   · entidad    → roles del cliente por `organization_entity_id` (el rol pertenece a UNA
 *                  entidad, no al cliente) con `save_entity_role` / `delete_entity_role`
 *
 * Ninguna operación amplía permisos: las RPC y RLS siguen siendo la autoridad final.
 */

/** Fila de rol. `organization_entity_id` sólo existe en los roles de entidad. */
export interface RoleRow {
  id: string
  name: string
  description: string | null
  is_system_role: boolean
  is_active: boolean
  created_at: string
  organization_entity_id?: string | null
}

/** Par rol ↔ permiso (clave de permiso según el ámbito). */
export interface RolePermissionPair {
  roleId: string
  permissionId: string
}

/** Par rol ↔ usuario asignado (membresía en el ámbito de entidad). */
export interface RoleAssignmentPair {
  roleId: string
  userId: string
}

export interface RoleScopeRows {
  roleRows: RoleRow[]
  permissionPairs: RolePermissionPair[]
  assignments: RoleAssignmentPair[]
}

interface PlatformUserRoleRow {
  platform_role_id: string
  user_id: string
}

interface TenantUserRoleRow {
  tenant_role_id: string
  tenant_membership_id: string
}

interface RolePermissionMappingRow {
  platform_role_id?: string
  tenant_role_id?: string
  platform_permission_id?: string
  tenant_permission_id?: string
}

/**
 * Roles del ámbito con sus permisos y sus asignaciones. En el ámbito de entidad, las
 * asignaciones se cuentan sobre las DOS fuentes históricas (`entity_user_access` y la
 * tabla legacy de roles de usuario) para no perder ningún usuario asignado.
 */
export async function selectRoleScopeRows(
  scope: RoleScope,
  organizationEntityId?: string
): Promise<RoleScopeRows> {
  const isPlatform = scope === "platform"

  if (!isPlatform && !organizationEntityId) {
    return { roleRows: [], permissionPairs: [], assignments: [] }
  }

  const rolesRequest = isPlatform
    ? supabase.from("platform_roles").select("*").order("name")
    : supabase
        .from(tableName("roles"))
        .select("*")
        .eq("organization_entity_id", organizationEntityId as string)
        .order("name")

  const rolesResult = await rolesRequest
  if (rolesResult.error) throw rolesResult.error

  const roleRows: RoleRow[] = (rolesResult.data as RoleRow[] | null) || []
  const roleIds = roleRows.map((role) => role.id)

  const mappingsRequest =
    roleIds.length === 0
      ? Promise.resolve({ data: [] as RolePermissionMappingRow[], error: null })
      : isPlatform
        ? supabase
            .from("platform_role_permissions")
            .select("platform_role_id,platform_permission_id")
            .in("platform_role_id", roleIds)
        : supabase
            .from(tableName("rolePermissions"))
            .select(selectQuery(`${selectColumn("roleId")},${selectColumn("permissionId")}`))
            .in(columnName("roleId"), roleIds)

  const mappingsResult = await mappingsRequest
  if (mappingsResult.error) throw mappingsResult.error

  let assignments: RoleAssignmentPair[] = []

  if (roleIds.length > 0) {
    if (isPlatform) {
      const platformAssignments = await supabase
        .from("platform_user_roles")
        .select("platform_role_id,user_id")
        .in("platform_role_id", roleIds)
      if (platformAssignments.error) throw platformAssignments.error
      assignments = ((platformAssignments.data as PlatformUserRoleRow[] | null) || []).map(
        (row) => ({ roleId: row.platform_role_id, userId: row.user_id })
      )
    } else {
      const [entityAssignments, legacyAssignments] = await Promise.all([
        supabase
          .from("entity_user_access")
          .select(selectQuery(`${selectColumn("roleId")},${selectColumn("membershipId")}`))
          .in(columnName("roleId"), roleIds),
        supabase
          .from(tableName("userRoles"))
          .select(selectQuery(`${selectColumn("roleId")},${selectColumn("membershipId")}`))
          .in(columnName("roleId"), roleIds),
      ])
      if (entityAssignments.error) throw entityAssignments.error
      if (legacyAssignments.error) throw legacyAssignments.error

      assignments = [
        ...((entityAssignments.data as TenantUserRoleRow[] | null) || []),
        ...((legacyAssignments.data as TenantUserRoleRow[] | null) || []),
      ].map((row) => ({ roleId: row.tenant_role_id, userId: row.tenant_membership_id }))
    }
  }

  const mappings = (mappingsResult.data as RolePermissionMappingRow[] | null) || []
  const permissionPairs: RolePermissionPair[] = mappings.map((mapping) => ({
    roleId: (isPlatform ? mapping.platform_role_id : mapping.tenant_role_id) as string,
    permissionId: (isPlatform
      ? mapping.platform_permission_id
      : mapping.tenant_permission_id) as string,
  }))

  return { roleRows, permissionPairs, assignments }
}

/**
 * Alta o edición de un rol con su lista COMPLETA de permisos. El backend valida el
 * ámbito, la propiedad (`save_entity_role` exige la entidad) y que el rol del sistema
 * no se degrade.
 */
export async function saveRoleRecord(input: SaveRoleInput): Promise<void> {
  const request =
    input.scope === "platform"
      ? supabase.rpc("save_platform_role", {
          p_role_id: input.roleId,
          p_name: input.name,
          p_description: input.description,
          p_is_active: input.isActive,
          p_permission_ids: input.permissionIds,
        })
      : supabase.rpc("save_entity_role", {
          p_entity_id: input.organizationEntityId,
          p_role_id: input.roleId,
          p_name: input.name,
          p_description: input.description,
          p_is_active: input.isActive,
          p_permission_ids: input.permissionIds,
        })

  const { error } = await request
  if (error) throw error
}

/**
 * Eliminación de un rol. En el ámbito de entidad pasa SIEMPRE por `delete_entity_role`,
 * que comprueba la propiedad del rol y rechaza los protegidos o asignados.
 */
export async function deleteRoleRecord(input: {
  scope: RoleScope
  roleId: string
}): Promise<void> {
  if (input.scope === "platform") {
    const { error } = await supabase.from("platform_roles").delete().eq("id", input.roleId)
    if (error) throw error
    return
  }

  const { error } = await supabase.rpc("delete_entity_role", { p_role_id: input.roleId })
  if (error) throw error
}
