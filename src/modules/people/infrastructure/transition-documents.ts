import * as contracts from "@/modules/contracts"
import type { DocumentAutomationResult } from "@/modules/contracts"
import * as payrollMovements from "@/modules/payroll-movements"
import type { PayrollMovementType } from "../domain/entities"

/**
 * Personas — Documentos que produce una transición laboral (infraestructura).
 *
 * Los triggers de PostgreSQL encolan automáticamente cada documento en
 * `public.document_generation_jobs` dentro de la misma transacción de negocio, y la Edge
 * Function `process-document-jobs` los procesa en segundo plano.
 *
 * Estos adaptadores disparan inmediatamente el procesador de la cola y devuelven cualquier
 * aviso de plantilla o de red sin ocultar errores en bloques `catch` vacíos.
 */

const contractWarning = (result: DocumentAutomationResult): string | null =>
  result.skipped || result.generated
    ? null
    : result.result?.error || "No se pudo generar el documento contractual automáticamente."

const addendumWarning = (result: DocumentAutomationResult): string | null =>
  result.skipped || result.generated
    ? null
    : result.result?.error || "No se pudo generar el documento del anexo automáticamente."

const resolutionWarning = (result: DocumentAutomationResult): string | null =>
  result.skipped || result.generated
    ? null
    : result.result?.error || "No se pudo generar la Resolución automáticamente."

const movementWarning = (result: DocumentAutomationResult): string | null =>
  result.skipped || result.generated
    ? null
    : result.result?.error || "No se pudo generar el documento del movimiento de nómina."

/**
 * Movimiento de nómina del trabajador (Alta, Baja o Reubicación).
 * Encola y procesa el trabajo en `public.document_generation_jobs` sin tragarse errores.
 */
export async function ensureMovementDocument(
  workerId: string,
  movementType: PayrollMovementType,
  effectiveDate: string
): Promise<string | null> {
  try {
    const movementId = await payrollMovements.findPayrollMovement(
      workerId,
      movementType,
      effectiveDate
    )
    if (movementId) {
      return movementWarning(await contracts.ensurePayrollMovementDocumentQueued(movementId))
    }
    return "No se encontró el movimiento de nómina para encolar su generación en el servidor."
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo generar el documento del movimiento de nómina."
    console.warn("[people] error generando documento de movimiento de nómina:", message)
    return message
  }
}

/** Documento del contrato creado. Devuelve el aviso si no se pudo generar y actualiza `document_status`. */
export async function ensureContractDocument(contractId: string): Promise<string | null> {
  await contracts.setContractDocumentStatus(contractId, "PENDIENTE", null)
  try {
    const warning = contractWarning(await contracts.ensureContractDocumentGenerated(contractId))
    await contracts.setContractDocumentStatus(contractId, warning ? "ERROR" : "GENERADO", warning)
    return warning
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo generar el documento contractual automáticamente."
    await contracts.setContractDocumentStatus(contractId, "ERROR", message)
    return message
  }
}

/** Documento del anexo formalizado (con estado persistido en `public.document_generation_jobs`). */
export async function ensureAddendumDocument(addendumId: string): Promise<string | null> {
  try {
    return addendumWarning(await contracts.ensureAddendumDocumentGenerated(addendumId))
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo generar el documento del anexo automáticamente."
  }
}

/** Resolución (documento sustitutivo del Cargo Especialista Principal). */
export async function ensureResolutionDocument(resolutionId: string): Promise<string | null> {
  try {
    const queued = await contracts.ensureResolutionDocumentQueued(resolutionId)
    return resolutionWarning(queued)
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo generar la Resolución automáticamente."
  }
}
