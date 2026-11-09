import type { Workbook } from "exceljs"
import {
  EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS,
  OFFICIAL_SEPARATION_CAUSE_COLUMNS,
  formatCargoAndCategory,
  formatDateDisplay,
  resolveOfficialSeparationColumn,
  type EmploymentPeriodRow,
} from "../domain/employment-registry.rules"

/**
 * Personas — Exportador Excel (.xlsx) del modelo oficial de 17 columnas
 * «Registro de Altas y Bajas».
 */

type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

const COLUMN_WIDTHS: readonly number[] = [
  14, // 1. Fecha de Alta
  12, // 2. No. (Alta)
  30, // 3. Nombre y Apellidos
  34, // 4. Cargo y/o Categoría Ocupacional
  14, // 5. Fecha de Baja
  12, // 6. No. (Baja)
  11, // 7. Salarial
  11, // 8. Jubilación
  13, // 9. Fallecimiento
  13, // 10. Invalidez Total
  13, // 11. Invalidez Parcial
  15, // 12. Privación de Libertad
  16, // 13. Paso a Formas no Estatales
  16, // 14. Proceso de Disponibilidad
  16, // 15. Sanción Administrativa
  13, // 16. Salida del País
  14, // 17. Otras
]

const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
}

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFEFF4FA" },
}

const SUBHEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFF7F9FC" },
}

const PENDING_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFFFFBEB" },
}

export interface EmploymentRegistryWorkbookMeta {
  entityName: string
  generatedAt?: Date
}

export async function buildEmploymentRegistryWorkbookBlob(
  rows: EmploymentPeriodRow[],
  meta: EmploymentRegistryWorkbookMeta
): Promise<Blob> {
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod
  const generatedAt = meta.generatedAt ?? new Date()

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  workbook.created = generatedAt

  const sheet = workbook.addWorksheet("Registro de Altas y Bajas", {
    views: [{ state: "frozen", ySplit: 6, xSplit: 3 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  })

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }))

  // ---------- Cabecera institucional ----------
  const titleRow = sheet.addRow(["REGISTRO DE ALTAS Y BAJAS"])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 17)

  const entityRow = sheet.addRow(["Entidad:", meta.entityName || "—"])
  entityRow.getCell(1).font = { bold: true }
  sheet.mergeCells(entityRow.number, 2, entityRow.number, 17)

  const dateRow = sheet.addRow([
    "Fecha de generación:",
    generatedAt.toLocaleDateString("es-CU"),
  ])
  dateRow.getCell(1).font = { bold: true }
  sheet.mergeCells(dateRow.number, 2, dateRow.number, 17)

  sheet.addRow([])

  // ---------- Encabezado oficial de dos niveles (17 columnas) ----------
  const topHeaderValues: string[] = [
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[0],
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[1],
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[2],
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[3],
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[4],
    EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[5],
    "MOTIVOS DE BAJAS",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]
  const topHeaderRow = sheet.addRow(topHeaderValues)
  const subHeaderRow = sheet.addRow([
    "",
    "",
    "",
    "",
    "",
    "",
    ...OFFICIAL_SEPARATION_CAUSE_COLUMNS.map((c) => c.label),
  ])

  topHeaderRow.height = 22
  subHeaderRow.height = 34

  // Combinar verticalmente las columnas 1 a 6 y horizontalmente el grupo 7 a 17
  for (let col = 1; col <= 6; col += 1) {
    sheet.mergeCells(topHeaderRow.number, col, subHeaderRow.number, col)
  }
  sheet.mergeCells(topHeaderRow.number, 7, topHeaderRow.number, 17)

  for (let col = 1; col <= 17; col += 1) {
    const topCell = topHeaderRow.getCell(col)
    topCell.font = { bold: true, size: 10 }
    topCell.fill = HEADER_FILL
    topCell.border = THIN_BORDER
    topCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }

    const subCell = subHeaderRow.getCell(col)
    subCell.font = { bold: true, size: 9 }
    subCell.fill = col >= 7 ? SUBHEADER_FILL : HEADER_FILL
    subCell.border = THIN_BORDER
    subCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
  }

  // ---------- Filas de períodos laborales ----------
  rows.forEach((row) => {
    const resolution = resolveOfficialSeparationColumn(row)
    const isClosed = row.status === "CLOSED"

    const causeCells = OFFICIAL_SEPARATION_CAUSE_COLUMNS.map((colDef) =>
      resolution.columnKey === colDef.key ? "X" : ""
    )

    const baseCargoCategory = formatCargoAndCategory(
      row.positionNameSnapshot,
      row.occupationalCategorySnapshot
    )
    const cleanSourceOrigin = row.sourceOrigin?.trim() || ""
    const cargoCategoryCellText =
      baseCargoCategory === "—"
        ? cleanSourceOrigin
          ? `Procedencia: ${cleanSourceOrigin}`
          : ""
        : cleanSourceOrigin
          ? `${baseCargoCategory} (Procedencia: ${cleanSourceOrigin})`
          : baseCargoCategory

    const dataRow = sheet.addRow([
      row.hireDate ? formatDateDisplay(row.hireDate) : "",
      row.hireNumber ?? "",
      row.workerFullName,
      cargoCategoryCellText,
      isClosed && row.separationDate ? formatDateDisplay(row.separationDate) : "",
      isClosed ? (row.separationNumber ?? "") : "",
      ...causeCells,
    ])

    dataRow.height = 20

    for (let col = 1; col <= 17; col += 1) {
      const cell = dataRow.getCell(col)
      cell.border = THIN_BORDER
      cell.font = { size: 10, bold: col >= 7 && cell.value === "X" }
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 3 || col === 4 ? "left" : "center",
        wrapText: col === 3 || col === 4,
      }
      if (resolution.isPendingValidation && col >= 5) {
        cell.fill = PENDING_FILL
      }
    }

    if (cleanSourceOrigin) {
      dataRow.getCell(3).note = `Procedencia: ${cleanSourceOrigin}`
      dataRow.getCell(4).note = `Procedencia: ${cleanSourceOrigin}`
    }

    if (resolution.detailComment) {
      if (resolution.isPendingValidation) {
        dataRow.getCell(5).note = resolution.detailComment
        dataRow.getCell(17).note = resolution.detailComment
      } else if (resolution.columnKey === "OTRAS") {
        dataRow.getCell(17).note = resolution.detailComment
      }
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

export async function downloadEmploymentRegistryWorkbook(
  rows: EmploymentPeriodRow[],
  meta: EmploymentRegistryWorkbookMeta
): Promise<void> {
  const blob = await buildEmploymentRegistryWorkbookBlob(rows, meta)
  const safeEntity = (meta.entityName || "entidad")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const datePart = (meta.generatedAt ?? new Date()).toISOString().slice(0, 10)
  const fileName = `registro-altas-y-bajas-${safeEntity || "entidad"}-${datePart}.xlsx`

  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    URL.revokeObjectURL(url)
  }
}
