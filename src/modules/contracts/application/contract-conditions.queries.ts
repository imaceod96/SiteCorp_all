import {
  rpcPendingContractFormalization,
  selectActivePaymentMethods,
  selectCompensationComponentsByContract,
  selectContractCompensationComponents,
  selectContractConditions,
} from "../infrastructure/contract-conditions.repository"
import type {
  ContractCompensationComponent,
  ContractConditionsSnapshot,
  ContractFormalizationPending,
  PaymentMethodOption,
} from "../domain/entities"

/**
 * Contratos y documentos — Casos de uso de condiciones contractuales (aplicación).
 *
 * Distinción que se conserva: SALARIO ACTUAL se deriva del puesto (dominio de estructura) y
 * SALARIO FORMALIZADO es el snapshot del contrato, que nunca se recalcula. El total
 * contractual y el salario de escala SIEMPRE los calcula el backend.
 */

/** Catálogo global de formas de pago (A tiempo / A rendimiento). */
export async function fetchPaymentMethods(): Promise<PaymentMethodOption[]> {
  return selectActivePaymentMethods()
}

/**
 * Checklist de formalización calculado por el backend: `blocking` impide formalizar;
 * `warnings` sólo advierte.
 */
export async function fetchContractFormalizationPending(input: {
  entityId: string
  positionId: string | null
  signatureDate: string | null
  signaturePlace: string | null
  paymentMethodId: string | null
  representativeAssignmentId: string | null
}): Promise<ContractFormalizationPending> {
  return rpcPendingContractFormalization(input)
}

/** Conceptos retributivos persistidos de un contrato (histórico). */
export async function fetchContractCompensationComponents(
  contractId: string
): Promise<ContractCompensationComponent[]> {
  return selectContractCompensationComponents(contractId)
}

/** Conceptos retributivos de varios contratos, agrupados por contrato. */
export async function fetchComponentsByContract(
  contractIds: string[]
): Promise<Record<string, ContractCompensationComponent[]>> {
  return selectCompensationComponentsByContract(contractIds)
}

/** Condiciones formalizadas de un contrato (snapshot histórico con sus conceptos). */
export async function fetchContractConditions(
  contractId: string
): Promise<ContractConditionsSnapshot | null> {
  return selectContractConditions(contractId)
}
