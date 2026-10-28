import {
  rpcApplySalaryGroupValueChange,
  rpcFinalizeSalaryChangeEvent,
} from "../infrastructure/salary.repository"
import type { SalaryChangeApplyResult, SalaryChangeEventResult } from "../domain/entities"

/**
 * Contratos y documentos — Casos de uso de cambio salarial (aplicación).
 *
 * El backend aplica el cambio de forma atómica y deja el anexo pendiente de generar; aquí
 * sólo se envía lo que el usuario decidió. Nada de esto modifica contratos, históricos ni
 * documentos por su cuenta.
 */

/**
 * Aplica el cambio de forma atómica: nueva versión del valor salarial, histórico salarial de
 * cada trabajador afectado y anexo contractual pendiente de generar.
 */
export async function applySalaryChange(
  groupId: string,
  newAmount: number,
  currencyCode: string | null,
  effectiveFrom: string,
  notes?: string | null
): Promise<SalaryChangeApplyResult> {
  return rpcApplySalaryGroupValueChange(groupId, newAmount, currencyCode, effectiveFrom, notes)
}

/**
 * Tras aplicar un cambio salarial masivo, materializa la documentación del evento: un
 * Movimiento de Nómina (Reubicación) por trabajador realmente afectado y los lotes ZIP.
 */
export async function finalizeSalaryChangeEvent(
  groupId: string,
  effectiveDate: string,
  description: string | null,
  workers: { worker_id: string; previous_amount: number }[]
): Promise<SalaryChangeEventResult> {
  return rpcFinalizeSalaryChangeEvent(groupId, effectiveDate, description, workers)
}
