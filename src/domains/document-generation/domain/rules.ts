import { DOCUMENT_VARIABLES, documentVariableByKey } from "@/lib/document-variables"
import type { DocumentData, Sc404SourceType } from "@/lib/document-data"
import type {
  DocumentGenerationPrecheck,
  GenerationBlockedReason,
  GenerationDocumentKind,
  MissingVariable,
  TemplateResolution,
} from "./entities"

/**
 * Generación documental — Reglas PURAS del dominio.
 *
 * Aquí vive todo lo que el motor DECIDE sin tocar la base de datos ni el Storage: qué tipo
 * documental corresponde a cada tipo de contrato, cómo se llama el archivo generado, qué
 * variables bloquean la generación, qué valores se prefijan y qué mensaje ve el usuario.
 *
 * Ninguna consulta, ninguna RPC y ningún acceso a Storage: esas operaciones viven en la
 * infraestructura del dominio.
 */

/* ------------------------------------------------------------------ */
/* Clasificación del origen                                            */
/* ------------------------------------------------------------------ */

/** ¿El origen es un modelo SC-4-04 (vacaciones o certificado médico)? */
export const isSc404Kind = (kind: GenerationDocumentKind): kind is Sc404SourceType =>
  kind === "VACATION" || kind === "MEDICAL_CERTIFICATE"

export const isResolutionKind = (kind: GenerationDocumentKind): boolean => kind === "RESOLUTION"

export const isPayrollMovementKind = (kind: GenerationDocumentKind): boolean =>
  kind === "PAYROLL_MOVEMENT"

/** El SC-4-04 y el Movimiento de Nómina NO fijan versión en su origen (sólo la trazan). */
export const pinsTemplateVersionOnSource = (kind: GenerationDocumentKind): boolean =>
  !isSc404Kind(kind) && !isResolutionKind(kind) && !isPayrollMovementKind(kind)

/* ------------------------------------------------------------------ */
/* Etiquetas                                                           */
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

/** Dónde puede corregirse cada variable (§66). Sin navegación inteligente. */
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

/** Mensajes de bloqueo (§64). Los ve el usuario: no cambian. */
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

export const blockedMessageFor = (reason: GenerationBlockedReason): string =>
  BLOCKED_MESSAGES[reason ?? "TEMPLATE_NONE"]

/* ------------------------------------------------------------------ */
/* Tipo documental y nombre del archivo                                */
/* ------------------------------------------------------------------ */

/** Tipo documental del catálogo central que corresponde a cada tipo de contrato. */
export const documentTypeCodeForContractType = (contractTypeCode: string | null): string | null => {
  if (contractTypeCode === "DETERMINADO") return "EMPLOYMENT_CONTRACT_DETERMINED"
  if (contractTypeCode === "INDETERMINADO") return "EMPLOYMENT_CONTRACT_INDETERMINED"
  return null
}

const slug = (value: string | null | undefined): string => {
  if (!value) return ""
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * Nombre humano del archivo generado (§37): el que ve el usuario al descargarlo.
 * Se conserva EXACTAMENTE el mismo criterio por tipo documental.
 */
export const buildGeneratedDocumentName = (
  precheck: DocumentGenerationPrecheck,
  dateIso: string,
  extension: string = "docx"
): string => {
  const workerName = slug(precheck.documentData.worker.full_name)
  const base =
    precheck.kind === "ADDENDUM"
      ? ["Anexo", "Contrato", workerName]
      : isResolutionKind(precheck.kind)
        ? ["Resolucion", workerName]
        : isPayrollMovementKind(precheck.kind)
        ? [workerName, "Movimiento", "Nomina"]
        : isSc404Kind(precheck.kind)
        ? precheck.kind === "VACATION"
          ? ["Modelo SC-4-04 - Vacaciones", workerName]
          : ["Modelo SC-4-04 - Certificados/Licencia", workerName]
        : [
          "Contrato",
          precheck.template.documentTypeCode === "EMPLOYMENT_CONTRACT_DETERMINED"
            ? "Determinado"
            : precheck.template.documentTypeCode === "EMPLOYMENT_CONTRACT_INDETERMINED"
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

/** Prefijo de error controlado emitido por begin_sc404_generation (§48). */
export const SC404_ALREADY_EXISTS_PREFIX = "SC404_ALREADY_EXISTS|"

/** Documento ya existente del que informa el backend, si el error lo trae. */
export const parseSc404ExistingId = (message: string | undefined | null): string | null => {
  if (!message) return null
  return message.startsWith(SC404_ALREADY_EXISTS_PREFIX)
    ? message.slice(SC404_ALREADY_EXISTS_PREFIX.length)
    : null
}

/* ------------------------------------------------------------------ */
/* Variables obligatorias y bloqueo (§26/§46/§31)                       */
/* ------------------------------------------------------------------ */

/** SC-4-04 (§26): sólo bloquean los datos nucleares del modelo. */
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

/** Movimiento de Nómina: los vacíos legítimos NO bloquean (§46). */
const PAYROLL_CRITICAL_KEYS = new Set(["m.exp", "m.nom", "m.ap1", "m.dia", "m.mes", "m.ano"])

const SC404_INCORPORATION_UNDETERMINED_HINT =
  "No puede determinarse la Fecha de incorporación: el Puesto vigente al período de vacaciones no tiene horario laboral configurado (días laborables)."

/**
 * §16 Fase 24: si la plantilla exige la Fecha de incorporación y el origen es VACATION pero
 * no pudo determinarse (Puesto sin horario laboral configurado), la generación se bloquea con
 * un mensaje claro — nunca se inventa una fecha.
 */
export const isSc404IncorporationUndetermined = (
  kind: GenerationDocumentKind,
  documentData: DocumentData
): boolean =>
  isSc404Kind(kind) &&
  documentData.document_type === "SC_4_04" &&
  documentData.origin.source_type === "VACATION" &&
  documentData.origin.incorporation_date === null

/**
 * Variables requeridas por la plantilla que NO tienen valor en el origen.
 * Cada tipo documental decide qué ausencias bloquean de verdad; el resto se sustituye por
 * cadena vacía y no impide generar el documento.
 */
export const selectMissingVariableKeys = (
  kind: GenerationDocumentKind,
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

/** Detalle legible de cada variable pendiente, con dónde corregirla. */
export const buildMissingVariables = (
  keys: string[],
  incorporationUndetermined: boolean
): MissingVariable[] =>
  keys.map((key) => ({
    key,
    label: documentVariableByKey(key)?.label ?? key,
    hint:
      SC404_INCORPORATION_KEYS.has(key) && incorporationUndetermined
        ? SC404_INCORPORATION_UNDETERMINED_HINT
        : documentVariableHint(key),
  }))

/** Motivo de bloqueo, en el orden exacto de la etapa anterior. */
export const resolveBlockedReason = (input: {
  formalized: boolean
  template: TemplateResolution
  analysisPresent: boolean
  missingCount: number
}): GenerationBlockedReason => {
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

/** Tipo documental para el que se prefijan TODAS las variables conocidas a cadena vacía. */
export const resolvePrefillDocumentType = (
  kind: GenerationDocumentKind
): "SC_4_04" | "PAYROLL_MOVEMENT" | null =>
  isSc404Kind(kind) ? "SC_4_04" : isPayrollMovementKind(kind) ? "PAYROLL_MOVEMENT" : null

/** Claves conocidas del registro central: las únicas variables que el motor sustituye. */
export const knownVariableKeys = (): string[] => DOCUMENT_VARIABLES.map((definition) => definition.key)

/**
 * Valores que se sustituyen en la plantilla.
 *
 * SC-4-04 (§26/§85): toda variable conocida del ámbito parte de "" y luego se sobrescribe con
 * los valores resueltos, de modo que los campos no aplicables al origen quedan visualmente
 * vacíos (nunca «null» ni marcador residual).
 */
export const buildRenderValues = (
  kind: GenerationDocumentKind,
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

/** Momento de una generación: `dd/mm/aaaa hh:mm`. */
export const formatGenerationMoment = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()} ${hours}:${minutes}`
}

/** Momento de un lote documental: `dd/mm/aaaa`. */
export const formatBatchMoment = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()}`
}
