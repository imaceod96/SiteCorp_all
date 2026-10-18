/**
 * Barrel público del dominio de estructura organizativa.
 *
 * Reexporta explícitamente los símbolos originales de los módulos migrados
 * para preservar la interfaz pública durante la migración DDD.
 *
 * La dependencia va siempre en un solo sentido:
 *   presentación → aplicación → dominio → infraestructura → Supabase
 * así que no puede formarse ningún ciclo. Las pantallas consumen CASOS DE USO: no componen
 * consultas ni hablan con Supabase.
 *
 * Alcance de este bloque: configuración de la estructura organizativa (áreas, cargos,
 * puestos con su horario y administración de escalas, grupos y valores salariales).
 */

// --- Tipos e interfaces ---
export type { OccupationalCategory } from "./domain/entities"
export type { PreparationLevel } from "./domain/entities"
export type { WeekDay } from "./domain/entities"
export type { PositionScheduleSegment } from "./domain/entities"
export type { PositionWorkInfo } from "./domain/entities"

// --- Configuración de la estructura: entidades ---
export type { OrganizationArea } from "./domain/entities"
export type { AreaNode } from "./domain/entities"
export type { SalaryGroupSummary } from "./domain/entities"
export type { OrganizationJob } from "./domain/entities"
export type { OrganizationPositionJobRef } from "./domain/entities"
export type { OrganizationPosition } from "./domain/entities"
export type { JobClaNightSegment } from "./domain/entities"
export type { JobClaDraft } from "./domain/entities"
export type { JobClaConfig } from "./domain/entities"
export type { PositionJobOption } from "./domain/entities"
export type { PositionEditingData } from "./domain/entities"

// --- Configuración de la estructura: comandos ---
export type { SaveAreaInput } from "./domain/entities"
export type { SaveJobInput } from "./domain/entities"
export type { SavePositionInput } from "./domain/entities"

// --- Escalas, grupos y valores salariales: entidades ---
export type { SalaryScale } from "./domain/entities"
export type { SalaryScaleScope } from "./domain/entities"
export type { SalaryGroup } from "./domain/entities"
export type { SalaryGroupValue } from "./domain/entities"
export type { SalaryGroupCurrentValue } from "./domain/entities"
export type { ResolvedSalaryGroupValue } from "./domain/entities"
export type { SalaryGroupWithCurrent } from "./domain/entities"
export type { SalaryScaleWithGroups } from "./domain/entities"

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

// --- Reglas puras de áreas ---
export {
  areaDescendantIds,
  areaParentOptions,
  buildAreaTree,
  validateAreaInput,
  areaSaveErrorMessage,
} from "./domain/areas.rules"

// --- Reglas puras de cargos ---
export {
  parseJobCla,
  jobSaveErrorMessage,
  validateJobCla,
  validateJobInput,
} from "./domain/jobs.rules"

// --- Reglas puras de puestos ---
export type { PositionFormValidation } from "./domain/positions.rules"
export {
  MAX_AUTHORIZED_QUANTITY,
  addDraftScheduleSegments,
  generatePositionCode,
  normalizeScheduleTime,
  parseNullableNumber,
  positionSaveErrorMessage,
  positionSchedulePayload,
  removeScheduleSegment,
  sortScheduleSegments,
  validatePositionInput,
} from "./domain/positions.rules"

// --- Casos de uso: configuración de plantilla ---
export type { StaffingConfigurationWorkspace } from "./application/staffing-configuration.queries"
export { loadStaffingConfiguration } from "./application/staffing-configuration.queries"

export {
  saveArea,
  saveJob,
  savePosition,
  setAreaActive,
  setJobActive,
  setPositionActive,
} from "./application/staffing-configuration.commands"

// --- Casos de uso: formulario del cargo ---
export type { JobFormScaleInfo, JobFormWorkspace } from "./application/job-form.queries"
export {
  loadCurrentSalaryValueForGroup,
  loadJobFormWorkspace,
} from "./application/job-form.queries"

// --- Casos de uso: administración de escalas salariales ---
export {
  canManageGlobalSalary,
  canManageSalary,
  canViewSalary,
  loadCurrentSalaryGroupValue,
  loadEntityEmpresarialScale,
  loadGlobalPresupuestadaScale,
  loadSalaryGroupValueHistory,
  loadSalaryScaleForEntity,
  loadSalaryScaleWithGroups,
  resolveSalaryValueForGroup,
} from "./application/salary-administration.queries"

export {
  addSalaryGroup,
  addSalaryGroupValue,
  createEntityEmpresarialScale,
  createGlobalPresupuestadaScale,
  deactivateSalaryGroup,
  updateSalaryGroup,
} from "./application/salary-administration.commands"

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

/* ================================================================== */
/* Configuración de entidad: entidades organizativas, escala de        */
/* antigüedad y pago por categoría académica                          */
/* ================================================================== */

// --- Entidades organizativas: tipos ---
export type { EntityRegime } from "./domain/entities"
export type { OrganizationEntity } from "./domain/entities"
export type { OrganizationEntityRow } from "./domain/entities"
export type { OrganizationEntityType } from "./domain/entities"
export type { OrganizationEntityRegime } from "./domain/entities"
export type { OrganizationEntityFormData } from "./domain/entities"
export type { SaveOrganizationEntityInput } from "./domain/entities"

// --- Entidades organizativas: reglas puras ---
export type { OrganizationTree } from "./domain/organization-entities.rules"
export {
  ENTITY_TYPE_OPTIONS,
  STATUS_OPTIONS,
  buildOrganizationEntityPayload,
  buildOrganizationTree,
  describeEntityError,
  generateEntityCode,
  isParentTypeAllowed,
  resolveEntityAncestors,
  resolveParentCandidates,
} from "./domain/organization-entities.rules"

// --- Entidades organizativas: casos de uso ---
export type {
  LoadOrganizationEntityDetailInput,
  OrganizationEntityDetail,
} from "./application/organization-entities.queries"
export {
  loadClientEntities,
  loadEntityRegimes,
  loadEntitySiteCorpFlag,
  loadOrganizationEntity,
  loadOrganizationEntityDetail,
  loadVisibleEntities,
} from "./application/organization-entities.queries"
export {
  deleteOrganizationEntity,
  saveOrganizationEntity,
} from "./application/organization-entities.commands"

// --- Escala de antigüedad: tipos ---
export type { TenureScaleRange } from "./domain/entities"
export type { TenureScaleValues } from "./domain/entities"
export type { TenureScaleFormValues } from "./domain/entities"
export type { TenureScaleUnit } from "./domain/entities"

// --- Escala de antigüedad: reglas puras ---
export {
  EMPTY_TENURE_FORM,
  MONTHS_PER_YEAR,
  formatTenureRange,
  tenureFormToValues,
  tenureRangeToForm,
} from "./domain/tenure-scale.rules"

// --- Escala de antigüedad: casos de uso ---
export { loadTenureScaleRanges } from "./application/tenure-scale.queries"
export {
  createTenureScaleRange,
  deleteTenureScaleRange,
  updateTenureScaleRangeById,
} from "./application/tenure-scale.commands"

// --- Pago por categoría académica: tipos ---
export type { AcademicCategory } from "./domain/entities"
export type { AcademicPaymentScope } from "./domain/entities"
export type { AcademicCategoryPaymentConfig } from "./domain/entities"
export type { AcademicCategoryPaymentResolution } from "./domain/entities"
export type { ParsedAcademicAmount } from "./domain/academic-payment.rules"

// --- Pago por categoría académica: reglas puras ---
export {
  academicCategoryLabel,
  formatAcademicAmount,
  parseAcademicAmount,
  resolveAcademicCategory,
} from "./domain/academic-payment.rules"

// --- Pago por categoría académica: casos de uso ---
export {
  loadAcademicCategoryPayment,
  loadAcademicCategoryPaymentConfig,
  loadAcademicCategoryPaymentForFlags,
} from "./application/academic-payment.queries"
export {
  saveAcademicCategoryPayment,
  saveAcademicCategoryPaymentAmounts,
} from "./application/academic-payment.commands"

// --- Cuenta SiteCorp de la entidad: reglas puras ---
export {
  SITECORP_MODULES_DISABLED_MESSAGE,
  SITECORP_MODULES_DISABLED_TITLE,
  buildAccountCode,
  canUseInternalModules,
  hasSiteCorpAccount,
  organizationFallbackPath,
} from "./domain/account.rules"

// --- Módulos internos de la entidad: catálogo de rutas y permisos ---
export type {
  EntityInternalModule,
  EntityNavEntry,
  EntityNavGroup,
  EntityNavLink,
} from "./domain/entity-modules.catalog"
export {
  ENTITY_INTERNAL_MODULES,
  ENTITY_NAV,
  contractAlertsPath,
} from "./domain/entity-modules.catalog"

// --- Documentos rectores de la entidad: tipos ---
export type {
  GoverningDocument,
  GoverningDocumentEntity,
  GoverningDocumentsWorkspace,
  SaveGoverningDocumentInput,
} from "./domain/entities"

// --- Documentos rectores de la entidad: casos de uso ---
export { loadGoverningDocuments } from "./application/governing-documents.queries"
export {
  downloadGoverningDocument,
  openGoverningDocument,
  removeGoverningDocument,
  saveGoverningDocument,
} from "./application/governing-documents.commands"
