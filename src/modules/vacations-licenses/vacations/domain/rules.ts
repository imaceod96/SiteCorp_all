/**
 * Vacaciones — Reglas y constantes puras del dominio.
 *
 * Contiene la única lógica de vacaciones independiente de React y de Supabase:
 * el tope de devengo, el rango de días naturales, el formateo de días y la
 * previsualización de consumo. Cálculos, condiciones, mensajes y tratamiento de
 * fechas son EXACTAMENTE los que ya usaba `src/lib/vacations.ts`.
 *
 * La autoridad final sobre el consumo, el devengo y el saldo es SIEMPRE del
 * backend (PostgreSQL/RPC): aquí solo se previsualiza lo que el backend decidirá.
 */

export const VACATION_ANNUAL_DAYS = 24
export const VACATION_MAX_ACCRUAL_DAYS = 24
export const VACATION_MIN_NATURAL_DAYS = 1
export const VACATION_MAX_NATURAL_DAYS = 15

/** Redondea a 2 decimales para mostrar (el backend conserva 4). */
export const formatVacationDays = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString("es-CU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Previsualización de consumo (SIN tocar la BD): días naturales, domingos y días a
 * descontar. Réplica EXACTA de la regla backend (`charged = natural − domingos`,
 * `1 ≤ natural ≤ 15`), usada solo para el diálogo; la validación definitiva es del
 * backend.
 */
export function previewVacationConsumption(startDate: string, endDate: string): {
  naturalDays: number
  sundays: number
  chargedDays: number
  valid: boolean
} {
  if (!startDate || !endDate) return { naturalDays: 0, sundays: 0, chargedDays: 0, valid: false }
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { naturalDays: 0, sundays: 0, chargedDays: 0, valid: false }
  }
  const naturalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  let sundays = 0
  for (let i = 0; i < naturalDays; i += 1) {
    const day = new Date(start.getTime() + i * 86400000).getUTCDay()
    if (day === 0) sundays += 1
  }
  return {
    naturalDays,
    sundays,
    chargedDays: naturalDays - sundays,
    valid:
      naturalDays >= VACATION_MIN_NATURAL_DAYS && naturalDays <= VACATION_MAX_NATURAL_DAYS,
  }
}

export const vacationWorkspaceAlertsEnabled = (permissions: string[]): boolean =>
  permissions.some((code) => ["vacations.view", "vacations.manage"].includes(code))
