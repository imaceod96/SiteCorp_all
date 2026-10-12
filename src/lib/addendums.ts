import { supabase } from "@/lib/supabase"

/**
 * Fase 11A.6 — Anexos al contrato de trabajo.
 *
 *   Contrato   → condiciones originales (snapshot histórico)
 *   Anexo 1..N → modificaciones formalizadas de esas condiciones
 *
 * Estados:
 *   PENDING_*   → cambio detectado/preparado, todavía NO formalizado documentalmente
 *   FORMALIZED  → datos estructurados confirmados (todavía NO existe PDF/DOCX)
 *   CANCELLED   → anexo cancelado preservando la auditoría (nunca se borra)
 *
 * El número de anexo, los totales y la resolución de condiciones vigentes SIEMPRE
 * los calcula el backend: el frontend sólo muestra y envía los cambios.
 */

export type AddendumStatus =
  | "PENDING_TEMPLATE"
  | "READY_TO_GENERATE"
  | "GENERATED"
  | "GENERATION_ERROR"
  | "FORMALIZED"
  | "CANCELLED"

export type AddendumReasonCode =
  | "POSITION_CHANGE"
  | "SALARY_CHANGE"
  | "COMPENSATION_CHANGE"
  | "PAYMENT_METHOD_CHANGE"
  | "WORK_LOCATION_CHANGE"
  | "WORK_SCHEDULE_CHANGE"
  | "OTHER"

export type AddendumSourceType =
  | "POSITION_CHANGE"
  | "SALARY_SCALE_CHANGE"
  | "MANUAL_COMPENSATION_CHANGE"
  | "MANUAL"
  | "OTHER"

export const ADDENDUM_STATUS_LABELS: Record<string, string> = {
  PENDING_TEMPLATE: "Pendiente de formalizar",
  READY_TO_GENERATE: "Listo para formalizar",
  GENERATED: "Generado",
  GENERATION_ERROR: "Error de generación",
  FORMALIZED: "Formalizado",
  CANCELLED: "Cancelado",
}

export const ADDENDUM_STATUS_BADGE: Record<
  string,
  "success" | "warning" | "danger" | "info" | "neutral"
> = {
  PENDING_TEMPLATE: "warning",
  READY_TO_GENERATE: "warning",
  GENERATED: "success",
  GENERATION_ERROR: "danger",
  FORMALIZED: "success",
  CANCELLED: "neutral",
}

/** Estados que todavía NO forman parte de las condiciones contractuales formalizadas. */
export const PENDING_ADDENDUM_STATUSES: AddendumStatus[] = [
  "PENDING_TEMPLATE",
  "READY_TO_GENERATE",
  "GENERATION_ERROR",
]

export const ADDENDUM_REASON_LABELS: Record<string, string> = {
  POSITION_CHANGE: "Cambio de puesto",
  SALARY_CHANGE: "Cambio salarial",
  COMPENSATION_CHANGE: "Modificación de condiciones retributivas",
  PAYMENT_METHOD_CHANGE: "Cambio de forma de pago",
  WORK_LOCATION_CHANGE: "Modificación de lugar de trabajo",
  WORK_SCHEDULE_CHANGE: "Modificación de jornada u horario",
  OTHER: "Otra modificación contractual",
}

/** Motivos admitidos en un anexo manual: el puesto y el salario de escala no se editan aquí. */
export const MANUAL_ADDENDUM_REASON_CODES: AddendumReasonCode[] = [
  "COMPENSATION_CHANGE",
  "PAYMENT_METHOD_CHANGE",
  "WORK_LOCATION_CHANGE",
  "WORK_SCHEDULE_CHANGE",
  "OTHER",
]

/** Etiquetas de los campos que puede modificar un anexo (mismas que el backend). */
export const ADDENDUM_FIELD_LABELS: Record<string, string> = {
  AREA: "Área",
  JOB: "Cargo",
  POSITION: "Puesto",
  OCCUPATIONAL_CATEGORY: "Categoría ocupacional",
  SALARY_GROUP: "Grupo salarial",
  SALARY: "Salario de escala",
  WORK_LOCATION: "Lugar de trabajo",
  DAILY_HOURS: "Horas diarias",
  WEEKLY_HOURS: "Horas semanales",
  MONTHLY_HOURS: "Horas mensuales",
  WORK_SCHEDULE: "Horario",
  PAYMENT_METHOD: "Forma de pago",
  ADDITIONAL_PAYMENT: "Pagos adicionales",
  ABNORMAL_CONDITIONS: "Condiciones laborales anormales",
  OTHER_PAYMENT: "Otros pagos",
  TOTAL_COMPENSATION: "Total contractual",
}

export const addendumFieldLabel = (code: string): string =>
  ADDENDUM_FIELD_LABELS[code] || code

export const addendumReasonLabel = (code: string | null | undefined): string =>
  code ? ADDENDUM_REASON_LABELS[code] || code : "Modificación contractual"

export const isAddendumPending = (status: string): boolean =>
  PENDING_ADDENDUM_STATUSES.includes(status as AddendumStatus)

export interface AddendumChange {
  id?: string
  field_code: string
  old_value: string | null
  new_value: string | null
  old_display_value: string | null
  new_display_value: string | null
  display_order: number
  old_reference_id?: string | null
  new_reference_id?: string | null
}

export interface ContractAddendum {
  id: string
  addendum_number: number | null
  employment_contract_id: string
  worker_id: string
  organization_entity_id: string
  addendum_type: string
  status: AddendumStatus
  reason_code: AddendumReasonCode | null
  reason: string | null
  notes: string | null
  effective_date: string
  signature_date: string | null
  signature_place: string | null
  representative_assignment_id: string | null
  representative_name_snapshot: string | null
  representative_position_snapshot: string | null
  representative_captured_at: string | null
  previous_amount: number | null
  new_amount: number | null
  total_before: number | null
  total_after: number | null
  currency_code: string | null
  salary_history_id: string | null
  source_type: string | null
  source_id: string | null
  payment_method_id: string | null
  previous_payment_method_id: string | null
  payment_method: { name: string } | null
  created_at: string
  formalized_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  changes: AddendumChange[]
}

/**
 * Fila cruda de `contract_addendums` tal como la devuelve Supabase: sin tipos
 * generados, la relación embebida con `payment_methods` se infiere como array
 * (aunque la FK es to-one) y el código la normaliza a objeto antes de exponerla
 * como `ContractAddendum`.
 */
interface ContractAddendumRow extends Omit<ContractAddendum, "payment_method"> {
  payment_method: { name: string } | { name: string }[] | null
}

export interface AddendumPending {
  blocking: string[]
  warnings: string[]
  status: string
}

/** Resultado de `create_contract_addendum` (anexo manual). */
export interface ManualAddendumResult {
  status: string
  addendum_id?: string
  addendum_number?: number | null
  addendum_status?: string
  pending?: string[]
}

export interface AddendumChangeInput {
  field_code: string
  old_value?: string | null
  new_value?: string | null
  old_display_value?: string | null
  new_display_value?: string | null
  old_reference_id?: string | null
  new_reference_id?: string | null
  display_order?: number
}

export interface FormalizedConditions {
  employment_contract_id: string
  worker_id: string
  contract_start_date: string
  contract_type_id: string | null
  has_formalized_addendums: boolean
  applied_addendums: { addendum_id: string; addendum_number: number | null; effective_date: string }[]
  last_addendum_number: number | null
  area_name: string | null
  job_name: string | null
  position_name: string | null
  position_code: string | null
  occupational_category: string | null
  work_location: string | null
  work_schedule: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  jornada: string | null
  salary_group_id: string | null
  salary_group_sequence: number | null
  salary_amount: number | null
  currency_code: string | null
  payment_method_id: string | null
  payment_method_name: string | null
  payment_schedule: string | null
  additional_payment: number
  abnormal_conditions: number
  other_payment: number
  total_compensation: number | null
  components: {
    component_type: string
    description: string
    amount: number
    display_order: number
    addendum_id: string | null
  }[]
}

export interface WorkerContractualConditions {
  worker_id: string
  has_contract: boolean
  employment_contract_id?: string
  formalized: FormalizedConditions | null
  pending_addendums: {
    addendum_id: string
    addendum_number: number | null
    reason_code: string | null
    reason: string | null
    effective_date: string
    status: string
    total_before: number | null
    total_after: number | null
    salary_history_id: string | null
    changes: {
      field_code: string
      old_display_value: string | null
      new_display_value: string | null
      display_order: number
    }[]
  }[]
  pending_difference: number | null
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Anexos del trabajador (todos los contratos), con el detalle antes/después. */
export const fetchWorkerAddendums = async (workerId: string): Promise<ContractAddendum[]> => {
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

/** Checklist de formalización calculado por el backend (§79). */
export const fetchAddendumPending = async (addendumId: string): Promise<AddendumPending> => {
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

/** Condiciones contractuales FORMALIZADAS vigentes + anexos pendientes (§40/§42/§43). */
export const fetchWorkerContractualConditions = async (
  workerId: string
): Promise<WorkerContractualConditions> => {
  const { data, error } = await supabase.rpc("worker_formalized_conditions", {
    p_worker_id: workerId,
  })
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

/** Anexo manual: condiciones retributivas, forma de pago, lugar y jornada (§63/§64). */
export const createManualAddendum = async (input: {
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
}): Promise<ManualAddendumResult> => {
  const { data, error } = await supabase.rpc("create_contract_addendum", {
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
  })
  if (error) throw error
  return data as ManualAddendumResult
}

/** Formalizar: sólo confirma los datos del anexo. No modifica salario, escala ni puesto. */
export const formalizeAddendum = async (input: {
  addendumId: string
  signatureDate: string
  signaturePlace: string
  representativeAssignmentId: string | null
}): Promise<void> => {
  const { error } = await supabase.rpc("formalize_contract_addendum", {
    p_addendum_id: input.addendumId,
    p_signature_date: input.signatureDate,
    p_signature_place: input.signaturePlace.trim(),
    p_representative_assignment_id: input.representativeAssignmentId,
  })
  if (error) throw error
}

/** Cancelar anexo pendiente. No revierte el movimiento operativo ni el histórico. */
export const cancelAddendum = async (input: {
  addendumId: string
  reason?: string | null
}): Promise<void> => {
  const { error } = await supabase.rpc("cancel_contract_addendum", {
    p_addendum_id: input.addendumId,
    p_reason: input.reason?.trim() || null,
  })
  if (error) throw error
}
