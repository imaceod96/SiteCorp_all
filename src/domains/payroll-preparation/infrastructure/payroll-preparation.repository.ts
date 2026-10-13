import { supabase } from "@/lib/supabase"
import { normalizeClaConfig, normalizeNightEntry, normalizeWorkerEntry } from "../domain/normalization"
import type {
  PrenominaClaConfig,
  PrenominaNightEntry,
  PrenominaPeriod,
  PrenominaWorkerEntry,
} from "../domain/entities"

/**
 * Prenómina — Acceso a datos (Infrastructure).
 *
 * Única frontera de Supabase del módulo. Las tablas, columnas, filtros, órdenes y las RPC
 * `prenomina_*` (con sus parámetros exactos) se conservan tal y como estaban: no se añade,
 * renombra ni elimina ninguna consulta.
 *
 * El cálculo vive en la base de datos: los comandos no calculan importes, sólo envían la
 * captura y el backend recalcula antes de persistir.
 *
 * Aislamiento: lo aplica RLS por organización/entidad; además las consultas de período y de
 * totales se restringen explícitamente por `organization_entity_id`.
 */

const PERIOD_COLUMNS =
  "id, organization_entity_id, period_year, period_month, status, created_at, closed_at"

/** Períodos de una entidad, del más reciente al más antiguo. */
export const selectPrenominaPeriods = async (entityId: string): Promise<PrenominaPeriod[]> => {
  const { data, error } = await supabase
    .from("prenomina_periods")
    .select(PERIOD_COLUMNS)
    .eq("organization_entity_id", entityId)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
  if (error) throw error
  return (data as PrenominaPeriod[]) || []
}

/** Total por período (para el histórico) sin traer todas las filas. */
export const selectPrenominaPeriodTotals = async (
  entityId: string
): Promise<Record<string, number>> => {
  const { data, error } = await supabase
    .from("prenomina_worker_entries")
    .select("period_id, total_payment")
    .eq("organization_entity_id", entityId)
  if (error) throw error
  const totals: Record<string, number> = {}
  ;((data as { period_id: string; total_payment: number }[]) || []).forEach((row) => {
    totals[row.period_id] = (totals[row.period_id] || 0) + Number(row.total_payment || 0)
  })
  return totals
}

/** Un período concreto, o nulo si no existe. */
export const selectPrenominaPeriod = async (periodId: string): Promise<PrenominaPeriod | null> => {
  const { data, error } = await supabase
    .from("prenomina_periods")
    .select(PERIOD_COLUMNS)
    .eq("id", periodId)
    .maybeSingle()
  if (error) throw error
  return (data as PrenominaPeriod) || null
}

/** Registros de trabajador del período, ordenados por nombre del snapshot. */
export const selectPrenominaEntries = async (periodId: string): Promise<PrenominaWorkerEntry[]> => {
  const { data, error } = await supabase
    .from("prenomina_worker_entries")
    .select("*")
    .eq("period_id", periodId)
    .order("worker_name_snapshot")
  if (error) throw error
  return ((data as PrenominaWorkerEntry[]) || []).map(normalizeWorkerEntry)
}

/** Registros de nocturnidad de varios trabajadores, agrupados por registro del período. */
export const selectPrenominaNights = async (
  entryIds: string[]
): Promise<Record<string, PrenominaNightEntry[]>> => {
  if (entryIds.length === 0) return {}
  const { data, error } = await supabase
    .from("prenomina_night_entries")
    .select("*")
    .in("worker_entry_id", entryIds)
    .order("display_order")
    .order("created_at")
  if (error) throw error
  const grouped: Record<string, PrenominaNightEntry[]> = {}
  ;(((data as PrenominaNightEntry[]) || [])).map(normalizeNightEntry).forEach((night) => {
    grouped[night.worker_entry_id] = grouped[night.worker_entry_id] || []
    grouped[night.worker_entry_id].push(night)
  })
  return grouped
}

/**
 * Configuración CLA del Cargo actual del trabajador (Assignment vigente).
 * Autorizada con prenomina.view/manage, no requiere permisos de Plantilla.
 */
export const rpcPrenominaClaConfig = async (entryId: string): Promise<PrenominaClaConfig> => {
  const { data, error } = await supabase.rpc("prenomina_cla_config", { p_entry_id: entryId })
  if (error) throw error
  return normalizeClaConfig((data || null) as Record<string, unknown> | null)
}

/** Abre (o recupera) el período mensual de la entidad. Devuelve su identificador. */
export const rpcCreatePrenominaPeriod = async (
  entityId: string,
  year: number,
  month: number
): Promise<string> => {
  const { data, error } = await supabase.rpc("prenomina_create_period", {
    p_entity_id: entityId,
    p_year: year,
    p_month: month,
  })
  if (error) throw error
  return data as string
}

/** Añade los trabajadores activos que falten y refresca los snapshots. Devuelve cuántos añadió. */
export const rpcRefreshPrenominaWorkers = async (periodId: string): Promise<number> => {
  const { data, error } = await supabase.rpc("prenomina_refresh_workers", {
    p_period_id: periodId,
  })
  if (error) throw error
  return (data as number) || 0
}

/** Guarda la captura base del trabajador (días trabajados y datos del mes). */
export const rpcSavePrenominaInputs = async (
  entryId: string,
  workedDays: number,
  salaryScaleAmount: number | null,
  workdayHours: number | null
): Promise<void> => {
  const { error } = await supabase.rpc("prenomina_upsert_inputs", {
    p_entry_id: entryId,
    p_worked_days: workedDays,
    p_salary_scale_amount: salaryScaleAmount,
    p_workday_hours: workdayHours,
  })
  if (error) throw error
}

/** Guarda la captura CLA del trabajador (minutos por modalidad). */
export const rpcSavePrenominaCla = async (
  entryId: string,
  applied: boolean,
  dayUsed: boolean,
  dayMinutes: number,
  nightUsed: boolean,
  night1Minutes: number,
  night2Minutes: number
): Promise<void> => {
  const { error } = await supabase.rpc("prenomina_save_cla", {
    p_entry_id: entryId,
    p_applied: applied,
    p_day_used: dayUsed,
    p_day_minutes: dayMinutes,
    p_night_used: nightUsed,
    p_night1_minutes: night1Minutes,
    p_night2_minutes: night2Minutes,
  })
  if (error) throw error
}

/** Crea o actualiza un horario nocturno. Devuelve su identificador. */
export const rpcSavePrenominaNight = async (
  entryId: string,
  nightId: string | null,
  start: string,
  end: string,
  nights: number
): Promise<string> => {
  const { data, error } = await supabase.rpc("prenomina_save_night", {
    p_entry_id: entryId,
    p_night_id: nightId,
    p_start: start,
    p_end: end,
    p_nights: nights,
  })
  if (error) throw error
  return data as string
}

/** Elimina un horario nocturno del período. */
export const rpcDeletePrenominaNight = async (nightId: string): Promise<void> => {
  const { error } = await supabase.rpc("prenomina_delete_night", { p_night_id: nightId })
  if (error) throw error
}

/** Cierra el período (pasa a CERRADA y congela la captura). */
export const rpcClosePrenominaPeriod = async (periodId: string): Promise<void> => {
  const { error } = await supabase.rpc("prenomina_close_period", { p_period_id: periodId })
  if (error) throw error
}

/** Reabre el período (vuelve a BORRADOR). */
export const rpcReopenPrenominaPeriod = async (periodId: string): Promise<void> => {
  const { error } = await supabase.rpc("prenomina_reopen_period", { p_period_id: periodId })
  if (error) throw error
}
