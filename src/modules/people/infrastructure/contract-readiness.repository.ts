import { supabase } from "@/lib/supabase"
import type { ContractReadinessParams, ReadinessResult } from "../domain/entities"

/**
 * Personas — Repositorio de preparación contractual (infraestructura).
 *
 * Los validadores viven como funciones SQL (una única fuente de verdad, reutilizada por
 * el frontend y por las RPC de contratación/formalización). Aquí sólo se invocan y se
 * tipa el resultado estructurado `{ ready, missing }`; el mensaje que ve el usuario lo
 * compone el dominio (`formatReadinessMessage`).
 */

/** Integridad completa antes de contratar o reincorporar (candidato/trabajador + puesto). */
export async function fetchHiringReadiness(
  params: ContractReadinessParams
): Promise<ReadinessResult> {
  const { data, error } = await supabase.rpc("validate_hiring_readiness", {
    p_candidate_id: params.candidateId || null,
    p_worker_id: params.workerId || null,
    p_position_id: params.positionId || null,
    p_signature_date: params.signatureDate || null,
    p_contract_type_id: params.contractTypeId || null,
    p_signature_place: params.signaturePlace || null,
    p_payment_method_id: params.paymentMethodId || null,
    p_representative_assignment_id: params.representativeAssignmentId || null,
    p_contract_start_date: params.contractStartDate || null,
    p_contract_end_date: params.contractEndDate || null,
  })
  if (error) throw error
  return data as ReadinessResult
}

/** Integridad de los datos personales del candidato. */
export async function fetchCandidateContractReadiness(
  candidateId: string
): Promise<ReadinessResult> {
  const { data, error } = await supabase.rpc("validate_candidate_contract_readiness", {
    p_candidate_id: candidateId,
  })
  if (error) throw error
  return data as ReadinessResult
}

/** Integridad estructural del puesto (cargo, jornada, escala aplicable). */
export async function fetchPositionContractReadiness(
  positionId: string
): Promise<ReadinessResult> {
  const { data, error } = await supabase.rpc("validate_position_contract_readiness", {
    p_position_id: positionId,
  })
  if (error) throw error
  return data as ReadinessResult
}
