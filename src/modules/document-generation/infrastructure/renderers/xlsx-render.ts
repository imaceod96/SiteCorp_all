/**
 * Motor de sustitución para plantillas XLSX (Excel).
 *
 * Trabaja SIEMPRE sobre una COPIA del XLSX configurado de la plantilla: nunca
 * modifica el archivo original. Recorre las celdas de cada hoja y sustituye los
 * marcadores `{{variable.key}}` por los valores resueltos.
 *
 * Se apoya en ExcelJS (ya utilizado por el resto de exportaciones del proyecto)
 * para CONSERVAR intacta toda la estructura visual del libro: hojas, celdas,
 * tamaños, anchos, altos, bordes, combinaciones de celdas, alineaciones, estilos,
 * formatos y textos fijos. Sólo cambia el texto de aquellas celdas que contienen
 * marcadores.
 */

import type { Cell, Row, Workbook, Worksheet } from "exceljs"

export interface XlsxRenderResult {
  bytes: Uint8Array
  /** Claves realmente sustituidas. */
  replacedKeys: string[]
  /** Número total de apariciones sustituidas. */
  replacedCount: number
  /** Marcadores presentes en el libro que NO existen en el registro. */
  unknownKeys: string[]
  /** Marcadores que quedaron sin resolver tras la sustitución. */
  leftoverKeys: string[]
  /** Hojas donde se encontraron marcadores. */
  parts: string[]
}

export const XLSX_PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g

/** Tipado mínimo del módulo ExcelJS usado por este motor (solo `Workbook`). */
type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

/** Carga diferida de ExcelJS (igual que el resto de exportaciones del proyecto). */
const loadExcelJS = async (): Promise<ExcelJSModule> => {
  const mod: ExcelJSModule = await import("exceljs")
  return mod?.default ?? mod
}

const toArrayBuffer = (input: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
  }
  return input
}

interface Detection {
  text: string
  unknownKeys: string[]
  replacedKeys: string[]
  replacedCount: number
}

/**
 * Sustituye todos los marcadores de un texto de celda.
 * Una celda puede ser `{{m.nom}}` o texto combinado como
 * `Trabajador: {{m.nom}} {{m.ap1}} {{m.ap2}}`.
 */
const substituteText = (
  original: string,
  values: Record<string, string>,
  knownKeys: Set<string>
): Detection => {
  const unknownKeys: string[] = []
  const replacedKeys: string[] = []
  let replacedCount = 0

  const text = original.replace(XLSX_PLACEHOLDER_PATTERN, (match, rawKey: string) => {
    const key = rawKey.trim()
    if (key === "") return match
    if (!knownKeys.has(key) || !(key in values)) {
      unknownKeys.push(key)
      return match
    }
    replacedKeys.push(key)
    replacedCount += 1
    return values[key]
  })

  return { text, unknownKeys, replacedKeys, replacedCount }
}

/** Recorre las celdas de un libro y aplica el reemplazo de marcadores. */
const renderWorkbook = (
  workbook: Workbook,
  values: Record<string, string>,
  knownKeys: Set<string>
): { replacedKeys: Set<string>; unknownKeys: Set<string>; leftoverKeys: Set<string>; replacedCount: number; parts: Set<string> } => {
  const replacedKeys = new Set<string>()
  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()
  const parts = new Set<string>()
  let replacedCount = 0

  workbook.eachSheet((worksheet: Worksheet) => {
    let sheetUsed = false

    worksheet.eachRow({ includeEmpty: false }, (row: Row) => {
      row.eachCell({ includeEmpty: false }, (cell: Cell) => {
        const value = cell.value
        if (typeof value !== "string") return
        if (!value.includes("{{")) return

        const detection = substituteText(value, values, knownKeys)
        detection.replacedKeys.forEach((key) => replacedKeys.add(key))
        detection.unknownKeys.forEach((key) => unknownKeys.add(key))
        replacedCount += detection.replacedCount

        if (detection.text !== value) {
          cell.value = detection.text
          sheetUsed = true
        }

        // Comprobación posterior (§31): cualquier marcador que quede sin resolver.
        XLSX_PLACEHOLDER_PATTERN.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = XLSX_PLACEHOLDER_PATTERN.exec(detection.text)) !== null) {
          const key = match[1].trim()
          if (key !== "") {
            leftoverKeys.add(key)
            sheetUsed = true
          }
        }
      })
    })

    if (sheetUsed) parts.add(worksheet.name)
  })

  return { replacedKeys, unknownKeys, leftoverKeys, replacedCount, parts }
}

/** Escanea un XLSX y devuelve los marcadores encontrados por hoja. */
export const scanXlsxPlaceholders = async (
  input: Uint8Array | ArrayBuffer
): Promise<{ keys: string[]; parts: string[] }> => {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(toArrayBuffer(input))

  const keys = new Set<string>()
  const parts: string[] = []

  workbook.eachSheet((worksheet: Worksheet) => {
    let found = false
    worksheet.eachRow({ includeEmpty: false }, (row: Row) => {
      row.eachCell({ includeEmpty: false }, (cell: Cell) => {
        const value = cell.value
        if (typeof value !== "string") return
        XLSX_PLACEHOLDER_PATTERN.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = XLSX_PLACEHOLDER_PATTERN.exec(value)) !== null) {
          const key = match[1].trim()
          if (key !== "") {
            keys.add(key)
            found = true
          }
        }
      })
    })
    if (found) parts.push(worksheet.name)
  })

  return { keys: [...keys], parts }
}

/**
 * Renderiza un XLSX sustituyendo los marcadores por los valores indicados.
 * Nunca escribe sobre el archivo de entrada: devuelve un libro nuevo.
 */
export const renderXlsxTemplate = async (
  input: Uint8Array | ArrayBuffer,
  values: Record<string, string>,
  knownKeys: Iterable<string>
): Promise<XlsxRenderResult> => {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(toArrayBuffer(input))

  const known = new Set(knownKeys)
  const outcome = renderWorkbook(workbook, values, known)

  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(buffer as ArrayBuffer)

  return {
    bytes,
    replacedKeys: [...outcome.replacedKeys],
    replacedCount: outcome.replacedCount,
    unknownKeys: [...outcome.unknownKeys],
    leftoverKeys: [...outcome.leftoverKeys],
    parts: [...outcome.parts],
  }
}
