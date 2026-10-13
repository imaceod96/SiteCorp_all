/**
 * Catálogos globales y estructura organizativa.
 *
 * Los catálogos (categorías ocupacionales, niveles de preparación) son GLOBALES de SiteCorp:
 * no tienen tenant_id ni organization_entity_id. Todos los workspaces y entidades consumen
 * exactamente los mismos valores.
 */

/** Categoría ocupacional global (Operario, Administrativo, Servicios, Técnico…). */
export interface OccupationalCategory {
  id: string
  name: string
  code: string
  sort_order: number
  is_active: boolean
}

/** Nivel de preparación global (NS, TM, etc.). */
export interface PreparationLevel {
  id: string
  name: string
  code: string
  sort_order: number
}

/** Día de la semana ISO-8601 (1 = Lunes … 7 = Domingo). */
export interface WeekDay {
  value: number
  label: string
  short: string
}

/** Segmento horario de un puesto (día + rango horario). */
export interface PositionScheduleSegment {
  id?: string
  position_id?: string
  day_of_week: number
  start_time: string
  end_time: string
  crosses_midnight?: boolean
  display_order?: number
}

/** Información laboral del puesto (lugar, jornada, descanso). */
export interface PositionWorkInfo {
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
}

/** Valor salarial vigente de un grupo (resuelto por vigencia temporal en el backend). */
export interface SalaryValue {
  amount: number
  currency_code: string
  effective_from?: string | null
}

/** Referencia mínima al grupo salarial de un cargo. */
export interface SalaryGroupRef {
  id: string
  salary_scale_id: string
  sequence_number: number
}

/* -------------------------------------------------------------------------- */
/* Configuración de la estructura organizativa                                */
/* -------------------------------------------------------------------------- */

/**
 * Área organizativa de una entidad. La jerarquía se expresa con `parent_area_id`
 * (nunca con rutas materiales): el código lo genera un trigger de la base de datos.
 */
export interface OrganizationArea {
  id: string
  organization_entity_id: string
  parent_area_id: string | null
  code: string
  name: string
  description: string | null
  hierarchy_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Nodo del árbol de áreas: el área y sus hijas ya ordenadas. */
export interface AreaNode extends OrganizationArea {
  children: AreaNode[]
}

/** Grupo salarial de un cargo: referencia a la escala y valor vigente. */
export interface SalaryGroupSummary {
  id: string
  salary_scale_id: string
  sequence_number: number
  description: string | null
  is_active: boolean
  current_value: SalaryValue | null
}

/** Cargo de la entidad con su área, su categoría y su grupo salarial. */
export interface OrganizationJob {
  id: string
  organization_entity_id: string
  area_id: string
  code: string
  name: string
  description: string | null
  salary_group_id: string
  hierarchy_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  occupational_category_id: string | null
  required_profession_or_trade: string | null
  work_content: string | null
  is_cuadro: boolean | null
  is_principal_specialist: boolean | null
  /** Condiciones Laborales Anormales (configuración del CARGO). */
  has_abnormal_conditions?: boolean | null
  cla_day_enabled?: boolean | null
  cla_day_hourly_rate?: number | null
  cla_night_enabled?: boolean | null
  area: {
    id: string
    name: string
    code: string
    is_active: boolean
    organization_entity_id: string
  } | null
  occupational_category: { id: string; name: string; code: string } | null
  salary_group: SalaryGroupSummary | null
}

/** Cargo tal como lo muestra un puesto (referencia mínima + área). */
export interface OrganizationPositionJobRef {
  id: string
  name: string
  code: string
  is_active: boolean
  area_id: string
  occupational_category_id: string | null
  area: { id: string; name: string; code: string } | null
  salary_group: SalaryGroupRef | null
}

/** Puesto autorizado de la plantilla con su cargo y su horario habitual. */
export interface OrganizationPosition {
  id: string
  organization_entity_id: string
  job_id: string
  code: string
  name: string
  description: string | null
  position_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  authorized_quantity: number
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  schedule_segments?: PositionScheduleSegment[]
  job: OrganizationPositionJobRef | null
}

/** Tramo nocturno de CLA configurado en el Cargo (tabla hija del cargo). */
export interface JobClaNightSegment {
  segment_order: number
  start_time: string
  end_time: string
  hourly_rate: number
}

/** Valores en crudo del formulario CLA del Cargo (antes de validarse). */
export interface JobClaDraft {
  hasAbnormalConditions: boolean
  dayEnabled: boolean
  dayRate: string
  nightEnabled: boolean
  night1: { start: string; end: string; rate: string }
  night2: { start: string; end: string; rate: string }
}

/** CLA del Cargo ya resuelto: es lo que se escribe en `organization_jobs`. */
export interface JobClaConfig {
  has_abnormal_conditions: boolean
  cla_day_enabled: boolean
  cla_day_hourly_rate: number | null
  cla_night_enabled: boolean
  /** Dos tramos independientes; vacío cuando el pago nocturno está desactivado. */
  night_segments: JobClaNightSegment[]
}

/* -------------------------------------------------------------------------- */
/* Comandos de la configuración de la estructura                              */
/* -------------------------------------------------------------------------- */

/** Alta o edición de un área (el código nunca se envía: lo genera la base de datos). */
export interface SaveAreaInput {
  entityId: string
  areaId: string | null
  name: string
  description: string | null
  parentAreaId: string | null
  hierarchyOrder: number
}

/** Alta o edición de un cargo con su clasificación, retribución y CLA. */
export interface SaveJobInput {
  entityId: string
  jobId: string | null
  name: string
  areaId: string
  description: string | null
  salaryGroupId: string
  hierarchyOrder: number
  occupationalCategoryId: string | null
  requiredProfessionOrTrade: string | null
  workContent: string | null
  isCuadro: boolean
  isPrincipalSpecialist: boolean
  preparationLevelIds: string[]
  cla: JobClaConfig
}

/** Alta o edición de un puesto (una sola llamada atómica con su horario). */
export interface SavePositionInput {
  entityId: string
  positionId: string | null
  jobId: string
  code: string
  name: string
  description: string | null
  authorizedQuantity: number
  workLocation: string | null
  dailyHours: number | null
  weeklyHours: number | null
  monthlyHours: number | null
  breakMinutes: number | null
  scheduleNotes: string | null
  segments: { day_of_week: number; start_time: string; end_time: string; display_order: number }[]
}

/** Cargo disponible en el selector del formulario del puesto. */
export interface PositionJobOption {
  id: string
  name: string
  code: string
  is_active: boolean
  area_id: string
  area: {
    id: string
    name: string
    code: string
  }
  salary_group: {
    id: string
    salary_scale_id: string
    sequence_number: number
  } | null
  /** Clasificación del cargo: se muestra derivada, nunca se edita en el Puesto. */
  occupational_category: { id: string; name: string } | null
  preparation_levels: { id: string; code: string; name: string }[]
}

/** Puesto en edición tal como lo entrega el formulario. */
export interface PositionEditingData {
  id: string
  job_id: string
  code: string
  name: string
  description: string | null
  authorized_quantity: number
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  schedule_segments?: PositionScheduleSegment[]
}

/* -------------------------------------------------------------------------- */
/* Escalas, grupos y valores salariales (administración)                       */
/* -------------------------------------------------------------------------- */

export type SalaryScaleScope = "PRESUPUESTADA_GLOBAL" | "EMPRESARIAL_ENTITY"

/** Escala salarial: presupuestada global (SiteCorp) o empresarial de la entidad. */
export interface SalaryScale {
  id: string
  scope_type: SalaryScaleScope
  tenant_id: string | null
  organization_entity_id: string | null
  regime_id: string
  name: string
  description: string | null
  currency_code: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Grupo salarial (número de secuencia dentro de su escala). */
export interface SalaryGroup {
  id: string
  salary_scale_id: string
  sequence_number: number
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Versión histórica del importe de un grupo. */
export interface SalaryGroupValue {
  id: string
  salary_group_id: string
  amount: number
  currency_code: string
  effective_from: string
  effective_to: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Importe vigente de un grupo con su vigencia. */
export interface SalaryGroupCurrentValue {
  amount: number
  currency_code: string
  effective_from: string
  effective_to: string | null
}

/** Fila devuelta por la RPC resolve_salary_group_values (vigencia temporal por grupo). */
export interface ResolvedSalaryGroupValue extends SalaryGroupCurrentValue {
  salary_group_id: string
}

/** Grupo con su importe vigente y su número romano. */
export interface SalaryGroupWithCurrent {
  group: SalaryGroup
  /** Importe vigente HOY (resolución temporal por effective_from / effective_to). */
  current_value: SalaryGroupCurrentValue | null
  roman_numeral: string
}

/** Escala con sus grupos y los importes vigentes. */
export interface SalaryScaleWithGroups {
  scale: SalaryScale
  groups: SalaryGroupWithCurrent[]
}

/* -------------------------------------------------------------------------- */
/* Anexo 14 — exportación de puestos                                          */
/* -------------------------------------------------------------------------- */

/** Fila del Anexo 14 de Puestos (VISTA DE PUESTOS, sin datos personales). */
export interface Anexo14Row {
  area_name: string | null
  area_code: string | null
  area_order: number
  job_order: number
  job_name: string | null
  position_name: string | null
  position_order: number
  occupational_category: string | null
  authorized_quantity: number
  preparation_levels: string | null
  salary_group_sequence: number | null
}

/** Filtros disponibles para la consulta del Anexo 14 de Puestos. */
export interface Anexo14Filters {
  includeInactive?: boolean
  areaId?: string | null
  jobId?: string | null
}

/** Metadatos de cabecera usados al generar el Anexo 14. */
export interface Anexo14Meta {
  entityName: string
  generatedAt: Date
}

/**
 * Fila del Anexo14B (plantilla con trabajadores): cada capacidad autorizada,
 * ocupada o vacante, con los datos del trabajador que la ocupa si existe.
 */
export interface StaffingExportRow {
  area_id: string | null
  area_name: string | null
  job_id: string | null
  job_name: string | null
  position_id: string | null
  position_name: string | null
  occupational_category: string | null
  worker_id: string | null
  worker_name: string | null
  gender_code: string | null
  identification: string | null
  preparation_level: string | null
  salary_group_sequence: number | null
  salary: number | null
  cla_amount: number | null
  academic_amount: number | null
  academic_category: string | null
  service_start: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
}

/** Metadatos de cabecera usados al generar el Anexo14B. */
export interface StaffingExportMeta {
  entityName: string
  generatedAt: Date
}
