/**
 * Prenómina — Formato y lectura de valores (Domain).
 *
 * Mismas precisiones y mismos separadores que ya usaba la interfaz: importes con 2 decimales,
 * horas hasta 2 decimales, minutos enteros y coma decimal española en la captura.
 */

const moneyFormatter = new Intl.NumberFormat("es-CU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatMoney = (value: number | null | undefined): string =>
  moneyFormatter.format(Number(value || 0))

export const formatMoneyWithCurrency = (
  value: number | null | undefined,
  currency = "CUP"
): string => `${formatMoney(value)} ${currency || "CUP"}`

export const formatHours = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })

/** Minutos enteros, sin decimales. */
export const formatMinutes = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString("es-CU", { maximumFractionDigits: 0 })

/** Conversión explícita minutos → horas para auditoría: «90 min → 1,5 h». */
export const formatMinutesToHours = (minutes: number | null | undefined): string =>
  `${formatMinutes(minutes)} min → ${formatHours(Number(minutes || 0) / 60)} h`

/** Días trabajados con coma decimal (UI española): 20.5 → "20,5". */
export const formatDecimalInput = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return ""
  return Number(value).toLocaleString("es-CU", { maximumFractionDigits: 2, useGrouping: false })
}

/**
 * Normaliza la entrada decimal aceptando coma española.
 * "20,5" → 20.5 ; "20" → 20 ; "" → 0. Nunca usa parseInt.
 */
export const parseDecimalInput = (raw: string): number => {
  if (raw === null || raw === undefined) return 0
  const normalized = String(raw).trim().replace(/\s/g, "").replace(",", ".")
  if (normalized === "" || normalized === ".") return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export const parseIntegerInput = (raw: string): number => {
  const parsed = parseDecimalInput(raw)
  return Math.trunc(parsed)
}

/** Etiqueta legible de la antigüedad del período: "X años, Y meses". */
export const formatTenureLabel = (years: number | null, months: number | null): string => {
  if (years === null || years === undefined) return "—"
  const y = Number(years)
  const m = Number(months || 0)
  const yLabel = `${y} año${y === 1 ? "" : "s"}`
  if (m <= 0) return yLabel
  return `${yLabel}, ${m} mes${m === 1 ? "" : "es"}`
}

/** dd/mm/aaaa a partir de una fecha ISO. */
export const formatDateDMY = (value: string | null | undefined): string => {
  if (!value) return "—"
  const iso = String(value).slice(0, 10)
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return "—"
  return `${d}/${m}/${y}`
}
