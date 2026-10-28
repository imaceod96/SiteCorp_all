import type {
  PrenominaClaConfig,
  PrenominaNightEntry,
  PrenominaWorkerEntry,
} from "./entities"

/**
 * Prenómina — Normalización de filas y respuestas de RPC (Domain, puro).
 *
 * La base de datos devuelve números como texto y banderas como nulos en algunas columnas.
 * Estas funciones fijan EXACTAMENTE el mismo criterio que ya aplicaba el módulo anterior:
 *   · importes/ratas/contadores → número (0 cuando falta)
 *   · campos opcionales          → número o nulo
 *   · banderas                   → booleano
 * No replican ninguna regla de negocio: sólo tipan lo que llega.
 */

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

export const normalizeWorkerEntry = (row: PrenominaWorkerEntry): PrenominaWorkerEntry => ({
  ...row,
  salary_group_sequence: toNumberOrNull(row.salary_group_sequence),
  salary_scale_amount: toNumberOrNull(row.salary_scale_amount),
  workday_hours: toNumberOrNull(row.workday_hours),
  worked_days: Number(row.worked_days || 0),
  worked_hours: Number(row.worked_hours || 0),
  hourly_scale_rate: Number(row.hourly_scale_rate || 0),
  scale_salary_payment: Number(row.scale_salary_payment || 0),
  tenure_years: toNumberOrNull(row.tenure_years),
  tenure_months: toNumberOrNull(row.tenure_months),
  tenure_total_months: toNumberOrNull(row.tenure_total_months),
  tenure_base_amount: toNumberOrNull(row.tenure_base_amount),
  tenure_hourly_rate: Number(row.tenure_hourly_rate || 0),
  tenure_payment: Number(row.tenure_payment || 0),
  has_masters_degree_snapshot: !!row.has_masters_degree_snapshot,
  has_doctorate_degree_snapshot: !!row.has_doctorate_degree_snapshot,
  academic_category:
    row.academic_category === "MASTER" || row.academic_category === "DOCTOR"
      ? row.academic_category
      : null,
  academic_status: row.academic_status || "OK",
  academic_monthly_amount: toNumberOrNull(row.academic_monthly_amount),
  academic_hourly_rate: Number(row.academic_hourly_rate || 0),
  academic_payment: Number(row.academic_payment || 0),
  cla_applied: !!row.cla_applied,
  cla_day_enabled: !!row.cla_day_enabled,
  cla_day_used: !!row.cla_day_used,
  cla_day_hourly_rate: toNumberOrNull(row.cla_day_hourly_rate),
  cla_day_minutes: Number(row.cla_day_minutes || 0),
  cla_day_hours: Number(row.cla_day_hours || 0),
  cla_day_payment: Number(row.cla_day_payment || 0),
  cla_night_enabled: !!row.cla_night_enabled,
  cla_night_used: !!row.cla_night_used,
  cla_night1_start: row.cla_night1_start ?? null,
  cla_night1_end: row.cla_night1_end ?? null,
  cla_night1_hourly_rate: toNumberOrNull(row.cla_night1_hourly_rate),
  cla_night1_minutes: Number(row.cla_night1_minutes || 0),
  cla_night1_hours: Number(row.cla_night1_hours || 0),
  cla_night1_payment: Number(row.cla_night1_payment || 0),
  cla_night2_start: row.cla_night2_start ?? null,
  cla_night2_end: row.cla_night2_end ?? null,
  cla_night2_hourly_rate: toNumberOrNull(row.cla_night2_hourly_rate),
  cla_night2_minutes: Number(row.cla_night2_minutes || 0),
  cla_night2_hours: Number(row.cla_night2_hours || 0),
  cla_night2_payment: Number(row.cla_night2_payment || 0),
  cla_total_payment: Number(row.cla_total_payment || 0),
  night_payment_19_23: Number(row.night_payment_19_23 || 0),
  night_payment_23_07: Number(row.night_payment_23_07 || 0),
  total_night_payment: Number(row.total_night_payment || 0),
  total_payment: Number(row.total_payment || 0),
})

export const normalizeNightEntry = (row: PrenominaNightEntry): PrenominaNightEntry => ({
  ...row,
  nights_worked: Number(row.nights_worked || 0),
  hours_19_23_per_night: Number(row.hours_19_23_per_night || 0),
  hours_23_07_per_night: Number(row.hours_23_07_per_night || 0),
  payment_19_23: Number(row.payment_19_23 || 0),
  payment_23_07: Number(row.payment_23_07 || 0),
  total_payment: Number(row.total_payment || 0),
})

/** Respuesta de la RPC `prenomina_cla_config` (configuración CLA del Cargo vigente). */
export const normalizeClaConfig = (raw: Record<string, unknown> | null): PrenominaClaConfig => {
  const data = raw || {}
  const num = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value)
  return {
    applicable: !!data.applicable,
    day_enabled: !!data.day_enabled,
    day_rate: num(data.day_rate),
    night_enabled: !!data.night_enabled,
    night1_start: (data.night1_start as string) ?? null,
    night1_end: (data.night1_end as string) ?? null,
    night1_rate: num(data.night1_rate),
    night2_start: (data.night2_start as string) ?? null,
    night2_end: (data.night2_end as string) ?? null,
    night2_rate: num(data.night2_rate),
  }
}
