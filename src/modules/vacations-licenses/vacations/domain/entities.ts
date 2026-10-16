/**
 * Vacaciones — Entidades y tipos del dominio.
 *
 * Define el vocabulario del dominio: los estados, los contratos de datos que
 * devuelve el motor backend y las etiquetas de presentación asociadas a cada
 * estado. Las definiciones son EXACTAMENTE las que exponía `src/lib/vacations.ts`:
 * la migración a DDD es un traslado estructural, no un cambio de contrato.
 *
 * Fuente de verdad: el LEDGER `worker_vacation_movements` (el saldo = SUM(movimientos))
 * y el motor backend. El frontend NUNCA calcula devengo ni consumo.
 */

export type VacationStatus = "NORMAL" | "NEAR_LIMIT" | "LIMIT_REACHED"
export type VacationPeriodStatus = "SCHEDULED" | "TAKEN" | "CANCELLED"
export type VacationMovementType = "ACCRUAL" | "VACATION_USAGE" | "ADJUSTMENT" | "INITIAL_BALANCE" | "REVERSAL"

export interface VacationSummary {
  worker_id: string
  balance: number
  accrued_this_year: number
  consumed_this_year: number
  next_accrual: number
  next_accrual_working_days: number | null
  projected_balance: number
  unaccredited_projection: number
  status: VacationStatus
  scheduled_future_days: number
  free_balance: number
  current_vacation_end: string | null
  current_vacation_return: string | null
  next_vacation_start: string | null
  next_vacation_end: string | null
  opening_cutoff: string | null
  has_schedule: boolean
}

export interface VacationOverviewRow {
  worker_id: string
  full_name: string
  area_name: string | null
  job_name: string | null
  position_name: string | null
  balance: number
  next_accrual: number
  projected_balance: number
  status: VacationStatus
  scheduled_future_days: number
  current_vacation_end: string | null
  next_vacation_start: string | null
  has_schedule: boolean
  active_vacation: boolean
}

export interface VacationPeriod {
  id: string
  worker_id: string
  start_date: string
  end_date: string
  natural_days: number
  sundays_count: number
  charged_days: number
  status: VacationPeriodStatus
  notes: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
}

export interface VacationMovement {
  id: string
  movement_type: VacationMovementType
  amount: number
  calculated_amount: number | null
  effective_date: string
  accrual_year: number | null
  accrual_month: number | null
  working_days_month: number | null
  working_days_year: number | null
  description: string | null
  reason: string | null
  vacation_id: string | null
  created_at: string
}

export const VACATION_STATUS_LABELS: Record<VacationStatus, string> = {
  NORMAL: "Normal",
  NEAR_LIMIT: "Próximo al límite",
  LIMIT_REACHED: "Límite alcanzado",
}

export const VACATION_MOVEMENT_LABELS: Record<VacationMovementType, string> = {
  ACCRUAL: "Devengo",
  VACATION_USAGE: "Vacaciones",
  ADJUSTMENT: "Ajuste",
  INITIAL_BALANCE: "Saldo inicial",
  REVERSAL: "Reversión",
}

export const VACATION_PERIOD_STATUS_LABELS: Record<VacationPeriodStatus, string> = {
  SCHEDULED: "Programadas",
  TAKEN: "Disfrutadas",
  CANCELLED: "Canceladas",
}
