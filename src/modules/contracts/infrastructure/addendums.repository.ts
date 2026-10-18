import { supabase } from "@/lib/supabase"
import { PLURIEMPLEO_ENABLED } from "@/shared/config/pluriempleo"
import type {
  AddendumChange,
  AddendumChangeInput,
  AddendumPending,
  AddendumReasonCode,
  ContractAddendum,
  ManualAddendumResult,
  WorkerContractualConditions,
} from "../domain/entities"

/**
 * Contratos y documentos — Repositorio de anexos (infraestructura).
 *
 * Único punto que habla con Supabase para los anexos: la tabla `contract_addendums`, sus
 * cambios y las RPC que el backend calcula (checklist, condiciones formalizadas, alta,
 * formalización y cancelación). Nombres de RPC, parámetros, `select`, orden y mapeo son
 * EXACTAMENTE los que ya usaba la aplicación: es un traslado estructural.
 *
 * El número de anexo, los totales y las condiciones vigentes SIEMPRE los calcula el
 * backend: aquí sólo se leen y se normalizan las filas.
 */

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Fila cruda de `contract_addendums` tal como la devuelve Supabase: sin tipos generados, la
 * relación embebida con `payment_methods` se infiere como array (aunque la FK es to-one) y
 * el mapeo la normaliza a objeto antes de exponerla como `ContractAddendum`.
 */
interface ContractAddendumRow extends Omit<ContractAddendum, "payment_method"> {
  payment_method: { name: string } | { name: string }[] | null
}

/** Anexos del trabajador (todos sus contratos), con el detalle antes/después. */
export async function selectWorkerAddendums(workerId: string): Promise<ContractAddendum[]> {
  const { data, error } = await supabase
    .from("contract_addendums")
    .select(
      `id, addendum_number, employment_contract_id, worker_id, organization_entity_id,
       addendum_type, status, reason_code, reason, notes, effective_date,
       signature_date, signature_place, representative_assignment_id,
       representative_name_snapshot, representative_position_snapshot, representative_captured_at,
       previous_amount, new_amount, total_before, total_after, currency_code,
       salary_history_id, source_type, source_id, payment_method_id, previous_payment_method_id,
       created_at, formalized_at, cancelled_at, cancellation_reason,
       payment_method:payment_methods!contract_addendums_payment_method_id_fkey(name),
       changes:employment_contract_addendum_changes(
         id, field_code, old_value, new_value, old_display_value, new_display_value,
         old_reference_id, new_reference_id, display_order
       )`
    )
    .eq("worker_id", workerId)
    .order("effective_date", { ascending: true })
    .order("addendum_number", { ascending: true })

  if (error) throw error

  return ((data as ContractAddendumRow[]) || []).map((row) => ({
    ...row,
    addendum_number: toNumber(row.addendum_number),
    previous_amount: toNumber(row.previous_amount),
    new_amount: toNumber(row.new_amount),
    total_before: toNumber(row.total_before),
    total_after: toNumber(row.total_after),
    payment_method: Array.isArray(row.payment_method)
      ? row.payment_method[0] || null
      : row.payment_method,
    changes: ((row.changes as AddendumChange[]) || [])
      .slice()
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
  })) as ContractAddendum[]
}

/** Checklist de formalización calculado por el backend. */
export async function rpcAddendumPendingChecklist(addendumId: string): Promise<AddendumPending> {
  const { data, error } = await supabase.rpc("pending_addendum_checklist", {
    p_addendum_id: addendumId,
  })
  if (error) throw error

  const result = (data as AddendumPending | null) || { blocking: [], warnings: [], status: "" }
  return {
    blocking: result.blocking || [],
    warnings: result.warnings || [],
    status: result.status || "",
  }
}

/**
 * Añade `p_target_contract_id` SOLO cuando hay contrato identificado Y la función está
 * habilitada.
 *
 * Con un solo contrato (o con las migraciones sin aplicar) el parámetro NO se envía: la
 * llamada es EXACTAMENTE la actual y la RPC resuelve el contrato por sí misma. Con dos
 * contratos vigentes las condiciones devueltas son SÓLO las del contrato seleccionado.
 */
const withTargetContract = (
  params: Record<string, unknown>,
  targetContractId: string | null | undefined
): Record<string, unknown> => {
  if (PLURIEMPLEO_ENABLED && targetContractId) params.p_target_contract_id = targetContractId
  return params
}

/** Condiciones contractuales FORMALIZADAS vigentes + anexos pendientes del trabajador. */
export async function rpcWorkerFormalizedConditions(
  workerId: string,
  targetContractId?: string | null
): Promise<WorkerContractualConditions> {
  const { data, error } = await supabase.rpc(
    "worker_formalized_conditions",
    withTargetContract({ p_worker_id: workerId }, targetContractId)
  )
  if (error) throw error

  const result = (data as WorkerContractualConditions | null) || null
  if (!result) {
    return {
      worker_id: workerId,
      has_contract: false,
      formalized: null,
      pending_addendums: [],
      pending_difference: null,
    }
  }

  return {
    ...result,
    pending_difference: toNumber(result.pending_difference),
    pending_addendums: result.pending_addendums || [],
  }
}

/**
 * Anexo manual: condiciones retributivas, forma de pago, lugar y jornada.
 *
 * `targetContractId` es el CONTRATO SELECCIONADO en la ficha (el de las condiciones que
 * el diálogo muestra como base del antes/después). Con dos contratos vigentes viaja como
 * `p_target_contract_id` y el anexo —con sus condiciones y su numeración— queda en ESE
 * contrato; con uno solo no se envía (misma llamada de siempre y la RPC resuelve el
 * contrato por sí misma).
 */
export async function rpcCreateContractAddendum(input: {
  workerId: string
  changes: AddendumChangeInput[]
  reasonCode: AddendumReasonCode
  reason?: string | null
  effectiveDate: string
  notes?: string | null
  components?: { component_type: string; description: string; amount: number }[]
  signatureDate?: string | null
  signaturePlace?: string | null
  representativeAssignmentId?: string | null
  requireFormalized?: boolean
  targetContractId?: string | null
}): Promise<ManualAddendumResult> {
  const params = withTargetContract(
    {
      p_worker_id: input.workerId,
      p_changes: input.changes,
      p_reason_code: input.reasonCode,
      p_reason: input.reason?.trim() || null,
      p_effective_date: input.effectiveDate,
      p_notes: input.notes?.trim() || null,
      p_source_type: "MANUAL",
      p_components: input.components && input.components.length > 0 ? input.components : null,
      p_signature_date: input.signatureDate || null,
      p_signature_place: input.signaturePlace?.trim() || null,
      p_representative_assignment_id: input.representativeAssignmentId || null,
      p_require_formalized: input.requireFormalized ?? false,
    },
    input.targetContractId
  )

  const { data, error } = await supabase.rpc("create_contract_addendum", params)
  if (error) throw error
  return data as ManualAddendumResult
}

/** Formalizar: sólo confirma los datos del anexo. No modifica salario, escala ni puesto. */
export async function rpcFormalizeContractAddendum(input: {
  addendumId: string
  signatureDate: string
  signaturePlace: string
  representativeAssignmentId: string | null
}): Promise<void> {
  const { error } = await supabase.rpc("formalize_contract_addendum", {
    p_addendum_id: input.addendumId,
    p_signature_date: input.signatureDate,
    p_signature_place: input.signaturePlace.trim(),
    p_representative_assignment_id: input.representativeAssignmentId,
  })
  if (error) throw error
}

/** Cancelar anexo pendiente. No revierte el movimiento operativo ni el histórico. */
export async function rpcCancelContractAddendum(input: {
  addendumId: string
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc("cancel_contract_addendum", {
    p_addendum_id: input.addendumId,
    p_reason: input.reason?.trim() || null,
  })
  if (error) throw error
}
