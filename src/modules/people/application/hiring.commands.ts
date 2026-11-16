import { hireCandidateRpc } from "../infrastructure/worker-transitions.repository"
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
 * La generación documental se encola automáticamente en `public.document_generation_jobs`
 * mediante triggers en PostgreSQL dentro de la misma transacción de la RPC y se procesa
 * en segundo plano por `process-document-jobs`.
 */

export interface EngagementOutcome {
  workerId: string | null
  contractId: string | null
  resolutionId: string | null
  /** Aviso cuando el documento de la operación queda pendiente o no se pudo generar. */
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
    // §24/§25/§30: para Cargo Cuadro / Especialista Principal el alta NO crea contrato,
    // así que el tipo de contrato no se envía (el backend recibe null, como siempre).
    contractTypeId: input.specialDocumentRole ? null : input.contractTypeId,
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

  return { ...result, documentWarning: null }
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

  return { ...result, documentWarning: null }
}
