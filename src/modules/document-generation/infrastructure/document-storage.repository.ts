import { supabase } from "@/lib/supabase"
import { WORKER_DOCUMENTS_BUCKET } from "../domain/entities"

/**
 * Generación documental — Storage del EXPEDIENTE (infraestructura).
 *
 * Único punto que escribe, descarga o firma objetos del bucket privado de documentos del
 * trabajador. La ruta de cada objeto la decide el backend (`begin_*_generation`): aquí nunca se
 * compone ni se altera.
 *
 * El documento ORIGINAL de la plantilla no se toca: se sube siempre una COPIA nueva con
 * `upsert: false`, de modo que un documento ya emitido nunca se sobrescribe.
 */

/** Enlace temporal (firmado) de una generación del expediente. */
export const createGeneratedObjectSignedUrl = async (
  path: string,
  expiresInSeconds = 600
): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from(WORKER_DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Sube la copia generada (Word o Excel) a la ruta reservada por el backend.
 * Lanza con el mensaje del backend si la subida falla: el caso de uso libera la reserva.
 */
export const uploadGeneratedObject = async (
  path: string,
  blob: Blob,
  mimeType: string
): Promise<void> => {
  const { error } = await supabase.storage
    .from(WORKER_DOCUMENTS_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: false })

  if (error) throw new Error(error.message)
}

/**
 * Retira un objeto del expediente.
 * Se usa EXCLUSIVAMENTE para retirar el huérfano cuando Storage recibió el archivo pero la base
 * de datos no llegó a registrarlo (§55): los documentos ya registrados nunca se eliminan.
 */
export const removeGeneratedObjects = async (paths: string[]): Promise<void> => {
  await supabase.storage.from(WORKER_DOCUMENTS_BUCKET).remove(paths)
}

/** Contenido REAL de un documento generado, para descargarlo. */
export const downloadGeneratedObject = async (path: string): Promise<Blob> => {
  const { data, error } = await supabase.storage.from(WORKER_DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw error ?? new Error("No se pudo descargar el documento")
  return data
}
