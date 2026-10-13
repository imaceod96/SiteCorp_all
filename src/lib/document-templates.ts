/**
 * Plantillas documentales — FACHADA DE COMPATIBILIDAD.
 *
 * El acceso a datos de la administración de plantillas vive ahora en el dominio
 * `@/domains/document-templates` (domain / application / infrastructure). Este módulo se
 * conserva ÚNICAMENTE como fachada de compatibilidad: cualquier consumidor que aún no se haya
 * migrado encuentra aquí los mismos nombres y los mismos valores de siempre.
 *
 * Ya NO hay consumidores internos de esta fachada: el motor de generación documental y la
 * sección contractual del expediente se migraron al dominio
 * (`@/domains/document-generation`), que consume las plantillas y sus versiones directamente
 * del dominio de plantillas. Se conserva mientras existan consumidores sin migrar.
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
