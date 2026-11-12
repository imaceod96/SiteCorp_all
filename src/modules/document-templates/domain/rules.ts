import {
  documentVariableByKey,
  type DocumentTypeCode,
} from "./document-variables"
import {
  DOCX_MIME,
  DOC_MIME,
  MAX_TEMPLATE_FILE_BYTES,
  UNSUPPORTED_WORD_FILE_MESSAGE,
  WORD_ACCEPT,
  XLSX_MIME,
  type DocumentTemplateAnalysis,
  type DocumentTemplateVersion,
  type TemplateFileInspection,
  type TemplateValidation,
  type WordDocumentFormat,
} from "./entities"

/**
 * Plantillas documentales — Reglas PURAS del dominio.
 *
 * Formatos admitidos, detección del formato real de un documento Word, etiquetas legibles
 * y periodos de vigencia. Ninguna de estas funciones consulta Supabase, Storage ni la red:
 * son criterios que se pueden probar sin base de datos.
 *
 * Dos decisiones NO se toman aquí porque son del backend: qué variables son válidas y si
 * una versión puede activarse. La inspección local es un informe RÁPIDO para no subir un
 * archivo inútil; nunca sustituye la verificación del analizador central.
 */

/**
 * Tipos documentales cuya plantilla oficial es una hoja de cálculo Excel (`.xlsx`) en
 * lugar de un documento Word. Sólo Movimiento de Nómina.
 */
export const TEMPLATE_TYPE_USES_XLSX = (typeCode: string | null | undefined): boolean =>
  typeCode === "PAYROLL_MOVEMENT"

/** Atributo `accept` para plantillas según el tipo documental. */
export const templateAcceptForType = (typeCode: string | null | undefined): string =>
  TEMPLATE_TYPE_USES_XLSX(typeCode) ? `.xlsx,${XLSX_MIME}` : WORD_ACCEPT

/** Código de documento del registro central al que pertenece cada tipo de plantilla. */
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
 * Ejemplos de marcadores del catálogo oficial según el tipo de plantilla (G2).
 * Muestra siempre las variables cortas visibles del catálogo (`c.*`, `a.*`, `s.*`, `r.*`, `m.*`).
 */
export const templatePlaceholderExamplesForType = (
  templateTypeCode: string | null | undefined
): { primary: string; secondary: string; beforeText: string; afterPrefix: string; afterMid: string } => {
  const docType = documentTypeCodeForTemplateType(templateTypeCode || "CONTRACT")
  switch (docType) {
    case "ADDENDUM":
      return {
        primary: "{{a.nom}}",
        secondary: "{{a.ci}}",
        beforeText: "D. Juan Pérez García, trabajador con CI 90010112345",
        afterPrefix: "D. ",
        afterMid: ", trabajador con CI ",
      }
    case "SC_4_04":
      return {
        primary: "{{s.nom}}",
        secondary: "{{s.ci}}",
        beforeText: "Juan, trabajador con CI 90010112345",
        afterPrefix: "",
        afterMid: ", trabajador con CI ",
      }
    case "RESOLUTION":
      return {
        primary: "{{r.nom}}",
        secondary: "{{r.car}}",
        beforeText: "D. Juan Pérez García, designado en el cargo de Especialista Principal",
        afterPrefix: "D. ",
        afterMid: ", designado en el cargo de ",
      }
    case "PAYROLL_MOVEMENT":
      return {
        primary: "{{m.nom}}",
        secondary: "{{m.exp}}",
        beforeText: "Juan, expediente laboral 90010112345",
        afterPrefix: "",
        afterMid: ", expediente laboral ",
      }
    case "CONTRACT":
    default:
      return {
        primary: "{{c.nom}}",
        secondary: "{{c.ci}}",
        beforeText: "D. Juan Pérez García, trabajador con CI 90010112345",
        afterPrefix: "D. ",
        afterMid: ", trabajador con CI ",
      }
  }
}

/**
 * Reconcilia el análisis devuelto por el backend con el catálogo oficial de dominio
 * (`DOCUMENT_VARIABLES`), garantizando una única fuente de verdad (C2/G1) incluso si la
 * tabla `public.document_variables` remota aún no ha ejecutado la última migración SQL.
 */
export const reconcileTemplateAnalysisWithCatalog = (
  analysis: DocumentTemplateAnalysis,
  templateTypeCode?: string | null
): DocumentTemplateAnalysis => {
  const docType = documentTypeCodeForTemplateType(templateTypeCode || "CONTRACT")

  const recognizedMap = new Map<string, DocumentTemplateAnalysis["recognized"][number]>()
  for (const item of analysis.recognized || []) {
    recognizedMap.set(item.key, { ...item })
  }

  const remainingUnknown: DocumentTemplateAnalysis["unknown_variables"] = []
  const remainingIncompatible: DocumentTemplateAnalysis["incompatible_variables"] = [
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

  // Re-evaluar también `incompatible_variables` por si una variable como `worker.full_name`
  // ahora es compatible con el tipo documental (G1).
  const finalIncompatible: DocumentTemplateAnalysis["incompatible_variables"] = []
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

/**
 * Reconcilia el resultado de `validate_document_template_version` con el catálogo oficial
 * de dominio (`DOCUMENT_VARIABLES`), actualizando contadores y checks estructurales (C2/G1).
 */
export const reconcileTemplateValidationWithCatalog = (
  validation: TemplateValidation
): TemplateValidation => {
  const docType = documentTypeCodeForTemplateType(validation.document_type_code || "CONTRACT")
  const reconciledAnalysis = validation.analysis
    ? reconcileTemplateAnalysisWithCatalog(validation.analysis, validation.document_type_code)
    : null

  const recognizedMap = new Map<string, TemplateValidation["recognized"][number]>()
  for (const item of reconciledAnalysis?.recognized || validation.recognized || []) {
    recognizedMap.set(item.key, { ...item })
  }

  const remainingUnknown: TemplateValidation["unknown_variables"] = []
  const remainingIncompatible: TemplateValidation["incompatible_variables"] = []

  const sourceUnknown =
    reconciledAnalysis?.unknown_variables ?? validation.unknown_variables ?? []
  for (const item of sourceUnknown) {
    const def = documentVariableByKey(item.key)
    if (!def) {
      remainingUnknown.push(item)
    } else if (def.documentTypes.includes(docType)) {
      recognizedMap.set(item.key, {
        key: item.key,
        count: item.count,
        split_runs: 0,
      })
    } else {
      remainingIncompatible.push({
        key: item.key,
        label: def.label,
        count: item.count,
      })
    }
  }

  const sourceIncompatible =
    reconciledAnalysis?.incompatible_variables ?? validation.incompatible_variables ?? []
  for (const inc of sourceIncompatible) {
    const def = documentVariableByKey(inc.key)
    if (def && def.documentTypes.includes(docType)) {
      recognizedMap.set(inc.key, {
        key: inc.key,
        count: inc.count,
        split_runs: 0,
      })
    } else if (!remainingIncompatible.some((item) => item.key === inc.key)) {
      remainingIncompatible.push(inc)
    }
  }

  const recognized = Array.from(recognizedMap.values())
  const requiredVariables = recognized.map((item) => item.key)
  const variablesValid = recognized.length
  const variablesUnknown = remainingUnknown.length
  const variablesIncompatible = remainingIncompatible.length
  const variablesFound = variablesValid + variablesUnknown + variablesIncompatible

  const checks: TemplateValidation["checks"] = {
    ...validation.checks,
    no_unknown_variables: validation.checks.analysis_present ? variablesUnknown === 0 : false,
    no_incompatible_variables: validation.checks.analysis_present
      ? variablesIncompatible === 0
      : false,
    has_placeholders: variablesValid > 0,
  }

  const ready =
    checks.original_file_present &&
    checks.configured_file_present &&
    checks.configured_format_analyzable &&
    checks.analysis_present &&
    checks.analysis_matches_configured &&
    checks.valid_docx &&
    checks.no_unknown_variables &&
    checks.no_incompatible_variables &&
    checks.no_malformed_placeholders &&
    checks.effective_dates_coherent &&
    checks.no_simultaneous_active

  const filteredWarnings = (validation.warnings || []).filter((w) => {
    if (variablesValid > 0 && w.includes("no contiene marcadores dinámicos")) {
      return false
    }
    return true
  })

  const serverReportedUnrecognized =
    validation.checks.analysis_present &&
    (!validation.checks.no_unknown_variables || !validation.checks.no_incompatible_variables)
  const serverCatalogOutOfSync = Boolean(
    serverReportedUnrecognized && checks.no_unknown_variables && checks.no_incompatible_variables
  )

  return {
    ...validation,
    analysis: reconciledAnalysis,
    variables_found: variablesFound,
    variables_valid: variablesValid,
    variables_unknown: variablesUnknown,
    variables_incompatible: variablesIncompatible,
    required_variables: requiredVariables,
    recognized,
    unknown_variables: remainingUnknown,
    incompatible_variables: remainingIncompatible,
    warnings: filteredWarnings,
    checks,
    ready,
    server_catalog_out_of_sync: serverCatalogOutOfSync,
  }
}

/** Firma OLE/CFB de los documentos Word 97-2003 (`.doc`). */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

const startsWithBytes = (bytes: Uint8Array, sequence: number[], offset = 0): boolean =>
  sequence.every((byte, index) => bytes[offset + index] === byte)

/**
 * Detección centralizada del formato real de un documento Word: usa la extensión como
 * pista, pero decide por firma/estructura, de modo que un PDF renombrado a `.doc`/`.docx`
 * se rechaza.
 */
export const detectWordDocumentFormat = async (file: File): Promise<WordDocumentFormat> =>
  (await inspectTemplateFile(file)).format

/** Verificación previa en cliente: informe rápido, sin sustituir al backend. */
export const inspectTemplateFile = async (file: File): Promise<TemplateFileInspection> => {
  const name = file.name.toLowerCase()
  const declaredExtension = name.includes(".") ? name.split(".").pop() ?? "" : ""
  const extensionHint =
    declaredExtension === "doc" || declaredExtension === "docx" || declaredExtension === "xlsx"
      ? declaredExtension
      : ""

  if (file.size === 0) {
    return { format: "UNSUPPORTED", extension: extensionHint, mimeType: "", problem: "El archivo está vacío." }
  }
  if (file.size > MAX_TEMPLATE_FILE_BYTES) {
    return {
      format: "UNSUPPORTED",
      extension: extensionHint,
      mimeType: "",
      problem: "El archivo supera el límite permitido de 10 MB.",
    }
  }

  const bytes = new Uint8Array(await file.slice(0, 16384).arrayBuffer())

  if (startsWithBytes(bytes, OLE2_SIGNATURE)) {
    // Contenedor OLE/CFB: es la familia Word 97-2003 (.doc).
    return { format: "DOC", extension: "doc", mimeType: DOC_MIME, problem: null }
  }

  if (startsWithBytes(bytes, [0x50, 0x4b])) {
    // Paquete OOXML (ZIP): Excel .xlsx o Word .docx. La pista fiable es la
    // extensión declarada; el analizador central confirma el formato real.
    if (declaredExtension === "xlsx") {
      return { format: "XLSX", extension: "xlsx", mimeType: XLSX_MIME, problem: null }
    }
    return { format: "DOCX", extension: "docx", mimeType: DOCX_MIME, problem: null }
  }

  return {
    format: "UNSUPPORTED",
    extension: extensionHint,
    mimeType: "",
    problem: UNSUPPORTED_WORD_FILE_MESSAGE,
  }
}

/**
 * Inspección usada por la interfaz para validar antes de subir.
 *
 * Un `.doc` se admite y se conserva: el aviso de «no analizable» lo emite el backend tras
 * identificarlo de verdad.
 */
export const describeTemplateFileProblem = async (file: File): Promise<string | null> =>
  (await inspectTemplateFile(file)).problem

/** Etiqueta legible del formato real detectado del archivo. */
export const templateFileFormatLabel = (format: string | null | undefined): string => {
  if (format === "DOC") return "Word 97-2003 (.doc)"
  if (format === "DOCX") return "Word (.docx)"
  if (format === "XLSX") return "Excel (.xlsx)"
  return "Formato no identificado"
}

export const formatTemplateFileSize = (bytes: number | null | undefined): string => {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Variables OBLIGATORIAS de una versión, tal como las determinó el analizador central.
 *
 * Ningún consumidor interpreta el contenido del documento por su cuenta: se lee el análisis
 * ya registrado. Una versión sin análisis no exige nada (la decisión de bloqueo es del motor
 * de generación documental, no de esta regla).
 */
export const requiredVariableKeys = (
  analysis: Pick<DocumentTemplateAnalysis, "required_variables"> | null | undefined
): string[] => {
  const required = analysis?.required_variables
  return Array.isArray(required) ? required.map((value) => String(value)) : []
}

/** Vigencia de una versión tal como se muestra: borrador, vigente o periodo cerrado. */
export const templateVersionPeriodLabel = (
  version: Pick<DocumentTemplateVersion, "effective_from" | "effective_to" | "status">
): string => {
  if (version.status === "DRAFT") return "Sin vigencia (borrador)"
  if (!version.effective_from) return "Vigente sin fecha de inicio"
  const from = version.effective_from.split("-").reverse().join("/")
  if (!version.effective_to) return `Desde ${from} · vigente`
  const to = version.effective_to.split("-").reverse().join("/")
  return `Del ${from} al ${to}`
}
