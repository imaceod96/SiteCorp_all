/**
 * Plantillas documentales — Entidades, contratos y CONSTANTES de dominio.
 *
 * Este contexto cubre la ADMINISTRACIÓN de las plantillas de una entidad: su catálogo,
 * sus versiones y vigencias, sus archivos (original y configurado), el análisis de
 * variables y su validación. NO incluye el motor de generación documental, que vive en el
 * dominio `@/domains/document-generation` y consume aquí la plantilla ya resuelta (la
 * dependencia va en un solo sentido).
 *
 * Reglas del contexto (las mismas de la etapa anterior):
 *  - Toda decisión crítica (qué variable es válida, qué es obligatorio, qué puede
 *    activarse) vive en la base de datos: el frontend sólo la invoca y tipa.
 *  - El contenido de una plantilla sólo lo interpreta el analizador central
 *    (Edge Function `analyze-document-template`).
 *  - Los documentos viven en el bucket privado `document-templates`, bajo la ruta
 *    `entity/{entityId}/templates/{templateId}/v{version}/{kind}-{stamp}.{ext}`,
 *    conservando SIEMPRE la extensión real del archivo subido.
 *  - Se admiten documentos Word `.doc` y `.docx`. El `.doc` es un formato binario
 *    OLE/CFB: nunca se abre como ZIP ni se pasa por el parser OOXML.
 *
 * El dominio NO autoriza nada: la autoridad son RLS, las RPC SECURITY DEFINER y los
 * permisos de la entidad (`organization.manage` / `organization.view`).
 */

/** Bucket privado de las plantillas documentales. */
export const DOCUMENT_TEMPLATES_BUCKET = "document-templates"

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const DOC_MIME = "application/msword"
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Atributo `accept` para cualquier input de plantillas Word. */
export const WORD_ACCEPT = `.doc,.docx,${DOC_MIME},${DOCX_MIME}`

/** Límite de tamaño por archivo (10 MB). Debe coincidir con el del backend. */
export const MAX_TEMPLATE_FILE_BYTES = 10485760

/** Mensaje único del analizador cuando el archivo no es un documento Word admitido. */
export const UNSUPPORTED_WORD_FILE_MESSAGE =
  "Formato no compatible. Seleccione un documento Word (.doc o .docx)."

/** Formatos admitidos que el detector central puede reconocer. */
export type WordDocumentFormat = "DOC" | "DOCX" | "XLSX" | "UNSUPPORTED"

/** Tipos documentales para los que existe una plantilla oficial. */
export type DocumentTemplateTypeCode =
  | "EMPLOYMENT_CONTRACT_DETERMINED"
  | "EMPLOYMENT_CONTRACT_INDETERMINED"
  | "EMPLOYMENT_CONTRACT_ADDENDUM"
  | "SC_4_04"
  | "RESOLUTION"
  | "PAYROLL_MOVEMENT"

export type DocumentTemplateVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE"

export type DocumentTemplateFileKind = "ORIGINAL" | "CONFIGURED"

/** Tipo documental del catálogo de 11A.7 al que pertenece cada tipo de plantilla. */
export interface DocumentTemplateType {
  code: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export interface TemplateOccurrence {
  key: string
  count: number
  split_runs: number
  sort_order?: number
}

export interface TemplateMalformed {
  part: string
  snippet: string
}

export interface TemplateIncompatibleVariable {
  key: string
  label: string | null
  count: number
}

export interface DocumentTemplateAnalysis {
  analyzed_at: string | null
  file_path: string
  file_kind: DocumentTemplateFileKind
  file_name: string | null
  file_sha256: string | null
  valid_docx: boolean
  zip_signature_ok: boolean
  has_document_xml: boolean
  scanned_parts: string[]
  paragraphs_scanned: number
  occurrences: TemplateOccurrence[]
  /** Variables válidas realmente presentes en el DOCX analizado. */
  recognized: TemplateOccurrence[]
  /** Variables obligatorias de ESTA plantilla, derivadas del DOCX configurado. */
  required_variables: string[]
  unknown_variables: { key: string; count: number }[]
  incompatible_variables: TemplateIncompatibleVariable[]
  malformed_placeholders: TemplateMalformed[]
  split_run_placeholders: number
  warnings: string[]
}

export interface DocumentTemplateVersion {
  id: string
  template_id: string
  organization_entity_id: string
  document_type_code: string
  version_number: number
  status: DocumentTemplateVersionStatus
  effective_from: string | null
  effective_to: string | null
  original_file_path: string | null
  original_file_name: string | null
  original_file_size: number | null
  /** Formato real detectado del original: `DOC` | `DOCX`. */
  original_file_format: string | null
  original_mime_type: string | null
  original_uploaded_at: string | null
  configured_file_path: string | null
  configured_file_name: string | null
  configured_file_size: number | null
  /** Formato real detectado del configurado: `DOC` | `DOCX`. */
  configured_file_format: string | null
  configured_mime_type: string | null
  configured_uploaded_at: string | null
  analysis: DocumentTemplateAnalysis | null
  analysis_at: string | null
  /** Motivo por el que el documento no puede analizarse (p. ej. un `.doc`). */
  analysis_issue: string | null
  created_at: string
  updated_at: string
}

export interface DocumentTemplate {
  id: string
  organization_entity_id: string
  document_type_code: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  versions: DocumentTemplateVersion[]
}

/**
 * Versión concreta con su análisis y el nombre de su plantilla.
 *
 * Es la lectura que necesita el MOTOR de generación documental —de ahí que viva en este
 * contexto, que es el dueño del catálogo de plantillas y versiones—: el formato REAL del
 * documento configurado y las variables que ESA plantilla exige.
 */
export interface DocumentTemplateVersionDetail {
  id: string
  version_number: number | null
  status: DocumentTemplateVersionStatus
  effective_from: string | null
  effective_to: string | null
  configured_file_path: string | null
  configured_file_format: string | null
  document_type_code: string | null
  analysis: DocumentTemplateAnalysis | null
  template_name: string | null
}

/**
 * Resultado de resolver la versión VIGENTE para un tipo documental y una fecha.
 * `status` lo decide el backend: `RESOLVED` (una sola aplicable), `NONE` (ninguna) o
 * `AMBIGUOUS` (más de una). Nunca se interpreta aquí.
 */
export interface ResolvedDocumentTemplateVersion {
  status: string
  version_id: string | null
  version_number: number | null
  template_name: string | null
}

export interface TemplateValidationChecks {
  original_file_present: boolean
  configured_file_present: boolean
  /** El configurado es un paquete OOXML (`.docx`) analizable. */
  configured_format_analyzable: boolean
  analysis_present: boolean
  analysis_matches_configured: boolean
  valid_docx: boolean
  no_unknown_variables: boolean
  no_incompatible_variables: boolean
  no_malformed_placeholders: boolean
  effective_dates_coherent: boolean
  no_simultaneous_active: boolean
  has_placeholders: boolean
}

export interface TemplateValidation {
  version_id: string
  template_id: string
  document_type_code: string
  version_number: number
  status: DocumentTemplateVersionStatus
  effective_from: string | null
  effective_to: string | null
  original_file_name: string | null
  original_file_format: string | null
  original_mime_type: string | null
  configured_file_name: string | null
  configured_file_format: string | null
  configured_mime_type: string | null
  analysis_issue: string | null
  analyzed_file_path: string | null
  ready: boolean
  checks: TemplateValidationChecks
  variables_found: number
  variables_valid: number
  variables_unknown: number
  variables_incompatible: number
  occurrences_total: number
  occurrences_invalid: number
  required_variables: string[]
  recognized: TemplateOccurrence[]
  unknown_variables: { key: string; count: number }[]
  incompatible_variables: TemplateIncompatibleVariable[]
  malformed_placeholders: TemplateMalformed[]
  warnings: string[]
  analysis: DocumentTemplateAnalysis | null
}

/** Datos de entrada del alta de una plantilla (su versión 1 nace en borrador). */
export interface CreateDocumentTemplateInput {
  entityId: string
  documentTypeCode: DocumentTemplateTypeCode
  name: string
  description?: string | null
  effectiveFrom?: string | null
}

/** Informe de la inspección local de un archivo antes de subirlo. */
export interface TemplateFileInspection {
  format: WordDocumentFormat
  /** Extensión canónica del formato detectado (`doc` | `docx`). */
  extension: string
  mimeType: string
  problem: string | null
}

/** Datos mínimos de la versión necesarios para subir un archivo. */
export type UploadableTemplateVersion = Pick<
  DocumentTemplateVersion,
  "id" | "version_number" | "original_file_path" | "configured_file_path"
>

export interface UploadTemplateFileInput {
  entityId: string
  templateId: string
  version: UploadableTemplateVersion
  kind: DocumentTemplateFileKind
  file: File
}

/** Resultado de la preparación del archivo en el analizador central. */
export interface TemplateFileProbe {
  detected_format: WordDocumentFormat
  /** `true` sólo si el formato real es OOXML analizable. */
  analysis_supported: boolean
  /** Motivo cuando el documento no puede prepararse para análisis. */
  issue: string | null
  mime_type: string
  file_sha256: string | null
  /** Análisis OOXML (sólo presente cuando `analysis_supported` es `true`). */
  analysis: unknown | null
}

/** Resultado del registro completo de un archivo en la versión de la plantilla. */
export interface RegisteredTemplateFile {
  path: string
  format: WordDocumentFormat
  analysis: DocumentTemplateAnalysis | null
  issue: string | null
}

export interface ReanalyzeTemplateFileInput {
  version: DocumentTemplateVersion
  kind: DocumentTemplateFileKind
  filePath: string
}
