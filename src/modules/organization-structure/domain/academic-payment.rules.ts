import type { AcademicCategory } from "./entities"

/**
 * Pago por categoría académica — Reglas de dominio.
 *
 * Máster y Doctor NO son excluyentes: una persona puede tener ambos títulos. La
 * resolución salarial usa la categoría SUPERIOR (Doctor tiene prioridad) y nunca suma
 * los dos importes.
 *
 * La resolución definitiva (importe y alcance) la hace el backend; estas reglas son las
 * puras que comparten la pantalla de configuración y el resto de la aplicación.
 */

/** Categoría académica efectiva según los indicadores de la persona. */
export function resolveAcademicCategory(
  hasMastersDegree: boolean | null | undefined,
  hasDoctorateDegree: boolean | null | undefined
): AcademicCategory | null {
  if (hasDoctorateDegree) return "DOCTOR"
  if (hasMastersDegree) return "MASTER"
  return null
}

/** Etiqueta legible de una categoría académica. */
export function academicCategoryLabel(category: AcademicCategory | null): string {
  if (category === "DOCTOR") return "Doctor"
  if (category === "MASTER") return "Máster"
  return "Sin categoría académica"
}

/** Formato monetario único para importes en CUP. */
export function formatAcademicAmount(amount: number | null, currencyCode = "CUP"): string {
  if (amount === null || amount === undefined) return "No configurado"
  return `${amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} ${currencyCode}`
}

export type ParsedAcademicAmount = { valid: true; value: number | null } | { valid: false }

/**
 * Interpreta el importe introducido:
 *   ""            → válido, valor NULL (No configurado)
 *   "0"           → válido, valor 0 (configurado sin pago)
 *   "< 0" o texto → inválido
 */
export function parseAcademicAmount(raw: string): ParsedAcademicAmount {
  const trimmed = raw.trim()
  if (trimmed === "") return { valid: true, value: null }
  const parsed = Number(trimmed.replace(",", "."))
  if (!Number.isFinite(parsed) || parsed < 0) return { valid: false }
  return { valid: true, value: parsed }
}
