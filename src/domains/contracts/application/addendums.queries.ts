import {
  rpcAddendumPendingChecklist,
  rpcWorkerFormalizedConditions,
  selectWorkerAddendums,
} from "../infrastructure/addendums.repository"
import type {
  AddendumPending,
  ContractAddendum,
  WorkerContractualConditions,
} from "../domain/entities"

/**
 * Contratos y documentos — Casos de uso de lectura de anexos (aplicación).
 *
 * La presentación pide estos casos de uso y recibe los modelos ya normalizados: no compone
 * consultas ni conoce el nombre de ninguna tabla o RPC.
 */

/** Anexos del trabajador (todos sus contratos), con el detalle antes/después. */
export async function fetchWorkerAddendums(workerId: string): Promise<ContractAddendum[]> {
  return selectWorkerAddendums(workerId)
}

/** Checklist de formalización calculado por el backend. */
export async function fetchAddendumPending(addendumId: string): Promise<AddendumPending> {
  return rpcAddendumPendingChecklist(addendumId)
}

/** Condiciones contractuales formalizadas vigentes + anexos pendientes del trabajador. */
export async function fetchWorkerContractualConditions(
  workerId: string
): Promise<WorkerContractualConditions> {
  return rpcWorkerFormalizedConditions(workerId)
}
