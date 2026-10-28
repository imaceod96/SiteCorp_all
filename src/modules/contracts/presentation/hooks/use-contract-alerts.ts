import { useQuery, type QueryClient } from "@tanstack/react-query"
import {
  CONTRACT_ALERT_HORIZON_DAYS,
  fetchContractAlerts,
  requiresAttention,
  type ContractAlertRow,
} from "@/modules/contracts"

/**
 * Alertas de vencimiento contractual vía React Query.
 *
 * Única fuente de datos para el módulo de Vencimientos, el badge del sidebar y el
 * bloque del Dashboard: los tres consumen `contract_expiry_alerts` con la misma
 * clasificación (derivada del contrato vigente y su fecha final formalizada).
 *
 * La query key incluye siempre `entityId` y el horizonte, de modo que cambiar de
 * entidad nunca reutiliza cache de otra entidad.
 */
export const contractAlertsQueryKey = (
  entityId: string | null | undefined,
  horizonDays: number,
  workerId: string | null
) => ["contract-alerts", entityId, horizonDays, workerId ?? "all"] as const

export function useEntityContractAlerts(
  entityId: string | null | undefined,
  options: {
    horizonDays?: number
    workerId?: string | null
    enabled?: boolean
  } = {}
) {
  const horizonDays = options.horizonDays ?? CONTRACT_ALERT_HORIZON_DAYS
  const workerId = options.workerId ?? null

  return useQuery({
    queryKey: contractAlertsQueryKey(entityId, horizonDays, workerId),
    queryFn: () =>
      fetchContractAlerts(entityId as string, {
        horizonDays,
        workerId: workerId ?? undefined,
      }),
    enabled: !!entityId && (options.enabled ?? true),
    staleTime: 0,
    refetchOnMount: "always",
  })
}

/** Contador de alertas que requieren atención (regla única `requiresAttention`). */
export function useContractAlertAttentionCount(
  entityId: string | null | undefined,
  options: { enabled?: boolean; horizonDays?: number } = {}
): number | null {
  const query = useEntityContractAlerts(entityId, {
    horizonDays: options.horizonDays ?? CONTRACT_ALERT_HORIZON_DAYS,
    enabled: options.enabled,
  })
  if (!query.data) return null
  return (query.data as ContractAlertRow[]).filter(requiresAttention).length
}

/**
 * Invalida los datos derivados de contratos (alertas de vencimiento y resumen de
 * entidad) para que se recalculen tras crear/formalizar/cambiar/finalizar un
 * contrato. Se invalida por prefijo, por lo que cubre cualquier entidad/horizonte.
 */
export function invalidateContractAlertData(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["contract-alerts"] })
  queryClient.invalidateQueries({ queryKey: ["entity-summary"] })
}
