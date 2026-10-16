/**
 * Prenómina — Entidades y contratos de datos (Domain).
 *
 * PRENÓMINA es la preparación MENSUAL del pago de los trabajadores activos de una entidad.
 * Es un módulo INDEPENDIENTE de los Movimientos de Nómina (`@/domains/payroll-movements`):
 * aquí no se registran altas/bajas/reubicaciones, sino la captura y el cálculo del mes.
 *
 * Conceptos del período: Salario Escala + Antigüedad + Categoría académica + Nocturnidad + CLA.
 *   · Nocturnidad → tramos fijos 19:00–23:00 / 23:00–07:00 (`prenomina_night_entries`).
 *   · CLA         → tarifas por hora del Cargo (diurno + dos tramos nocturnos configurables)
 *                   × minutos capturados por trabajador.
 *
 * Estas interfaces describen EXACTAMENTE las columnas y los contratos actuales de la base de
 * datos y de las RPC `prenomina_*`: no se añade, renombra ni elimina ningún campo.
 */

/** Estado del período mensual. Sólo dos estados posibles, como en la base de datos. */
export type PrenominaStatus = "BORRADOR" | "CERRADA"

/** Período mensual de prenómina de una entidad. */
export interface PrenominaPeriod {
  id: string
  organization_entity_id: string
  period_year: number
  period_month: number
  status: PrenominaStatus
  created_at: string
  closed_at: string | null
}

/** Registro de un trabajador en el período, con sus snapshots y sus importes congelados. */
export interface PrenominaWorkerEntry {
  id: string
  period_id: string
  organization_entity_id: string
  worker_id: string
  worker_name_snapshot: string
  identification_snapshot: string | null
  area_name_snapshot: string | null
  job_name_snapshot: string | null
  position_name_snapshot: string | null
  salary_group_id: string | null
  salary_group_sequence: number | null
  salary_scale_id: string | null
  salary_scale_amount: number | null
  salary_currency: string | null
  workday_hours: number | null
  worked_days: number
  worked_hours: number
  hourly_scale_rate: number
  scale_salary_payment: number
  // Antigüedad
  employment_start_date_snapshot: string | null
  tenure_reference_date: string | null
  tenure_years: number | null
  tenure_months: number | null
  tenure_total_months: number | null
  tenure_band_id: string | null
  tenure_band_label: string | null
  tenure_base_amount: number | null
  tenure_hourly_rate: number
  tenure_payment: number
  tenure_status: string
  // Pago por categoría académica (Máster / Doctor) — snapshot del período
  has_masters_degree_snapshot: boolean
  has_doctorate_degree_snapshot: boolean
  academic_category: "MASTER" | "DOCTOR" | null
  academic_status: string
  academic_monthly_amount: number | null
  academic_hourly_rate: number
  academic_payment: number
  // CLA — Condiciones Laborales Anormales (snapshot por trabajador del período)
  cla_applied: boolean
  cla_day_enabled: boolean
  cla_day_used: boolean
  cla_day_hourly_rate: number | null
  cla_day_minutes: number
  cla_day_hours: number
  cla_day_payment: number
  cla_night_enabled: boolean
  cla_night_used: boolean
  cla_night1_start: string | null
  cla_night1_end: string | null
  cla_night1_hourly_rate: number | null
  cla_night1_minutes: number
  cla_night1_hours: number
  cla_night1_payment: number
  cla_night2_start: string | null
  cla_night2_end: string | null
  cla_night2_hourly_rate: number | null
  cla_night2_minutes: number
  cla_night2_hours: number
  cla_night2_payment: number
  cla_total_payment: number
  night_payment_19_23: number
  night_payment_23_07: number
  total_night_payment: number
  total_payment: number
}

/** Registro de nocturnidad de un trabajador en el período. */
export interface PrenominaNightEntry {
  id: string
  worker_entry_id: string
  start_time: string
  end_time: string
  nights_worked: number
  hours_19_23_per_night: number
  hours_23_07_per_night: number
  payment_19_23: number
  payment_23_07: number
  total_payment: number
}

/**
 * Configuración CLA del Cargo ACTUAL del trabajador (para la captura mensual).
 * Se resuelve desde el Assignment/Puesto vigente (RPC `prenomina_cla_config`) o,
 * en períodos CERRADOS, desde el snapshot del propio registro.
 */
export interface PrenominaClaConfig {
  applicable: boolean
  day_enabled: boolean
  day_rate: number | null
  night_enabled: boolean
  night1_start: string | null
  night1_end: string | null
  night1_rate: number | null
  night2_start: string | null
  night2_end: string | null
  night2_rate: number | null
}

/** Metadatos de la exportación a Excel del período. */
export interface PrenominaExportMeta {
  entityName: string
  year: number
  month: number
  status: string
  generatedAt: Date
}

/** Horario nocturno tal y como se captura en el diálogo (aún sin normalizar). */
export interface PrenominaNightInput {
  id: string | null
  start: string
  end: string
  nights: number
}

/** Captura CLA de un trabajador (minutos enteros por modalidad). */
export interface PrenominaClaInput {
  applied: boolean
  dayUsed: boolean
  dayMinutes: number
  nightUsed: boolean
  night1Minutes: number
  night2Minutes: number
}
