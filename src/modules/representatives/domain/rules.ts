/**
 * Representantes — Reglas puras del dominio.
 *
 * Únicamente lógica independiente de React y de Supabase: la lista de datos
 * contractuales pendientes y las dos funciones de formato de fechas/períodos.
 * Condiciones, formatos y resultados son EXACTAMENTE los que ya usaba
 * `src/lib/representatives.ts`.
 *
 * La autoridad sobre la vigencia, el historial y la resolución por fecha es
 * SIEMPRE del backend (PostgreSQL/RPC): aquí solo se presenta lo que el backend
 * devuelve.
 */

import type { EntityContractData } from "./entities"

/**
 * Datos contractuales pendientes de la entidad, derivados dinámicamente.
 * No se almacena ningún indicador de «datos completos»: se calcula al vuelo.
 */
export function pendingEntityContractualData(data: EntityContractData | null): string[] {
  if (!data) {
    return [
      "Organismo al que pertenece",
      "Rama",
      "Código de identificación laboral/organizacional",
      "Dirección",
      "Provincia",
      "Municipio",
      "Año de la Revolución",
    ]
  }

  const missing = (value: string | null) => !value || !value.trim()
  const pending: string[] = []

  if (missing(data.organism)) pending.push("Organismo al que pertenece")
  if (missing(data.branch)) pending.push("Rama")
  if (missing(data.labor_identification_code)) {
    pending.push("Código de identificación laboral/organizacional")
  }
  if (missing(data.address)) pending.push("Dirección")
  if (missing(data.province)) pending.push("Provincia")
  if (missing(data.municipality)) pending.push("Municipio")
  if (data.revolution_year == null || !data.revolution_year.trim()) pending.push("Año de la Revolución")

  return pending
}

/** Texto humano de un período de vigencia de representante. */
export function representativePeriodLabel(
  effectiveFrom: string,
  effectiveTo: string | null
): string {
  const from = formatRepresentativeDate(effectiveFrom)
  return effectiveTo ? `${from} → ${formatRepresentativeDate(effectiveTo)}` : `${from} → Actualidad`
}

export function formatRepresentativeDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—"
  const [year, month, day] = isoDate.split("-")
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}
