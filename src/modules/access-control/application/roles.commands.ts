import { deleteRoleRecord, saveRoleRecord } from "../infrastructure/roles.repository"
import type { RoleScope, SaveRoleInput } from "../domain/entities"

/**
 * Control de acceso — Comandos de roles (aplicación).
 *
 * Alta, edición (incluye cambiar el estado o los permisos de un rol existente) y
 * eliminación. La comprobación de ámbito, la propiedad del rol, la protección de los
 * roles del sistema y los permisos efectivos los impone el backend en
 * `save_platform_role`, `save_entity_role` y `delete_entity_role`: aquí sólo se valida
 * la precondición de nombre, que también rechaza el servidor.
 */

export async function saveRole(input: SaveRoleInput): Promise<void> {
  if (!input.name.trim()) {
    throw new Error("Role name is required")
  }
  await saveRoleRecord(input)
}

/** Elimina un rol del ámbito indicado (el backend rechaza los protegidos y asignados). */
export async function deleteRole(input: {
  scope: RoleScope
  roleId: string
}): Promise<void> {
  await deleteRoleRecord(input)
}
