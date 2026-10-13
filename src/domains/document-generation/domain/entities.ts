import type { DocumentData } from "./document-data"

/**
 * Generación documental — Entidades y contratos de dominio.
 *
 * Este contexto cubre el MOTOR de generación documental:
 *
 *   ORIGEN (contrato / anexo / SC-4-04 / resolución / movimiento)
 *      → DATOS DOCUMENTALES (snapshots históricos)
 *      → VARIABLES (registro central)
 *      → PLANTILLA VIGENTE (dominio `document-templates`)
 *      → DOCX / XLSX FINAL (Storage del expediente)
 *
 * Límites del contexto (los mismos de la etapa anterior, sin cambios de comportamiento):
 *  - La generación es HISTÓRICAMENTE REPRODUCIBLE: se resuelve desde el origen y sus
 *    snapshots, nunca desde el estado vivo.
 *  - Una vez fijada la versión de plantilla en la fuente, las regeneraciones usan SIEMPRE
 *    esa misma versión, aunque exista una más nueva.
 *  - Nunca se inventan datos: una variable requerida por ESA plantilla sin valor bloquea la
 *    generación.
 *  - Las plantillas, sus versiones y sus vigencias NO se administran aquí: se consultan al
 *    dominio `document-templates`, que sigue siendo el único dueño de ese catálogo.
 *
 * Los contratos de los SNAPSHOTS documentales (`ContractDocumentData`, `AddendumDocumentData`,
 * `Sc404DocumentData`, `ResolutionDocumentData`, `PayrollMovementDocumentData`) viven en
 * `./document-data`, y el catálogo de variables que los describe en el dominio
 * `document-templates`: la dependencia va en un solo sentido (generación → plantillas) y así
 * no puede formarse ningún ciclo entre el catálogo de variables y este dominio.
 */

/** Bucket privado del expediente del trabajador (documentos generados). No cambia. */
export const WORKER_DOCUMENTS_BUCKET = "documents"

/** Tipos documentales que el motor sabe generar. */
export type GenerationDocumentKind =
  | "CONTRACT"
  | "ADDENDUM"
  | "VACATION"
  | "MEDICAL_CERTIFICATE"
  | "RESOLUTION"
  | "PAYROLL_MOVEMENT"

/** Cómo se obtuvo la versión de plantilla con la que se genera. */
export type TemplateResolutionStatus = "PINNED" | "RESOLVED" | "NONE" | "AMBIGUOUS"

/** Plantilla resuelta para un documento concreto (versión real y su vigencia). */
export interface TemplateResolution {
  status: TemplateResolutionStatus
  versionId: string | null
  versionNumber: number | null
  versionStatus: string | null
  versionUsable: boolean
  templateName: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  configuredFilePath: string | null
  configuredFileFormat: string | null
  referenceDate: string
  documentTypeCode: string
}

/** Motivo por el que un documento NO puede generarse todavía. */
export type GenerationBlockedReason =
  | "NOT_FORMALIZED"
  | "TEMPLATE_NONE"
  | "TEMPLATE_AMBIGUOUS"
  | "TEMPLATE_UNUSABLE"
  | "NO_ANALYSIS"
  | "MISSING_DATA"
  | null

/** Variable requerida por la plantilla que no tiene valor en el origen. */
export interface MissingVariable {
  key: string
  label: string
  hint: string | null
}

/** Diagnóstico previo a la generación (§64): qué falta y con qué plantilla se generaría. */
export interface DocumentGenerationPrecheck {
  kind: GenerationDocumentKind
  sourceId: string
  workerId: string
  entityId: string
  formalized: boolean
  documentTypeLabel: string
  template: TemplateResolution
  requiredVariables: string[]
  missingVariables: MissingVariable[]
  ready: boolean
  blockedReason: GenerationBlockedReason
  /** Valores ya resueltos y formateados por el registro central (uso interno del motor). */
  resolvedValues: Record<string, string>
  documentData: DocumentData
}

/** Resultado de una generación (éxito o error con su motivo legible). */
export interface DocumentGenerationResult {
  success: boolean
  generationId?: string
  templateVersionId?: string
  workerDocumentId?: string
  generationNumber?: number
  docxPath?: string
  pdfPath?: string | null
  missingVariables?: { key: string; label: string }[]
  error?: string
}

/** Documento generado del expediente, con su plantilla y versión ya resueltas. */
export interface GeneratedDocumentRow {
  id: string
  worker_id: string
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  generation_number: number | null
  created_at: string
  document_template_version_id: string | null
  version_number: number | null
  template_name: string | null
}

/** Fila cruda de `worker_documents` (contrato del backend). */
export interface GeneratedDocumentRecord {
  id: string
  worker_id: string
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  generation_number: number | null
  created_at: string
  document_template_version_id: string | null
}

/** Origen seleccionado de un documento: de dónde se resuelve todo lo demás. */
export interface SourceContext {
  kind: GenerationDocumentKind
  sourceId: string
  workerId: string
  entityId: string
  formalized: boolean
  referenceDate: string
  documentTypeCode: string | null
  pinnedVersionId: string | null
}

/** Reserva de generación devuelta por las RPC `begin_*`. */
export interface GenerationReservation {
  worker_document_id: string
  generation_number: number
  storage_path: string
}

/* ------------------------------------------------------------------ */
/* Lotes documentales (agrupaciones de descarga)                        */
/* ------------------------------------------------------------------ */

export type BatchStatus = "GENERATING" | "READY" | "ERRORS"

/** Lote listo (o en curso) para descargar: una entidad + un evento + un tipo documental. */
export interface PendingBatch {
  id: string
  event_id: string
  organization_entity_id: string
  entity_name: string | null
  document_type_code: string
  document_type_label: string
  label: string | null
  status: BatchStatus
  expected_count: number
  generated_count: number
  failed_count: number
  zip_path: string | null
  zip_file_name: string | null
  effective_date: string | null
  created_at: string
}

/** Estado documental de cada trabajador de un lote. */
export interface PendingBatchItem {
  id: string
  worker_id: string
  worker_document_id: string | null
  worker_name: string | null
  status: "GENERATED" | "ERROR"
  error: string | null
}

/** Resultado de generar los documentos individuales de un evento masivo. */
export interface EventGenerationResult {
  generated: number
  failed: number
  errors: { movement_id: string; message: string }[]
}

/** Resultado del cierre documental automático de un evento masivo (§75). */
export interface EventDocumentationResult {
  generated: number
  failed: number
  batchesReady: number
  zipsCreated: number
}
