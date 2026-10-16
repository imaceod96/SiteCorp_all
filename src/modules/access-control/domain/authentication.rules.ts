import type { AuthProfileRecord } from "./entities"

/**
 * Control de acceso — Reglas PURAS de la cuenta y la sesión.
 *
 * Sólo se traslada aquí lo que antes estaba disperso en la presentación: la validación de
 * la contraseña nueva, la regla de sesión de un perfil inactivo y la composición del nivel
 * de plataforma. No se cambia ningún texto, ninguna política ni la configuración de Supabase
 * Auth: la autoridad sigue siendo del backend (RLS y las RPC de plataforma).
 */

/**
 * Validación de la contraseña nueva en la pantalla de cuenta.
 *
 * Devuelve el mensaje de usuario o `null` si la pareja es válida. Es EXACTAMENTE el texto
 * que ya mostraba la pantalla: la migración es un traslado, no un cambio de mensajes.
 */
export function passwordChangeError(
  newPassword: string,
  confirmPassword: string
): string | null {
  if (newPassword !== confirmPassword) return "Las contraseñas nuevas no coinciden."
  return null
}

/**
 * Regla de SESIÓN del perfil: un perfil inactivo (`is_active === false`) no la mantiene.
 *
 * Ausencia de perfil o de la columna NO se consideran inactividad: sólo el `false` explícito
 * cierra la sesión, que es como se comportaba el proveedor de autenticación.
 */
export function profileIsActive(
  profile: Pick<AuthProfileRecord, "is_active"> | null | undefined
): boolean {
  return profile?.is_active !== false
}

/**
 * Nivel 1 de plataforma: el superadministrador ES también usuario de plataforma.
 *
 * La RPC `is_platform_user` ya contempla sus privilegios; el atajo se conserva para no
 * depender de una segunda respuesta contradictoria.
 */
export function isPlatformUserFlag(
  isPlatformUser: boolean,
  isPlatformSuperAdmin: boolean
): boolean {
  return isPlatformUser || isPlatformSuperAdmin
}
