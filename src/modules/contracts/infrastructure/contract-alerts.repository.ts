import { supabase } from "@/lib/supabase"
import {
  CONTRACT_ALERT_HORIZON_DAYS,
  type ContractAlertRow,
} from "../domain/contract-alerts.rules"

/**
 * Contratos — Repositorio de vencimientos contractuales (infraestructura).
 *
 * Único punto del dominio que consulta `contract_expiry_alerts`: la RPC, sus
 * parámetros y el horizonte por defecto son EXACTAMENTE los mismos de siempre, de
 * modo que la clasificación temporal (categoría de alerta y días restantes) sigue
 * teniendo una única fuente de verdad en la base de datos.
 */

/**
 * Alertas de vencimiento de la entidad. `targetWorkerId` permite reutilizar el
 * mismo cálculo (y la misma autoridad de permisos) desde WorkerDetail.
 */
export async function fetchContractAlertRows(
  entityId: string,
  options: { horizonDays?: number; workerId?: string } = {}
): Promise<ContractAlertRow[]> {
  const { data, error } = await supabase.rpc("contract_expiry_alerts", {
    target_entity_id: entityId,
    horizon_days: options.horizonDays ?? CONTRACT_ALERT_HORIZON_DAYS,
    target_worker_id: options.workerId ?? null,
  })

  if (error) throw error
  return (data as ContractAlertRow[]) || []
}
