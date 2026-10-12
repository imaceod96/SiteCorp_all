import { supabase } from "@/lib/supabase"
import type {
  SalaryChangeApplyResult,
  SalaryChangeEventResult,
  SalaryChangeImpactRow,
  SalaryChangePreview,
  WorkerSalaryHistoryEntry,
} from "../domain/entities"

/**
 * Contratos y documentos — Repositorio del historial salarial (infraestructura).
 *
 * Único punto que habla con Supabase para la evolución económica del trabajador:
 * `worker_salary_history` y las RPC de cambio de escala salarial. Toda la lógica del cambio
 * (impacto, histórico por trabajador, anexos pendientes y fecha efectiva) vive en las
 * funciones atómicas del backend: aquí sólo se envían los parámetros y se leen resultados.
 *
 * Consultas, parámetros y orden son EXACTAMENTE los que ya usaba la aplicación.
 */

/**
 * Fila cruda de `worker_salary_history` con las relaciones embebidas tal como las devuelve
 * Supabase: la relación a `salary_groups` llega como objeto o array y `addendums` como
 * array. Se normaliza a `WorkerSalaryHistoryEntry` en el mapeo.
 */
interface WorkerSalaryHistoryRow
  extends Omit<WorkerSalaryHistoryEntry, "group_sequence_number" | "addendums"> {
  salary_group: { sequence_number: number } | { sequence_number: number }[] | null
  addendums: WorkerSalaryHistoryEntry["addendums"] | null
}

/** Histórico salarial del trabajador en orden cronológico inverso, con su anexo si existe. */
export async function selectWorkerSalaryHistory(
  workerId: string
): Promise<WorkerSalaryHistoryEntry[]> {
  const { data, error } = await supabase
    .from("worker_salary_history")
    .select(
      `id, worker_id, employment_contract_id, assignment_id, salary_group_id, salary_scale_id,
       previous_amount, new_amount, currency_code, effective_date, change_type, source, notes, created_at,
       salary_group:salary_groups(sequence_number),
       addendums:contract_addendums(id, status, effective_date, document_type_id, addendum_number, previous_amount, new_amount, currency_code, employment_contract_id)`
    )
    .eq("worker_id", workerId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw error

  return (((data as WorkerSalaryHistoryRow[]) || []).map((row) => ({
    ...row,
    group_sequence_number: Array.isArray(row.salary_group)
      ? row.salary_group[0]?.sequence_number ?? null
      : row.salary_group?.sequence_number ?? null,
    addendums: row.addendums || [],
  })) as WorkerSalaryHistoryEntry[]) || []
}

/** Impacto previsto del cambio de escala, sin aplicarlo. */
export async function rpcPreviewSalaryChange(
  groupId: string,
  newAmount: number,
  effectiveFrom: string
): Promise<SalaryChangePreview> {
  const { data, error } = await supabase.rpc("preview_salary_change", {
    p_salary_group_id: groupId,
    p_new_amount: newAmount,
    p_effective_from: effectiveFrom || null,
  })
  if (error) throw error
  return data as SalaryChangePreview
}

/** Trabajadores cuyo salario cambiará con el nuevo importe en la fecha efectiva. */
export async function rpcSalaryChangeImpact(
  groupId: string,
  newAmount: number,
  effectiveDate: string
): Promise<SalaryChangeImpactRow[]> {
  const { data, error } = await supabase.rpc("salary_change_impact", {
    p_salary_group_id: groupId,
    p_new_amount: newAmount,
    p_effective_date: effectiveDate || null,
  })
  if (error) throw error
  return (data as SalaryChangeImpactRow[]) || []
}

/**
 * Tras aplicar un cambio salarial masivo: crea un EVENTO documental, un Movimiento de
 * Nómina (Reubicación) por trabajador realmente afectado y los lotes ZIP cuando se superan
 * 5 documentos por entidad y tipo documental. NO aplica el cambio salarial (eso lo hace
 * `applySalaryChange`); sólo materializa la documentación del evento.
 */
export async function rpcFinalizeSalaryChangeEvent(
  groupId: string,
  effectiveDate: string,
  description: string | null,
  workers: { worker_id: string; previous_amount: number }[]
): Promise<SalaryChangeEventResult> {
  const { data, error } = await supabase.rpc("finalize_salary_change_event", {
    p_salary_group_id: groupId,
    p_effective_date: effectiveDate,
    p_description: description?.trim() || null,
    p_workers: workers.map((w) => ({ worker_id: w.worker_id, previous_amount: w.previous_amount })),
  })
  if (error) throw error
  return data as SalaryChangeEventResult
}

/**
 * Aplica el cambio de forma atómica: nueva versión del valor salarial, histórico salarial de
 * cada trabajador afectado y anexo contractual pendiente de generar. Es idempotente:
 * repetir el mismo cambio no duplica históricos ni anexos.
 */
export async function rpcApplySalaryGroupValueChange(
  groupId: string,
  newAmount: number,
  currencyCode: string | null,
  effectiveFrom: string,
  notes?: string | null
): Promise<SalaryChangeApplyResult> {
  const { data, error } = await supabase.rpc("apply_salary_group_value_change", {
    p_salary_group_id: groupId,
    p_new_amount: newAmount,
    p_currency_code: currencyCode || null,
    p_effective_from: effectiveFrom,
    p_notes: notes?.trim() || null,
  })
  if (error) throw error
  return data as SalaryChangeApplyResult
}
