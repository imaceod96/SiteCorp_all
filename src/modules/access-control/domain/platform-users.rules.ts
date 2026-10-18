import type { PlatformRole, PlatformUser } from "./entities"

/**
 * Control de acceso — Reglas de la ELIMINACIÓN de usuarios de plataforma (puras).
 *
 * Estas reglas NO autorizan nada: sólo explican en la interfaz por qué una eliminación no
 * debe ofrecerse. La autoridad real es el servidor (Edge Function `delete-platform-user`),
 * que revalida el rol del llamante, la cuenta propia y la última cuenta de SuperAdmin.
 *
 * Se conservan aquí para que la interfaz nunca ofrezca una acción que el backend va a
 * rechazar, y para poder probarlas sin tocar la base de datos.
 */

/**
 * El usuario tiene el rol de sistema `SuperAdmin`.
 *
 * La proyección de roles que consume la pantalla no incluye el estado del rol, así que aquí
 * sólo se comprueba lo que sí llega (nombre + rol de sistema). El estado ACTIVO del rol lo
 * valida el servidor, que es la autoridad final.
 */
export function isPlatformSuperAdminUser(user: PlatformUser): boolean {
  return user.roles.some(
    (role) => role.name === "SuperAdmin" && role.is_system_role === true
  )
}

/** Número de cuentas ACTIVAS con rol SuperAdmin. */
export function countActivePlatformSuperAdmins(users: PlatformUser[]): number {
  return users.filter((user) => user.is_active && isPlatformSuperAdminUser(user)).length
}

export const SELF_DELETION_MESSAGE = "No puedes eliminar tu propia cuenta."
export const LAST_SUPERADMIN_MESSAGE =
  "No se puede eliminar la última cuenta de SuperAdmin activa."

/**
 * Motivo por el que NO debe ofrecerse la eliminación, o `null` si la acción es admisible.
 *
 * Mismas condiciones que aplica el servidor: nunca la cuenta fundadora, nunca la cuenta propia
 * y nunca la última cuenta activa de SuperAdmin.
 */
export function platformUserDeletionBlockReason(input: {
  currentUserId: string | null | undefined
  target: PlatformUser
  users: PlatformUser[]
  /**
   * UUID de la cuenta fundadora, cuando la sesión puede conocerlo. La cuenta fundadora no se
   * elimina por procedimientos administrativos: la base lo impide (clave foránea
   * `ON DELETE RESTRICT`) y el servidor lo rechaza, así que la interfaz no debe ofrecerlo ni a
   * otro SuperAdmin.
   */
  founderUserId?: string | null
}): string | null {
  const { currentUserId, target, users, founderUserId } = input

  if (founderUserId && target.id === founderUserId) {
    return FOUNDER_ACCOUNT_PROTECTED_MESSAGE
  }

  if (currentUserId && target.id === currentUserId) {
    return SELF_DELETION_MESSAGE
  }

  if (isPlatformSuperAdminUser(target) && countActivePlatformSuperAdmins(users) <= 1) {
    return LAST_SUPERADMIN_MESSAGE
  }

  return null
}

/** La confirmación escrita debe coincidir exactamente con el nombre de usuario. */
export function deletionConfirmationMatches(username: string, typed: string): boolean {
  return username.trim().toLowerCase() === typed.trim().toLowerCase() && typed.trim() !== ""
}

/* -------------------------------------------------------------------------- */
/* Rol SuperAdmin reservado a la cuenta fundadora                             */
/* -------------------------------------------------------------------------- */

/**
 * El rol es el SuperAdmin del sistema.
 *
 * El rol SuperAdmin se identifica por nombre + marca de sistema, igual que en la base
 * (`platform_roles.name = 'SuperAdmin' and is_system_role`). No hay roles paralelos.
 */
export function isSuperAdminPlatformRole(role: {
  name: string
  is_system_role: boolean
}): boolean {
  return role.name === "SuperAdmin" && role.is_system_role === true
}

export const SUPERADMIN_FOUNDER_ONLY_MESSAGE =
  "Solo la cuenta fundadora puede asignar o retirar el rol SuperAdmin."

export const FOUNDER_ACCOUNT_PROTECTED_MESSAGE =
  "La cuenta fundadora no se puede desactivar ni eliminar."

/**
 * Roles que la sesión actual puede ofrecer para asignar.
 *
 * A la cuenta fundadora no se le esconde nada; al resto se le retira el SuperAdmin. La
 * decisión es de presentación: la base rechaza cualquier intento que no venga del fundador
 * (disparador `enforce_founder_only_superadmin_role`).
 */
export function assignablePlatformRoles(
  roles: PlatformRole[],
  isFounder: boolean
): PlatformRole[] {
  if (isFounder) return roles
  return roles.filter((role) => !isSuperAdminPlatformRole(role))
}
