import {
  BLOCKED_MESSAGES,
  DOCUMENT_TYPE_LABELS,
  SC404_ALREADY_EXISTS_PREFIX,
  blockedMessageFor,
  buildGeneratedDocumentFileName,
  buildMissingVariables,
  buildRenderValues,
  documentTypeCodeForContractType,
  documentTypeLabelFor,
  documentVariableHint,
  formatBatchMoment,
  formatGenerationMoment,
  isPayrollMovementKind,
  isResolutionKind,
  isSc404IncorporationUndetermined,
  isSc404Kind,
  knownVariableKeys,
  parseSc404ExistingId,
  pinsTemplateVersionOnSource,
  resolveBlockedReason,
  resolvePrefillDocumentType,
  selectMissingVariableKeys,
} from "../../../../supabase/functions/_shared/generation-rules.ts"
import type { DocumentGenerationPrecheck } from "./entities"

/**
 * Generación documental — Reglas PURAS del dominio.
 *
 * Delegadas desde la fuente única compartida (`supabase/functions/_shared/generation-rules.ts`)
 * manteniendo intactos los tipos del dominio para el frontend y Vitest.
 */

export {
  BLOCKED_MESSAGES,
  DOCUMENT_TYPE_LABELS,
  SC404_ALREADY_EXISTS_PREFIX,
  blockedMessageFor,
  buildGeneratedDocumentFileName,
  buildMissingVariables,
  buildRenderValues,
  documentTypeCodeForContractType,
  documentTypeLabelFor,
  documentVariableHint,
  formatBatchMoment,
  formatGenerationMoment,
  isPayrollMovementKind,
  isResolutionKind,
  isSc404IncorporationUndetermined,
  isSc404Kind,
  knownVariableKeys,
  parseSc404ExistingId,
  pinsTemplateVersionOnSource,
  resolveBlockedReason,
  resolvePrefillDocumentType,
  selectMissingVariableKeys,
}

/**
 * Nombre humano del archivo generado (§37): el que ve el usuario al descargarlo.
 * Conserva exactamente el mismo criterio por tipo documental.
 */
export const buildGeneratedDocumentName = (
  precheck: DocumentGenerationPrecheck,
  dateIso: string,
  extension: string = "docx"
): string =>
  buildGeneratedDocumentFileName(
    precheck.kind,
    precheck.template.documentTypeCode,
    precheck.documentData.worker.full_name,
    dateIso,
    extension
  )
