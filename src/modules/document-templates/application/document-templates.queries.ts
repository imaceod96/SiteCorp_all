import {
  rpcResolveDocumentTemplateVersion,
  rpcValidateDocumentTemplateVersion,
  selectCompatibleVariableKeys,
  selectDocumentTemplateById,
  selectDocumentTemplateTypes,
  selectDocumentTemplateVersionById,
  selectDocumentTemplateVersionsByIds,
  selectEntityDocumentTemplates,
} from "../infrastructure/document-templates.repository"
import {
  createTemplateSignedUrl,
  downloadTemplateObject,
} from "../infrastructure/document-template-files.repository"
import type {
  DocumentTemplate,
  DocumentTemplateType,
  DocumentTemplateVersionDetail,
  ResolvedDocumentTemplateVersion,
  TemplateValidation,
} from "../domain/entities"

/**
 * Plantillas documentales — Casos de uso de LECTURA (aplicación).
 *
 * Las pantallas de administración de plantillas piden aquí lo que necesitan y reciben el
 * contrato de dominio ya resuelto: no componen consultas, no conocen los nombres de las
 * tablas ni de las RPC y no interpretan el contenido de los documentos.
 *
 * Todo lo que se devuelve está acotado por RLS y por los permisos de la entidad; estos
 * casos de uso SÓLO PREGUNTAN, nunca conceden nada.
 */

/** Catálogo de tipos de plantilla disponibles. */
export async function fetchDocumentTemplateTypes(): Promise<DocumentTemplateType[]> {
  return selectDocumentTemplateTypes()
}

/** Plantillas de una entidad, con todas sus versiones ordenadas de la más nueva a la más antigua. */
export async function fetchDocumentTemplates(entityId: string): Promise<DocumentTemplate[]> {
  return selectEntityDocumentTemplates(entityId)
}

/** Plantilla concreta con sus versiones (o `null` si no existe o no es visible). */
export async function fetchDocumentTemplate(
  templateId: string
): Promise<DocumentTemplate | null> {
  return selectDocumentTemplateById(templateId)
}

/** Claves de variables disponibles para un tipo de plantilla (catálogo central). */
export async function fetchCompatibleVariableKeys(
  templateTypeCode: string
): Promise<string[]> {
  return selectCompatibleVariableKeys(templateTypeCode)
}

/**
 * Validación estructural de una versión.
 *
 * La decisión es del backend —incluida la coherencia de vigencias y la ausencia de
 * versiones activas simultáneas—: aquí sólo se pregunta por su resultado para mostrarlo.
 */
export async function validateTemplateVersion(versionId: string): Promise<TemplateValidation> {
  return rpcValidateDocumentTemplateVersion(versionId)
}

/** Enlace temporal de descarga de un archivo del bucket privado de plantillas. */
export async function getTemplateFileUrl(path: string): Promise<string | null> {
  return createTemplateSignedUrl(path)
}

/**
 * Versión concreta con su análisis y el nombre de su plantilla.
 * La usa el motor de generación documental cuando la fuente ya tiene una versión FIJA: las
 * regeneraciones usan SIEMPRE esa misma versión, aunque exista una más nueva.
 */
export async function fetchDocumentTemplateVersion(
  versionId: string
): Promise<DocumentTemplateVersionDetail | null> {
  return selectDocumentTemplateVersionById(versionId)
}

/** Varias versiones a la vez (historial de documentos generados de un origen). */
export async function fetchDocumentTemplateVersionsByIds(
  versionIds: string[]
): Promise<DocumentTemplateVersionDetail[]> {
  return selectDocumentTemplateVersionsByIds(versionIds)
}

/**
 * Versión VIGENTE para un tipo documental, una entidad y una fecha.
 * El backend decide si hay una versión aplicable, ninguna o varias (ambiguo).
 */
export async function resolveDocumentTemplateVersion(
  entityId: string,
  documentTypeCode: string,
  referenceDate: string
): Promise<ResolvedDocumentTemplateVersion> {
  return rpcResolveDocumentTemplateVersion({ entityId, documentTypeCode, referenceDate })
}

/** Contenido REAL del documento configurado de una versión (lectura del motor). */
export async function fetchTemplateFileContent(path: string): Promise<Uint8Array> {
  return downloadTemplateObject(path)
}
