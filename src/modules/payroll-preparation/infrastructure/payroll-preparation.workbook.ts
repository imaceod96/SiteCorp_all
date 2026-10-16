import type { Workbook } from "exceljs"
// Regla pura de la categoría académica, tomada directamente del dominio que la define: la
// exportación sólo necesita la etiqueta y así no arrastra la capa de datos de ese dominio.
import { academicCategoryLabel } from "@/domains/organization-structure/domain/academic-payment.rules"
import { formatDateDMY, formatTenureLabel } from "../domain/formatters"
import { MONTH_LABELS, PRENOMINA_STATUS_LABELS } from "../domain/rules"
import type { PrenominaExportMeta, PrenominaNightEntry, PrenominaWorkerEntry } from "../domain/entities"

/**
 * Prenómina — Exportación a Excel (Infrastructure).
 *
 * Reutiliza ExcelJS igual que el resto de exportaciones del proyecto. Reproduce EXACTAMENTE el
 * mismo libro: mismos encabezados, mismos anchos, mismos formatos numéricos, mismos metadatos
 * de cabecera y la misma fila TOTAL GENERAL con los mismos importes.
 */

/** Tipado mínimo del módulo ExcelJS usado por esta exportación (solo `Workbook`). */
type ExcelJSModule = {
  Workbook: typeof Workbook
  default?: { Workbook: typeof Workbook }
}

export const PRENOMINA_EXPORT_HEADERS = [
  "No.",
  "Trabajador",
  "Identificación",
  "Área",
  "Cargo",
  "Puesto",
  "Grupo Escala",
  "Salario Escala",
  "Tarifa por Hora",
  "Días Trabajados",
  "Horas Trabajadas",
  "Pago Salario Escala",
  "Fecha de Incorporación",
  "Antigüedad",
  "Tramo de Antigüedad",
  "Importe Base Antigüedad",
  "Tarifa Antigüedad/Hora",
  "Pago Antigüedad",
  "Nocturnidad 19–23",
  "Nocturnidad 23–07",
  "Total Nocturnidad",
  "CLA",
  "Categoría académica",
  "Pago categoría académica",
  "Total Trabajador",
] as const

const COLUMN_WIDTHS = [
  6, 32, 18, 22, 26, 26, 14, 14, 14, 14, 14, 18, 20, 18, 20, 20, 18, 16, 16, 16, 16, 14, 18, 18, 16,
]

/** Números monetarios/numerados: índices (1-based) de columnas numéricas del Excel. */
const NUMERIC_COLUMNS = [8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 24, 25]

/**
 * Nombre del archivo exportado: `Prenomina_[Entidad]_[Mes]_[Año].xlsx`.
 * Mismo saneado de nombre que el resto de exportaciones (sin acentos ni separadores inválidos).
 */
export function buildPrenominaFileName(entityName: string, year: number, month: number): string {
  const safeName =
    (entityName || "Entidad")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "Entidad"
  const monthName = MONTH_LABELS[month - 1] || String(month)
  return `Prenomina_${safeName}_${monthName}_${year}.xlsx`
}

/** Construye el libro del período (hoja «Prenómina») con los registros y su nocturnidad. */
export async function buildPrenominaWorkbookBlob(
  entries: PrenominaWorkerEntry[],
  nightsByEntry: Record<string, PrenominaNightEntry[]>,
  meta: PrenominaExportMeta
): Promise<Blob> {
  const mod: ExcelJSModule = await import("exceljs")
  const ExcelJS = mod?.default ?? mod

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "SiteCorp"
  workbook.created = meta.generatedAt

  const sheet = workbook.addWorksheet("Prenómina")
  sheet.columns = COLUMN_WIDTHS.map((width, index) => ({ width, key: `c${index}` }))

  const monthName = MONTH_LABELS[meta.month - 1] || String(meta.month)
  const dateLabel = meta.generatedAt.toLocaleDateString("es-CU")

  // Metadatos de cabecera
  const metaRows: [string, string][] = [
    ["PRENÓMINA", ""],
    ["Entidad:", meta.entityName],
    ["Mes:", monthName],
    ["Año:", String(meta.year)],
    ["Fecha de generación:", dateLabel],
    ["Estado:", PRENOMINA_STATUS_LABELS[meta.status] || meta.status],
  ]
  metaRows.forEach(([label, value], index) => {
    const row = sheet.addRow([label, value])
    if (index === 0) row.font = { bold: true, size: 14 }
  })
  sheet.addRow([])

  // Encabezados
  const headerRow = sheet.addRow([...PRENOMINA_EXPORT_HEADERS])
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle" }

  let totalScale = 0
  let totalTenure = 0
  let totalAcademic = 0
  let total19 = 0
  let total23 = 0
  let totalNight = 0
  let totalCla = 0
  let totalAll = 0

  entries.forEach((entry, index) => {
    const nights = nightsByEntry[entry.id] || []
    const p19 = nights.reduce((acc, n) => acc + Number(n.payment_19_23 || 0), 0)
    const p23 = nights.reduce((acc, n) => acc + Number(n.payment_23_07 || 0), 0)
    const tenureLabel =
      entry.tenure_status === "NO_START_DATE"
        ? "Sin fecha de incorporación"
        : formatTenureLabel(entry.tenure_years, entry.tenure_months)
    const bandLabel =
      entry.tenure_status === "NO_BAND"
        ? "Sin tramo de antigüedad configurado"
        : entry.tenure_band_label || "—"
    const row = sheet.addRow([
      index + 1,
      entry.worker_name_snapshot,
      entry.identification_snapshot,
      entry.area_name_snapshot,
      entry.job_name_snapshot,
      entry.position_name_snapshot,
      entry.salary_group_sequence,
      entry.salary_scale_amount,
      entry.hourly_scale_rate,
      entry.worked_days,
      entry.worked_hours,
      entry.scale_salary_payment,
      formatDateDMY(entry.employment_start_date_snapshot),
      tenureLabel,
      bandLabel,
      entry.tenure_base_amount,
      entry.tenure_hourly_rate,
      entry.tenure_payment,
      p19,
      p23,
      entry.total_night_payment,
      entry.cla_total_payment,
      academicCategoryLabel(entry.academic_category),
      entry.academic_payment,
      entry.total_payment,
    ])
    // Identificación como texto (nunca notación científica)
    const idCell = row.getCell(3)
    idCell.numFmt = "@"
    if (entry.identification_snapshot !== null && entry.identification_snapshot !== undefined) {
      idCell.value = String(entry.identification_snapshot)
    }
    NUMERIC_COLUMNS.forEach((col) => {
      row.getCell(col).numFmt = "#,##0.00"
    })

    totalScale += Number(entry.scale_salary_payment || 0)
    totalTenure += Number(entry.tenure_payment || 0)
    totalAcademic += Number(entry.academic_payment || 0)
    total19 += p19
    total23 += p23
    totalNight += Number(entry.total_night_payment || 0)
    totalCla += Number(entry.cla_total_payment || 0)
    totalAll += Number(entry.total_payment || 0)
  })

  // Fila TOTAL GENERAL
  const totalRow = sheet.addRow([
    "",
    "TOTAL GENERAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    Math.round(totalScale * 100) / 100,
    "",
    "",
    "",
    "",
    "",
    Math.round(totalTenure * 100) / 100,
    Math.round(total19 * 100) / 100,
    Math.round(total23 * 100) / 100,
    Math.round(totalNight * 100) / 100,
    Math.round(totalCla * 100) / 100,
    "",
    Math.round(totalAcademic * 100) / 100,
    Math.round(totalAll * 100) / 100,
  ])
  totalRow.font = { bold: true }
  NUMERIC_COLUMNS.forEach((col) => {
    totalRow.getCell(col).numFmt = "#,##0.00"
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

/** Descarga el libro generado en el navegador. */
export function savePrenominaExcelBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
