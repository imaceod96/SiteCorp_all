import { supabase } from "@/lib/supabase"
import {
  DOCUMENT_TEMPLATES_BUCKET,
  type DocumentTemplateFileKind,
  type TemplateFileProbe,
} from "../domain/entities"

/**
 * Plantillas documentales — Repositorio de ARCHIVOS (infraestructura).
 *
 * Único punto que habla con el bucket privado de plantillas, con el analizador central y
 * con la RPC que fija el archivo de una versión.
 *
 * El archivo ORIGINAL nunca se convierte ni se sobrescribe: cada carga usa un nombre nuevo
 * y la descarga devuelve exactamente lo subido. El análisis del contenido lo decide el
 * analizador central (`analyze-document-template`): aquí sólo se invoca y se tipa.
 */

/**
 * Invoca al analizador central: detecta el formato REAL por firma y sólo analiza paquetes
 * OOXML. Un `.doc` binario nunca se abre como ZIP.
 */
export const invokeAnalyzeDocumentTemplate = async (
  filePath: string
): Promise<TemplateFileProbe> => {
  const { data, error } = await supabase.functions.invoke("analyze-document-template", {
    body: { file_path: filePath },
  })

  const failure = (data as { error?: string } | null)?.error
  if (error || failure) {
    throw new Error(failure || error?.message || "No se pudo preparar el documento para el análisis.")
  }

  return data as TemplateFileProbe
}

/** Subida del archivo a la ruta indicada, sin sobrescribir (`upsert: false`). */
export const uploadTemplateObject = async (
  path: string,
  file: File,
  mimeType: string
): Promise<void> => {
  const { error } = await supabase.storage
    .from(DOCUMENT_TEMPLATES_BUCKET)
    .upload(path, file, { contentType: mimeType, upsert: false })

  if (error) {
    throw new Error(`No se pudo subir el archivo: ${error.message}`)
  }
}

/**
 * Retira objetos del bucket.
 *
 * Se usa EXCLUSIVAMENTE para deshacer una carga que no llegó a registrarse: los archivos ya
 * registrados en una versión nunca se eliminan (el histórico es inmutable).
 */
export const removeTemplateObjects = async (paths: string[]): Promise<void> => {
  await supabase.storage.from(DOCUMENT_TEMPLATES_BUCKET).remove(paths)
}

/** Enlace temporal (firmado) de descarga de un archivo del bucket privado. */
export const createTemplateSignedUrl = async (path: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_TEMPLATES_BUCKET)
    .createSignedUrl(path, 600)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/** Fija (o reemplaza) el archivo de una versión en BORRADOR, con su formato real. */
export const rpcSetDocumentTemplateVersionFile = async (input: {
  versionId: string
  kind: DocumentTemplateFileKind
  filePath: string
  fileName: string
  fileSize: number | null
  fileFormat: string
  mimeType: string
  analysisIssue: string | null
}): Promise<void> => {
  const { error } = await supabase.rpc("set_document_template_version_file", {
    p_version_id: input.versionId,
    p_file_kind: input.kind,
    p_file_path: input.filePath,
    p_file_name: input.fileName,
    p_file_size: input.fileSize,
    p_file_format: input.fileFormat,
    p_mime_type: input.mimeType,
    // Un `.doc` se conserva tal cual y queda marcado como no analizable.
    p_analysis_issue: input.analysisIssue,
  })

  if (error) throw new Error(error.message)
}
