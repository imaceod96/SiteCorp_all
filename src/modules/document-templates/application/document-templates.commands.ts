import {
  UNSUPPORTED_WORD_FILE_MESSAGE,
  type CreateDocumentTemplateInput,
  type DocumentTemplateAnalysis,
  type RegisteredTemplateFile,
  type ReanalyzeTemplateFileInput,
  type TemplateFileProbe,
  type UploadTemplateFileInput,
} from "../domain/entities"
import { inspectTemplateFile } from "../domain/rules"
import {
  rpcActivateDocumentTemplateVersion,
  rpcCreateDocumentTemplate,
  rpcCreateDocumentTemplateVersion,
  rpcDeactivateDocumentTemplateVersion,
  rpcSaveDocumentTemplateAnalysis,
} from "../infrastructure/document-templates.repository"
import {
  invokeAnalyzeDocumentTemplate,
  removeTemplateObjects,
  rpcSetDocumentTemplateVersionFile,
  uploadTemplateObject,
} from "../infrastructure/document-template-files.repository"

/**
 * Plantillas documentales — Casos de uso de ESCRITURA (aplicación).
 *
 * Orquesta la creación de plantillas y versiones, la carga y el análisis de documentos, y
 * la activación de versiones. Ninguna decisión de negocio se resuelve aquí: el backend
 * decide qué tipo documental existe, si el documento es analizable, qué variables son
 * válidas y si la versión puede activarse.
 *
 * Dos invariantes se conservan intactas:
 *   · Cada carga escribe un objeto NUEVO (nunca sobrescribe) y, si algo falla antes de
 *     registrarse en la versión, se retira únicamente el archivo recién subido. Los
 *     archivos ya registrados no se eliminan jamás.
 *   · El documento original no se convierte ni se modifica: se conserva tal cual, incluso
 *     cuando es un `.doc` que no puede analizarse.
 */

/** Alta de una plantilla: crea la plantilla y su versión 1 (borrador) en una operación. */
export const createDocumentTemplate = async ({
  entityId,
  documentTypeCode,
  name,
  description,
  effectiveFrom,
}: CreateDocumentTemplateInput): Promise<{
  template_id: string
  version_id: string
  version_number: number
}> => {
  return rpcCreateDocumentTemplate({ entityId, documentTypeCode, name, description, effectiveFrom })
}

/** Nueva versión (borrador) de una plantilla existente, con su vigencia inicial opcional. */
export const createDocumentTemplateVersion = async (
  templateId: string,
  effectiveFrom?: string | null
): Promise<{ version_id: string; version_number: number }> => {
  return rpcCreateDocumentTemplateVersion(templateId, effectiveFrom)
}

/** Registro del análisis de variables que devolvió el analizador central. */
export const saveTemplateAnalysis = async (
  versionId: string,
  analysis: unknown
): Promise<DocumentTemplateAnalysis> => {
  return rpcSaveDocumentTemplateAnalysis(versionId, analysis)
}

/**
 * Flujo completo de carga de un documento:
 *   inspección en cliente → subida al bucket privado conservando formato y extensión
 *   reales → detección/análisis central → registro en la versión.
 */
export const registerTemplateFile = async ({
  entityId,
  templateId,
  version,
  kind,
  file,
}: UploadTemplateFileInput): Promise<RegisteredTemplateFile> => {
  const inspection = await inspectTemplateFile(file)
  if (inspection.problem) {
    throw new Error(inspection.problem)
  }

  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // Cada carga usa un nombre propio: nunca se sobrescribe un documento ya cargado.
  const path = `entity/${entityId}/templates/${templateId}/v${version.version_number}/${kind.toLowerCase()}-${stamp}.${inspection.extension}`

  await uploadTemplateObject(path, file, inspection.mimeType)

  let probe: TemplateFileProbe
  try {
    probe = await invokeAnalyzeDocumentTemplate(path)
  } catch (err) {
    await removeTemplateObjects([path])
    throw err
  }

  // Formato ajeno a Word (PDF, RTF, ODT, binario desconocido): no entra en la versión.
  if (probe.detected_format === "UNSUPPORTED") {
    await removeTemplateObjects([path])
    throw new Error(probe.issue || UNSUPPORTED_WORD_FILE_MESSAGE)
  }

  try {
    await rpcSetDocumentTemplateVersionFile({
      versionId: version.id,
      kind,
      filePath: path,
      fileName: file.name,
      fileSize: file.size,
      fileFormat: probe.detected_format,
      mimeType: probe.mime_type || inspection.mimeType,
      analysisIssue: probe.analysis_supported ? null : probe.issue,
    })
  } catch (err) {
    // La versión no se actualizó: se retira únicamente el archivo recién subido.
    await removeTemplateObjects([path])
    throw err
  }

  let analysis: DocumentTemplateAnalysis | null = null
  if (probe.analysis_supported && probe.analysis) {
    analysis = await saveTemplateAnalysis(version.id, probe.analysis)
  }

  return {
    path,
    format: probe.detected_format,
    analysis,
    issue: probe.analysis_supported ? null : probe.issue,
  }
}

/**
 * Reejecuta el analizador central sobre un archivo ya registrado en la versión.
 *
 * Vuelve a registrar el formato/MIME detectados y el estado del documento, de modo que un
 * archivo identificado antes con otra clasificación queda corregido y un `.doc` sin análisis
 * conserva su mensaje accionable.
 */
export const reanalyzeTemplateFile = async ({
  version,
  kind,
  filePath,
}: ReanalyzeTemplateFileInput): Promise<{
  analysis: DocumentTemplateAnalysis | null
  issue: string | null
  supported: boolean
}> => {
  const probe = await invokeAnalyzeDocumentTemplate(filePath)
  const fileName = kind === "ORIGINAL" ? version.original_file_name : version.configured_file_name
  const fileSize = kind === "ORIGINAL" ? version.original_file_size : version.configured_file_size

  await rpcSetDocumentTemplateVersionFile({
    versionId: version.id,
    kind,
    filePath,
    fileName: fileName || filePath.split("/").pop() || "documento",
    fileSize,
    fileFormat: probe.detected_format,
    mimeType: probe.mime_type,
    analysisIssue: probe.analysis_supported ? null : probe.issue,
  })

  if (!probe.analysis_supported || !probe.analysis) {
    return { analysis: null, issue: probe.issue, supported: false }
  }

  const analysis = await saveTemplateAnalysis(version.id, probe.analysis)
  return { analysis, issue: null, supported: true }
}

/** Activación de una versión validada: el backend cierra la versión anterior del tipo. */
export const activateTemplateVersion = async (
  versionId: string
): Promise<{
  status: "ACTIVATED" | "ALREADY_ACTIVE"
  version_id: string
  effective_from: string | null
  deactivated_previous?: {
    version_id: string
    version_number: number
    effective_to: string | null
  }[]
}> => {
  return rpcActivateDocumentTemplateVersion(versionId)
}

/** Desactivación de una versión: se conserva como histórico. */
export const deactivateTemplateVersion = async (
  versionId: string
): Promise<{
  status: "DEACTIVATED" | "ALREADY_INACTIVE"
  version_id: string
  effective_to: string | null
}> => {
  return rpcDeactivateDocumentTemplateVersion(versionId)
}
