import type { PositionScheduleSegment } from "./entities"

/**
 * Puestos — reglas puras del formulario.
 *
 * El Puesto es un único registro con N plazas autorizadas (`authorized_quantity`): las
 * ocupadas y las vacantes se derivan de las asignaciones activas y NUNCA se guardan aquí.
 * La jornada (horas diarias, semanales y mensuales por separado), el lugar de trabajo y el
 * horario habitual son datos del puesto e indispensables para formalizar el contrato.
 *
 * Este archivo no duplica el reparto de plazas (`staffing.rules.ts`) ni el texto del horario
 * (`formatters.ts`): sólo valida y normaliza lo que envía el formulario.
 */

/** Tope de plazas autorizadas por puesto. */
export const MAX_AUTHORIZED_QUANTITY = 9999

/** "08:00:00" | "08:00" → "08:00" (la base de datos guarda `time`). */
export function normalizeScheduleTime(time: string): string {
  const [hours, minutes] = time.split(":")
  return `${(hours || "00").padStart(2, "0")}:${(minutes || "00").padStart(2, "0")}`
}

/**
 * Número opcional del formulario: null si está vacío, NaN si no es un número.
 * El NaN se conserva a propósito para poder distinguir «vacío» de «inválido».
 */
export function parseNullableNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".")
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : NaN
}

/** Segmentos del horario ordenados por día y hora de inicio. */
export function sortScheduleSegments(
  segments: PositionScheduleSegment[]
): PositionScheduleSegment[] {
  return [...segments].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)
  )
}

/** Quita del borrador el segmento indicado (mismo día y mismo rango horario). */
export function removeScheduleSegment(
  segments: PositionScheduleSegment[],
  segment: PositionScheduleSegment
): PositionScheduleSegment[] {
  return segments.filter(
    (item) =>
      !(
        item.day_of_week === segment.day_of_week &&
        item.start_time === segment.start_time &&
        item.end_time === segment.end_time
      )
  )
}

/**
 * Añade a cada día seleccionado el rango horario del borrador, sin duplicar segmentos
 * idénticos. Devuelve los segmentos resultantes y el mensaje de error, si lo hubo.
 */
export function addDraftScheduleSegments(
  segments: PositionScheduleSegment[],
  draft: { days: number[]; start: string; end: string }
): { segments: PositionScheduleSegment[]; error: string | null } {
  if (draft.days.length === 0) {
    return { segments, error: "Selecciona al menos un día para el horario" }
  }
  if (!draft.start || !draft.end) {
    return { segments, error: "Indica la hora desde y hasta del horario" }
  }

  const start = normalizeScheduleTime(draft.start)
  const end = normalizeScheduleTime(draft.end)
  if (start === end) {
    return { segments, error: "La hora desde y hasta no pueden ser iguales" }
  }

  const next = [...segments]
  draft.days.forEach((day) => {
    const duplicated = next.some(
      (segment) =>
        segment.day_of_week === day &&
        normalizeScheduleTime(segment.start_time) === start &&
        normalizeScheduleTime(segment.end_time) === end
    )
    if (!duplicated) {
      next.push({ day_of_week: day, start_time: start, end_time: end })
    }
  })

  return { segments: next, error: null }
}

/** Segmentos tal como los espera la RPC atómica del puesto (`display_order` correlativo). */
export function positionSchedulePayload(segments: PositionScheduleSegment[]): {
  day_of_week: number
  start_time: string
  end_time: string
  display_order: number
}[] {
  return sortScheduleSegments(segments).map((segment, index) => ({
    day_of_week: segment.day_of_week,
    start_time: segment.start_time,
    end_time: segment.end_time,
    display_order: index + 1,
  }))
}

export interface PositionFormValidation {
  error: string | null
  quantity: number
  dailyHours: number | null
  weeklyHours: number | null
  monthlyHours: number | null
  breakMinutes: number | null
}

/**
 * Valida el formulario del puesto y devuelve el primer error junto con los valores ya
 * convertidos. El orden de las comprobaciones es el de la interfaz: cargo, nombre, cantidad,
 * lugar de trabajo, jornada, descanso y horario.
 */
export function validatePositionInput(input: {
  jobId: string
  jobExists: boolean
  name: string
  authorizedQuantity: string
  workLocation: string
  dailyHours: string
  weeklyHours: string
  monthlyHours: string
  breakMinutes: string
  segmentsCount: number
  scheduleNotes: string
}): PositionFormValidation {
  const quantity = parseInt(input.authorizedQuantity, 10)
  const daily = parseNullableNumber(input.dailyHours)
  const weekly = parseNullableNumber(input.weeklyHours)
  const monthly = parseNullableNumber(input.monthlyHours)
  const breakValue = parseNullableNumber(input.breakMinutes)

  const invalid = (error: string): PositionFormValidation => ({
    error,
    quantity,
    dailyHours: daily,
    weeklyHours: weekly,
    monthlyHours: monthly,
    breakMinutes: breakValue,
  })

  if (!input.jobId) return invalid("El cargo es obligatorio")
  if (!input.name) return invalid("El nombre del puesto es obligatorio")
  if (!input.jobExists) return invalid("El cargo seleccionado no es válido")

  if (isNaN(quantity) || quantity < 1) {
    return invalid("La cantidad de puestos debe ser un número entero mayor o igual a 1")
  }
  if (quantity > MAX_AUTHORIZED_QUANTITY) {
    return invalid(`La cantidad de puestos no puede superar ${MAX_AUTHORIZED_QUANTITY}`)
  }

  // Integridad contractual: el lugar de trabajo, la jornada y el horario viven en el PUESTO
  // y son indispensables para formalizar el contrato.
  if (!input.workLocation.trim()) return invalid("El lugar de trabajo es obligatorio")
  if (
    daily === null || daily <= 0 ||
    weekly === null || weekly <= 0 ||
    monthly === null || monthly <= 0
  ) {
    return invalid(
      "La jornada es obligatoria: indica horas diarias, semanales y mensuales mayores que 0"
    )
  }
  if (breakValue === null) return invalid("El descanso (minutos) es obligatorio")
  if (input.segmentsCount === 0 && !input.scheduleNotes.trim()) {
    return invalid("El horario es obligatorio: añade segmentos de horario o una descripción")
  }

  // Los valores deben ser >= 0; no se imponen límites legales no definidos.
  const hourFields: [string, number | null][] = [
    ["Horas diarias", daily],
    ["Horas semanales", weekly],
    ["Horas mensuales", monthly],
  ]
  for (const [label, value] of hourFields) {
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      return invalid(`${label} debe ser un número mayor o igual a 0`)
    }
  }
  if (breakValue !== null) {
    if (Number.isNaN(breakValue) || breakValue < 0) {
      return invalid("El descanso debe ser un número de minutos mayor o igual a 0")
    }
    if (!Number.isInteger(breakValue)) {
      return invalid("El descanso debe expresarse en minutos enteros")
    }
  }

  return {
    error: null,
    quantity,
    dailyHours: daily,
    weeklyHours: weekly,
    monthlyHours: monthly,
    breakMinutes: breakValue,
  }
}

export interface ScheduledWeeklyHoursSummary {
  grossHours: number
  effectiveHours: number
  segmentCount: number
}

function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Calcula las horas semanales brutas y efectivas (descontando el descanso por tramo cuando aplica)
 * a partir de los segmentos del horario habitual. Soporta turnos que cruzan medianoche.
 */
export function calculateScheduledWeeklyHours(
  segments: Pick<PositionScheduleSegment, "start_time" | "end_time">[],
  breakMinutes: number | null = 0
): ScheduledWeeklyHoursSummary {
  const safeBreak = breakMinutes && breakMinutes > 0 ? breakMinutes : 0
  let grossMinutes = 0
  let effectiveMinutes = 0

  for (const segment of segments) {
    const start = timeToMinutes(segment.start_time)
    const end = timeToMinutes(segment.end_time)
    if (start === null || end === null || start === end) continue
    const duration = end > start ? end - start : 24 * 60 - start + end
    grossMinutes += duration
    effectiveMinutes += safeBreak > 0 && duration > safeBreak ? duration - safeBreak : duration
  }

  return {
    grossHours: roundHours(grossMinutes / 60),
    effectiveHours: roundHours(effectiveMinutes / 60),
    segmentCount: segments.length,
  }
}

/**
 * Devuelve un aviso informativo (no bloqueante) cuando las horas semanales declaradas no coinciden
 * con el total de horas del horario habitual configurado.
 */
export function getScheduleWeeklyHoursWarning(input: {
  segments: Pick<PositionScheduleSegment, "start_time" | "end_time">[]
  weeklyHours: number | null
  breakMinutes: number | null
}): string | null {
  if (
    input.segments.length === 0 ||
    input.weeklyHours === null ||
    Number.isNaN(input.weeklyHours) ||
    input.weeklyHours <= 0
  ) {
    return null
  }

  const summary = calculateScheduledWeeklyHours(input.segments, input.breakMinutes)
  const tolerance = 0.05
  if (
    Math.abs(summary.effectiveHours - input.weeklyHours) <= tolerance ||
    Math.abs(summary.grossHours - input.weeklyHours) <= tolerance
  ) {
    return null
  }

  const hasBreakDifference = Math.abs(summary.grossHours - summary.effectiveHours) > tolerance
  const scheduleLabel = hasBreakDifference
    ? `${summary.effectiveHours} h efectivas (${summary.grossHours} h brutas)`
    : `${summary.effectiveHours} h`

  return `Las horas semanales declaradas (${input.weeklyHours} h) no coinciden con la suma del horario habitual (${scheduleLabel} en ${summary.segmentCount} tramo(s)). Verifica si corresponde a sábados alternos u otra distribución.`
}

/** Mensaje de error del guardado del puesto (conflicto de código único o detalle de BD). */
export function positionSaveErrorMessage(error: unknown): string {
  let message = ""
  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === "object") {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown }
    const parts = [record.message, record.details, record.hint]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    message = parts.join(" — ")
  } else if (typeof error === "string") {
    message = error
  }

  if (!message.trim()) {
    return "Error al guardar el puesto"
  }
  if (
    message.includes("organization_positions_entity_code_unique") ||
    message.includes("organization_positions_job_id_code_unique")
  ) {
    return "Conflicto de código, inténtalo de nuevo"
  }
  return message
}

/**
 * Ordena los puestos respetando:
 *   1. El orden del área (`area.hierarchy_order`, luego `area.name`).
 *   2. Dentro del área, el orden del cargo (`job.hierarchy_order`, luego `job.name`).
 *   3. Dentro del cargo, el orden del puesto (`position.position_order`, luego `position.name`).
 */
export function sortPositionsByHierarchyOrder<
  T extends {
    name: string
    position_order?: number
    job_id?: string
    job?: {
      id?: string
      name?: string | null
      hierarchy_order?: number
      area_id?: string
      area?: { id?: string | null; name?: string | null; hierarchy_order?: number } | null
    } | null
  },
>(
  positions: T[],
  areas: { id: string; name: string; hierarchy_order: number }[] = [],
  jobs: { id: string; name: string; hierarchy_order: number; area_id: string }[] = []
): T[] {
  const areaById = new Map(areas.map((a) => [a.id, a]))
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  return [...positions].sort((a, b) => {
    const jobIdA = a.job_id || a.job?.id || ""
    const jobIdB = b.job_id || b.job?.id || ""
    const jobA = jobById.get(jobIdA)
    const jobB = jobById.get(jobIdB)

    const areaIdA = jobA?.area_id || a.job?.area_id || a.job?.area?.id || ""
    const areaIdB = jobB?.area_id || b.job?.area_id || b.job?.area?.id || ""
    const areaA = areaById.get(areaIdA)
    const areaB = areaById.get(areaIdB)

    const areaOrderA =
      areaA?.hierarchy_order ?? a.job?.area?.hierarchy_order ?? Number.MAX_SAFE_INTEGER
    const areaOrderB =
      areaB?.hierarchy_order ?? b.job?.area?.hierarchy_order ?? Number.MAX_SAFE_INTEGER
    if (areaOrderA !== areaOrderB) return areaOrderA - areaOrderB

    const areaNameA = areaA?.name || a.job?.area?.name || ""
    const areaNameB = areaB?.name || b.job?.area?.name || ""
    const areaNameCmp = areaNameA.localeCompare(areaNameB)
    if (areaNameCmp !== 0) return areaNameCmp

    const jobOrderA =
      jobA?.hierarchy_order ?? a.job?.hierarchy_order ?? Number.MAX_SAFE_INTEGER
    const jobOrderB =
      jobB?.hierarchy_order ?? b.job?.hierarchy_order ?? Number.MAX_SAFE_INTEGER
    if (jobOrderA !== jobOrderB) return jobOrderA - jobOrderB

    const jobNameA = jobA?.name || a.job?.name || ""
    const jobNameB = jobB?.name || b.job?.name || ""
    const jobNameCmp = jobNameA.localeCompare(jobNameB)
    if (jobNameCmp !== 0) return jobNameCmp

    const posOrderA = a.position_order ?? 0
    const posOrderB = b.position_order ?? 0
    if (posOrderA !== posOrderB) return posOrderA - posOrderB

    return a.name.localeCompare(b.name)
  })
}

