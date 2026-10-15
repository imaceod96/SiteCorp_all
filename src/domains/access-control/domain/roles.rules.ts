import {
  groupEntityPermissions,
  groupPlatformPermissions,
  isInternalPermissionCode,
} from "./permissions.catalog"
import type {
  EntityPermission,
  PermissionOption,
  PlatformPermission,
  RolePermissionGroup,
  RoleRecord,
  RoleScope,
} from "./entities"

/**
 * Control de acceso — Reglas puras de roles y permisos.
 *
 * Aquí vive lo que la interfaz debe poder decidir sin consultar nada:
 *   · qué rol es «del sistema» y por tanto está PROTEGIDO (no editable, no
 *     desactivable, no eliminable);
 *   · qué permisos se pueden ofrecer en cada ámbito (los de plataforma nunca se
 *     ofrecen dentro de una entidad y viceversa);
 *   · cómo se agrupa el catálogo para mostrarlo;
 *   · cómo se traduce el error del backend a un mensaje entendible.
 *
 * Las reglas duras siguen impuestas por el backend: los RPC `save_platform_role`,
 * `save_entity_role` y `delete_entity_role` validan ámbito, propiedad y permisos.
 * Ninguna comprobación del servidor se sustituye por una del cliente.
 */

/** Mensaje legible del guardado/borrado de un rol (mismos textos que ya veía el usuario). */
export const friendlyRoleSaveError = (scope: RoleScope, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  const roleLabel = scope === "platform" ? "rol de plataforma" : "rol de la entidad"

  if (
    normalized.includes("already exists") ||
    normalized.includes("duplicate key") ||
    normalized.includes("23505")
  ) {
    return `Ya existe un ${roleLabel} con ese nombre en este ámbito.`
  }
  if (normalized.includes("role name is required")) {
    return "El nombre del rol es obligatorio."
  }
  if (normalized.includes("reserved system role")) {
    return "SuperAdmin es un nombre reservado y no puede usarse en un rol personalizado."
  }
  if (normalized.includes("system role names cannot be changed")) {
    return "El nombre de un rol del sistema no puede cambiarse."
  }
  if (normalized.includes("activation status cannot be changed")) {
    return "El estado de un rol del sistema no puede cambiarse."
  }
  if (normalized.includes("system role administrador is protected")) {
    return "El rol Administrador es un rol del sistema protegido: no puede modificarse, desactivarse ni eliminarse."
  }
  if (normalized.includes("system organization role permissions cannot be reduced")) {
    return "Los permisos del rol Administrador no pueden reducirse ni cambiarse."
  }
  if (normalized.includes("system platform role permissions cannot")) {
    return "Los permisos de un rol del sistema de la plataforma no pueden reducirse ni cambiarse."
  }
  if (normalized.includes("platform system role is protected")) {
    return "Un rol del sistema de la plataforma no puede eliminarse."
  }
  if (normalized.includes("permission denied") || normalized.includes("row-level security")) {
    return scope === "platform"
      ? "No tienes permiso para gestionar roles de plataforma."
      : "Necesitas el permiso «Gestionar roles y permisos» dentro de esta entidad."
  }
  if (normalized.includes("permissions are invalid")) {
    return "Uno o más permisos seleccionados no son válidos."
  }
  if (normalized.includes("not internal entity permissions")) {
    return "Sólo puedes asignar permisos internos de entidad. Los permisos de plataforma no están disponibles aquí."
  }
  if (normalized.includes("only assign internal permissions")) {
    return "Sólo puedes asignar permisos internos que tú mismo tengas actualmente en esta entidad."
  }
  if (normalized.includes("only assign platform permissions")) {
    return "Solo puedes asignar permisos de plataforma que actualmente posees."
  }
  if (normalized.includes("role was not found in this entity") || normalized.includes("role was not found")) {
    return "El rol indicado no pertenece a esta entidad."
  }
  if (normalized.includes("cannot be deleted")) {
    return "El rol no puede eliminarse: tiene usuarios o invitaciones asignadas, o es un rol del sistema."
  }
  if (normalized.includes("workspace was not found")) {
    return "El cliente no existe."
  }
  return message || `No se pudo guardar el ${roleLabel}.`
}

/**
 * Un rol del sistema está PROTEGIDO en los DOS ámbitos: sus metadatos (nombre y estado) y
 * su conjunto de permisos no se tocan. El backend lo impone para cualquier rol de sistema
 * (`save_platform_role`, `protect_system_platform_role_permissions`,
 * `protect_system_company_client_role_permissions`), así que la interfaz no debe ofrecer
 * una edición que el servidor va a rechazar.
 */
export const isProtectedRole = (role: RoleRecord | null): boolean =>
  Boolean(role?.is_system_role)

/**
 * Permisos que se pueden ofrecer en cada ámbito:
 *   · plataforma → los marcados como de plataforma por el catálogo;
 *   · entidad    → sólo el catálogo global de permisos INTERNOS (nunca de plataforma).
 */
export function selectablePermissionsFor(
  scope: RoleScope,
  permissions: PermissionOption[]
): PermissionOption[] {
  if (scope === "platform") {
    return permissions.filter((permission) => permission.is_platform_scope !== false)
  }
  return permissions.filter((permission) => isInternalPermissionCode(permission.code))
}

/** Agrupación del catálogo ofrecible según el ámbito. */
export function permissionGroupsFor(
  scope: RoleScope,
  permissions: PermissionOption[]
): RolePermissionGroup[] {
  if (scope === "platform") {
    return groupPlatformPermissions(permissions as PlatformPermission[])
  }
  return groupEntityPermissions(permissions as EntityPermission[])
}
