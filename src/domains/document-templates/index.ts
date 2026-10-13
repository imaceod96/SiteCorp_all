/**
 * Plantillas documentales — Interfaz pública del contexto.
 *
 * Punto único de entrada para los consumidores (páginas y componentes):
 *   import { fetchDocumentTemplates } from "@/domains/document-templates"
 *
 * Estructura:
 *   domain/entities.ts                            → tipos, contratos y constantes
 *   domain/rules.ts                               → reglas puras (formato, etiquetas, vigencias)
 *   domain/document-variables.ts                  → catálogo de variables documentales,
 *                                                  sus tipos y sus formatos de presentación
 *   infrastructure/document-templates.repository.ts → Supabase y RPC del catálogo
 *   infrastructure/document-template-files.repository.ts → Storage y analizador central
 *   application/document-templates.queries.ts     → casos de uso de lectura
 *   application/document-templates.commands.ts    → casos de uso de escritura
 *
 * Alcance DELIBERADAMENTE ACOTADO: la ADMINISTRACIÓN de plantillas de una entidad (listado,
 * versiones y vigencias, archivos, análisis, validación, activación y descarga). El motor de
 * generación documental NO forma parte de este contexto: vive en el dominio
 * `@/domains/document-generation`, que CONSUME estas plantillas y versiones ya resueltas (y de
 * ahí las lecturas de versión y de su documento configurado que se ofrecen aquí).
 *
 * La dependencia va en un solo sentido —presentación → aplicación → dominio → infraestructura
 * → Supabase; generación documental → plantillas—, por lo que no puede formarse ningún ciclo
 * entre dominios.
 *
 * Los nombres públicos se conservan respecto de la etapa anterior para no alterar a los
 * consumidores que todavía no se han migrado; lo que cambia es el lugar donde vive el código,
 * no su contrato.
 */

/* Constantes y tipos de dominio */
export {
  DOCUMENT_TEMPLATES_BUCKET,
  DOCX_MIME,
  DOC_MIME,
  XLSX_MIME,
  WORD_ACCEPT,
  MAX_TEMPLATE_FILE_BYTES,
  UNSUPPORTED_WORD_FILE_MESSAGE,
} from "./domain/entities"

export type {
  WordDocumentFormat,
  DocumentTemplateTypeCode,
  DocumentTemplateVersionDetail,
  ResolvedDocumentTemplateVersion,
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
} from "./domain/entities"

/* Reglas puras (formato de archivo, etiquetas y vigencias) */
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
  requiredVariableKeys,
} from "./domain/rules"

/* Catálogo de variables documentales (contrato que declaran las plantillas) */
export type {
  DocumentTypeCode,
  DocumentVariableDataType,
  DocumentVariableKind,
  DocumentVariableDefinition,
  DocumentVariableResolution,
} from "./domain/document-variables"

export {
  DOCUMENT_VARIABLES,
  documentVariableByKey,
  documentVariablesByCategory,
  describeDocumentDuration,
  documentSignatureDay,
  documentSignatureMonth,
  documentSignatureYear,
  formatDocumentAmount,
  formatDocumentDate,
  formatDocumentDateShort,
  formatDocumentDateTextual,
  formatDocumentHours,
  formatSc404Dias,
} from "./domain/document-variables"

/* Casos de uso de lectura */
export {
  fetchCompatibleVariableKeys,
  fetchDocumentTemplate,
  fetchDocumentTemplates,
  fetchDocumentTemplateTypes,
  fetchDocumentTemplateVersion,
  fetchDocumentTemplateVersionsByIds,
  fetchTemplateFileContent,
  getTemplateFileUrl,
  resolveDocumentTemplateVersion,
  validateTemplateVersion,
} from "./application/document-templates.queries"

/* Casos de uso de escritura */
export {
  activateTemplateVersion,
  createDocumentTemplate,
  createDocumentTemplateVersion,
  deactivateTemplateVersion,
  reanalyzeTemplateFile,
  registerTemplateFile,
  saveTemplateAnalysis,
} from "./application/document-templates.commands"
