/**
 * Generación documental — Interfaz pública del contexto.
 *
 * Punto único de entrada para los consumidores (páginas, componentes y otros dominios):
 *   import { generateContractDocument } from "@/domains/document-generation"
 *
 * Estructura:
 *   domain/entities.ts                                  → tipos, contratos y constantes
 *   domain/rules.ts                                     → reglas puras (etiquetas, nombres de
 *                                                          archivo, variables obligatorias,
 *                                                          bloqueos y mensajes)
 *   infrastructure/document-source.repository.ts        → el origen del documento
 *   infrastructure/document-data.repository.ts          → datos documentales (snapshots)
 *   infrastructure/document-template-version.repository.ts → versión de plantilla (traduce el
 *                                                          contrato del dominio de plantillas)
 *   infrastructure/document-generation.repository.ts    → RPC del ciclo de generación y expediente
 *   infrastructure/document-storage.repository.ts       → Storage del expediente
 *   infrastructure/document-batches.repository.ts       → lotes, ZIP y Edge Function
 *   infrastructure/renderers/docx-render.ts             → motor OOXML (Word)
 *   infrastructure/renderers/xlsx-render.ts             → motor Excel
 *   application/document-generation.queries.ts          → precheck e historial
 *   application/document-generation.commands.ts         → generación y descarga
 *   application/document-batches.queries.ts             → bandeja documental
 *   application/document-batches.commands.ts            → generación por lotes y cierre masivo
 *
 * Límites DELIBERADOS del contexto:
 *  - Las plantillas, sus versiones y sus vigencias se piden SIEMPRE al dominio
 *    `document-templates`: aquí no se administran ni se duplican.
 *  - Los contratos de los SNAPSHOTS documentales viven en `@/lib/document-data` porque el
 *    registro central de variables (`@/lib/document-variables`) los describe; el dominio los
 *    consume y las reglas de contratos, representantes, resoluciones y personas NO se repiten.
 *  - La dependencia va en un solo sentido —presentación → aplicación → dominio → infraestructura
 *    → Supabase—, por lo que no puede formarse ningún ciclo entre dominios.
 *
 * Los nombres públicos se conservan respecto de la etapa anterior para no alterar a los
 * consumidores; lo que cambia es el lugar donde vive el código, no su contrato.
 */

/* Constantes y tipos de dominio */
export { WORKER_DOCUMENTS_BUCKET } from "./domain/entities"

export type {
  GenerationDocumentKind,
  TemplateResolutionStatus,
  TemplateResolution,
  GenerationBlockedReason,
  MissingVariable,
  DocumentGenerationPrecheck,
  DocumentGenerationResult,
  GeneratedDocumentRow,
  GeneratedDocumentRecord,
  SourceContext,
  GenerationReservation,
  BatchStatus,
  PendingBatch,
  PendingBatchItem,
  EventGenerationResult,
  EventDocumentationResult,
} from "./domain/entities"

/* Reglas puras */
export {
  DOCUMENT_TYPE_LABELS,
  documentTypeLabelFor,
  documentVariableHint,
  documentTypeCodeForContractType,
  buildGeneratedDocumentName,
  BLOCKED_MESSAGES,
  blockedMessageFor,
  SC404_ALREADY_EXISTS_PREFIX,
  parseSc404ExistingId,
  formatGenerationMoment,
  formatBatchMoment,
} from "./domain/rules"

/* Casos de uso de lectura */
export {
  resolveTemplateVersionForDocument,
  precheckDocumentGeneration,
  precheckContractDocument,
  precheckAddendumDocument,
  precheckSc404Document,
  precheckResolutionDocument,
  precheckPayrollMovementDocument,
  fetchGeneratedDocuments,
} from "./application/document-generation.queries"

/* Casos de uso de escritura (generación individual y descarga) */
export {
  generateContractDocument,
  generateAddendumDocument,
  generateSc404Document,
  generateResolutionDocument,
  generatePayrollMovementDocument,
  createGeneratedDocumentUrl,
  downloadGeneratedDocument,
} from "./application/document-generation.commands"

/* Bandeja documental y generación por lotes */
export {
  fetchPendingBatches,
  fetchBatchItems,
  createBatchZipUrl,
} from "./application/document-batches.queries"

export {
  generateEventMovementDocuments,
  rebuildEventBatches,
  requestBatchZip,
  ensureEventDocumentation,
} from "./application/document-batches.commands"
