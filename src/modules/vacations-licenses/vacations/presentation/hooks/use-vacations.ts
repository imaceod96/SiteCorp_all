import { useQuery } from "@tanstack/react-query"
import {
  fetchEntityVacationOverview,
  loadWorkerVacationData,
  vacationOverviewQueryKey,
  workerVacationQueryKey,
  invalidateVacationData,
} from "@/domains/vacations-licenses/vacations"
import type {
  VacationOverviewRow,
  WorkerVacationData,
} from "@/domains/vacations-licenses/vacations"

/**
 * Vacaciones — queries de React Query (Fase 18).
 *
 * Adaptador React del dominio: los hooks solo declaran la query, sus opciones de
 * caché y el caso de uso que la resuelve. Las claves, la carga consolidada
 * (devengo idempotente → lecturas) y la invalidación viven en el dominio
 * (`application/vacations.queries.ts`) y se reexportan aquí sin cambios para
 * conservar la superficie pública de este módulo.
 *
 * Toda query está SCOPEADA por entidad o por trabajador, de modo que cambiar de
 * entidad nunca reutiliza cache de otra (§86/§88). Abrir el módulo/ficha ejecuta el
 * catch-up idempotente del backend: el saldo consolidado siempre refleja meses cerrados.
 */

export { vacationOverviewQueryKey, workerVacationQueryKey, invalidateVacationData }
export type { WorkerVacationData }

export function useEntityVacationOverview(entityId: string | null | undefined, enabled = true) {
  return useQuery<VacationOverviewRow[]>({
    queryKey: vacationOverviewQueryKey(entityId),
    queryFn: () => fetchEntityVacationOverview(entityId as string),
    enabled: !!entityId && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  })
}

export function useWorkerVacation(workerId: string | null | undefined, enabled = true) {
  return useQuery<WorkerVacationData>({
    queryKey: workerVacationQueryKey(workerId),
    queryFn: () => loadWorkerVacationData(workerId as string),
    enabled: !!workerId && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  })
}
