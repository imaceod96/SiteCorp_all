import type { QueryClient } from "@tanstack/react-query"
import {
  ensureWorkerVacationAccruals,
  fetchWorkerVacationMovements,
  fetchWorkerVacationPeriods,
  fetchWorkerVacationSummary,
} from "../infrastructure/vacations.repository"
import type { VacationMovement, VacationPeriod, VacationSummary } from "../domain/entities"

/**
 * Vacaciones — Casos de uso y claves de caché (aplicación).
 *
 * Orquesta las operaciones del repositorio sin conocer React: mantiene el orden
 * semántico de las llamadas y expone el contrato de caché que consumen los hooks.
 * Toda query está SCOPEADA por entidad o por trabajador, de modo que cambiar de
 * entidad nunca reutiliza cache de otra (§86/§88).
 */

export const vacationOverviewQueryKey = (entityId: string | null | undefined) =>
  ["vacations", "overview", entityId ?? "none"] as const

export const workerVacationQueryKey = (workerId: string | null | undefined) =>
  ["vacations", "worker", workerId ?? "none"] as const

export interface WorkerVacationData {
  summary: VacationSummary
  periods: VacationPeriod[]
  movements: VacationMovement[]
}

/**
 * Carga consolidada de la ficha del trabajador.
 *
 * El mantenimiento idempotente del devengo (`run_worker_vacation_catchup`) se
 * ejecuta y se ESPERA antes de leer: el saldo consolidado debe reflejar siempre los
 * meses cerrados. Solo después se leen en paralelo resumen, períodos y movimientos.
 */
export async function loadWorkerVacationData(workerId: string): Promise<WorkerVacationData> {
  // Mantenimiento idempotente del devengo antes de leer el saldo consolidado.
  await ensureWorkerVacationAccruals(workerId)
  const [summary, periods, movements] = await Promise.all([
    fetchWorkerVacationSummary(workerId),
    fetchWorkerVacationPeriods(workerId),
    fetchWorkerVacationMovements(workerId),
  ])
  return { summary, periods, movements }
}

/**
 * Invalida los datos derivados de vacaciones tras registrar/cancelar/ajustar/inicializar.
 * Invalida por prefijo para cubrir cualquier entidad/trabajador afectado, y también el
 * resumen de entidad (Dashboard) que reutiliza el mismo motor (§87).
 */
export function invalidateVacationData(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["vacations"] })
  queryClient.invalidateQueries({ queryKey: ["entity-summary"] })
}
