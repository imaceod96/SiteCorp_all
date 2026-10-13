import { fetchEntityPermissionCatalog, fetchPlatformPermissionCatalog } from "../infrastructure/permissions.repository"
import { selectRoleScopeRows } from "../infrastructure/roles.repository"
import type { PermissionOption, RoleRecord, RoleScope, RoleScopeWorkspace } from "../domain/entities"

/**
 * Control de acceso — Consultas de roles (aplicación).
 *
 * Compone la vista de un ámbito: los roles del ámbito con sus permisos y sus usuarios
 * asignados, más el catálogo de permisos que ese ámbito admite. La consulta se hace
 * POR ÁMBITO: nunca se mezclan los roles de plataforma con los de una entidad, ni los de
 * una entidad con los de otra.
 */

/**
 * Carga el ámbito indicado. En el ámbito de entidad sin entidad seleccionada devuelve
 * una vista vacía SIN consultar nada: no se comparte caché entre entidades.
 */
export async function loadRoleScopeWorkspace(input: {
  scope: RoleScope
  organizationEntityId?: string
}): Promise<RoleScopeWorkspace> {
  const isPlatform = input.scope === "platform"

  if (!isPlatform && !input.organizationEntityId) {
    return { roles: [], permissions: [] }
  }

  const [rows, permissions] = await Promise.all([
    selectRoleScopeRows(input.scope, input.organizationEntityId),
    isPlatform ? fetchPlatformPermissionCatalog() : fetchEntityPermissionCatalog(),
  ])

  const roles: RoleRecord[] = rows.roleRows.map((role) => {
    const permissionIds = rows.permissionPairs
      .filter((pair) => pair.roleId === role.id)
      .map((pair) => pair.permissionId)

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      is_system_role: role.is_system_role,
      is_active: role.is_active,
      created_at: role.created_at,
      permissionIds,
      permissionCodes: permissionIds
        .map(
          (permissionId) =>
            (permissions as PermissionOption[]).find(
              (permission) => permission.id === permissionId
            )?.code
        )
        .filter((code): code is string => Boolean(code)),
      assignedUserCount: new Set(
        rows.assignments.filter((assignment) => assignment.roleId === role.id).map(
          (assignment) => assignment.userId
        )
      ).size,
      organizationEntityId: role.organization_entity_id || null,
    }
  })

  return { roles, permissions: permissions as PermissionOption[] }
}
