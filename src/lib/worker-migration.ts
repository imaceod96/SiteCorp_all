import type { MigrationRow } from "@/domains/people"
import type { Workbook, Cell, Row } from "exceljs"

/**
 * Plantilla y lectura del Excel de la Carga inicial de trabajadores.
 *
 * Este módulo es SOLO el formato del archivo: construye la plantilla oficial, la descarga y
 * lee el .xlsx que sube el usuario. El formato de las columnas NO cambia.
 *
 * La resolución de catálogos, la validación por fila, el historial de lotes y las RPC de la
 * migración son casos de uso del dominio Personas (`@/domains/people`): las filas que
 * produce esta lectura son las mismas que consumen esos casos de uso.
 */

/** Tipado mínimo del módulo ExcelJS usado por esta exportación (solo `Workbook`). */
type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

export type { MigrationRow, MigrationPreviewRow } from "@/domains/people"

// Plantilla simplificada de Carga inicial. No incluye "Fecha nacimiento"
// (se deriva de la identificación) ni "Código Puesto" (la carga inicial no
// asigna puestos; la vinculación se hace después desde Trabajadores).
export const MIGRATION_HEADERS = [
  "Identificación", "Nombre", "Primer apellido", "Segundo apellido",
  "Sexo", "Color de piel", "Estado civil", "Dirección",
  "Fecha de incorporación", "Saldo inicial vacaciones", "Fecha corte vacaciones",
  "Teléfono", "Correo", "Provincia", "Municipio",
  "Nivel educacional", "Especialidad", "Profesión u oficio",
  "Tiene licencia", "Categorías licencia",
] as const

const excelDate = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return date.toISOString().slice(0, 10)
  }
  const text = String(value ?? "").trim()
  if (!text) return ""
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return text
}

const excelText = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    if ("text" in value) return String((value as { text: unknown }).text ?? "").trim()
    if ("result" in value) return excelText((value as { result: unknown }).result)
    return ""
  }
  return String(value).trim()
}

const decimalText = (value: unknown): string => {
  const text = excelText(value).replace(/\s/g, "")
  if (!text) return ""
  if (text.includes(",") && text.includes(".")) {
    return text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "")
  }
  return text.replace(",", ".")
}

export async function buildWorkerMigrationTemplate(): Promise<Blob> {
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  const sheet = workbook.addWorksheet("Trabajadores", { views: [{ state: "frozen", ySplit: 1 }] })
  sheet.columns = MIGRATION_HEADERS.map((header, index) => ({ header, key: `c${index}`, width: index < 4 ? 22 : 20 }))
  sheet.getColumn(1).numFmt = "@"
  sheet.getColumn(9).numFmt = "@"
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A67" } }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: MIGRATION_HEADERS.length } }
  const instructions = workbook.addWorksheet("Instrucciones")
  instructions.columns = [{ width: 34 }, { width: 110 }]
  instructions.addRows([
    ["Campo", "Instrucciones"],
    ["Identificación", "Obligatoria. Se conserva como texto; no elimine ceros ni cambie su formato."],
    ["Fecha de nacimiento", "No se solicita: SiteCorp la deriva automáticamente de la identificación cuando es posible. Si no puede derivarse, el trabajador queda con información pendiente de completar."],
    ["Fecha de incorporación", "Obligatoria. Indique la fecha real en la que el trabajador comenzó a trabajar en la entidad. SiteCorp utilizará esta fecha para calcular su antigüedad. Use DD/MM/AAAA o una fecha real de Excel. No puede ser futura."],
    ["Fechas", "Use DD/MM/YYYY o una fecha real de Excel."],
    ["Sexo / Estado civil / Color / Nivel", "Use el nombre del catálogo existente en la entidad/aplicación."],
    ["Tiene licencia", "Sí/No. Indique además las categorías separadas por coma cuando corresponda."],
    ["Puesto", "La carga inicial no asigna puestos: los trabajadores quedan pendientes de vinculación y se asignan después desde Trabajadores."],
    ["Saldo y corte de vacaciones", "Ambos son opcionales. Un saldo vacío queda desconocido; no se asume cero."],
    ["Flujo", "Complete la hoja Trabajadores, pulse Validar para revisar el Preview y luego Iniciar carga para crear los trabajadores."],
  ])
  instructions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  instructions.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A67" } }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

export function downloadWorkerMigrationTemplate(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "Plantilla_Carga_Inicial_Trabajadores.xlsx"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Clasificación de los errores de estructura del archivo de plantilla.
 * Permite a la UI mostrar un mensaje accionable sin exponer detalles internos.
 * No cambia ninguna regla de validación: solo expone de forma tipada el error
 * que el parser ya detectaba.
 */
export type WorkerMigrationFileErrorCode = "MISSING_COLUMNS" | "SHEET_MISSING" | "INVALID_FILE"

export class WorkerMigrationTemplateError extends Error {
  readonly code: WorkerMigrationFileErrorCode
  readonly missingColumns: string[]

  constructor(code: WorkerMigrationFileErrorCode, message: string, missingColumns: string[] = []) {
    super(message)
    this.name = "WorkerMigrationTemplateError"
    this.code = code
    this.missingColumns = missingColumns
  }
}

export async function readWorkerMigrationExcel(file: File): Promise<MigrationRow[]> {
  if (file.size > 10 * 1024 * 1024) throw new WorkerMigrationTemplateError("INVALID_FILE", "El archivo supera el límite de 10 MB.")
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new WorkerMigrationTemplateError("INVALID_FILE", "Seleccione un archivo .xlsx válido.")
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.getWorksheet("Trabajadores") || workbook.worksheets[0]
  if (!sheet) throw new WorkerMigrationTemplateError("SHEET_MISSING", "El archivo no contiene ninguna hoja de trabajo.")
  const indexHeaders = (rowNumber: number) => {
    const map = new Map<string, number>()
    sheet.getRow(rowNumber).eachCell((cell: Cell, column: number) => map.set(excelText(cell.value).toLowerCase(), column))
    return map
  }
  // Busca la fila de encabezados en las primeras filas (por si hay títulos previos).
  let headerRow = 1
  let headerIndex = indexHeaders(1)
  for (let candidate = 1; candidate <= Math.min(5, sheet.rowCount); candidate += 1) {
    const map = indexHeaders(candidate)
    if (map.has("identificación")) {
      headerRow = candidate
      headerIndex = map
      break
    }
  }
  const required = ["identificación", "nombre", "primer apellido", "fecha de incorporación"]
  const missing = required.filter((header) => !headerIndex.has(header))
  if (missing.length) {
    throw new WorkerMigrationTemplateError(
      "MISSING_COLUMNS",
      `Faltan columnas requeridas: ${missing.join(", ")}.`,
      missing,
    )
  }
  // Las columnas ausentes en el archivo NO deben romper la lectura. La plantilla
  // oficial omite "Fecha nacimiento" (se deriva de la identificación) y
  // "Código Puesto" (la carga inicial no vincula puestos). Nunca se debe pedir a
  // exceljs una columna inexistente: getCell(0) lanza una excepción.
  const get = (row: Row, header: string): unknown => {
    const column = headerIndex.get(header.toLowerCase())
    return column ? row.getCell(column).value : undefined
  }
  const rows: MigrationRow[] = []
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const nonEmpty = Array.isArray(row.values)
      ? row.values.some((value: unknown) => excelText(value) !== "")
      : false
    if (!nonEmpty) continue
    const licensesText = excelText(get(row, "Categorías licencia"))
    const licenses = licensesText.split(/[;,]/).map((value) => value.trim()).filter(Boolean)
    const hasLicense = excelText(get(row, "Tiene licencia")).toLowerCase()
    rows.push({
      identification: excelText(get(row, "Identificación")),
      first_name: excelText(get(row, "Nombre")),
      first_surname: excelText(get(row, "Primer apellido")),
      second_surname: excelText(get(row, "Segundo apellido")),
      birth_date: excelDate(get(row, "Fecha nacimiento")),
      gender_id: excelText(get(row, "Sexo")),
      marital_status_id: excelText(get(row, "Estado civil")),
      skin_color_id: excelText(get(row, "Color de piel")),
      phone: excelText(get(row, "Teléfono")),
      email: excelText(get(row, "Correo")),
      address: excelText(get(row, "Dirección")),
      province: excelText(get(row, "Provincia")),
      municipality: excelText(get(row, "Municipio")),
      employment_start_date: excelDate(get(row, "Fecha de incorporación")),
      education_level_id: excelText(get(row, "Nivel educacional")),
      specialty: excelText(get(row, "Especialidad")),
      profession_or_trade: excelText(get(row, "Profesión u oficio")),
      driving_license_category_ids: hasLicense === "no" ? [] : licenses,
      position_code: excelText(get(row, "Código Puesto")),
      initial_vacation_balance: decimalText(get(row, "Saldo inicial vacaciones")),
      vacation_cutoff_date: excelDate(get(row, "Fecha corte vacaciones")),
    })
  }
  if (!rows.length) throw new Error("No se encontraron filas de trabajadores para validar.")
  return rows
}
