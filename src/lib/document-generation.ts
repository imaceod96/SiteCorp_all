/**
 * Fachada de compatibilidad del MOTOR de generación documental.
 *
 * El motor vive ahora en el dominio `src/domains/document-generation` (dominio, aplicación e
 * infraestructura). Este archivo SÓLO reexporta su interfaz pública, para los consumidores que
 * todavía no se han migrado; no conserva ninguna consulta, ninguna regla ni ningún renderizador.
 *
 * Los consumidores ya migrados importan directamente del dominio:
 *   import { generateContractDocument } from "@/domains/document-generation"
 *
 * Los contratos de los snapshots documentales siguen en `@/lib/document-data` (tipos puros que
 * comparte el registro central de variables).
 */

export {
  WORKER_DOCUMENTS_BUCKET,
  DOCUMENT_TYPE_LABELS,
  documentVariableHint,
  documentTypeCodeForContractType,
  buildGeneratedDocumentName,
  BLOCKED_MESSAGES,
  SC404_ALREADY_EXISTS_PREFIX,
  parseSc404ExistingId,
  formatGenerationMoment,
  resolveTemplateVersionForDocument,
  precheckDocumentGeneration,
  precheckContractDocument,
  precheckAddendumDocument,
  precheckSc404Document,
  precheckResolutionDocument,
  precheckPayrollMovementDocument,
  fetchGeneratedDocuments,
  generateContractDocument,
  generateAddendumDocument,
  generateSc404Document,
  generateResolutionDocument,
  generatePayrollMovementDocument,
  createGeneratedDocumentUrl,
  downloadGeneratedDocument,
} from "@/domains/document-generation"

export type {
  GenerationDocumentKind,
  TemplateResolutionStatus,
  TemplateResolution,
  GenerationBlockedReason,
  MissingVariable,
  DocumentGenerationPrecheck,
  DocumentGenerationResult,
  GeneratedDocumentRow,
} from "@/domains/document-generation"
