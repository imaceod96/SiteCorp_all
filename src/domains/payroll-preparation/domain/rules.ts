import type {
  PrenominaClaConfig,
  PrenominaNightInput,
  PrenominaStatus,
  PrenominaWorkerEntry,
} from "./entities"

/**
 * Prenómina — Reglas, cálculos y validaciones puras (Domain).
 *
 * El cálculo DEFINITIVO vive en la base de datos (RPC `prenomina_*`): este módulo reproduce
 * EXACTAMENTE las mismas constantes y fórmulas para previsualizar en la interfaz y para
 * exportar. No introduce conceptos, tarifas ni redondeos nuevos.
 *
 * CLA y Nocturnidad son conceptos DISTINTOS e independientes y ambos coexisten.
 */

/** Regla fija de negocio: divisor de horas del salario escala. NO depende del mes. */
export const MONTHLY_SALARY_HOURS_DIVISOR = 190.6

/** Tarifa adicional nocturnidad — Tramo 19:00–23:00 (CUP/hora). */
export const NIGHT_RATE_19_23 = 0.6

/** Tarifa adicional nocturnidad — Tramo 23:00–07:00 (CUP/hora). */
export const NIGHT_RATE_23_07 = 1.15

export const PRENOMINA_STATUS_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  CERRADA: "Cerrada",
}

export const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

/** ¿El período está cerrado (sólo consulta, sin captura)? */
export const isPeriodClosed = (status: PrenominaStatus | string | null | undefined): boolean =>
  status === "CERRADA"

/** ¿Puede verse la prenómina con estos permisos? `prenomina.view` o `prenomina.manage`. */
export const canViewPrenomina = (permissions: string[]): boolean =>
  permissions.includes("prenomina.view") || permissions.includes("prenomina.manage")

/** ¿Puede capturarse/cerrarse la prenómina con estos permisos? `prenomina.manage`. */
export const canManagePrenomina = (permissions: string[]): boolean =>
  permissions.includes("prenomina.manage")

// ---------------------------------------------------------------------------
// Configuración CLA del período
// ---------------------------------------------------------------------------

/** Construye la configuración CLA a partir del snapshot congelado del registro. */
export function claConfigFromEntry(entry: PrenominaWorkerEntry): PrenominaClaConfig {
  const t = (value: string | null | undefined) => (value ? String(value).slice(0, 5) : null)
  return {
    applicable: entry.cla_day_enabled || entry.cla_night_enabled,
    day_enabled: entry.cla_day_enabled,
    day_rate: entry.cla_day_hourly_rate,
    night_enabled: entry.cla_night_enabled,
    night1_start: t(entry.cla_night1_start),
    night1_end: t(entry.cla_night1_end),
    night1_rate: entry.cla_night1_hourly_rate,
    night2_start: t(entry.cla_night2_start),
    night2_end: t(entry.cla_night2_end),
    night2_rate: entry.cla_night2_hourly_rate,
  }
}

// ---------------------------------------------------------------------------
// Nocturnidad (tramos fijos 19:00–23:00 y 23:00–07:00)
// ---------------------------------------------------------------------------

export interface NightOverlapHours {
  hours19_23: number
  hours23_07: number
}

const timeToMinutes = (time: string): number => {
  const [h, m] = String(time || "00:00").split(":")
  return Number(h) * 60 + Number(m || 0)
}

/**
 * Horas reales del horario introducido que se solapan con cada tramo nocturno,
 * contemplando horarios que cruzan medianoche (19:00 → 07:00) y parciales.
 */
export function computeNightOverlapHours(start: string, end: string): NightOverlapHours {
  const s = timeToMinutes(start)
  let e = timeToMinutes(end)
  if (e <= s) e += 1440

  const overlap = (a: number, b: number) => Math.max(0, Math.min(e, b) - Math.max(s, a))

  let m1 = 0
  let m2 = 0
  for (const k of [-1440, 0, 1440]) {
    m1 += overlap(1140 + k, 1380 + k) // 19:00–23:00
    m2 += overlap(1380 + k, 1860 + k) // 23:00–07:00 (cruza medianoche)
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  return { hours19_23: round2(m1 / 60), hours23_07: round2(m2 / 60) }
}

export interface NightPreview {
  hours19_23: number
  hours23_07: number
  payment19_23: number
  payment23_07: number
  totalPayment: number
}

export function computeNightPreview(start: string, end: string, nights: number): NightPreview {
  const { hours19_23, hours23_07 } = computeNightOverlapHours(start, end)
  const safeNights = Math.max(0, nights || 0)
  const payment19_23 = Math.round(hours19_23 * NIGHT_RATE_19_23 * safeNights * 100) / 100
  const payment23_07 = Math.round(hours23_07 * NIGHT_RATE_23_07 * safeNights * 100) / 100
  return {
    hours19_23,
    hours23_07,
    payment19_23,
    payment23_07,
    totalPayment: Math.round((payment19_23 + payment23_07) * 100) / 100,
  }
}

// ---------------------------------------------------------------------------
// CLA — Condiciones Laborales Anormales
// ---------------------------------------------------------------------------

export interface ClaPreviewInput {
  applied: boolean
  dayEnabled: boolean
  dayRate: number | null
  dayMinutes: number
  nightEnabled: boolean
  night1Rate: number | null
  night1Minutes: number
  night2Rate: number | null
  night2Minutes: number
}

export interface ClaPreview {
  dayHours: number
  dayPayment: number
  night1Hours: number
  night1Payment: number
  night2Hours: number
  night2Payment: number
  totalPayment: number
}

/**
 * Previsualiza el CLA de un trabajador en el período (espejo de prenomina_recalc_entry).
 * Cada tramo es independiente: horas = minutos / 60 ; importe = horas × tarifa del tramo.
 * No redondea prematuramente las horas (4 decimales) y aplica la política monetaria
 * de Prenómina (2 decimales) al importe. NO tiene relación con la Nocturnidad.
 */
export function computeClaPreview(input: ClaPreviewInput): ClaPreview {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4
  const dayHours = input.applied && input.dayEnabled ? r4((input.dayMinutes || 0) / 60) : 0
  const dayPayment = input.applied && input.dayEnabled ? r2(dayHours * Number(input.dayRate || 0)) : 0
  const night1Hours = input.applied && input.nightEnabled ? r4((input.night1Minutes || 0) / 60) : 0
  const night1Payment = input.applied && input.nightEnabled ? r2(night1Hours * Number(input.night1Rate || 0)) : 0
  const night2Hours = input.applied && input.nightEnabled ? r4((input.night2Minutes || 0) / 60) : 0
  const night2Payment = input.applied && input.nightEnabled ? r2(night2Hours * Number(input.night2Rate || 0)) : 0
  return {
    dayHours,
    dayPayment,
    night1Hours,
    night1Payment,
    night2Hours,
    night2Payment,
    totalPayment: r2(dayPayment + night1Payment + night2Payment),
  }
}

// ---------------------------------------------------------------------------
// Previsualización total del trabajador
// ---------------------------------------------------------------------------

export interface EntryPreview {
  hourlyRate: number
  workedHours: number
  scaleSalaryPayment: number
  tenureHourlyRate: number
  tenurePayment: number
  academicHourlyRate: number
  academicPayment: number
  claTotalPayment: number
  nightPayment19_23: number
  nightPayment23_07: number
  totalNightPayment: number
  totalPayment: number
}

export function computeEntryPreview(
  salaryScaleAmount: number | null,
  tenureBaseAmount: number | null,
  workdayHours: number | null,
  workedDays: number,
  nights: NightPreview[],
  academicMonthlyAmount: number | null = null,
  cla: ClaPreview | null = null
): EntryPreview {
  const hourlyRate =
    salaryScaleAmount && salaryScaleAmount > 0
      ? Math.round((salaryScaleAmount / MONTHLY_SALARY_HOURS_DIVISOR) * 1e6) / 1e6
      : 0
  // Antigüedad: mismo divisor y MISMAS horas trabajadas que el salario escala.
  const tenureHourlyRate =
    tenureBaseAmount && tenureBaseAmount > 0
      ? Math.round((tenureBaseAmount / MONTHLY_SALARY_HOURS_DIVISOR) * 1e6) / 1e6
      : 0
  // Categoría académica: mismo divisor y MISMAS horas trabajadas (concepto mensual).
  const academicHourlyRate =
    academicMonthlyAmount && academicMonthlyAmount > 0
      ? Math.round((academicMonthlyAmount / MONTHLY_SALARY_HOURS_DIVISOR) * 1e6) / 1e6
      : 0
  const workedHours = Math.round((workedDays || 0) * (workdayHours || 0) * 1e4) / 1e4
  const scaleSalaryPayment = Math.round(workedHours * hourlyRate * 100) / 100
  const tenurePayment = Math.round(workedHours * tenureHourlyRate * 100) / 100
  const academicPayment = Math.round(workedHours * academicHourlyRate * 100) / 100
  const nightPayment19_23 = Math.round(nights.reduce((acc, n) => acc + n.payment19_23, 0) * 100) / 100
  const nightPayment23_07 = Math.round(nights.reduce((acc, n) => acc + n.payment23_07, 0) * 100) / 100
  const totalNightPayment = Math.round((nightPayment19_23 + nightPayment23_07) * 100) / 100
  const claTotalPayment = cla ? cla.totalPayment : 0
  return {
    hourlyRate,
    workedHours,
    scaleSalaryPayment,
    tenureHourlyRate,
    tenurePayment,
    academicHourlyRate,
    academicPayment,
    claTotalPayment,
    nightPayment19_23,
    nightPayment23_07,
    totalNightPayment,
    totalPayment:
      Math.round(
        (scaleSalaryPayment + tenurePayment + academicPayment + totalNightPayment + claTotalPayment) * 100
      ) / 100,
  }
}

// ---------------------------------------------------------------------------
// Validaciones de captura (mismos mensajes que ya ve el usuario)
// ---------------------------------------------------------------------------

/** Los días trabajados no pueden ser negativos. */
export function validateWorkedDays(workedDays: number): string | null {
  return workedDays < 0 ? "Los días trabajados no pueden ser negativos" : null
}

/** Cada registro nocturno necesita horario y noches mayores que cero. */
export function validateNightInput(input: PrenominaNightInput): string | null {
  if (!input.start || !input.end) return "Cada registro nocturno debe tener hora de inicio y fin"
  if (input.nights <= 0) return "Las noches trabajadas deben ser mayores que cero"
  return null
}

/**
 * Lee los minutos CLA capturados: vacío = 0; sólo enteros >= 0.
 * Devuelve el error exacto que se muestra al usuario junto al tramo afectado.
 */
export function validateClaMinutes(
  raw: string,
  label: string
): { minutes: number; error: string | null } {
  const trimmed = raw.trim()
  if (trimmed === "") return { minutes: 0, error: null }
  if (!/^\d+$/.test(trimmed)) {
    return {
      minutes: 0,
      error: `${label}: los minutos deben ser un número entero mayor o igual que 0`,
    }
  }
  return { minutes: Number(trimmed), error: null }
}

/**
 * Horarios nocturnos que se conservan al guardar un registro: identifica los que el usuario
 * eliminó (existían antes y ya no están) para borrarlos en el backend.
 */
export const deletedNightIds = (
  originalIds: string[],
  rows: Pick<PrenominaNightInput, "id">[]
): string[] => {
  const keptIds = rows.map((row) => row.id).filter((id): id is string => !!id)
  return originalIds.filter((id) => !keptIds.includes(id))
}

