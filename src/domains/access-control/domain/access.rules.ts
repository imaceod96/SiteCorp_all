import type { AccessScope, EntityAccessRow, UserProfile } from "./entities"

/**
 * Control de acceso — Reglas puras del acceso de usuarios a una entidad.
 *
 * Un usuario puede llegar a una entidad por dos vías, y la interfaz las separa
 * siempre para que no se confundan:
 *   · acceso DIRECTO   → asignación exacta a esta entidad;
 *   · acceso HEREDADO  → concedido por un ancestro con alcance a descendientes.
 *
 * La concesión efectiva (y su revocación) la decide el backend: RLS, las comprobaciones
 * de `entity_user_access` y los permisos `users.manage` / `users.invite`. Aquí sólo se
 * etiqueta, se reparte y se traduce el error.
 */

/** Etiqueta legible del alcance de un acceso. */
export const ACCESS_SCOPE_LABELS: Record<AccessScope, string> = {
  SELF: "Solo esta entidad",
  SELF_AND_DESCENDANTS: "Esta entidad y sus descendientes",
}

const PERMISSION_ERROR_MESSAGES: Record<string, string> = {
  "users.manage": "Necesitas permiso para gestionar usuarios en esta entidad.",
  "users.invite": "Necesitas permiso para invitar usuarios en esta entidad.",
}

/** Mensaje legible de las operaciones de acceso (mismos textos que ya veía el usuario). */
export const friendlyAccessError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()

  if (normalized.includes("duplicate key") || normalized.includes("unique constraint")) {
    return "Ya existe una asignación idéntica para este usuario, entidad y rol."
  }
  if (normalized.includes("row-level security")) {
    return "No tienes permiso para realizar esta acción en esta entidad."
  }
  if (normalized.includes("must belong to the same organization entity")) {
    return "El rol seleccionado no pertenece a esta entidad. Selecciona un rol interno de esta entidad."
  }
  if (normalized.includes("invitation role must belong to the invited")) {
    return "El rol de la invitación debe pertenecer a esta entidad."
  }
  if (normalized.includes("entity invitations require an organization role")) {
    return "Las invitaciones desde una entidad requieren un rol interno de esa entidad."
  }
  if (normalized.includes("users.manage") || normalized.includes("users.invite")) {
    const permission = normalized.includes("users.invite") ? "users.invite" : "users.manage"
    return PERMISSION_ERROR_MESSAGES[permission]
  }
  return message || fallback
}

/** Reparte las filas devueltas por el backend entre accesos directos y heredados. */
export function accessRowsByOwnership(rows: EntityAccessRow[]): {
  direct: EntityAccessRow[]
  inherited: EntityAccessRow[]
} {
  return {
    direct: rows.filter((row) => row.is_direct),
    inherited: rows.filter((row) => !row.is_direct),
  }
}

/** Nombre visible de un usuario: el del acceso y, en su defecto, el de su perfil. */
export function accessDisplayName(
  row: Pick<EntityAccessRow, "full_name" | "user_id">,
  profile?: UserProfile
): string {
  return row.full_name || profile?.full_name || "Usuario"
}

/** Nombre de usuario visible (nunca vacío). */
export function accessUsername(
  row: Pick<EntityAccessRow, "username">,
  profile?: UserProfile
): string {
  return row.username || profile?.username || "sin usuario"
}

/** Etiqueta que sustituye al rol cuando el solicitante no puede gestionar roles. */
export const RESTRICTED_ROLE_LABEL = "Restringido"

/**
 * Etiqueta del rol de una fila con rol (acceso de usuario o invitación). El backend oculta
 * el rol (`null`) a quien no tiene permisos de gestión de roles, de modo que la interfaz
 * NUNCA afirma que no hay rol: distingue «restringido» de «sin rol».
 */
export function accessRoleLabel(row: { role_name: string | null }): string {
  return row.role_name ?? RESTRICTED_ROLE_LABEL
}

/** Etiqueta de una membresía del cliente en el selector de usuarios. */
export function membershipLabel(
  membership: { id: string; user_id: string },
  profile?: UserProfile
): string {
  return profile?.full_name || profile?.username || membership.user_id
}

/**
 * Vigencia de una invitación a entidad: una semana desde su registro. Se calcula aquí
 * para que el valor sea único y verificable, no disperso por la interfaz.
 */
export const INVITATION_VALIDITY_DAYS = 7

export function invitationExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
}
