import {
  rpcPreviewSalaryChange,
  rpcSalaryChangeImpact,
  selectWorkerSalaryHistory,
} from "../infrastructure/salary.repository"
import type {
  SalaryChangeImpactRow,
  SalaryChangePreview,
  WorkerSalaryHistoryEntry,
} from "../domain/entities"

/**
 * Contratos y documentos — Historial y previsión salarial (aplicación).
 *
 * El histórico salarial es la evolución económica del trabajador y nunca se recalcula; el
 * anexo contractual es su formalización documental. La previsión del cambio la calcula el
 * backend sin aplicar nada.
 */

/** Histórico salarial del trabajador en orden cronológico inverso, con su anexo si existe. */
export async function fetchWorkerSalaryHistory(
  workerId: string
): Promise<WorkerSalaryHistoryEntry[]> {
  return selectWorkerSalaryHistory(workerId)
}

/** Impacto previsto del cambio de escala, sin aplicarlo. */
export async function previewSalaryChange(
  groupId: string,
  newAmount: number,
  effectiveFrom: string
): Promise<SalaryChangePreview> {
  return rpcPreviewSalaryChange(groupId, newAmount, effectiveFrom)
}

/** Trabajadores cuyo salario cambiará con el nuevo importe en la fecha efectiva. */
export async function fetchSalaryChangeImpact(
  groupId: string,
  newAmount: number,
  effectiveDate: string
): Promise<SalaryChangeImpactRow[]> {
  return rpcSalaryChangeImpact(groupId, newAmount, effectiveDate)
}
