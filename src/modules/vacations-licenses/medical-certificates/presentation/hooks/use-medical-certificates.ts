import { useQuery, type QueryClient } from "@tanstack/react-query"
import {
  fetchEntityMedicalCertificates,
  fetchWorkerMedicalCertificates,
  type EntityMedicalCertificatesResult,
  type WorkerMedicalCertificatesResult,
} from "@/domains/vacations-licenses/medical-certificates"

/**
 * Certificados Médicos — React Query (Fase 19).
 *
 * Toda query está SCOPEADA por entidad y por trabajador/año, de modo que cambiar
 * de entidad o de trabajador nunca reutiliza cache de otro (§60/§88).
 *
 * retry: 1 — los errores de esta familia (400 de validación / permiso) son
 * deterministas: reintentar en bucle solo genera spam de peticiones (§31).
 */

export const workerMedicalCertificatesQueryKey = (
  entityId: string | null | undefined,
  workerId: string | null | undefined,
  year: number | null | undefined
) => ["medical-certificates", "worker", entityId ?? "none", workerId ?? "none", year ?? "all"] as const

export const entityMedicalCertificatesQueryKey = (
  entityId: string | null | undefined,
  year: number | null | undefined
) => ["medical-certificates", "entity", entityId ?? "none", year ?? "all"] as const

const EMPTY_WORKER: WorkerMedicalCertificatesResult = {
  worker_id: "",
  year: null,
  certificates: [],
  total_days: 0,
  count: 0,
}

const EMPTY_ENTITY: EntityMedicalCertificatesResult = {
  entity_id: "",
  year: null,
  certificates: [],
  total_days: 0,
  count: 0,
  worker_count: 0,
}

/** Histórico + totales anuales de UN trabajador (pestaña del expediente). */
export function useWorkerMedicalCertificates(
  entityId: string | null | undefined,
  workerId: string | null | undefined,
  year: number | null | undefined,
  enabled = true
) {
  return useQuery<WorkerMedicalCertificatesResult>({
    queryKey: workerMedicalCertificatesQueryKey(entityId, workerId, year),
    queryFn: async () => {
      if (!workerId) return EMPTY_WORKER
      return fetchWorkerMedicalCertificates(workerId, year ?? null)
    },
    enabled: enabled && !!entityId && !!workerId,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  })
}

/** Listado global + KPIs de la entidad (página del módulo). */
export function useEntityMedicalCertificates(
  entityId: string | null | undefined,
  year: number | null | undefined,
  enabled = true
) {
  return useQuery<EntityMedicalCertificatesResult>({
    queryKey: entityMedicalCertificatesQueryKey(entityId, year),
    queryFn: async () => {
      if (!entityId) return EMPTY_ENTITY
      return fetchEntityMedicalCertificates(entityId, year ?? null)
    },
    enabled: enabled && !!entityId,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  })
}

/** Invalida todos los datos de certificados tras registrar/editar. */
export function invalidateMedicalCertificateData(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: ["medical-certificates"],
  })
}
