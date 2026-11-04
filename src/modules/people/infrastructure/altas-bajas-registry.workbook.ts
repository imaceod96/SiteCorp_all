import ExcelJS from "exceljs"
import { ALTAS_BAJAS_FOOTNOTE_TEXT, ALTAS_BAJAS_REASON_COLUMNS } from "../domain/rules"
import type { AltasBajasRegistryRow } from "../domain/entities"

export interface ExportAltasBajasExcelOptions {
  entityName?: string | null
  rows: AltasBajasRegistryRow[]
}

/**
 * Construye el libro Excel (.xlsx) oficial del modelo «b) Registro de Altas y Bajas»
 * respetando exactamente la estructura de 17 columnas ordenadas de izquierda a derecha (1 a 17),
 * las cabeceras combinadas («Altas» en 4-5 y «Motivo de la baja» en 7-17),
 * la orientación vertical de los 11 motivos de baja, la marca «X» centrada y la nota oficial al pie.
 */
export async function buildAltasBajasRegistryWorkbook(
  options: ExportAltasBajasExcelOptions
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Registro de Altas y Bajas", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    views: [{ state: "frozen", ySplit: 5 }],
  })

  // Definir anchos de las 17 columnas (1 a 17)
  sheet.columns = [
    { key: "col1", width: 6 },   // 1: No.
    { key: "col2", width: 32 },  // 2: No. Carné y Nombre del trabajador
    { key: "col3", width: 36 },  // 3: Dirección particular del trabajador
    { key: "col4", width: 18 },  // 4: Fecha y No. de alta
    { key: "col5", width: 24 },  // 5: Fuente de procedencia
    { key: "col6", width: 18 },  // 6: Fecha y No. de baja
    { key: "col7", width: 6 },   // 7: Salarial
    { key: "col8", width: 6 },   // 8: Jubilación
    { key: "col9", width: 6 },   // 9: Fallecimiento
    { key: "col10", width: 6 },  // 10: Invalidez total
    { key: "col11", width: 6 },  // 11: Invalidez parcial
    { key: "col12", width: 6 },  // 12: Privación de libertad
    { key: "col13", width: 6 },  // 13: Paso a formas no estatales
    { key: "col14", width: 6 },  // 14: Proceso de disponibilidad
    { key: "col15", width: 6 },  // 15: Sanción administrativa
    { key: "col16", width: 6 },  // 16: Salida del país
    { key: "col17", width: 8 },  // 17: Otras
  ]

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF1E293B" } },
    left: { style: "thin", color: { argb: "FF1E293B" } },
    bottom: { style: "thin", color: { argb: "FF1E293B" } },
    right: { style: "thin", color: { argb: "FF1E293B" } },
  }

  // Fila 1: Título oficial del modelo
  const titleText = options.entityName
    ? `b) Registro de Altas y Bajas — ${options.entityName}`
    : "b) Registro de Altas y Bajas."
  const titleRow = sheet.getRow(1)
  titleRow.getCell(1).value = titleText
  titleRow.getCell(1).font = { name: "Arial", size: 12, bold: true }
  titleRow.height = 24
  sheet.mergeCells(1, 1, 1, 17)

  // Fila 2: Vacía de separación
  sheet.getRow(2).height = 8

  // Fila 3 y Fila 4: Encabezado agrupado multinivel
  const headerRow1 = sheet.getRow(3)
  const headerRow2 = sheet.getRow(4)
  headerRow1.height = 26
  headerRow2.height = 115

  // Columnas 1, 2, 3 y 6 combinadas verticalmente entre filas 3 y 4
  headerRow1.getCell(1).value = "No."
  sheet.mergeCells(3, 1, 4, 1)

  headerRow1.getCell(2).value = "No. Carné y Nombre del trabajador"
  sheet.mergeCells(3, 2, 4, 2)

  headerRow1.getCell(3).value = "Dirección particular del trabajador"
  sheet.mergeCells(3, 3, 4, 3)

  // Grupo «Altas» en columnas 4 y 5
  headerRow1.getCell(4).value = "Altas"
  sheet.mergeCells(3, 4, 3, 5)
  headerRow2.getCell(4).value = "Fecha y No. de alta"
  headerRow2.getCell(5).value = "Fuente de procedencia"

  // Columna 6 combinada verticalmente entre filas 3 y 4
  headerRow1.getCell(6).value = "Fecha y No. de baja"
  sheet.mergeCells(3, 6, 4, 6)

  // Grupo «Motivo de la baja» en columnas 7 a 17
  headerRow1.getCell(7).value = "Motivo de la baja"
  sheet.mergeCells(3, 7, 3, 17)

  ALTAS_BAJAS_REASON_COLUMNS.forEach((col) => {
    headerRow2.getCell(col.columnNumber).value = col.label
  })

  // Aplicar estilos a las filas 3 y 4 de cabecera
  for (let r = 3; r <= 4; r++) {
    const row = sheet.getRow(r)
    for (let c = 1; c <= 17; c++) {
      const cell = row.getCell(c)
      cell.border = thinBorder
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" },
      }
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF0F172A" } }

      // Rotación vertical para las columnas de motivos de baja (7 a 17) en fila 4
      if (r === 4 && c >= 7 && c <= 17) {
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          textRotation: 90,
          wrapText: true,
        }
      } else {
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        }
      }
    }
  }

  // Fila 5: Numeración oficial de columnas 1 a 17
  const numberRow = sheet.getRow(5)
  numberRow.height = 18
  for (let c = 1; c <= 17; c++) {
    const cell = numberRow.getCell(c)
    cell.value = c
    cell.border = thinBorder
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    }
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF0F172A" } }
    cell.alignment = { vertical: "middle", horizontal: "center" }
  }

  // Filas de datos (a partir de la fila 6)
  let currentRowIndex = 6
  const rowsToExport = options.rows

  if (rowsToExport.length === 0) {
    // Generar al menos 10 filas en blanco con formato si no hay datos
    for (let i = 0; i < 10; i++) {
      const emptyRow = sheet.getRow(currentRowIndex++)
      emptyRow.height = 20
      for (let c = 1; c <= 17; c++) {
        const cell = emptyRow.getCell(c)
        cell.border = thinBorder
      }
    }
  } else {
    rowsToExport.forEach((item, idx) => {
      const row = sheet.getRow(currentRowIndex++)
      row.height = 24

      row.getCell(1).value = idx + 1
      row.getCell(2).value = `${item.identification} — ${item.fullName}`
      row.getCell(3).value = item.address || "—"
      row.getCell(4).value = item.altaDisplay || item.altaDate || "—"
      row.getCell(5).value = item.sourceOfOrigin || "—"
      row.getCell(6).value = item.bajaDisplay || item.bajaDate || ""

      ALTAS_BAJAS_REASON_COLUMNS.forEach((col) => {
        const isMarked = item.status === "SEPARATED" && item.bajaReasonColumn === col.code
        if (isMarked) {
          if (
            col.code === "OTRAS" &&
            item.bajaReasonDetail &&
            item.bajaReasonDetail.toLowerCase() !== "otras"
          ) {
            row.getCell(col.columnNumber).value = `X (${item.bajaReasonDetail})`
          } else {
            row.getCell(col.columnNumber).value = "X"
          }
        } else {
          row.getCell(col.columnNumber).value = ""
        }
      })

      for (let c = 1; c <= 17; c++) {
        const cell = row.getCell(c)
        cell.border = thinBorder
        const isMarkCell = c >= 7 && c <= 17
        cell.font = {
          name: "Arial",
          size: 9,
          bold: isMarkCell || c === 1,
          color: { argb: "FF0F172A" },
        }
        cell.alignment = {
          vertical: "middle",
          horizontal: c === 2 || c === 3 || c === 5 ? "left" : "center",
          wrapText: true,
        }
      }
    })
  }

  // Nota oficial al pie
  const footerRowIndex = currentRowIndex + 1
  const footerRow = sheet.getRow(footerRowIndex)
  footerRow.height = 30
  sheet.mergeCells(footerRowIndex, 1, footerRowIndex, 17)
  const footerCell = footerRow.getCell(1)
  footerCell.value = ALTAS_BAJAS_FOOTNOTE_TEXT
  footerCell.font = { name: "Arial", size: 8, italic: true, color: { argb: "FF334155" } }
  footerCell.alignment = { vertical: "top", horizontal: "left", wrapText: true }

  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

/**
 * Descarga en el navegador el archivo Excel (.xlsx) del Registro de Altas y Bajas.
 */
export async function downloadAltasBajasRegistryExcel(
  options: ExportAltasBajasExcelOptions
): Promise<void> {
  const buffer = await buildAltasBajasRegistryWorkbook(options)
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const safeEntity = (options.entityName || "entidad")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
  const datePart = new Date().toISOString().slice(0, 10)
  const fileName = `registro_altas_y_bajas_${safeEntity || "entidad"}_${datePart}.xlsx`

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
