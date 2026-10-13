/**
 * Company Client — Reglas puras del dominio.
 *
 * Únicamente lógica independiente de React y de Supabase: comparación de
 * pertenencia al mismo cliente y comprobación de que un identificador es
 * utilizable antes de usarlo.
 *
 * Estas reglas NO sustituyen a RLS ni a `can_access_entity`: son validaciones de
 * forma previas al uso de un identificador, NUNCA autorización.
 */

import type { CompanyClientId } from "./entities"

/**
 * Normaliza un identificador para compararlo.
 *
 * `tenants.id` es `uuid`: su representación textual es insensible a mayúsculas,
 * por lo que se recortan los espacios y se unifica el caso antes de comparar.
 */
const normalize = (value: CompanyClientId): string => value.trim().toLowerCase()

/**
 * ¿El identificador existe y no está vacío?
 *
 * Comprueba SOLO presencia de valor: no valida formato, ni existencia en la
 * base de datos, ni permisos sobre el cliente.
 */
export function isCompanyClientId(
  value: CompanyClientId | null | undefined
): value is CompanyClientId {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * ¿Ambos identificadores pertenecen al MISMO cliente propietario?
 *
 * Comparación pura en memoria: no consulta Supabase y NO concede permiso
 * alguno sobre el cliente comparado.
 */
export function sameCompanyClient(
  a: CompanyClientId | null | undefined,
  b: CompanyClientId | null | undefined
): boolean {
  if (!isCompanyClientId(a) || !isCompanyClientId(b)) return false
  return normalize(a) === normalize(b)
}

/**
 * Mensaje de usuario para un fallo al GUARDAR un cliente.
 *
 * Regla pura de traducción de errores: no consulta nada, no concede nada y sólo
 * reescribe los fallos que el backend identifica con un significado estable
 * (permiso denegado por RLS y colisión del código generado). Cualquier otro mensaje
 * del servidor se conserva literal: el diagnóstico original nunca se descarta.
 */
export function companyClientNameError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "")
  if (message.toLowerCase().includes("row-level security")) {
    return "No tienes permiso para crear o editar clientes."
  }
  if (message.toLowerCase().includes("duplicate key")) {
    return "No se pudo generar un código único para el cliente. Inténtalo de nuevo."
  }
  return message || "No se pudo guardar el cliente."
}

/** Mensaje de usuario para un fallo al ELIMINAR un cliente (misma política de errores). */
export function companyClientDeletionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "")
  if (message.toLowerCase().includes("row-level security")) {
    return "No tienes permiso para eliminar clientes."
  }
  return message || "No se pudo eliminar el cliente."
}
