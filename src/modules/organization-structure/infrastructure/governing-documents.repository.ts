import { supabase } from "@/lib/supabase"
import { columnName, selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import { sanitizeFileName } from "@/lib/documents"
import type { GoverningDocument } from "../domain/entities"

/**
 * Estructura organizativa — Repositorio de DOCUMENTOS RECTORES de una entidad (infraestructura).
 *
 * Único punto que lee y escribe `governing_documents` y que toca el bucket privado
 * `documents`. NO se cambia ningún contrato de Storage: el bucket, la ruta
 * (`governing-documents/<entidad>/<documento>/<archivo>`), la caducidad de la URL firmada y
 * los metadatos son EXACTAMENTE los mismos, de modo que las políticas de Storage siguen
 * resolviendo la entidad desde la ruta.
 *
 * La frontera de nomenclatura resuelve el nombre físico de la columna del cliente
 * propietario; la clave de JavaScript (`tenant_id`) se conserva.
 */

/** Bucket privado de los documentos. */
export const GOVERNING_DOCUMENTS_BUCKET = "documents"

/** Prefijo de la ruta que resuelve la entidad propietaria del archivo. */
const GOVERNING_DOCUMENTS_PREFIX = "governing-documents"

/** Caducidad (segundos) de la URL firmada de apertura. */
const SIGNED_URL_EXPIRES_IN = 60

/**
 * Ruta de Storage de un documento rector: la MISMA que ya se usaba.
 *
 * El nombre del archivo se sanea con la utilidad compartida del sistema documental, así que
 * la ruta no admite espacios ni caracteres problemáticos.
 */
export function governingDocumentStoragePath(
  entityId: string,
  documentId: string,
  fileName: string
): string {
  return `${GOVERNING_DOCUMENTS_PREFIX}/${entityId}/${documentId}/${sanitizeFileName(fileName)}`
}

/**
 * Identidad mínima de la entidad: su nombre y el cliente propietario.
 *
 * Lectura NO concluyente (`.maybeSingle()`): un fallo o una entidad invisible dejan la
 * pantalla con la entidad vacía, igual que antes, porque la autorización ya la aplica RLS y
 * la comprobación de permisos de la propia pantalla.
 */
export async function selectGoverningDocumentEntity(entityId: string): Promise<{
  name: string
  tenant_id: string | null
} | null> {
  const { data } = await supabase
    .from("organization_entities")
    .select(selectQuery(`name, ${selectColumn("clientId")}`))
    .eq("id", entityId)
    .maybeSingle()

  return (data as { name: string; tenant_id: string | null } | null) || null
}

/** Documentos rectores de una entidad, del más reciente al más antiguo. */
export async function selectGoverningDocuments(
  entityId: string
): Promise<GoverningDocument[]> {
  const { data, error } = await supabase
    .from("governing_documents")
    .select(
      "id, organization_entity_id, name, file_name, storage_path, mime_type, file_size, created_at"
    )
    .eq("organization_entity_id", entityId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as GoverningDocument[] | null) || []
}

/** Subida del archivo al bucket privado (sin sobrescritura). */
export async function uploadGoverningDocumentObject(
  storagePath: string,
  file: File
): Promise<void> {
  const { error } = await supabase.storage
    .from(GOVERNING_DOCUMENTS_BUCKET)
    .upload(storagePath, file, { cacheControl: "3600", upsert: false })

  if (error) throw error
}

/** Retirada del objeto de Storage (limpieza o borrado definitivo). */
export async function removeGoverningDocumentObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from(GOVERNING_DOCUMENTS_BUCKET)
    .remove([storagePath])

  if (error) throw error
}

/** URL firmada y temporal para abrir el documento. */
export async function createGoverningDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(GOVERNING_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN)

  if (error) throw error
  return data.signedUrl
}

/** Descarga del archivo del bucket privado. */
export async function downloadGoverningDocumentObject(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(GOVERNING_DOCUMENTS_BUCKET)
    .download(storagePath)

  if (error) throw error
  return data
}

/** Registro del documento rector. Las claves son las del esquema (no se renombran). */
export async function insertGoverningDocumentRow(record: {
  id: string
  companyClientId: string | null
  entityId: string
  name: string
  fileName: string
  storagePath: string
  mimeType: string | null
  fileSize: number
  createdBy: string
}): Promise<void> {
  const { error } = await supabase.from("governing_documents").insert({
    id: record.id,
    [columnName("clientId")]: record.companyClientId,
    organization_entity_id: record.entityId,
    name: record.name,
    file_name: record.fileName,
    storage_path: record.storagePath,
    mime_type: record.mimeType,
    file_size: record.fileSize,
    created_by: record.createdBy,
  })

  if (error) throw error
}

/** Borrado definitivo del registro del documento. */
export async function deleteGoverningDocumentRow(documentId: string): Promise<void> {
  const { error } = await supabase.from("governing_documents").delete().eq("id", documentId)
  if (error) throw error
}
