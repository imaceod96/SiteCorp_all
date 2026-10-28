/**
 * Control de acceso — Reglas PURAS del ciclo de vida de la contraseña inicial.
 *
 * Define el TRI-ESTADO del requisito de cambio y la validación de fortaleza. No habla con
 * Supabase ni con React: la decisión de acceso real vive en el backend (RLS + helper SQL).
 */

/** Resultado de intentar leer el ciclo de vida del usuario autenticado. */
export type PasswordLifecycleRead =
  | { status: "record"; mustChange: boolean }
  | { status: "none" }
  | { status: "error" }

/**
 * Requisito de cambio obligatorio de contraseña:
 *   · `required`     → debe cambiarla antes de operar con normalidad.
 *   · `not_required` → acceso normal (incluye usuarios legacy SIN fila de ciclo de vida).
 *   · `unverified`   → no se pudo comprobar: NUNCA se asume `not_required`.
 */
export type PasswordRequirement = "required" | "not_required" | "unverified"

/**
 * Traduce la lectura del ciclo de vida en un requisito de acceso.
 *
 * Regla de seguridad: un ERROR de lectura NO es «no requerido» — se marca `unverified` para
 * no conceder acceso indebidamente. La ausencia de fila es un usuario legacy (`not_required`).
 */
export function resolvePasswordRequirement(read: PasswordLifecycleRead): PasswordRequirement {
  if (read.status === "error") return "unverified"
  if (read.status === "none") return "not_required"
  return read.mustChange ? "required" : "not_required"
}

/** Longitud mínima de la contraseña nueva (coherente con la política del servidor). */
export const PASSWORD_MIN_LENGTH = 12

/**
 * Validación de fortaleza de la contraseña nueva. Devuelve el mensaje de usuario o `null`.
 *
 * No sustituye a la validación del servidor (la Edge Function vuelve a validar): es la
 * comprobación inmediata de la interfaz para dar respuesta sin ir y volver.
 */
export function passwordStrengthError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
  }
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una minúscula."
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una mayúscula."
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir al menos un número."
  if (!/[^A-Za-z0-9]/.test(password)) return "La contraseña debe incluir al menos un símbolo."
  return null
}
