import { supabase } from "@/lib/supabase"
import { sanitizeFileName } from "@/lib/documents"
import type { PlatformDocument, PlatformDocumentFolder } from "../domain/entities"

/**
 * Documentos del Super Admin — Repositorio (infraestructura).
 *
 * Único punto que habla con las tablas `platform_document_folders` / `platform_documents`
 * y con el bucket PRIVADO `platform_documents`. Sigue el mismo contrato que el resto del
 * sistema documental de SiteCorp:
 *
 *   · bucket privado, nunca público: el archivo se sirve con URL firmada y caducidad corta;
 *   · la ruta la compone SIEMPRE este módulo a partir del identificador del registro y del
 *     nombre saneado del archivo — nunca se acepta una ruta del cliente;
 *   · la subida no sobrescribe (`upsert: false`): un archivo ya registrado no se reemplaza.
 *
 * El aislamiento real lo aplica RLS: estas tablas son exclusivas del Super Admin global.
 */

/** Bucket privado de los documentos globales. */
export const PLATFORM_DOCUMENTS_BUCKET = "platform_documents"

/** Caducidad (segundos) de la URL firmada de apertura. */
const SIGNED_URL_EXPIRES_IN = 60

/**
 * Ruta de Storage de un documento: `<documento>/<archivo saneado>`.
 *
 * El nombre se sanea con la utilidad compartida del sistema documental, así que la ruta no
 * admite espacios, rutas relativas (`..`) ni caracteres problemáticos.
 */
export function platformDocumentStoragePath(
  documentId: string,
  fileName: string
): string {
  return `${documentId}/${sanitizeFileName(fileName)}`
}

/* ------------------------------------------------------------------ */
/* Carpetas                                                            */
/* ------------------------------------------------------------------ */

export async function selectPlatformDocumentFolders(): Promise<PlatformDocumentFolder[]> {
  const { data, error } = await supabase
    .from("platform_document_folders")
    .select("id, name, created_at, updated_at")
    .order("name")

  if (error) throw error
  return (data as PlatformDocumentFolder[] | null) || []
}

export async function insertPlatformDocumentFolder(name: string): Promise<void> {
  const { error } = await supabase.from("platform_document_folders").insert({ name })
  if (error) throw error
}

export async function updatePlatformDocumentFolder(
  folderId: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from("platform_document_folders")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", folderId)

  if (error) throw error
}

export async function deletePlatformDocumentFolder(folderId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_document_folders")
    .delete()
    .eq("id", folderId)

  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

export async function selectPlatformDocuments(): Promise<PlatformDocument[]> {
  const { data, error } = await supabase
    .from("platform_documents")
    .select(
      "id, folder_id, name, file_name, storage_path, mime_type, file_size, created_at, updated_at"
    )
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as PlatformDocument[] | null) || []
}

export async function insertPlatformDocumentRow(record: {
  id: string
  folderId: string | null
  name: string
  fileName: string
  storagePath: string
  mimeType: string | null
  fileSize: number | null
}): Promise<void> {
  const { error } = await supabase.from("platform_documents").insert({
    id: record.id,
    folder_id: record.folderId,
    name: record.name,
    file_name: record.fileName,
    storage_path: record.storagePath,
    mime_type: record.mimeType,
    file_size: record.fileSize,
  })

  if (error) throw error
}

export async function updatePlatformDocumentRow(
  documentId: string,
  patch: { name?: string; folder_id?: string | null }
): Promise<void> {
  const { error } = await supabase
    .from("platform_documents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", documentId)

  if (error) throw error
}

export async function deletePlatformDocumentRow(documentId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_documents")
    .delete()
    .eq("id", documentId)

  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/** Subida del archivo al bucket privado (sin sobrescritura). */
export async function uploadPlatformDocumentObject(
  storagePath: string,
  file: File
): Promise<void> {
  const { error } = await supabase.storage
    .from(PLATFORM_DOCUMENTS_BUCKET)
    .upload(storagePath, file, { cacheControl: "3600", upsert: false })

  if (error) throw error
}

/**
 * Retira el objeto del bucket.
 *
 * Se usa al eliminar un documento y para deshacer una carga que no llegó a registrarse
 * (archivo huérfano): nunca se borra un archivo que siga teniendo registro.
 */
export async function removePlatformDocumentObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from(PLATFORM_DOCUMENTS_BUCKET)
    .remove([storagePath])

  if (error) throw error
}

/** URL firmada y temporal para abrir el documento en otra pestaña. */
export async function createPlatformDocumentSignedUrl(
  storagePath: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PLATFORM_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN)

  if (error) throw error
  return data.signedUrl
}

/** Descarga del archivo del bucket privado. */
export async function downloadPlatformDocumentObject(
  storagePath: string
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(PLATFORM_DOCUMENTS_BUCKET)
    .download(storagePath)

  if (error) throw error
  return data
}
