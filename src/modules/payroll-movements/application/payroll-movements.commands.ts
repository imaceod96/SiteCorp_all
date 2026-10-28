import {
  fetchGeneratedDocuments,
  generatePayrollMovementDocument,
} from "@/modules/document-generation"
import type {
  PayrollMovementAutomationResult,
  PayrollMovementEventType,
} from "../domain/entities"
import { movementAlreadyDocumented } from "../domain/rules"
import { findPayrollMovement } from "./payroll-movements.queries"

/**
 * Movimientos de Nómina — Casos de uso de ESCRITURA (aplicación).
 *
 * Garantiza el documento del movimiento en el expediente del trabajador reutilizando el motor
 * documental: aquí sólo se decide CUÁNDO y si ya existe, para no duplicar documentos.
 *
 * Nada se crea ni se modifica en la base de datos: el movimiento ya quedó registrado por el
 * backend y su documento es una consecuencia documental de ese hecho.
 */

/**
 * Garantiza el documento del Movimiento de Nómina del evento indicado.
 *
 *  · Si el evento no registró movimiento (p. ej. una reincorporación sin Alta), no hace nada.
 *  · Si ya existe un documento completado, no genera otro (§73, idempotencia).
 *  · En cualquier otro caso, encarga la generación al dominio documental, que aplica la
 *    plantilla vigente, la sustitución de variables y la trazabilidad.
 */
export async function ensurePayrollMovementDocumentGenerated(
  workerId: string,
  eventType: PayrollMovementEventType,
  effectiveDate: string
): Promise<PayrollMovementAutomationResult> {
  const movementId = await findPayrollMovement(workerId, eventType, effectiveDate)
  if (!movementId) return { generated: false, skipped: true, result: null }

  const documents = await fetchGeneratedDocuments({ movementId })
  if (movementAlreadyDocumented(documents)) {
    return { generated: false, skipped: true, result: null }
  }

  const result = await generatePayrollMovementDocument(movementId)
  return { generated: result.success, skipped: false, result }
}
