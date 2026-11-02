import { supabase } from "@/lib/supabase"
import { syncCandidateEntityWithPosition } from "./candidate-pool-meta"
import { ensureHiringTrainingNotification } from "@/modules/training"
import { ensureSstAssignmentNotification } from "@/modules/sst"
import type {
  ContractualChange,
  PluriemployContractInput,
  PluriemployResult,
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
  /** Asignación afectada (pluriempleo). `null` = comportamiento actual. */
  targetAssignmentId?: string | null
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
  /** Contrato afectado (pluriempleo). `null` = comportamiento actual. */
  targetContractId?: string | null
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
  /** Asignación afectada (pluriempleo). `null` = comportamiento actual. */
  targetAssignmentId?: string | null
}

const toNullableText = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim()
  return trimmed ? trimmed : null
}

/**
 * Añade el parámetro de identificación del contrato SOLO cuando existe.
 *
 * Mientras las migraciones del pluriempleo no estén aplicadas, las RPC no admiten
 * `p_target_assignment_id` / `p_target_contract_id`: omitir el parámetro cuando es
 * `null` mantiene EXACTAMENTE la llamada actual para trabajadores con un solo contrato.
 */
const withTarget = (
  params: Record<string, unknown>,
  key: "p_target_assignment_id" | "p_target_contract_id",
  value: string | null | undefined
): Record<string, unknown> => {
  if (value) params[key] = value
  return params
}

/** Alta de una persona (o reincorporación de una persona con expediente laboral). */
export async function hireCandidateRpc(
  payload: HireCandidateRpcPayload
): Promise<WorkerEngagementResult> {
  await syncCandidateEntityWithPosition(payload.candidateId, payload.positionId)

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

  await ensureHiringTrainingNotification({
    workerId: result.worker_id ?? null,
    candidateId: payload.candidateId,
    positionId: payload.positionId,
    hireDate: payload.hireDate,
    contractOrResolutionId: result.contract_id ?? result.resolution_id ?? null,
  })

  await ensureSstAssignmentNotification({
    workerId: result.worker_id ?? null,
    positionId: payload.positionId,
    effectiveDate: payload.hireDate,
    triggerType: "NUEVA_CONTRATACION",
    sourceId: result.contract_id ?? result.resolution_id ?? null,
  })

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

  await ensureSstAssignmentNotification({
    workerId: result.worker_id ?? payload.workerId ?? null,
    positionId: payload.positionId,
    effectiveDate: payload.reincorporationDate,
    triggerType: "NUEVA_CONTRATACION",
    sourceId: result.contract_id ?? result.resolution_id ?? null,
  })

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
  const params = withTarget(
    {
      p_worker_id: payload.workerId,
      p_effective_date: payload.effectiveDate,
      p_separation_reason_id: payload.separationReasonId,
      p_notes: toNullableText(payload.notes),
    },
    "p_target_assignment_id",
    payload.targetAssignmentId
  )

  const { error } = await supabase.rpc("register_worker_separation", params)
  if (error) throw error
}

/** Cambio de tipo de contrato: cierra el vigente y crea uno nuevo con sus condiciones. */
export async function changeWorkerContractRpc(
  payload: ChangeWorkerContractRpcPayload
): Promise<WorkerContractChangeResult> {
  const params = withTarget(
    {
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
    },
    "p_target_contract_id",
    payload.targetContractId
  )

  const { data, error } = await supabase.rpc("change_worker_contract", params)
  if (error) throw error

  const result = (data || {}) as { new_contract_id?: string | null }
  return { newContractId: result.new_contract_id ?? null }
}

/** Reubicación: cierra la asignación actual, crea la nueva y prepara el anexo. */
export async function changeWorkerPositionRpc(
  payload: ChangeWorkerPositionRpcPayload
): Promise<WorkerPositionChangeResult> {
  const params = withTarget(
    {
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
    },
    "p_target_assignment_id",
    payload.targetAssignmentId
  )

  const { data, error } = await supabase.rpc("change_worker_position", params)
  if (error) throw error

  await ensureSstAssignmentNotification({
    workerId: payload.workerId,
    positionId: payload.newPositionId,
    effectiveDate: payload.effectiveDate,
    triggerType: "CAMBIO_CARGO",
    sourceId: payload.targetAssignmentId ?? null,
  })

  return data as WorkerPositionChangeResult
}

/**
 * Alta del SEGUNDO contrato del trabajador (`create_worker_pluriemploy`): nueva
 * asignación y contrato independientes, sin duplicar la persona.
 *
 * La RPC reutiliza las mismas primitivas de la contratación normal (snapshots,
 * condiciones, bitácora y movimiento de nómina) y valida la preparación contractual.
 */
export async function createWorkerPluriemployRpc(
  payload: PluriemployContractInput
): Promise<PluriemployResult> {
  const { data, error } = await supabase.rpc("create_worker_pluriemploy", {
    p_worker_id: payload.workerId,
    p_position_id: payload.positionId,
    p_hire_date: payload.hireDate,
    p_contract_type_id: payload.contractTypeId,
    p_contract_start_date: payload.contractStartDate || payload.hireDate,
    p_contract_end_date: payload.isDetermined ? payload.contractEndDate || null : null,
    p_notes: toNullableText(payload.notes),
    p_representative_assignment_id: payload.representativeAssignmentId,
    p_signature_date: payload.signatureDate,
    p_signature_place: toNullableText(payload.signaturePlace),
    p_payment_method_id: payload.paymentMethodId,
    p_compensation_components: payload.compensationComponents,
    p_payment_schedule_text: toNullableText(payload.paymentScheduleText),
  })
  if (error) throw error

  const result = (data || {}) as { assignment_id?: string | null; contract_id?: string | null }

  await ensureSstAssignmentNotification({
    workerId: payload.workerId,
    positionId: payload.positionId,
    effectiveDate: payload.hireDate,
    triggerType: "CAMBIO_CARGO",
    sourceId: result.assignment_id ?? result.contract_id ?? null,
  })

  return {
    assignmentId: result.assignment_id ?? null,
    contractId: result.contract_id ?? null,
  }
}

/**
 * Diferencias contractuales de un cambio de puesto, calculadas por el backend.
 *
 * La vista previa corresponde a la ASIGNACIÓN OBJETIVO: con un solo contrato viaja `null`
 * y la RPC la resuelve por sí misma (llamada actual); con dos contratos vigentes se
 * identifica la asignación seleccionada, de modo que el cálculo salarial y los cambios
 * propuestos sean los de ESE contrato.
 */
export async function previewPositionChangeRpc(input: {
  workerId: string
  newPositionId: string
  effectiveDate: string
  /** Asignación afectada (pluriempleo). `null` = comportamiento actual. */
  targetAssignmentId?: string | null
}): Promise<PositionChangePreview> {
  const { data, error } = await supabase.rpc(
    "position_change_preview",
    withTarget(
      {
        p_worker_id: input.workerId,
        p_new_position_id: input.newPositionId,
        p_effective_date: input.effectiveDate,
      },
      "p_target_assignment_id",
      input.targetAssignmentId
    )
  )
  if (error) throw error

  const result = data as PositionChangePreview
  return {
    ...result,
    changes: ((result?.changes || []) as ContractualChange[])
      .slice()
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
  }
}
