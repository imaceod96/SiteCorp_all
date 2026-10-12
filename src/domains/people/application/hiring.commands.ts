import { hireCandidateRpc } from "../infrastructure/worker-transitions.repository"
import {
  ensureContractDocument,
  ensureMovementDocument,
  ensureResolutionDocument,
} from "../infrastructure/transition-documents"
import { TRANSITION_MOVEMENT_DOCUMENT } from "../domain/rules"
import type {
  CandidateHireInput,
  CandidateHireWithResolutionInput,
} from "../domain/entities"

/**
 * Personas — Casos de uso de contratación (aplicación).
 *
 * Contratar a una persona la lleva de Candidatos a Trabajadores; si esa persona ya tuvo
 * un expediente laboral en el cliente, la misma operación la reincorpora (vuelve a
 * Trabajadores) SIN duplicar ni la persona ni su historial: la RPC resuelve el vínculo
 * por su `worker_id`. Es una sola operación porque es una sola regla.
 *
 * Hay dos vías según el Cargo destino, y las decide el dominio
 * (`requiresResolution` / `isSpecialDocumentRole`):
 *
 *   · CONTRATO    → se formaliza el contrato y se genera su documento.
 *   · RESOLUCIÓN  → Cargo Especialista Principal: la Resolución sustituye al contrato.
 *
 * En ambos casos la operación registra el movimiento de nómina de Alta, cuyo documento es
 * silencioso: el movimiento ya quedó registrado y puede regenerarse.
 *
 * Las validaciones previas (mensajes que ve el usuario) viven en el dominio y las aplica
 * el diálogo antes de llegar aquí; la autoridad final es la propia RPC, que revalida en
 * el servidor la preparación contractual, las fechas y los permisos.
 */

export interface EngagementOutcome {
  workerId: string | null
  contractId: string | null
  resolutionId: string | null
  /** Aviso cuando el documento de la operación no se pudo generar. */
  documentWarning: string | null
}

/** Alta (o recontratación) con formalización de contrato. */
export async function hireCandidateWithContract(
  input: CandidateHireInput
): Promise<EngagementOutcome> {
  const result = await hireCandidateRpc({
    candidateId: input.candidateId,
    positionId: input.positionId,
    hireDate: input.hireDate,
    contractTypeId: input.contractTypeId,
    contractStartDate: input.contractStartDate || input.hireDate,
    contractEndDate: input.isDetermined ? input.contractEndDate || null : null,
    notes: input.notes,
    representativeAssignmentId: input.representativeAssignmentId,
    signatureDate: input.signatureDate,
    signaturePlace: input.signaturePlace,
    paymentMethodId: input.paymentMethodId,
    compensationComponents: input.compensationComponents,
    paymentScheduleText: input.paymentScheduleText,
  })

  // Para Cargos Cuadro / Especialista Principal no se genera contrato ni documento.
  const documentWarning =
    !input.specialDocumentRole && result.contractId
      ? await ensureContractDocument(result.contractId)
      : null

  await registerHireMovement(result.workerId, input.hireDate)

  return { ...result, documentWarning }
}

/** Alta (o recontratación) hacia un Cargo Especialista Principal: Resolución sustitutiva. */
export async function hireCandidateWithResolution(
  input: CandidateHireWithResolutionInput
): Promise<EngagementOutcome> {
  const result = await hireCandidateRpc({
    candidateId: input.candidateId,
    positionId: input.positionId,
    hireDate: input.hireDate,
    contractTypeId: null,
    contractStartDate: null,
    contractEndDate: null,
    notes: input.notes,
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

  await registerHireMovement(result.workerId, input.hireDate)

  return { ...result, documentWarning }
}

/** Movimiento de nómina del alta, tal y como lo registra la transición. */
async function registerHireMovement(workerId: string | null, hireDate: string): Promise<void> {
  const movement = TRANSITION_MOVEMENT_DOCUMENT.hire
  if (!workerId || !movement) return
  await ensureMovementDocument(workerId, movement, hireDate)
}
