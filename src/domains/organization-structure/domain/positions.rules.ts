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

/** Alfabeto sin caracteres ambiguos (0/O, 1/I) para códigos legibles. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Código del puesto: lo genera la interfaz cuando el backend no recibe uno. */
export function generatePositionCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let suffix = ""
  for (let i = 0; i < bytes.length; i++) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return `PST-${suffix}`
}

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

/** Mensaje de error del guardado del puesto (conflicto de código único). */
export function positionSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error al guardar el puesto"
  if (
    message.includes("organization_positions_entity_code_unique") ||
    message.includes("organization_positions_job_id_code_unique")
  ) {
    return "Conflicto de código, inténtalo de nuevo"
  }
  return message
}
