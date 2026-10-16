import {
  type WeekDay,
  type PositionScheduleSegment,
  type PositionWorkInfo,
} from "./entities"
import { WEEK_DAYS } from "./rules"

/** Etiqueta completa del día (Lunes…Domingo). */
export const weekDayLabel = (dayOfWeek: number): string =>
  WEEK_DAYS.find((day) => day.value === dayOfWeek)?.label || `Día ${dayOfWeek}`

/** Abreviatura de 1 letra del día. */
export const weekDayShort = (dayOfWeek: number): string =>
  WEEK_DAYS.find((day) => day.value === dayOfWeek)?.short || "?"

/** Normaliza "08:00:00" o "08:00" a "08:00". */
export const formatTime = (time: string | null | undefined): string => {
  if (!time) return "—"
  const [hours, minutes] = time.split(":")
  return `${hours.padStart(2, "0")}:${(minutes || "00").padStart(2, "0")}`
}

/** Horas: 8 → "8", 190.6 → "190,6" (sin ceros innecesarios). */
export const formatHoursValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—"
  return value.toLocaleString("es-CU", { maximumFractionDigits: 2 })
}

/** Rango de días consecutivos: [1,2,3,4,5] → "Lun–Vie"; [1,3] → "Lun, Mié". */
export const formatDayRange = (days: number[]): string => {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 0) return "—"
  if (sorted.length === 1) return weekDayLabel(sorted[0]).slice(0, 3)

  const isConsecutive = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1)
  if (isConsecutive) {
    return `${weekDayLabel(sorted[0]).slice(0, 3)}–${weekDayLabel(sorted[sorted.length - 1]).slice(0, 3)}`
  }
  return sorted.map((day) => weekDayLabel(day).slice(0, 3)).join(", ")
}

/**
 * Resumen legible del horario agrupando días con el mismo rango horario:
 * "Lun–Vie 08:00–16:30 · Sáb 08:00–12:00".
 */
export const formatScheduleSummary = (
  segments: PositionScheduleSegment[] | null | undefined
): string | null => {
  if (!segments || segments.length === 0) return null

  const groups = new Map<string, number[]>()
  segments.forEach((segment) => {
    const key = `${formatTime(segment.start_time)}-${formatTime(segment.end_time)}`
    const days = groups.get(key) || []
    days.push(segment.day_of_week)
    groups.set(key, days)
  })

  return Array.from(groups.entries())
    .map(([range, days]) => {
      const [start, end] = range.split("-")
      const suffix = end < start ? " (+1 día)" : ""
      return `${formatDayRange(days)} ${start}–${end}${suffix}`
    })
    .join(" · ")
}

/** Línea de días con sus segmentos: útil para el detalle del puesto. */
export const formatScheduleByDay = (
  segments: PositionScheduleSegment[] | null | undefined
): { day: string; ranges: string }[] => {
  if (!segments || segments.length === 0) return []

  const byDay = new Map<number, PositionScheduleSegment[]>()
  segments.forEach((segment) => {
    const list = byDay.get(segment.day_of_week) || []
    list.push(segment)
    byDay.set(segment.day_of_week, list)
  })

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => ({
      day: weekDayLabel(day),
      ranges: list
        .slice()
        .sort((a, b) => formatTime(a.start_time).localeCompare(formatTime(b.start_time)))
        .map(
          (segment) =>
            `${formatTime(segment.start_time)}–${formatTime(segment.end_time)}${
              segment.crosses_midnight ? " (+1 día)" : ""
            }`
        )
        .join(", "),
    }))
}

/** Jornada: "8 h/día · 44 h/semana · 190,6 h/mes" o null si no hay nada configurado. */
export const formatJornada = (info: {
  daily_hours?: number | null
  weekly_hours?: number | null
  monthly_hours?: number | null
}): string | null => {
  const parts: string[] = []
  if (info.daily_hours !== null && info.daily_hours !== undefined) {
    parts.push(`${formatHoursValue(info.daily_hours)} h/día`)
  }
  if (info.weekly_hours !== null && info.weekly_hours !== undefined) {
    parts.push(`${formatHoursValue(info.weekly_hours)} h/semana`)
  }
  if (info.monthly_hours !== null && info.monthly_hours !== undefined) {
    parts.push(`${formatHoursValue(info.monthly_hours)} h/mes`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

export const formatBreak = (minutes: number | null | undefined): string | null =>
  minutes === null || minutes === undefined ? null : `${minutes} min`

/** ¿El puesto tiene algo configurado de lugar/jornada/horario? */
export const hasWorkInfo = (
  position: Partial<PositionWorkInfo> | null | undefined,
  segments?: PositionScheduleSegment[] | null
): boolean => {
  if (!position) return false
  return !!(
    position.work_location ||
    (position.daily_hours !== null && position.daily_hours !== undefined) ||
    (position.weekly_hours !== null && position.weekly_hours !== undefined) ||
    (position.monthly_hours !== null && position.monthly_hours !== undefined) ||
    (position.break_minutes !== null && position.break_minutes !== undefined) ||
    position.schedule_notes ||
    (segments && segments.length > 0)
  )
}

/** Formato de importe salarial: «1.234,56 CUP». */
export const formatSalary = (v: { amount: number; currency_code: string }) =>
  `${v.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} ${v.currency_code}`

/** Nombre saneado: Anexo_14_Plantilla_[Entidad].xlsx */
export function buildAnexo14FileName(entityName: string, date = new Date()): string {
  const safeName =
    (entityName || "Entidad")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "Entidad"
  const iso = date.toISOString().slice(0, 10)
  return `Anexo_14_Plantilla_${safeName}_${iso}.xlsx`
}

/** Nombre saneado del Anexo14B: Anexo14B_[Entidad]_[AAAA-MM-DD].xlsx */
export function buildAnexo14BFileName(entityName: string, date = new Date()): string {
  const safeName =
    (entityName || "Entidad")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "Entidad"
  const iso = date.toISOString().slice(0, 10)
  return `Anexo14B_${safeName}_${iso}.xlsx`
}

/**
 * Años de servicios desde `workers.employment_start_date` hasta la fecha de
 * generación del Anexo14B: «12 años» o «12 años, 4 meses».
 */
export function formatService(
  serviceStart: string | null | undefined,
  reference: Date
): string | null {
  if (!serviceStart) return null
  const start = new Date(`${String(serviceStart).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime())) return null

  const ref = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  if (start > ref) return null

  let years = ref.getFullYear() - start.getFullYear()
  let months = ref.getMonth() - start.getMonth()
  if (ref.getDate() < start.getDate()) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }
  if (years < 0) return null

  const yearsLabel = years === 1 ? "1 año" : `${years} años`
  if (months <= 0) return yearsLabel
  return `${yearsLabel}, ${months} ${months === 1 ? "mes" : "meses"}`
}
