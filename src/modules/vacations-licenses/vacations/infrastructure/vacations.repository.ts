import { supabase } from "@/lib/supabase"
import type {
  VacationMovement,
  VacationOverviewRow,
  VacationPeriod,
  VacationSummary,
} from "../domain/entities"

/**
 * Vacaciones — Repositorio (infraestructura).
 *
 * Único punto del dominio que conoce Supabase. Lectura: 7 RPC SECURITY DEFINER
 * (que validan permisos y ejecutan el catch-up idempotente del devengo) y dos
 * SELECT directos sujetos a RLS. Escritura: SIEMPRE por RPC transaccional, nunca
 * una escritura directa desde el frontend.
 *
 * Nombres de RPC, parámetros, consultas, columnas, ordenación, tratamiento de
 * errores y firmas son EXACTAMENTE los que ya usaba `src/lib/vacations.ts`.
 */

const rpcError = (error: { message?: string } | null): never => {
  throw new Error(error?.message || "No se pudo completar la operación de vacaciones.")
}

/** Lista + KPIs de vacaciones de la entidad (el backend ejecuta catch-up idempotente). */
export async function fetchEntityVacationOverview(entityId: string): Promise<VacationOverviewRow[]> {
  const { data, error } = await supabase.rpc("entity_vacation_overview", { p_entity_id: entityId })
  if (error) rpcError(error)
  return ((data as VacationOverviewRow[]) || []).map((row) => ({
    ...row,
    balance: Number(row.balance) || 0,
    next_accrual: Number(row.next_accrual) || 0,
    projected_balance: Number(row.projected_balance) || 0,
    scheduled_future_days: Number(row.scheduled_future_days) || 0,
  }))
}

/** Contabiliza de forma idempotente los meses cerrados pendientes del trabajador. */
export async function ensureWorkerVacationAccruals(workerId: string): Promise<void> {
  const { error } = await supabase.rpc("run_worker_vacation_catchup", { p_worker_id: workerId })
  if (error) rpcError(error)
}

export async function fetchWorkerVacationSummary(workerId: string): Promise<VacationSummary> {
  const { data, error } = await supabase.rpc("worker_vacation_summary", { p_worker_id: workerId })
  if (error) rpcError(error)
  const s = (data as VacationSummary | null) || null
  if (!s) throw new Error("No se pudo obtener el saldo de vacaciones del trabajador.")
  return {
    ...s,
    balance: Number(s.balance) || 0,
    accrued_this_year: Number(s.accrued_this_year) || 0,
    consumed_this_year: Number(s.consumed_this_year) || 0,
    next_accrual: Number(s.next_accrual) || 0,
    projected_balance: Number(s.projected_balance) || 0,
    unaccredited_projection: Number(s.unaccredited_projection) || 0,
    scheduled_future_days: Number(s.scheduled_future_days) || 0,
    free_balance: Number(s.free_balance) || 0,
  }
}

export async function fetchWorkerVacationPeriods(workerId: string): Promise<VacationPeriod[]> {
  const { data, error } = await supabase
    .from("worker_vacations")
    .select("id, worker_id, start_date, end_date, natural_days, sundays_count, charged_days, status, notes, cancelled_at, cancel_reason, created_at")
    .eq("worker_id", workerId)
    .order("start_date", { ascending: false })
  if (error) throw new Error(error.message)
  return ((data as VacationPeriod[]) || []).map((p) => ({
    ...p,
    charged_days: Number(p.charged_days) || 0,
  }))
}

export async function fetchWorkerVacationMovements(workerId: string): Promise<VacationMovement[]> {
  const { data, error } = await supabase
    .from("worker_vacation_movements")
    .select("id, movement_type, amount, calculated_amount, effective_date, accrual_year, accrual_month, working_days_month, working_days_year, description, reason, vacation_id, created_at")
    .eq("worker_id", workerId)
    .order("effective_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (error) throw new Error(error.message)
  return ((data as VacationMovement[]) || []).map((m) => ({
    ...m,
    amount: Number(m.amount) || 0,
    calculated_amount: m.calculated_amount === null ? null : Number(m.calculated_amount),
  }))
}

/** Registra un período de vacaciones (crea período + movimiento negativo en una transacción). */
export async function registerWorkerVacation(params: {
  workerId: string
  startDate: string
  endDate: string
  notes?: string | null
  requestId?: string | null
}): Promise<{ charged_days: number; balance: number; vacation_id: string }> {
  const { data, error } = await supabase.rpc("register_worker_vacation", {
    p_worker_id: params.workerId,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_notes: params.notes ?? null,
    p_request_id: params.requestId ?? null,
  })
  if (error) rpcError(error)
  return data as { charged_days: number; balance: number; vacation_id: string }
}

/** Cancela un período y revierte el consumo (transacción). */
export async function cancelWorkerVacation(vacationId: string, reason?: string | null): Promise<{ balance: number }> {
  const { data, error } = await supabase.rpc("cancel_worker_vacation", {
    p_vacation_id: vacationId,
    p_reason: reason ?? null,
  })
  if (error) rpcError(error)
  return data as { balance: number }
}

/** Ajuste administrativo auditable (nunca edita el saldo directamente). */
export async function adjustWorkerVacationBalance(params: {
  workerId: string
  amount: number
  reason: string
  effectiveDate?: string | null
}): Promise<{ balance: number }> {
  const { data, error } = await supabase.rpc("adjust_worker_vacation_balance", {
    p_worker_id: params.workerId,
    p_amount: params.amount,
    p_reason: params.reason,
    p_effective_date: params.effectiveDate ?? null,
  })
  if (error) rpcError(error)
  return data as { balance: number }
}

/** Inicializa el saldo de un trabajador histórico desde una fecha de corte. */
export async function setWorkerVacationOpeningBalance(params: {
  workerId: string
  amount: number
  cutoffDate: string
}): Promise<{ balance: number }> {
  const { data, error } = await supabase.rpc("set_worker_vacation_opening_balance", {
    p_worker_id: params.workerId,
    p_amount: params.amount,
    p_cutoff_date: params.cutoffDate,
  })
  if (error) rpcError(error)
  return data as { balance: number }
}
