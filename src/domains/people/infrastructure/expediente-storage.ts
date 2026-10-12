import { supabase } from "@/lib/supabase"

/**
 * Personas — Documentos del expediente en el Storage (infraestructura).
 *
 * Bucket privado `documents`, opciones de subida, rutas y liberación del archivo son
 * EXACTAMENTE las que ya usaban las cuatro pantallas del expediente: es un traslado
 * estructural, no un cambio de comportamiento. Las rutas se guardan en la fila del
 * documento (`storage_path`), de modo que el archivo siempre se puede volver a leer.
 */

export const EXPEDIENTE_BUCKET = "documents"

/** Identificador del usuario autenticado: autor del documento o del registro. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Usuario autenticado exigido por las escrituras del expediente. */
export async function requireCurrentUserId(): Promise<string> {
  const userId = await currentUserId()
  if (!userId) throw new Error("Usuario no autenticado")
  return userId
}

/** Nombre del archivo dentro del bucket, con la marca de tiempo que lo hace único. */
export function storageFileName(prefix: string, fileName: string): string {
  const fileExt = fileName.split(".").pop() || "pdf"
  return `${prefix}_${Date.now()}.${fileExt}`
}

export async function uploadExpedienteFile(fileName: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(EXPEDIENTE_BUCKET).upload(fileName, file, {
    cacheControl: "3600",
    upsert: false,
  })
  if (error) throw error
}

export async function downloadExpedienteFile(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(EXPEDIENTE_BUCKET).download(storagePath)
  if (error) throw error
  return data
}

export async function removeExpedienteFiles(storagePaths: string[]): Promise<void> {
  const paths = storagePaths.filter(Boolean)
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(EXPEDIENTE_BUCKET).remove(paths)
  if (error) throw error
}

/** Entrega un archivo descargado al usuario con su nombre original. */
export function saveDownloadedFile(blob: Blob, originalFileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const link = window.document.createElement("a")
  link.href = url
  link.download = originalFileName
  window.document.body.appendChild(link)
  link.click()
  window.URL.revokeObjectURL(url)
  window.document.body.removeChild(link)
}
