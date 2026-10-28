import {
  deleteWorkerDocument as deleteWorkerDocumentRecord,
  uploadWorkerDocument as uploadWorkerDocumentFile,
} from "../infrastructure/worker-expediente.repository"
import {
  createExpedienteSignedUrl,
  downloadExpedienteFile,
  saveDownloadedFile,
} from "../infrastructure/expediente-storage"
import type { WorkerDocumentRow } from "../domain/entities"

/**
 * Personas — Casos de uso de escritura del expediente documental del TRABAJADOR (aplicación).
 *
 * Subir, abrir, descargar y eliminar un documento del expediente laboral. Los UUID, las
 * rutas de Storage, el orden de borrado (archivo primero) y la limpieza del archivo cuando el
 * registro falla son EXACTAMENTE los que ya usaba la pestaña: es un traslado estructural.
 *
 * El archivo se sirve con un enlace temporal firmado, nunca con una URL pública.
 */

/** Caducidad del enlace de lectura, en segundos (la misma de siempre). */
export const EXPEDIENTE_SIGNED_URL_TTL = 60

/** Sube un documento al Storage privado y lo registra en el expediente del trabajador. */
export async function uploadWorkerDocument(input: {
  workerId: string
  documentTypeId: string
  file: File
  description: string | null
}): Promise<void> {
  await uploadWorkerDocumentFile({
    documentId: crypto.randomUUID(),
    workerId: input.workerId,
    documentTypeId: input.documentTypeId,
    file: input.file,
    description: input.description,
  })
}

/** Abre el documento en una pestaña nueva mediante un enlace temporal. */
export async function openWorkerDocument(storagePath: string): Promise<void> {
  const signedUrl = await createExpedienteSignedUrl(storagePath, EXPEDIENTE_SIGNED_URL_TTL)
  window.open(signedUrl, "_blank", "noopener,noreferrer")
}

/** Descarga el documento con su nombre original. */
export async function downloadWorkerDocument(input: {
  storagePath: string
  fileName: string
}): Promise<void> {
  const blob = await downloadExpedienteFile(input.storagePath)
  saveDownloadedFile(blob, input.fileName)
}

/** Elimina el archivo y la fila del documento. */
export async function deleteWorkerDocument(document: WorkerDocumentRow): Promise<void> {
  await deleteWorkerDocumentRecord(document)
}
