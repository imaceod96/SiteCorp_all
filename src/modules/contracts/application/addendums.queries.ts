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

/**
 * Condiciones contractuales formalizadas vigentes + anexos pendientes del trabajador.
 *
 * `targetContractId` identifica el contrato seleccionado cuando el trabajador tiene DOS
 * contratos vigentes (pluriempleo); con uno solo viaja `null`/ausente y la llamada es la
 * misma de siempre.
 */
export async function fetchWorkerContractualConditions(
  workerId: string,
  targetContractId?: string | null
): Promise<WorkerContractualConditions> {
  return rpcWorkerFormalizedConditions(workerId, targetContractId)
}
