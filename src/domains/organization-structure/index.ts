/**
 * Barrel público del dominio de estructura organizativa.
 *
 * Reexporta explícitamente los símbolos originales de los módulos migrados
 * para preservar la interfaz pública durante la migración DDD.
 */

// --- Tipos e interfaces ---
export type { OccupationalCategory } from "./domain/entities"
export type { PreparationLevel } from "./domain/entities"
export type { WeekDay } from "./domain/entities"
export type { PositionScheduleSegment } from "./domain/entities"
export type { PositionWorkInfo } from "./domain/entities"

// --- Constantes de etiqueta ---
export { NO_OCCUPATIONAL_CATEGORY_LABEL } from "./infrastructure/catalogs.repository"
export { NO_PREPARATION_LEVEL_LABEL } from "./infrastructure/catalogs.repository"
export { NO_WORK_INFO_LABEL } from "./domain/rules"
export { WEEK_DAYS } from "./domain/rules"

// --- Funciones de formato (puras) ---
export {
  weekDayLabel,
  weekDayShort,
  formatTime,
  formatHoursValue,
  formatDayRange,
  formatScheduleSummary,
  formatScheduleByDay,
  formatJornada,
  formatBreak,
  hasWorkInfo,
} from "./domain/formatters"

// --- Funciones de infraestructura: catálogos ---
export {
  fetchOccupationalCategories,
  occupationalCategoryLabel,
  hasOccupationalCategory,
  fetchPreparationLevels,
  fetchJobPreparationLevels,
  formatPreparationLevels,
} from "./infrastructure/catalogs.repository"

// --- Funciones de infraestructura: horarios ---
export {
  fetchEntityScheduleSegments,
  fetchPositionScheduleSegments,
} from "./infrastructure/schedule.repository"

// --- Puestos: jerarquía (Área → Cargo → Puesto) ---
export type { PositionHierarchyEntry } from "./infrastructure/positions.repository"
export { fetchEntityPositionHierarchy } from "./infrastructure/positions.repository"

// --- Plantilla operativa: entidad y cargos ---
export type { EntityStaffingJob } from "./infrastructure/entity-staffing.repository"
export {
  fetchEntityName,
  fetchEntityStaffingJobs,
} from "./infrastructure/entity-staffing.repository"

// --- Plantilla operativa: plazas y vacantes (reglas puras) ---
export type { PositionCapacity } from "./domain/staffing.rules"
export {
  sumAuthorizedPlazas,
  vacantPlazas,
  capacityFromRows,
  buildPositionCapacity,
} from "./domain/staffing.rules"

// --- Salario: tipos ---
export type { SalaryValue } from "./domain/entities"
export type { SalaryGroupRef } from "./domain/entities"

// --- Salario: funciones puras ---
export { salaryForGroup } from "./domain/rules"
export { formatSalary } from "./domain/formatters"

// --- Salario: infraestructura ---
export {
  resolveApplicableScaleId,
  fetchSalaryValuesForGroups,
} from "./infrastructure/salary.repository"

// --- Anexo 14: tipos ---
export type { Anexo14Row } from "./domain/entities"
export type { Anexo14Filters } from "./domain/entities"
export type { Anexo14Meta } from "./domain/entities"

// --- Anexo 14: constantes ---
export { ANEXO_14_HEADERS } from "./domain/rules"
export { NO_CATEGORY_VALUE } from "./domain/rules"
export { NOT_CONFIGURED_VALUE } from "./domain/rules"

// --- Anexo 14: funciones de formato (puras) ---
export { buildAnexo14FileName } from "./domain/formatters"

// --- Anexo 14: infraestructura ---
export { fetchAnexo14Rows } from "./infrastructure/positions-export.repository"
export {
  buildAnexo14WorkbookBlob,
  saveAnexo14Blob,
} from "./infrastructure/positions-export.workbook"

// --- Anexo14B (plantilla con trabajadores): tipos ---
export type { StaffingExportRow } from "./domain/entities"
export type { StaffingExportMeta } from "./domain/entities"

// --- Anexo14B: constantes ---
export { ANEXO14_HEADERS } from "./domain/rules"

// --- Anexo14B: funciones de formato (puras) ---
export { buildAnexo14BFileName } from "./domain/formatters"
export { formatService } from "./domain/formatters"

// --- Anexo14B: infraestructura ---
export { fetchStaffingExportRows } from "./infrastructure/staffing-export.repository"
export {
  buildStaffingWorkbookBlob,
  saveStaffingExcelBlob,
} from "./infrastructure/staffing-export.workbook"
