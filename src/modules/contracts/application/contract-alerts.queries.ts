import {
  CONTRACT_ALERT_LOOKAHEAD_DAYS,
  type ContractAlertRow,
} from "../domain/contract-alerts.rules"
import { fetchContractAlertRows } from "../infrastructure/contract-alerts.repository"

/**
 * Contratos — Casos de uso de lectura de vencimientos (aplicación).
 *
 * Los nombres públicos y las firmas son los mismos que usaban el hook, la ficha del
 * trabajador y el Resumen de entidad: cambiar de entidad, de horizonte o de trabajador
 * no cambia ni el cálculo ni los permisos (los gobierna la RPC).
 */

/**
 * Alertas de vencimiento de la entidad. `targetWorkerId` permite reutilizar el
 * mismo cálculo (y la misma autoridad de permisos) desde WorkerDetail.
 */
export async function fetchContractAlerts(
  entityId: string,
  options: { horizonDays?: number; workerId?: string } = {}
): Promise<ContractAlertRow[]> {
  return fetchContractAlertRows(entityId, options)
}

/** Vencimiento del contrato vigente de un trabajador (o null si no aplica). */
export async function fetchWorkerContractAlert(
  entityId: string,
  workerId: string
): Promise<ContractAlertRow | null> {
  const rows = await fetchContractAlerts(entityId, {
    horizonDays: CONTRACT_ALERT_LOOKAHEAD_DAYS,
    workerId,
  })
  return rows[0] ?? null
}
