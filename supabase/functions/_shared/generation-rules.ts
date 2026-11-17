/**
 * Reglas puras compartidas de generación documental y reconciliación de plantillas
 * (frontend, Vitest y Deno Edge Functions).
 */

import {
  DOCUMENT_VARIABLES,
  documentVariableByKey,
  type DocumentTypeCode,
} from "./document-variables.ts"
import type { DocumentData, Sc404SourceType } from "./document-data.ts"

export type SharedGenerationDocumentKind =
  | "CONTRACT"
  | "ADDENDUM"
  | "VACATION"
  | "MEDICAL_CERTIFICATE"
  | "RESOLUTION"
  | "PAYROLL_MOVEMENT"

export type SharedTemplateResolutionStatus = "PINNED" | "RESOLVED" | "NONE" | "AMBIGUOUS"

export type SharedGenerationBlockedReason =
  | "NOT_FORMALIZED"
  | "TEMPLATE_NONE"
  | "TEMPLATE_AMBIGUOUS"
  | "TEMPLATE_UNUSABLE"
  | "NO_ANALYSIS"
  | "MISSING_DATA"
  | null

export interface SharedMissingVariable {
  key: string
  label: string
  hint: string | null
}

export interface SharedTemplateResolution {
  status: SharedTemplateResolutionStatus
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

export interface SharedTemplateOccurrence {
  key: string
  count: number
  split_runs: number
  sort_order?: number
}

export interface SharedTemplateAnalysis {
  analyzed_at: string | null
  file_path: string
  file_kind: "ORIGINAL" | "CONFIGURED"
  file_name: string | null
  file_sha256: string | null
  valid_docx: boolean
  zip_signature_ok: boolean
  has_document_xml: boolean
  scanned_parts: string[]
  paragraphs_scanned: number
  occurrences: SharedTemplateOccurrence[]
  recognized: SharedTemplateOccurrence[]
  required_variables: string[]
  unknown_variables: { key: string; count: number }[]
  incompatible_variables: { key: string; label: string | null; count: number }[]
  malformed_placeholders: { part: string; snippet: string }[]
  split_run_placeholders: number
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* Clasificación del origen                                            */
/* ------------------------------------------------------------------ */

export const isSc404Kind = (kind: SharedGenerationDocumentKind): kind is Sc404SourceType =>
  kind === "VACATION" || kind === "MEDICAL_CERTIFICATE"

export const isResolutionKind = (kind: SharedGenerationDocumentKind): boolean =>
  kind === "RESOLUTION"

export const isPayrollMovementKind = (kind: SharedGenerationDocumentKind): boolean =>
  kind === "PAYROLL_MOVEMENT"

export const pinsTemplateVersionOnSource = (kind: SharedGenerationDocumentKind): boolean =>
  !isSc404Kind(kind) && !isResolutionKind(kind) && !isPayrollMovementKind(kind)

/* ------------------------------------------------------------------ */
/* Etiquetas y mapeos de tipo documental                               */
/* ------------------------------------------------------------------ */

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  EMPLOYMENT_CONTRACT_DETERMINED: "Contrato de Trabajo por Tiempo Determinado",
  EMPLOYMENT_CONTRACT_INDETERMINED: "Contrato de Trabajo por Tiempo Indeterminado",
  EMPLOYMENT_CONTRACT_ADDENDUM: "Anexo al Contrato de Trabajo",
  SC_4_04: "Modelo SC-4-04 — Notificación de Vacaciones, Deducciones, Licencias y Subsidios",
  RESOLUTION: "Resolución — Especialista Principal",
  PAYROLL_MOVEMENT: "Movimiento de Nómina",
}

export const documentTypeLabelFor = (documentTypeCode: string | null): string =>
  (documentTypeCode && DOCUMENT_TYPE_LABELS[documentTypeCode]) || "Documento contractual"

export const documentTypeCodeForContractType = (contractTypeCode: string | null): string | null => {
  if (contractTypeCode === "DETERMINADO") return "EMPLOYMENT_CONTRACT_DETERMINED"
  if (contractTypeCode === "INDETERMINADO") return "EMPLOYMENT_CONTRACT_INDETERMINED"
  return null
}

export const documentTypeCodeForTemplateType = (templateTypeCode: string): DocumentTypeCode =>
  templateTypeCode === "EMPLOYMENT_CONTRACT_ADDENDUM" || templateTypeCode === "ADDENDUM"
    ? "ADDENDUM"
    : templateTypeCode === "SC_4_04"
      ? "SC_4_04"
      : templateTypeCode === "RESOLUTION"
        ? "RESOLUTION"
        : templateTypeCode === "PAYROLL_MOVEMENT"
          ? "PAYROLL_MOVEMENT"
          : "CONTRACT"

/**
 * Reconcilia el análisis devuelto por el backend con el catálogo oficial de dominio
 * (`DOCUMENT_VARIABLES`), garantizando una única fuente de verdad (C2/G1).
 */
export const reconcileTemplateAnalysisWithCatalog = <T extends SharedTemplateAnalysis>(
  analysis: T,
  templateTypeCode?: string | null
): T => {
  const docType = documentTypeCodeForTemplateType(templateTypeCode || "CONTRACT")

  const recognizedMap = new Map<string, SharedTemplateOccurrence>()
  for (const item of analysis.recognized || []) {
    recognizedMap.set(item.key, { ...item })
  }

  const remainingUnknown: { key: string; count: number }[] = []
  const remainingIncompatible: { key: string; label: string | null; count: number }[] = [
    ...(analysis.incompatible_variables || []),
  ]

  for (const item of analysis.unknown_variables || []) {
    const def = documentVariableByKey(item.key)
    if (!def) {
      remainingUnknown.push(item)
      continue
    }
    if (def.documentTypes.includes(docType)) {
      recognizedMap.set(item.key, {
        key: item.key,
        count: item.count,
        split_runs: 0,
      })
    } else if (!remainingIncompatible.some((inc) => inc.key === item.key)) {
      remainingIncompatible.push({
        key: item.key,
        label: def.label,
        count: item.count,
      })
    }
  }

  const finalIncompatible: { key: string; label: string | null; count: number }[] = []
  for (const inc of remainingIncompatible) {
    const def = documentVariableByKey(inc.key)
    if (def && def.documentTypes.includes(docType)) {
      recognizedMap.set(inc.key, {
        key: inc.key,
        count: inc.count,
        split_runs: 0,
      })
    } else {
      finalIncompatible.push(inc)
    }
  }

  const recognized = Array.from(recognizedMap.values())
  const requiredVariables = recognized.map((item) => item.key)

  const filteredWarnings = (analysis.warnings || []).filter((w) => {
    if (recognized.length > 0 && w.includes("no contiene marcadores dinámicos")) {
      return false
    }
    return true
  })

  return {
    ...analysis,
    recognized,
    unknown_variables: remainingUnknown,
    incompatible_variables: finalIncompatible,
    required_variables: requiredVariables,
    warnings: filteredWarnings,
  }
}

const VARIABLE_FIX_HINTS: Record<string, string> = {
  "worker.profession": "Datos personales del trabajador",
  "worker.address": "Datos personales del trabajador",
  "worker.province": "Datos personales del trabajador",
  "worker.municipality": "Datos personales del trabajador",
  "worker.birth_date": "Datos personales del trabajador",
  "worker.identification": "Datos personales del trabajador",
  "contract.payment_schedule": "Contrato (condiciones contractuales)",
  "contract.payment_method": "Contrato (condiciones contractuales)",
  "contract.signature_place": "Contrato (datos de firma)",
  "entity.organism": "Datos contractuales de la entidad",
  "entity.branch": "Datos contractuales de la entidad",
  "entity.address": "Datos contractuales de la entidad",
  "entity.revolution_year": "Datos contractuales de la entidad",
  "representative.name": "Datos contractuales de la entidad (representantes)",
  "representative.position": "Datos contractuales de la entidad (representantes)",
}

export const documentVariableHint = (key: string): string | null => VARIABLE_FIX_HINTS[key] ?? null

export const BLOCKED_MESSAGES: Record<string, string> = {
  NOT_FORMALIZED: "Solo se puede generar el documento de un contrato o anexo formalizado.",
  TEMPLATE_NONE:
    "No existe una versión de plantilla aplicable a la fecha de este documento.",
  TEMPLATE_AMBIGUOUS:
    "Existe más de una versión de plantilla aplicable a la fecha de este documento. Revise la vigencia de las plantillas.",
  TEMPLATE_UNUSABLE:
    "La versión de plantilla aplicable no tiene un documento configurado en un formato analizable (.docx o .xlsx).",
  NO_ANALYSIS: "La versión de plantilla aplicable no tiene un análisis de variables válido.",
  MISSING_DATA: "Faltan datos requeridos por esta plantilla.",
}

export const blockedMessageFor = (reason: SharedGenerationBlockedReason): string =>
  BLOCKED_MESSAGES[reason ?? "TEMPLATE_NONE"]

const slug = (value: string | null | undefined): string => {
  if (!value) return ""
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export const buildGeneratedDocumentFileName = (
  kind: SharedGenerationDocumentKind,
  templateDocumentTypeCode: string | null,
  workerFullName: string | null | undefined,
  dateIso: string,
  extension: string = "docx"
): string => {
  const workerName = slug(workerFullName)
  const base =
    kind === "ADDENDUM"
      ? ["Anexo", "Contrato", workerName]
      : isResolutionKind(kind)
        ? ["Resolucion", workerName]
        : isPayrollMovementKind(kind)
          ? [workerName, "Movimiento", "Nomina"]
          : isSc404Kind(kind)
            ? kind === "VACATION"
              ? ["Modelo SC-4-04 - Vacaciones", workerName]
              : ["Modelo SC-4-04 - Certificados/Licencia", workerName]
            : [
                "Contrato",
                templateDocumentTypeCode === "EMPLOYMENT_CONTRACT_DETERMINED"
                  ? "Determinado"
                  : templateDocumentTypeCode === "EMPLOYMENT_CONTRACT_INDETERMINED"
                    ? "Indeterminado"
                    : null,
                workerName,
              ]
  const parts = base.map((part) => slug(part ?? "")).filter((part) => part !== "")
  return `${parts.join("_")}_${dateIso}.${extension}`
}

/* ------------------------------------------------------------------ */
/* Idempotencia del SC-4-04 (§47/§48)                                  */
/* ------------------------------------------------------------------ */

export const SC404_ALREADY_EXISTS_PREFIX = "SC404_ALREADY_EXISTS|"

export const parseSc404ExistingId = (message: string | undefined | null): string | null => {
  if (!message) return null
  return message.startsWith(SC404_ALREADY_EXISTS_PREFIX)
    ? message.slice(SC404_ALREADY_EXISTS_PREFIX.length)
    : null
}

/* ------------------------------------------------------------------ */
/* Variables obligatorias y bloqueo (§26/§46/§31)                       */
/* ------------------------------------------------------------------ */

const SC404_CRITICAL_KEYS = new Set([
  "entity.name",
  "worker.full_name",
  "worker.identification",
  "sc404.fecha_desde",
  "sc404.dias",
])

const SC404_INCORPORATION_KEYS = new Set([
  "sc404.incorporacion_dia",
  "sc404.incorporacion_mes",
  "sc404.incorporacion_anio",
  "vacaciones.reincorporacion",
])

const PAYROLL_CRITICAL_KEYS = new Set(["m.exp", "m.nom", "m.ap1", "m.dia", "m.mes", "m.ano"])

const SC404_INCORPORATION_UNDETERMINED_HINT =
  "No puede determinarse la Fecha de incorporación: el Puesto vigente al período de vacaciones no tiene horario laboral configurado (días laborables)."

export const isSc404IncorporationUndetermined = (
  kind: SharedGenerationDocumentKind,
  documentData: DocumentData
): boolean =>
  isSc404Kind(kind) &&
  documentData.document_type === "SC_4_04" &&
  documentData.origin.source_type === "VACATION" &&
  documentData.origin.incorporation_date === null

export const selectMissingVariableKeys = (
  kind: SharedGenerationDocumentKind,
  requiredVariables: string[],
  resolvedValues: Record<string, string>,
  incorporationUndetermined: boolean
): string[] => {
  if (isSc404Kind(kind)) {
    return requiredVariables.filter(
      (key) =>
        !(key in resolvedValues) &&
        (SC404_CRITICAL_KEYS.has(key) ||
          (incorporationUndetermined && SC404_INCORPORATION_KEYS.has(key)))
    )
  }
  if (isPayrollMovementKind(kind)) {
    return requiredVariables.filter(
      (key) => !(key in resolvedValues) && PAYROLL_CRITICAL_KEYS.has(key)
    )
  }
  return requiredVariables.filter((key) => !(key in resolvedValues))
}

export const buildMissingVariables = (
  keys: string[],
  incorporationUndetermined: boolean
): SharedMissingVariable[] =>
  keys.map((key) => ({
    key,
    label: documentVariableByKey(key)?.label ?? key,
    hint:
      SC404_INCORPORATION_KEYS.has(key) && incorporationUndetermined
        ? SC404_INCORPORATION_UNDETERMINED_HINT
        : documentVariableHint(key),
  }))

export const resolveBlockedReason = (input: {
  formalized: boolean
  template: Pick<SharedTemplateResolution, "status" | "versionId" | "versionUsable">
  analysisPresent: boolean
  missingCount: number
}): SharedGenerationBlockedReason => {
  if (!input.formalized) return "NOT_FORMALIZED"
  if (input.template.status === "NONE") return "TEMPLATE_NONE"
  if (input.template.status === "AMBIGUOUS") return "TEMPLATE_AMBIGUOUS"
  if (!input.template.versionId) return "TEMPLATE_NONE"
  if (!input.template.versionUsable) return "TEMPLATE_UNUSABLE"
  if (!input.analysisPresent) return "NO_ANALYSIS"
  if (input.missingCount > 0) return "MISSING_DATA"
  return null
}

/* ------------------------------------------------------------------ */
/* Sustitución de variables (§26/§85)                                  */
/* ------------------------------------------------------------------ */

export const resolvePrefillDocumentType = (
  kind: SharedGenerationDocumentKind
): "SC_4_04" | "PAYROLL_MOVEMENT" | null =>
  isSc404Kind(kind) ? "SC_4_04" : isPayrollMovementKind(kind) ? "PAYROLL_MOVEMENT" : null

export const knownVariableKeys = (): string[] =>
  DOCUMENT_VARIABLES.map((definition) => definition.key)

export const buildRenderValues = (
  kind: SharedGenerationDocumentKind,
  resolvedValues: Record<string, string>
): Record<string, string> => {
  const prefillType = resolvePrefillDocumentType(kind)
  if (!prefillType) return resolvedValues
  return {
    ...Object.fromEntries(
      DOCUMENT_VARIABLES.filter((definition) =>
        definition.documentTypes.includes(prefillType)
      ).map((definition) => [definition.key, ""])
    ),
    ...resolvedValues,
  }
}

/* ------------------------------------------------------------------ */
/* Fechas legibles (historial y lotes)                                 */
/* ------------------------------------------------------------------ */

export const formatGenerationMoment = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()} ${hours}:${minutes}`
}

export const formatBatchMoment = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()}`
}
