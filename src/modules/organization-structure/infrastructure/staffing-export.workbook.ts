import { toRomanNumeral } from "@/utils/roman-numerals"
import type { PaperSize, Workbook } from "exceljs"
import type { StaffingExportRow, StaffingExportMeta } from "../domain/entities"
import { ANEXO14_HEADERS } from "../domain/rules"
import { buildAnexo14BFileName, formatService } from "../domain/formatters"

const COLUMN_WIDTHS = [5, 34, 18, 30, 7, 15, 18, 11, 13, 12, 11, 16, 17, 15, 11]

/** Índices (1-based) de las columnas monetarias. */
const MONEY_COLUMNS = [9, 10, 11, 12, 13, 15]

const CI_COLUMN = 6
const FIRST_SALARY_COLUMN = 9
const LAST_COLUMN = ANEXO14_HEADERS.length

const HEADER_ROW_TOP = 6
const HEADER_ROW_BOTTOM = 7
const NUMBERING_ROW = 8
const FIRST_DATA_ROW = 9

const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
}

/** Colores sobrios de documento administrativo. */
const SALARY_HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFDCE6F1" },
}
const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F6FA" } }
const AREA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEAEEF3" } }

const ROMAN_SAFE = (sequence: number | null): string | null => {
  if (sequence === null || sequence === undefined) return null
  try {
    return toRomanNumeral(sequence)
  } catch {
    return String(sequence)
  }
}

interface AreaGroup {
  areaLabel: string
  rows: StaffingExportRow[]
}

/** Agrupa por Área respetando el orden organizativo devuelto por el backend. */
function groupByArea(rows: StaffingExportRow[]): AreaGroup[] {
  const groups: AreaGroup[] = []
  rows.forEach((row) => {
    const label = (row.area_name || "").trim() || "SIN ÁREA ASIGNADA"
    let group = groups.find((candidate) => candidate.areaLabel === label)
    if (!group) {
      group = { areaLabel: label, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  })
  return groups
}

/**
 * TOTAL salarial estructural del registro: suma ÚNICAMENTE los conceptos
 * monetarios realmente disponibles (Escala + CLA + categoría académica).
 * No suma «Años de Servicios» (es tiempo, no importe) y no inventa conceptos:
 * si ningún concepto tiene valor, la celda queda vacía.
 */
function computeTotal(row: StaffingExportRow): number | null {
  const components = [row.salary, row.cla_amount, row.academic_amount].filter(
    (value): value is number => value !== null && value !== undefined
  )
  if (components.length === 0) return null
  return Math.round(components.reduce((sum, value) => sum + value, 0) * 100) / 100
}

/** Tipado mínimo del módulo ExcelJS usado por esta exportación (solo `Workbook`). */
type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

/**
 * Genera el .xlsx del Anexo14B (hoja «Anexo14B»).
 * `exceljs` se importa dinámicamente, igual que en el resto de exportaciones.
 */
export async function buildStaffingWorkbookBlob(
  rows: StaffingExportRow[],
  meta: StaffingExportMeta
): Promise<Blob> {
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  workbook.created = meta.generatedAt

  const sheet = workbook.addWorksheet("Anexo14B", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9 as PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: `${HEADER_ROW_TOP}:${NUMBERING_ROW}`,
    },
  })

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }))

  // ---------- Cabecera del documento ----------
  sheet.mergeCells(1, 1, 1, 13)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = "REGISTRO DE TRABAJADORES"
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { vertical: "middle" }

  sheet.mergeCells(1, 14, 1, LAST_COLUMN)
  const annexCell = sheet.getCell(1, 14)
  annexCell.value = "ANEXO 14B"
  annexCell.font = { bold: true, size: 14 }
  annexCell.alignment = { vertical: "middle", horizontal: "right" }
  sheet.getRow(1).height = 22

  sheet.mergeCells(2, 1, 2, LAST_COLUMN)
  const subtitleCell = sheet.getCell(2, 1)
  subtitleCell.value = "a) Registro de principales datos"
  subtitleCell.font = { bold: true, size: 11, italic: true }

  sheet.getCell(3, 1).value = "Entidad:"
  sheet.getCell(3, 1).font = { bold: true }
  sheet.mergeCells(3, 2, 3, LAST_COLUMN)
  sheet.getCell(3, 2).value = meta.entityName || "—"

  sheet.getCell(4, 1).value = "Fecha:"
  sheet.getCell(4, 1).font = { bold: true }
  sheet.mergeCells(4, 2, 4, LAST_COLUMN)
  sheet.getCell(4, 2).value = meta.generatedAt.toLocaleDateString("es-CU")

  // ---------- Cabecera multinivel (SALARIO sobre las columnas 9–15) ----------
  for (let column = 1; column < FIRST_SALARY_COLUMN; column += 1) {
    sheet.mergeCells(HEADER_ROW_TOP, column, HEADER_ROW_BOTTOM, column)
    const cell = sheet.getCell(HEADER_ROW_TOP, column)
    cell.value = ANEXO14_HEADERS[column - 1]
    cell.font = { bold: true }
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    cell.fill = HEADER_FILL
  }

  sheet.mergeCells(HEADER_ROW_TOP, FIRST_SALARY_COLUMN, HEADER_ROW_TOP, LAST_COLUMN)
  const salaryCell = sheet.getCell(HEADER_ROW_TOP, FIRST_SALARY_COLUMN)
  salaryCell.value = "SALARIO"
  salaryCell.font = { bold: true }
  salaryCell.alignment = { vertical: "middle", horizontal: "center" }
  salaryCell.fill = SALARY_HEADER_FILL

  for (let column = FIRST_SALARY_COLUMN; column <= LAST_COLUMN; column += 1) {
    const cell = sheet.getCell(HEADER_ROW_BOTTOM, column)
    cell.value = ANEXO14_HEADERS[column - 1]
    cell.font = { bold: true }
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    cell.fill = SALARY_HEADER_FILL
  }

  for (let row = HEADER_ROW_TOP; row <= HEADER_ROW_BOTTOM; row += 1) {
    for (let column = 1; column <= LAST_COLUMN; column += 1) {
      sheet.getCell(row, column).border = THIN_BORDER
    }
  }
  sheet.getRow(HEADER_ROW_TOP).height = 20
  sheet.getRow(HEADER_ROW_BOTTOM).height = 30

  // ---------- Fila de numeración (igual que el modelo oficial) ----------
  for (let column = 1; column <= LAST_COLUMN; column += 1) {
    const cell = sheet.getCell(NUMBERING_ROW, column)
    cell.value = column
    cell.font = { bold: false, size: 9, color: { argb: "FF6B7280" } }
    cell.alignment = { horizontal: "center" }
    cell.border = THIN_BORDER
  }

  // ---------- Área → capacidades del Puesto ----------
  const groups = groupByArea(rows)
  let ordinal = 0
  let currentRow = FIRST_DATA_ROW

  groups.forEach((group) => {
    const areaRow = sheet.getRow(currentRow)
    sheet.mergeCells(currentRow, 1, currentRow, LAST_COLUMN)
    const areaCell = sheet.getCell(currentRow, 1)
    areaCell.value = group.areaLabel.toLocaleUpperCase("es-CU")
    areaCell.font = { bold: true }
    areaCell.fill = AREA_FILL
    areaCell.alignment = { vertical: "middle" }
    for (let column = 1; column <= LAST_COLUMN; column += 1) {
      const cell = sheet.getCell(currentRow, column)
      cell.fill = AREA_FILL
      cell.border = THIN_BORDER
    }
    areaRow.height = 18
    currentRow += 1

    group.rows.forEach((row) => {
      ordinal += 1
      const rowValues = [
        ordinal,
        // Columna 2: «Órgano y Cargos» = Cargo/Puesto real (el Área ya es fila separadora).
        row.position_name || row.job_name || "—",
        row.occupational_category || null,
        row.worker_name || null,
        row.gender_code || null,
        row.identification || null,
        row.preparation_level || null,
        ROMAN_SAFE(row.salary_group_sequence),
        computeTotal(row),
        row.salary,
        row.cla_amount,
        null, // Turnos Nocturnos y Mixtos: sin fuente estructural definida todavía.
        row.academic_amount,
        formatService(row.service_start, meta.generatedAt),
        null, // Otros: pendiente de definición de conceptos.
      ]

      const excelRow = sheet.getRow(currentRow)
      rowValues.forEach((value, index) => {
        excelRow.getCell(index + 1).value = value === undefined ? null : value
      })

      // Carnet de identidad SIEMPRE como texto: conserva ceros iniciales y dígitos.
      const ciCell = excelRow.getCell(CI_COLUMN)
      ciCell.numFmt = "@"
      if (row.identification !== null && row.identification !== undefined) {
        ciCell.value = String(row.identification)
      }

      MONEY_COLUMNS.forEach((column) => {
        const cell = excelRow.getCell(column)
        if (cell.value !== null && cell.value !== undefined) {
          cell.numFmt = "#,##0.00"
        }
        cell.alignment = { vertical: "middle", horizontal: "right" }
      })

      excelRow.getCell(1).alignment = { vertical: "middle", horizontal: "center" }
      excelRow.getCell(1).numFmt = "0"
      excelRow.getCell(5).alignment = { vertical: "middle", horizontal: "center" }
      excelRow.getCell(6).alignment = { vertical: "middle", horizontal: "center" }
      excelRow.getCell(8).alignment = { vertical: "middle", horizontal: "center" }
      excelRow.getCell(2).alignment = { vertical: "middle", wrapText: true }
      excelRow.getCell(3).alignment = { vertical: "middle", wrapText: true }
      excelRow.getCell(4).alignment = { vertical: "middle", wrapText: true }
      excelRow.getCell(7).alignment = { vertical: "middle", wrapText: true }
      excelRow.getCell(14).alignment = { vertical: "middle", horizontal: "center" }

      for (let column = 1; column <= LAST_COLUMN; column += 1) {
        excelRow.getCell(column).border = THIN_BORDER
      }

      currentRow += 1
    })
  })

  // ---------- Impresión ----------
  sheet.headerFooter = {
    oddHeader: '&L&"Calibri,Bold"REGISTRO DE TRABAJADORES - ANEXO 14B&R&"Calibri"&A',
    oddFooter: "&C&P de &N",
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

/** Dispara la descarga del Anexo14B generado en el navegador. */
export function saveStaffingExcelBlob(blob: Blob, entityName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = buildAnexo14BFileName(entityName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
