import {
  changeWorkerContractRpc,
  changeWorkerPositionRpc,
  createWorkerPluriemployRpc,
  registerWorkerSeparationRpc,
  reincorporateWorkerRpc,
} from "../infrastructure/worker-transitions.repository"
import {
  ensureAddendumDocument,
  ensureContractDocument,
  ensureMovementDocument,
  ensureResolutionDocument,
} from "../infrastructure/transition-documents"
import { TRANSITION_MOVEMENT_DOCUMENT } from "../domain/rules"
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
 * Efectos posteriores a la transacción (documentos), iguales a los que ya tenían las
 * pantallas: el movimiento de nómina es silencioso (Alta/Baja/Reubicación) y el contrato,
 * el anexo y la Resolución devuelven aviso para no presentar la operación como completada.
 *
 * Las validaciones previas viven en el dominio y las aplica el diálogo; la RPC revalida en
 * el servidor (fechas, vacantes, permisos y preparación contractual).
 */

/** Baja del trabajador: libera la plaza y lo deja en Reingresos con todo su historial. */
export async function registerWorkerSeparation(input: WorkerSeparationInput): Promise<void> {
  await registerWorkerSeparationRpc({
    workerId: input.workerId,
    effectiveDate: input.effectiveDate,
    separationReasonId: input.separationReasonId,
    notes: input.notes,
    targetAssignmentId: input.targetAssignmentId ?? null,
  })

  const movement = TRANSITION_MOVEMENT_DOCUMENT.separation
  if (movement) await ensureMovementDocument(input.workerId, movement, input.effectiveDate)
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

  const documentWarning = result.contractId ? await ensureContractDocument(result.contractId) : null
  return { workerId: result.workerId, documentWarning }
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

  const documentWarning = result.resolutionId
    ? await ensureResolutionDocument(result.resolutionId)
    : null
  return { workerId: result.workerId, documentWarning }
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
    // El representante del anexo cuando se formaliza; el de la Resolución en la vía de
    // Cargo Especialista Principal (§45). En el resto no se envía ninguno.
    representativeAssignmentId: formalizeNow
      ? addendum?.representativeAssignmentId || null
      : input.representativeAssignmentId ?? null,
    requireFormalized: formalizeNow,
    resolutionDate: input.resolutionDate ?? null,
    // Pluriempleo: con dos contratos vigentes hay que identificar la asignación
    // afectada. Con uno solo viaja `null` y la llamada es la de siempre.
    targetAssignmentId: input.targetAssignmentId ?? null,
  })

  // §42/§65: el documento del anexo formalizado se genera automáticamente.
  const addendumId = result.addendum?.addendum_id
  let documentWarning: string | null = null

  if (result.resolution_id) {
    documentWarning = await ensureResolutionDocument(result.resolution_id)
  } else if (result.addendum?.addendum_status === "FORMALIZED" && addendumId) {
    documentWarning = await ensureAddendumDocument(addendumId)
  }

  // Movimiento de Nómina (Reubicación) → documento individual en el expediente.
  const movement = TRANSITION_MOVEMENT_DOCUMENT.position_change
  if (movement) await ensureMovementDocument(input.workerId, movement, input.effectiveDate)

  return { ...result, documentWarning }
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
    // Pluriempleo: con dos contratos vigentes hay que identificar el contrato afectado.
    targetContractId: input.targetContractId ?? null,
  })

  const documentWarning = result.newContractId
    ? await ensureContractDocument(result.newContractId)
    : null

  return { ...result, documentWarning }
}

export interface PluriemployOutcome extends PluriemployResult {
  /** Aviso cuando el documento del contrato no se pudo generar. */
  documentWarning: string | null
}

/**
 * Alta del SEGUNDO contrato del trabajador (Pluriempleo).
 *
 * No crea candidato ni proceso de selección y no duplica la ficha: abre una segunda
 * asignación y un segundo contrato independientes sobre la misma persona. El documento
 * del contrato se genera después y nunca interrumpe la operación.
 */
export async function createWorkerPluriemploy(
  input: PluriemployContractInput
): Promise<PluriemployOutcome> {
  const result = await createWorkerPluriemployRpc(input)

  const documentWarning = result.contractId
    ? await ensureContractDocument(result.contractId)
    : null

  return { ...result, documentWarning }
}
