import {
  fetchCandidateContractReadiness,
  fetchHiringReadiness,
  fetchPositionContractReadiness,
} from "../infrastructure/contract-readiness.repository"
import type { ContractReadinessParams, ReadinessResult } from "../domain/entities"

/**
 * Personas — Consultas de preparación contractual (aplicación).
 *
 * Revisan la integridad ANTES de crear cualquier registro, de modo que la generación
 * documental nunca sea el primer punto donde se descubre un dato estructural faltante
 * (§26/§38/§39). El mensaje humano del resultado lo compone `formatReadinessMessage`.
 */

/** Integridad completa del alta o de la reincorporación. */
export async function checkHiringReadiness(
  params: ContractReadinessParams
): Promise<ReadinessResult> {
  return fetchHiringReadiness(params)
}

/** Integridad de los datos personales necesarios para formalizar el contrato. */
export async function checkCandidateContractReadiness(
  candidateId: string
): Promise<ReadinessResult> {
  return fetchCandidateContractReadiness(candidateId)
}

/** Integridad estructural del puesto (cargo, jornada, escala aplicable). */
export async function checkPositionContractReadiness(
  positionId: string
): Promise<ReadinessResult> {
  return fetchPositionContractReadiness(positionId)
}
