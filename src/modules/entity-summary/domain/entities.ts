/**
 * Informes demográficos del Resumen de entidad.
 *
 * Principios (nunca se rompen):
 *   - La fuente de verdad son los TRABAJADORES ACTIVOS. Ni Candidates, ni Workers
 *     dados de baja (Reingresos).
 *   - Un Worker activo SIN Assignment (pendiente de vinculación) CUENTA en los
 *     informes personales (sexo, color de piel, nivel académico, edad).
 *   - El ámbito respeta el scope (Esta entidad / + descendientes vía `entityIds`).
 */

/** Punto (rebanada) de un informe demográfico. */
export type ReportSlice = {
  key: string
  label: string
  value: number
}

/** Informe: trabajadores según edad (agrupados por tramo de edad). */
export interface AgeReport {
  /** Trabajadores activos del ámbito (con o sin fecha de nacimiento). */
  total: number
  byAgeGroup: ReportSlice[]
}

/** Informe: trabajadores según sexo. */
export interface SexReport {
  total: number
  bySex: ReportSlice[]
}

/** Informe: trabajadores según color de piel. */
export interface SkinColorReport {
  total: number
  bySkinColor: ReportSlice[]
}

/** Informe: trabajadores según nivel académico. */
export interface EducationLevelReport {
  total: number
  byEducation: ReportSlice[]
}

export interface WorkersByAgeData {
  total: number
  byAgeGroup: ReportSlice[]
}

/** Catálogos de referencia globales resueltos a nombre real (no código). */
export interface CatalogRefs {
  genderNameById: Record<string, string>
  skinColorNameById: Record<string, string>
  educationNameById: Record<string, string>
}

// ---------------------------------------------------------------------------
// BLOQUE PRINCIPAL — PLANTILLA
// ---------------------------------------------------------------------------

export interface PositionRef {
  id: string
  job_id: string
  authorized_quantity: number
}

export interface PlantillaSummary {
  /** SUM(authorized_quantity) sobre puestos activos/válidos (no nº de registros). */
  authorized: number
  positionsTotal: number
  positions: PositionRef[]
  areaByJob: Record<string, string | null>
  categoryByJob: Record<string, string | null>
  areaNameById: Record<string, string>
  categoryNameById: Record<string, string>
}

// ---------------------------------------------------------------------------
// BLOQUE PRINCIPAL — OCUPACIÓN Y TRABAJADORES ACTIVOS
// ---------------------------------------------------------------------------

export interface OccupancySummary {
  /** Trabajadores con estado laboral activo. */
  activeWorkers: number
  /** Assignments actuales de trabajadores activos (puestos ocupados). */
  occupied: number
  /** Ocupación por puesto (position_id → nº de trabajadores activos). */
  occupiedByPosition: Record<string, number>
}

// ---------------------------------------------------------------------------
// DISTRIBUCIÓN (Área / Categoría ocupacional)
// ---------------------------------------------------------------------------

export interface DistributionSlice {
  key: string
  label: string
  value: number
}

export interface DistributionSummary {
  byArea: DistributionSlice[]
  byCategory: DistributionSlice[]
}

// ---------------------------------------------------------------------------
// VACACIONES (reutiliza el MISMO motor backend `entity_vacation_overview`)
// ---------------------------------------------------------------------------

export interface VacationsSummary {
  active: number
  onVacation: number
  nearLimit: number
  atLimit: number
  averageBalance: number
}

// ---------------------------------------------------------------------------
// ÁMBITO DEL RESUMEN (Esta entidad / Entidad + descendientes)
// ---------------------------------------------------------------------------

/** Ámbito del Resumen: sólo esta entidad, o esta entidad más sus descendientes. */
export type SummaryScope = "self" | "descendants"

export interface EntityScopeInfo {
  /** Entidades incluidas en el ámbito efectivo. */
  entityIds: string[]
  /** Descendientes ACCESIBLES para el usuario (0 = no se ofrece el ámbito ampliado). */
  descendantCount: number
}

// ---------------------------------------------------------------------------
// CANDIDATOS (módulo Candidatos: los mismos estados que gobiernan su vista)
// ---------------------------------------------------------------------------

export interface CandidatesSummary {
  total: number
  active: number
  archived: number
  /** Candidatos con vínculo fiable a un trabajador (contratados). */
  hired: number
}

// ---------------------------------------------------------------------------
// CONTRATOS VIGENTES
// ---------------------------------------------------------------------------

export interface ContractsSummary {
  current: number
  determined: number
  undetermined: number
}

// ---------------------------------------------------------------------------
// MOVIMIENTOS DE PERSONAL (últimos N días)
// ---------------------------------------------------------------------------

export interface MovementsSummary {
  from: string
  to: string
  days: number
  hires: number
  separations: number
  reincorporations: number
  positionChanges: number
  contractChanges: number
}

// ---------------------------------------------------------------------------
// CONFIGURACIÓN / READINESS DE LA ENTIDAD
// ---------------------------------------------------------------------------

export interface ContractDataReadiness {
  ready: boolean
  missing: number
}

export interface RepresentativeStatus {
  ready: boolean
  assigned: number
}

export interface SalaryScaleStatus {
  ready: boolean
}

export interface DocumentTemplatesStatus {
  configured: number
  total: number
}
