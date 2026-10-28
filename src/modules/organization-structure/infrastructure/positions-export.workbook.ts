import { toRomanNumeral } from "@/utils/roman-numerals"
import type { Workbook } from "exceljs"
import type { Anexo14Row, Anexo14Meta } from "../domain/entities"
import {
  ANEXO_14_HEADERS,
  NO_CATEGORY_VALUE,
  NOT_CONFIGURED_VALUE,
} from "../domain/rules"

const COLUMN_WIDTHS = [34, 24, 14, 24, 14]

const ROMAN_SAFE = (sequence: number | null): string | null => {
  if (sequence === null || sequence === undefined) return null
  try {
    return toRomanNumeral(sequence)
  } catch {
    return String(sequence)
  }
}

const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
}

const AREA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF4FA" } }
const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF7F9FC" } }

/** Tipado mínimo del módulo ExcelJS usado por esta exportación (solo `Workbook`). */
type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

/**
 * Genera el .xlsx del Anexo 14 (hoja «Anexo 14»), agrupado por Área.
 * `exceljs` se importa dinámicamente, igual que en el resto de exportaciones.
 */
export async function buildAnexo14WorkbookBlob(
  rows: Anexo14Row[],
  meta: Anexo14Meta
): Promise<Blob> {
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  workbook.created = meta.generatedAt

  const sheet = workbook.addWorksheet("Anexo 14", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 0 }],
  })

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }))

  // ---------- Cabecera institucional ----------
  const titleRow = sheet.addRow(["REGISTRO DE TRABAJADORES"])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  sheet.mergeCells(titleRow.number, 1, titleRow.number, ANEXO_14_HEADERS.length)

  const subtitleRow = sheet.addRow(["ANEXO 14"])
  subtitleRow.getCell(1).font = { bold: true, size: 12 }
  sheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, ANEXO_14_HEADERS.length)

  const entityRow = sheet.addRow(["Entidad:", meta.entityName || "—"])
  entityRow.getCell(1).font = { bold: true }
  sheet.mergeCells(entityRow.number, 2, entityRow.number, ANEXO_14_HEADERS.length)

  const dateRow = sheet.addRow([
    "Fecha de generación:",
    meta.generatedAt.toLocaleDateString("es-CU"),
  ])
  dateRow.getCell(1).font = { bold: true }
  sheet.mergeCells(dateRow.number, 2, dateRow.number, ANEXO_14_HEADERS.length)

  sheet.addRow([])

  // ---------- Área → Puestos ----------
  const groups = groupRowsByArea(rows)

  groups.forEach((group) => {
    const areaRow = sheet.addRow([
      `ÁREA: ${group.areaLabel}${group.areaCode ? ` (${group.areaCode})` : ""}`,
    ])
    const areaCell = areaRow.getCell(1)
    areaCell.font = { bold: true }
    areaCell.fill = AREA_FILL
    areaCell.alignment = { vertical: "middle" }
    areaCell.border = THIN_BORDER
    sheet.mergeCells(areaRow.number, 1, areaRow.number, ANEXO_14_HEADERS.length)
    for (let column = 1; column <= ANEXO_14_HEADERS.length; column += 1) {
      areaRow.getCell(column).fill = AREA_FILL
      areaRow.getCell(column).border = THIN_BORDER
    }

    const headerRow = sheet.addRow([...ANEXO_14_HEADERS])
    headerRow.font = { bold: true }
    headerRow.height = 18
    for (let column = 1; column <= ANEXO_14_HEADERS.length; column += 1) {
      const cell = headerRow.getCell(column)
      cell.fill = HEADER_FILL
      cell.border = THIN_BORDER
      cell.alignment = { vertical: "middle", wrapText: true }
    }

    group.rows.forEach((row) => {
      const dataRow = sheet.addRow([
        row.position_name || "—",
        row.occupational_category || NO_CATEGORY_VALUE,
        row.authorized_quantity,
        row.preparation_levels || NOT_CONFIGURED_VALUE,
        ROMAN_SAFE(row.salary_group_sequence) || NOT_CONFIGURED_VALUE,
      ])

      dataRow.getCell(1).alignment = { vertical: "middle", wrapText: true }
      dataRow.getCell(2).alignment = { vertical: "middle", wrapText: true }
      dataRow.getCell(4).alignment = { vertical: "middle", wrapText: true }

      // Cantidad autorizada: número entero sumable.
      const quantityCell = dataRow.getCell(3)
      quantityCell.value = row.authorized_quantity
      quantityCell.numFmt = "0"
      quantityCell.alignment = { vertical: "middle", horizontal: "center" }

      dataRow.getCell(5).alignment = { vertical: "middle", horizontal: "center" }

      for (let column = 1; column <= ANEXO_14_HEADERS.length; column += 1) {
        dataRow.getCell(column).border = THIN_BORDER
      }
    })
  })

  // ---------- Impresión ----------
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
  sheet.headerFooter = { oddHeader: "&L&\"Calibri,Bold\"REGISTRO DE TRABAJADORES - ANEXO 14&R&\"Calibri\"&A" }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

interface AreaGroup {
  key: string
  areaLabel: string
  areaCode: string | null
  rows: Anexo14Row[]
}

/** Agrupa respetando el orden organizativo devuelto por el backend. */
function groupRowsByArea(rows: Anexo14Row[]): AreaGroup[] {
  const groups: AreaGroup[] = []
  rows.forEach((row) => {
    const label = (row.area_name || "").trim() || "Sin área asignada"
    const code = row.area_code || null
    const key = `${label}|${code || ""}`
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      group = { key, areaLabel: label, areaCode: code, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  })
  return groups
}

/** Dispara la descarga del archivo generado en el navegador. */
export function saveAnexo14Blob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
