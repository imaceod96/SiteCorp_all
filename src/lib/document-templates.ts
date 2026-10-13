/**
 * Plantillas documentales — FACHADA DE COMPATIBILIDAD.
 *
 * El acceso a datos de la administración de plantillas vive ahora en el dominio
 * `@/domains/document-templates` (domain / application / infrastructure). Este módulo se
 * conserva ÚNICAMENTE como fachada para los consumidores que todavía no se han migrado:
 *
 *   · `@/lib/document-generation` (motor de generación documental, fuera del alcance de
 *     esta migración) usa el bucket y los MIME de los documentos.
 *   · `@/components/documents/ContractualDocumentSection` usa el formateo de tamaños.
 *
 * No se ha cambiado ningún nombre, ningún valor ni ninguna consulta: la fachada sólo
 * reexporta. Las pantallas y los componentes de plantillas ya migrados importan
 * directamente del dominio.
 *
 *   import { fetchDocumentTemplates } from "@/domains/document-templates"
 */

export {
  DOCUMENT_TEMPLATES_BUCKET,
  DOCX_MIME,
  DOC_MIME,
  XLSX_MIME,
  WORD_ACCEPT,
  MAX_TEMPLATE_FILE_BYTES,
  UNSUPPORTED_WORD_FILE_MESSAGE,
} from "@/domains/document-templates"

export type {
  WordDocumentFormat,
  DocumentTemplateTypeCode,
  DocumentTemplateVersionStatus,
  DocumentTemplateFileKind,
  DocumentTemplateType,
  TemplateOccurrence,
  TemplateMalformed,
  TemplateIncompatibleVariable,
  DocumentTemplateAnalysis,
  DocumentTemplateVersion,
  DocumentTemplate,
  TemplateValidationChecks,
  TemplateValidation,
  CreateDocumentTemplateInput,
  TemplateFileInspection,
  UploadableTemplateVersion,
  UploadTemplateFileInput,
  TemplateFileProbe,
  RegisteredTemplateFile,
  ReanalyzeTemplateFileInput,
} from "@/domains/document-templates"

export {
  TEMPLATE_TYPE_USES_XLSX,
  templateAcceptForType,
  documentTypeCodeForTemplateType,
  detectWordDocumentFormat,
  inspectTemplateFile,
  describeTemplateFileProblem,
  templateFileFormatLabel,
  formatTemplateFileSize,
  templateVersionPeriodLabel,
  fetchCompatibleVariableKeys,
  fetchDocumentTemplate,
  fetchDocumentTemplates,
  fetchDocumentTemplateTypes,
  getTemplateFileUrl,
  validateTemplateVersion,
  activateTemplateVersion,
  createDocumentTemplate,
  createDocumentTemplateVersion,
  deactivateTemplateVersion,
  reanalyzeTemplateFile,
  registerTemplateFile,
  saveTemplateAnalysis,
} from "@/domains/document-templates"
