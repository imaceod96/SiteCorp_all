import type { DocumentTypeCode } from "./document-variables"
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
  templateTypeCode === "EMPLOYMENT_CONTRACT_ADDENDUM"
    ? "ADDENDUM"
    : templateTypeCode === "SC_4_04"
      ? "SC_4_04"
      : templateTypeCode === "RESOLUTION"
        ? "RESOLUTION"
        : templateTypeCode === "PAYROLL_MOVEMENT"
          ? "PAYROLL_MOVEMENT"
          : "CONTRACT"

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
