import { supabase } from "@/lib/supabase"
import type {
  ContractualChange,
  PositionChangePreview,
  WorkerContractChangeResult,
  WorkerEngagementResult,
  WorkerPositionChangeResult,
} from "../domain/entities"

/**
 * Personas — Repositorio de transiciones laborales (infraestructura).
 *
 * ÚNICO punto del dominio que invoca las RPC de contratación y transiciones:
 *
 *   · hire_candidate              → alta (y reincorporación de una persona con expediente)
 *   · register_worker_separation  → baja
 *   · reincorporate_worker        → reincorporación directa de un trabajador inactivo
 *   · change_worker_position      → reubicación (y anexo al contrato vigente)
 *   · change_worker_contract      → cambio de tipo de contrato
 *
 * Las funciones y sus parámetros NO se modifican: son los que ya se enviaban desde las
 * pantallas. La reubicación se invoca sin `_addendum` en el nombre real de la RPC
 * (`change_worker_position`, no `change_position`).
 *
 * Este módulo sólo transporta: quién decide qué enviar es la capa de aplicación.
 */

/** Concepto retributivo ya construido para el backend (nunca el total). */
export interface CompensationComponentPayload {
  component_type: string
  description: string
  amount: number
}

export interface HireCandidateRpcPayload {
  candidateId: string
  positionId: string
  hireDate: string
  contractTypeId: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  notes: string | null
  representativeAssignmentId: string | null
  signatureDate: string | null
  signaturePlace: string | null
  paymentMethodId: string | null
  compensationComponents: CompensationComponentPayload[] | null
  paymentScheduleText: string | null
  /** Sólo en la vía de Resolución (Cargo Especialista Principal). */
  resolutionDate?: string | null
}

export interface ReincorporateWorkerRpcPayload {
  workerId: string
  positionId: string
  reincorporationDate: string
  contractTypeId: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  notes: string | null
  representativeAssignmentId: string | null
  signatureDate: string | null
  signaturePlace: string | null
  paymentMethodId: string | null
  compensationComponents: CompensationComponentPayload[] | null
  paymentScheduleText: string | null
  /** Sólo en la vía de Resolución (Cargo Especialista Principal). */
  resolutionDate?: string | null
}

export interface RegisterSeparationRpcPayload {
  workerId: string
  effectiveDate: string
  separationReasonId: string
  notes: string | null
}

export interface ChangeWorkerContractRpcPayload {
  workerId: string
  newContractTypeId: string
  effectiveDate: string
  newEndDate: string | null
  notes: string | null
  representativeAssignmentId: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  compensationComponents: CompensationComponentPayload[] | null
  paymentScheduleText: string | null
}

export interface ChangeWorkerPositionRpcPayload {
  workerId: string
  newPositionId: string
  effectiveDate: string
  reason: string | null
  notes: string | null
  createAddendum: boolean
  reasonCode: string | null
  signatureDate: string | null
  signaturePlace: string | null
  representativeAssignmentId: string | null
  requireFormalized: boolean
  /** Fecha de la Resolución cuando el Cargo destino es Especialista Principal. */
  resolutionDate: string | null
}

const toNullableText = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim()
  return trimmed ? trimmed : null
}

/** Alta de una persona (o reincorporación de una persona con expediente laboral). */
export async function hireCandidateRpc(
  payload: HireCandidateRpcPayload
): Promise<WorkerEngagementResult> {
  const params: Record<string, unknown> = {
    p_candidate_id: payload.candidateId,
    p_position_id: payload.positionId,
    p_hire_date: payload.hireDate,
    p_contract_type_id: payload.contractTypeId,
    p_contract_start_date: payload.contractStartDate,
    p_contract_end_date: payload.contractEndDate,
    p_notes: toNullableText(payload.notes),
    p_representative_assignment_id: payload.representativeAssignmentId,
    p_signature_date: payload.signatureDate,
    p_signature_place: toNullableText(payload.signaturePlace),
    p_payment_method_id: payload.paymentMethodId,
    p_compensation_components: payload.compensationComponents,
    p_payment_schedule_text: toNullableText(payload.paymentScheduleText),
  }
  if (payload.resolutionDate) params.p_resolution_date = payload.resolutionDate

  const { data, error } = await supabase.rpc("hire_candidate", params)
  if (error) throw error

  const result = (data || {}) as {
    worker_id?: string | null
    contract_id?: string | null
    resolution_id?: string | null
  }
  return {
    workerId: result.worker_id ?? null,
    contractId: result.contract_id ?? null,
    resolutionId: result.resolution_id ?? null,
  }
}

/** Reincorporación directa de un trabajador inactivo. */
export async function reincorporateWorkerRpc(
  payload: ReincorporateWorkerRpcPayload
): Promise<WorkerEngagementResult> {
  const params: Record<string, unknown> = {
    p_worker_id: payload.workerId,
    p_new_position_id: payload.positionId,
    p_reincorporation_date: payload.reincorporationDate,
    p_contract_type_id: payload.contractTypeId,
    p_contract_start_date: payload.contractStartDate,
    p_contract_end_date: payload.contractEndDate,
    p_notes: toNullableText(payload.notes),
    p_representative_assignment_id: payload.representativeAssignmentId,
    p_signature_date: payload.signatureDate,
    p_signature_place: toNullableText(payload.signaturePlace),
    p_payment_method_id: payload.paymentMethodId,
    p_compensation_components: payload.compensationComponents,
    p_payment_schedule_text: toNullableText(payload.paymentScheduleText),
  }
  if (payload.resolutionDate) params.p_resolution_date = payload.resolutionDate

  const { data, error } = await supabase.rpc("reincorporate_worker", params)
  if (error) throw error

  const result = (data || {}) as {
    worker_id?: string | null
    contract_id?: string | null
    resolution_id?: string | null
  }
  return {
    workerId: result.worker_id ?? null,
    contractId: result.contract_id ?? null,
    resolutionId: result.resolution_id ?? null,
  }
}

/** Baja: cierra la asignación y el contrato vigentes y deja al trabajador inactivo. */
export async function registerWorkerSeparationRpc(
  payload: RegisterSeparationRpcPayload
): Promise<void> {
  const { error } = await supabase.rpc("register_worker_separation", {
    p_worker_id: payload.workerId,
    p_effective_date: payload.effectiveDate,
    p_separation_reason_id: payload.separationReasonId,
    p_notes: toNullableText(payload.notes),
  })
  if (error) throw error
}

/** Cambio de tipo de contrato: cierra el vigente y crea uno nuevo con sus condiciones. */
export async function changeWorkerContractRpc(
  payload: ChangeWorkerContractRpcPayload
): Promise<WorkerContractChangeResult> {
  const { data, error } = await supabase.rpc("change_worker_contract", {
    p_worker_id: payload.workerId,
    p_new_contract_type_id: payload.newContractTypeId,
    p_effective_date: payload.effectiveDate,
    p_new_end_date: payload.newEndDate,
    p_notes: toNullableText(payload.notes),
    p_representative_assignment_id: payload.representativeAssignmentId,
    p_signature_date: payload.signatureDate,
    p_signature_place: toNullableText(payload.signaturePlace),
    p_payment_method_id: payload.paymentMethodId,
    p_compensation_components: payload.compensationComponents,
    p_payment_schedule_text: toNullableText(payload.paymentScheduleText),
  })
  if (error) throw error

  const result = (data || {}) as { new_contract_id?: string | null }
  return { newContractId: result.new_contract_id ?? null }
}

/** Reubicación: cierra la asignación actual, crea la nueva y prepara el anexo. */
export async function changeWorkerPositionRpc(
  payload: ChangeWorkerPositionRpcPayload
): Promise<WorkerPositionChangeResult> {
  const { data, error } = await supabase.rpc("change_worker_position", {
    p_worker_id: payload.workerId,
    p_new_position_id: payload.newPositionId,
    p_effective_date: payload.effectiveDate,
    p_reason: toNullableText(payload.reason),
    p_notes: toNullableText(payload.notes),
    p_create_addendum: payload.createAddendum,
    p_reason_code: payload.reasonCode,
    p_signature_date: payload.signatureDate,
    p_signature_place: toNullableText(payload.signaturePlace),
    p_representative_assignment_id: payload.representativeAssignmentId,
    p_require_formalized: payload.requireFormalized,
    p_resolution_date: payload.resolutionDate,
  })
  if (error) throw error
  return data as WorkerPositionChangeResult
}

/** Diferencias contractuales de un cambio de puesto, calculadas por el backend. */
export async function previewPositionChangeRpc(input: {
  workerId: string
  newPositionId: string
  effectiveDate: string
}): Promise<PositionChangePreview> {
  const { data, error } = await supabase.rpc("position_change_preview", {
    p_worker_id: input.workerId,
    p_new_position_id: input.newPositionId,
    p_effective_date: input.effectiveDate,
  })
  if (error) throw error

  const result = data as PositionChangePreview
  return {
    ...result,
    changes: ((result?.changes || []) as ContractualChange[])
      .slice()
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
  }
}
