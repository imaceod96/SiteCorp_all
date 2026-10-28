/**
 * Personas — Reglas puras de antigüedad y edad (trayectoria laboral).
 *
 * La antigüedad se calcula desde la fecha REAL de incorporación (`employment_start_date`,
 * con respaldo histórico en `hire_date`) hasta la fecha de referencia, con diferencias de
 * calendario (NO asumiendo 365 días = 1 año ni 30 días = 1 mes). La antigüedad NO se
 * almacena como texto: se calcula dinámicamente para la ficha del trabajador.
 *
 * La fecha de referencia es un parámetro porque Prenómina evalúa la antigüedad al cierre
 * del período (último día del mes), no a la fecha actual. Los valores de antigüedad que
 * consume Prenómina vienen calculados del backend; este módulo es la ÚNICA implementación
 * en TypeScript del cálculo, y no duplica ninguna regla de otro dominio.
 *
 * Este módulo no importa React, Supabase ni `@/lib/*`: puede verificarse de forma aislada.
 */

/** Resultado del cálculo de antigüedad. */
export interface TenureResult {
  /** Años completos de antigüedad. */
  years: number
  /** Meses completos adicionales (0-11). */
  months: number
  /** Total de meses normalizado (years*12 + months). */
  totalMonths: number
  /** Descripción legible para mostrar al usuario. */
  humanDescription: string
}

/**
 * Calcula la antigüedad desde una fecha de inicio hasta una fecha de referencia.
 *
 * @param startDate Fecha de incorporación (formato YYYY-MM-DD o Date).
 * @param referenceDate Fecha de evaluación (por defecto, hoy). Prenómina usa el
 *   último día del mes del período, no la fecha actual.
 * @returns Resultado con años, meses y descripción humana.
 */
export function calculateTenure(
  startDate: string | Date | null | undefined,
  referenceDate?: string | Date | null
): TenureResult | null {
  if (!startDate) return null

  const start = typeof startDate === "string" ? new Date(startDate) : startDate
  if (isNaN(start.getTime())) return null

  const reference = referenceDate
    ? (typeof referenceDate === "string" ? new Date(referenceDate) : referenceDate)
    : new Date()
  if (isNaN(reference.getTime())) return null

  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  if (from > today) return null

  let years = today.getFullYear() - from.getFullYear()
  let months = today.getMonth() - from.getMonth()

  if (months < 0) {
    years--
    months += 12
  }

  // Ajuste por día del mes: 20/12/2021 → 30/11/2026 todavía no cumple 5 años.
  if (today.getDate() < from.getDate()) {
    months--
    if (months < 0) {
      years--
      months += 12
    }
  }

  const totalMonths = years * 12 + months

  let humanDescription: string
  if (years === 0 && months === 0) {
    humanDescription = "Menos de 1 mes"
  } else if (years === 0) {
    humanDescription = `${months} mes${months === 1 ? "" : "es"}`
  } else if (months === 0) {
    humanDescription = `${years} año${years === 1 ? "" : "s"}`
  } else {
    humanDescription = `${years} año${years === 1 ? "" : "s"} y ${months} mes${months === 1 ? "" : "es"}`
  }

  return { years, months, totalMonths, humanDescription }
}

/**
 * Calcula la edad desde la fecha de nacimiento hasta hoy.
 * Reutiliza la misma lógica de diferencia de calendario.
 */
export function calculateAge(birthDate: string | Date | null | undefined): number | null {
  if (!birthDate) return null

  const birth = typeof birthDate === "string" ? new Date(birthDate) : birthDate
  if (isNaN(birth.getTime())) return null

  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()

  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--
  }

  return age
}

/**
 * Agrupa una edad en el rango correspondiente.
 */
export function ageRange(age: number | null): string {
  if (age === null) return "Sin información"
  if (age < 20) return "Menos de 20"
  if (age < 30) return "20-29"
  if (age < 40) return "30-39"
  if (age < 50) return "40-49"
  if (age < 60) return "50-59"
  return "60 o más"
}
