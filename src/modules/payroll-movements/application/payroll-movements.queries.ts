import type { PayrollMovementEventType } from "../domain/entities"
import { rpcFindPayrollMovement } from "../infrastructure/payroll-movements.repository"

/**
 * Movimientos de Nómina — Casos de uso de LECTURA (aplicación).
 *
 * Localizar el movimiento que corresponde a un evento laboral. Nunca se deduce desde el
 * estado vivo del trabajador: se pregunta al backend por el trabajador, el tipo de evento y
 * la fecha efectiva, que son la clave real del registro histórico.
 */

/** Movimiento del evento indicado, o `null` si ese evento no registró ninguno. */
export async function findPayrollMovement(
  workerId: string,
  eventType: PayrollMovementEventType,
  effectiveDate: string
): Promise<string | null> {
  return rpcFindPayrollMovement({ workerId, eventType, effectiveDate })
}
