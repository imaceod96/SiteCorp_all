import { supabase } from "@/lib/supabase"
import type { PayrollMovementEventType } from "../domain/entities"

/**
 * Movimientos de Nómina — Repositorio (infraestructura).
 *
 * Único punto del dominio que habla con Supabase: localiza el movimiento HISTÓRICO que
 * registró el backend para un evento laboral concreto (trabajador + tipo de evento + fecha
 * efectiva). El nombre de la RPC y sus parámetros son el CONTRATO del backend y NO cambian.
 *
 * La creación, la modificación y los estados del movimiento NO pasan por aquí: los gobierna el
 * backend dentro de la operación que los origina.
 */

/** Identificador del movimiento del evento, o `null` si el evento no registró movimiento. */
export const rpcFindPayrollMovement = async (input: {
  workerId: string
  eventType: PayrollMovementEventType
  effectiveDate: string
}): Promise<string | null> => {
  const { data, error } = await supabase.rpc("find_payroll_movement", {
    p_worker_id: input.workerId,
    p_event_type: input.eventType,
    p_effective_date: input.effectiveDate,
  })
  if (error) throw error
  return data ? String(data) : null
}
