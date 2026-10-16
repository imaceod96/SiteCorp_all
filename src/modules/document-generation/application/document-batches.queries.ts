import type { PendingBatch, PendingBatchItem } from "../domain/entities"
import {
  createBatchZipSignedUrl,
  selectBatchItems,
  selectPendingBatches,
} from "../infrastructure/document-batches.repository"

/**
 * Generación documental — Casos de uso de LECTURA de lotes (aplicación).
 *
 * La bandeja documental de la entidad sólo pregunta: qué lotes hay, qué contiene cada uno y con
 * qué enlace temporal se descarga su ZIP. El aislamiento entre entidades lo aplica RLS.
 */

/** Lotes documentales visibles para el usuario, del más reciente al más antiguo. */
export async function fetchPendingBatches(): Promise<PendingBatch[]> {
  return selectPendingBatches()
}

/** Detalle de un lote: cada trabajador con su documento y su estado. */
export async function fetchBatchItems(batchId: string): Promise<PendingBatchItem[]> {
  return selectBatchItems(batchId)
}

/** Enlace temporal (10 min) para descargar el ZIP privado de un lote. */
export async function createBatchZipUrl(zipPath: string): Promise<string | null> {
  return createBatchZipSignedUrl(zipPath)
}
