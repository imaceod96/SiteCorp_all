import type { EventDocumentationResult, EventGenerationResult } from "../domain/entities"
import {
  invokeGenerateBatchZip,
  rpcCreateDocumentBatchesForEvent,
  selectPendingBatches,
  selectUngeneratedEventMovements,
} from "../infrastructure/document-batches.repository"
import { generatePayrollMovementDocument } from "./document-generation.commands"

/**
 * Generación documental — Casos de uso de ESCRITURA de lotes (aplicación).
 *
 * Los documentos individuales SIEMPRE viven en el expediente del trabajador; el lote es sólo
 * una agrupación para descargar un ZIP. Nada se regenera: sólo se generan los documentos que
 * faltan (la idempotencia la garantiza el backend).
 */

/**
 * Genera el documento individual de cada Movimiento de Nómina pendiente del evento.
 * Reintenta únicamente los no generados: los correctos nunca se regeneran.
 */
export async function generateEventMovementDocuments(
  eventId: string
): Promise<EventGenerationResult> {
  const pending = await selectUngeneratedEventMovements(eventId)
  const result: EventGenerationResult = { generated: 0, failed: 0, errors: [] }
  for (const movement of pending) {
    const generated = await generatePayrollMovementDocument(movement.id)
    if (generated.success) {
      result.generated += 1
    } else {
      result.failed += 1
      result.errors.push({ movement_id: movement.id, message: generated.error ?? "Error" })
    }
  }
  return result
}

/** Reconstruye los lotes del evento (aplica la regla > 5 por entidad y tipo en el backend). */
export async function rebuildEventBatches(eventId: string): Promise<number> {
  return rpcCreateDocumentBatchesForEvent(eventId)
}

/** Empaqueta el ZIP del lote en el backend (Edge Function) y lo registra. */
export async function requestBatchZip(batchId: string): Promise<{
  zip_path: string
  zip_file_name: string
}> {
  return invokeGenerateBatchZip(batchId)
}

/**
 * Cierre documental automático de un evento masivo (§75).
 *
 * 1. Genera el documento individual de cada Movimiento de Nómina pendiente del evento
 *    (nunca regenera los ya correctos).
 * 2. Reconstruye los lotes del evento (aplica la regla > 5 por entidad y tipo).
 * 3. Empaqueta el ZIP de cada lote listo que aún no lo tenga.
 *
 * La generación es del lado cliente (no hay conversor en servidor), por lo que este cierre se
 * dispara justo tras materializar el evento, sin intervención del usuario.
 */
export async function ensureEventDocumentation(
  eventId: string
): Promise<EventDocumentationResult> {
  const generated = await generateEventMovementDocuments(eventId)
  await rebuildEventBatches(eventId)

  const batches = (await selectPendingBatches()).filter((batch) => batch.event_id === eventId)
  let batchesReady = 0
  let zipsCreated = 0
  for (const batch of batches) {
    if (batch.status !== "READY") continue
    batchesReady += 1
    if (!batch.zip_path) {
      try {
        await requestBatchZip(batch.id)
        zipsCreated += 1
      } catch {
        // El ZIP es una facilidad de descarga: su fallo no invalida los documentos.
      }
    }
  }

  return { generated: generated.generated, failed: generated.failed, batchesReady, zipsCreated }
}
