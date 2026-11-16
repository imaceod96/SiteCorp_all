import {
  applyDueScheduledSeparationsRpc,
  cancelScheduledWorkerSeparationRpc,
  changeWorkerContractRpc,
  changeWorkerPositionRpc,
  createWorkerPluriemployRpc,
  registerWorkerSeparationRpc,
  reincorporateWorkerRpc,
} from "../infrastructure/worker-transitions.repository"
import type {
  PluriemployContractInput,
  PluriemployResult,
  WorkerContractChangeInput,
  WorkerContractChangeResult,
  WorkerPositionChangeInput,
  WorkerPositionChangeResult,
  WorkerReincorporationInput,
  WorkerReincorporationWithResolutionInput,
  WorkerSeparationInput,
  WorkerSeparationResult,
} from "../domain/entities"

/**
 * Personas — Casos de uso de las transiciones laborales (aplicación).
 *
 *   · Baja               → Trabajadores a Reingresos (cierra puesto y contrato vigentes).
 *   · Reincorporación    → Reingresos a Trabajadores (nuevo período, puesto y contrato).
 *   · Reubicación        → permanece en Trabajadores; nueva asignación y, si procede,
 *                          anexo al contrato vigente. Conserva la trayectoria.
 *   · Cambio de contrato → permanece en Trabajadores; contrato nuevo e histórico intacto.
 *
 * Los documentos se encolan automáticamente en `public.document_generation_jobs` mediante
 * triggers en PostgreSQL dentro de la misma transacción de la RPC y se procesan en segundo
 * plano mediante `process-document-jobs`.
 */

export type SeparationOutcome = WorkerSeparationResult

/** Baja del trabajador: inmediata si effectiveDate <= hoy, o programada si effectiveDate > hoy. */
export async function registerWorkerSeparation(
  input: WorkerSeparationInput
): Promise<SeparationOutcome> {
  return registerWorkerSeparationRpc({
    workerId: input.workerId,
    effectiveDate: input.effectiveDate,
    separationReasonId: input.separationReasonId,
    notes: input.notes,
    targetAssignmentId: input.targetAssignmentId ?? null,
  })
}

/** Cancela una baja futura previamente programada antes de su fecha efectiva. */
export async function cancelScheduledWorkerSeparation(input: {
  workerId: string
  targetAssignmentId?: string | null
}): Promise<void> {
  await cancelScheduledWorkerSeparationRpc(input)
}

/** Aplica las bajas y cambios diferidos cuya fecha efectiva ya llegó (<= hoy en Cuba). */
export async function applyDueScheduledSeparations(input?: {
  entityId?: string | null
  workerId?: string | null
}): Promise<number> {
  return applyDueScheduledSeparationsRpc(input)
}

export interface ReincorporationOutcome {
  workerId: string | null
  documentWarning: string | null
}

/** Reincorporación directa con contrato nuevo. */
export async function reincorporateWorkerWithContract(
  input: WorkerReincorporationInput
): Promise<ReincorporationOutcome> {
  const result = await reincorporateWorkerRpc({
    workerId: input.workerId,
    positionId: input.positionId,
    reincorporationDate: input.reincorporationDate,
    contractTypeId: input.contractTypeId,
    contractStartDate: input.contractStartDate || input.reincorporationDate,
    contractEndDate: input.isDetermined ? input.contractEndDate || null : null,
    notes: null,
    representativeAssignmentId: input.representativeAssignmentId,
    signatureDate: input.signatureDate,
    signaturePlace: input.signaturePlace,
    paymentMethodId: input.paymentMethodId,
    compensationComponents: input.compensationComponents,
    paymentScheduleText: input.paymentScheduleText,
  })

  return { workerId: result.workerId, documentWarning: null }
}

/** Reincorporación directa hacia un Cargo Especialista Principal: Resolución sustitutiva. */
export async function reincorporateWorkerWithResolution(
  input: WorkerReincorporationWithResolutionInput
): Promise<ReincorporationOutcome> {
  const result = await reincorporateWorkerRpc({
    workerId: input.workerId,
    positionId: input.positionId,
    reincorporationDate: input.reincorporationDate,
    contractTypeId: null,
    contractStartDate: null,
    contractEndDate: null,
    notes: null,
    representativeAssignmentId: input.resolution.representativeAssignmentId,
    signatureDate: null,
    signaturePlace: null,
    paymentMethodId: null,
    compensationComponents: null,
    paymentScheduleText: null,
    resolutionDate: input.resolution.resolutionDate,
  })

  return { workerId: result.workerId, documentWarning: null }
}

export interface PositionChangeOutcome extends WorkerPositionChangeResult {
  /** Aviso cuando el documento del anexo o de la Resolución no se pudo generar. */
  documentWarning: string | null
}

/**
 * Reubicación: cierra la asignación actual, crea la nueva y —si el cambio altera
 * condiciones representables— registra el anexo en la MISMA transacción.
 */
export async function changeWorkerPosition(
  input: WorkerPositionChangeInput
): Promise<PositionChangeOutcome> {
  const addendum = input.addendum
  const formalizeNow = !!addendum?.create && addendum.formalize

  const result = await changeWorkerPositionRpc({
    workerId: input.workerId,
    newPositionId: input.newPositionId,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
    notes: input.notes,
    createAddendum: !!addendum?.create,
    reasonCode: "POSITION_CHANGE",
    signatureDate: formalizeNow ? addendum?.signatureDate || null : null,
    signaturePlace: formalizeNow ? addendum?.signaturePlace || null : null,
    representativeAssignmentId: formalizeNow
      ? addendum?.representativeAssignmentId || null
      : input.representativeAssignmentId ?? null,
    requireFormalized: formalizeNow,
    resolutionDate: input.resolutionDate ?? null,
    targetAssignmentId: input.targetAssignmentId ?? null,
  })

  return { ...result, documentWarning: null }
}

export interface ContractChangeOutcome extends WorkerContractChangeResult {
  /** Aviso cuando el documento del contrato nuevo no se pudo generar. */
  documentWarning: string | null
}

/** Cambio de tipo de contrato: contrato nuevo formalizado y anterior conservado. */
export async function changeWorkerContract(
  input: WorkerContractChangeInput
): Promise<ContractChangeOutcome> {
  const result = await changeWorkerContractRpc({
    workerId: input.workerId,
    newContractTypeId: input.newContractTypeId,
    effectiveDate: input.effectiveDate,
    newEndDate: input.isDetermined ? input.newEndDate || null : null,
    notes: input.notes,
    representativeAssignmentId: input.representativeAssignmentId,
    signatureDate: input.signatureDate,
    signaturePlace: input.signaturePlace,
    paymentMethodId: input.paymentMethodId,
    compensationComponents: input.compensationComponents,
    paymentScheduleText: input.paymentScheduleText,
    targetContractId: input.targetContractId ?? null,
  })

  return { ...result, documentWarning: null }
}

export interface PluriemployOutcome extends PluriemployResult {
  /** Aviso cuando el documento del contrato no se pudo generar. */
  documentWarning: string | null
}

/**
 * Alta del SEGUNDO contrato del trabajador (Pluriempleo).
 */
export async function createWorkerPluriemploy(
  input: PluriemployContractInput
): Promise<PluriemployOutcome> {
  const result = await createWorkerPluriemployRpc(input)
  return { ...result, documentWarning: null }
}
