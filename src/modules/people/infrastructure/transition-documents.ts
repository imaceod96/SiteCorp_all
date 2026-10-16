import {
  ensureAddendumDocumentGenerated,
  ensureContractDocumentGenerated,
  type DocumentAutomationResult,
} from "@/modules/contracts"
import { ensurePayrollMovementDocumentGenerated } from "@/domains/payroll-movements"
import { ensureResolutionDocumentGenerated } from "@/domains/resolutions"
import type { PayrollMovementType } from "../domain/entities"

/**
 * Personas — Documentos que produce una transición laboral (infraestructura).
 *
 * Qué documento acompaña a cada operación es una regla del dominio
 * (`TRANSITION_MOVEMENT_DOCUMENT`); CÓMO se genera es de la capa documental, que se
 * invoca desde aquí a través de los dominios de contratos, resoluciones y movimientos de
 * nómina — ningún dominio ni caso de uso depende ya de `@/lib`.
 *
 * Política de avisos (idéntica a la que ya tenían las pantallas):
 *   · El documento del movimiento de nómina es SILENCIOSO: el movimiento ya quedó
 *     registrado y el documento puede regenerarse. Nunca interrumpe la operación.
 *   · El contrato, el anexo y la Resolución devuelven un AVISO cuando no se pudieron
 *     generar, para que la pantalla no presente la operación como completada.
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

/**
 * Movimiento de nómina del trabajador (Alta, Baja o Reubicación). Un fallo no se
 * propaga: el movimiento ya está registrado y su documento puede regenerarse.
 */
export async function ensureMovementDocument(
  workerId: string,
  movementType: PayrollMovementType,
  effectiveDate: string
): Promise<void> {
  try {
    await ensurePayrollMovementDocumentGenerated(workerId, movementType, effectiveDate)
  } catch {
    /* el movimiento ya quedó registrado; el documento puede regenerarse */
  }
}

/** Documento del contrato creado. Devuelve el aviso si no se pudo generar. */
export async function ensureContractDocument(contractId: string): Promise<string | null> {
  try {
    return contractWarning(await ensureContractDocumentGenerated(contractId))
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo generar el documento contractual automáticamente."
  }
}

/** Documento del anexo formalizado. Devuelve el aviso si no se pudo generar. */
export async function ensureAddendumDocument(addendumId: string): Promise<string | null> {
  try {
    return addendumWarning(await ensureAddendumDocumentGenerated(addendumId))
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo generar el documento del anexo automáticamente."
  }
}

/** Resolución (documento sustitutivo del Cargo Especialista Principal). */
export async function ensureResolutionDocument(resolutionId: string): Promise<string | null> {
  try {
    return resolutionWarning(await ensureResolutionDocumentGenerated(resolutionId))
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "No se pudo generar la Resolución automáticamente."
  }
}
