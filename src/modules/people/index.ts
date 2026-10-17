/**
 * Personas — Interfaz pública del dominio.
 *
 * Punto único de entrada para los consumidores (páginas y componentes):
 *   · domain/entities.ts        → identidad de persona, filas de cada vista y comandos
 *   · domain/rules.ts           → clasificación excluyente, ficha, validación del alta y
 *                                 reglas de las transiciones laborales (efecto esperado y
 *                                 validaciones previas con sus mensajes)
 *   · domain/tenure.rules.ts    → antigüedad y edad del trabajador (cálculo de calendario):
 *                                 la ÚNICA implementación en TypeScript del cálculo
 *   · application/              → casos de uso de las tres vistas, del alta y de la
 *                                 contratación y las transiciones
 *   · infrastructure/           → repositorios (consultas Supabase, RPC y Storage) y el
 *                                 adaptador del Excel de la Carga inicial
 *
 * El dominio NO importa de la presentación ni de otros dominios: la dependencia va siempre en
 * un solo sentido (presentación → aplicación → dominio → infraestructura → Supabase), así
 * que no puede formarse ningún ciclo. Las páginas consumen CASOS DE USO: no componen
 * consultas ni repiten el criterio de clasificación. La única utilidad compartida que usa la
 * frontera de Storage es el saneado de nombres de archivo de `@/lib/documents` (junto a la
 * estructura organizativa), porque define la compatibilidad de las rutas ya almacenadas.
 *
 * Alcance de este bloque: registro y ciclo laboral de Personas (Candidatos · Trabajadores
 * · Reingresos), contratación y transiciones laborales (baja, reincorporación, reubicación
 * y cambio de contrato). Los expedientes detallados (ficha de candidato y de trabajador)
 * siguen en su módulo actual.
 */

/* Entidades, estados y comandos */
export type {
  PeopleView,
  PersonIdentity,
  EmploymentRecord,
  EmploymentIndex,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonReentryWorker,
  PersonSeparation,
  CatalogRow,
  CatalogOption,
  PersonRegistryCatalogs,
  PersonIdentificationStatus,
  CandidateRegistrationInput,
  SalaryGroupRef,
  PositionJobRef,
  StaffingPosition,
  PositionOccupant,
  EntityOccupancy,
  ContractTypeOption,
  WorkerIdentity,
  SeparationReason,
  EmploymentLink,
  HireablePerson,
  ReadinessItem,
  ReadinessSection,
  ReadinessResult,
  ContractReadinessParams,
  WorkerTransitionKind,
  TransitionEffect,
  ContractFormalizationInput,
  CompensationComponentPayload,
  ResolutionFormalizationInput,
  CandidateHireInput,
  CandidateHireWithResolutionInput,
  WorkerReincorporationInput,
  WorkerReincorporationWithResolutionInput,
  WorkerSeparationInput,
  WorkerContractChangeInput,
  WorkerPositionChangeInput,
  PluriemployContractInput,
  PluriemployResult,
  ContractualChange,
  PositionChangePreview,
  PositionChangeAddendum,
  WorkerPositionChangeResult,
  WorkerEngagementResult,
  WorkerContractChangeResult,
} from "./domain/entities"

export { EMPLOYMENT_STATUS } from "./domain/entities"

/* Reglas puras */
export {
  PeopleRuleError,
  emptyEmploymentIndex,
  buildEmploymentIndex,
  hasLinkedWorker,
  isPendingCandidate,
  isActiveWorker,
  isReentryWorker,
  filterUnlinkedCandidates,
  filterActiveWorkers,
  filterReentryWorkers,
  personFullName,
  missingPersonProfileFields,
  candidateRequiresSpecialty,
  convertDisplayDateToISO,
  validateCandidateRegistration,
  personRegistrationConflict,
  TRANSITION_EFFECTS,
  transitionEffect,
  TRANSITION_MOVEMENT_DOCUMENT,
  requiresResolution,
  isSpecialDocumentRole,
  READINESS_SECTION_LABELS,
  READINESS_SECTION_ORDER,
  formatReadinessMessage,
  validateSignaturePlace,
  validatePaymentMethod,
  validateCompensationComponents,
  validateFormalizationPending,
  validateRepresentative,
  validateContractEndDate,
  validateHireInput,
  validateReincorporationInput,
  validateSeparationInput,
  validateContractChangeInput,
  validatePositionChangeInput,
  MISSING_SIGNATURE_PLACE_MESSAGE,
  MISSING_PAYMENT_METHOD_MESSAGE,
  INVALID_COMPONENTS_MESSAGE,
  MISSING_REPRESENTATIVE_MESSAGE,
  MISSING_HIRING_REPRESENTATIVE_MESSAGE,
} from "./domain/rules"

export type {
  HireValidationInput,
  ReincorporationValidationInput,
  SeparationValidationInput,
  ContractChangeValidationInput,
  PositionChangeValidationInput,
} from "./domain/rules"

/* Casos de uso (lectura) */
export type {
  EntityCandidatesView,
  EntityWorkersDirectoryView,
  EntityReentriesView,
} from "./application/people.queries"

export {
  loadEntityCandidatesView,
  loadEntityWorkersDirectory,
  loadEntityReentriesView,
  loadCandidateRegistryCatalogs,
  loadEntityActiveWorkerOptions,
  loadMigrationTemplateData,
  loadPersonIdentificationStatus,
} from "./application/people.queries"

/* Casos de uso (contratación y transiciones) */
export type {
  EntityStaffingBoard,
  TransitionWorkspace,
  ContractChangeWorkspace,
  HiringWorkspace,
} from "./application/staffing.queries"

export {
  CONTRACT_DATA_PERMISSION,
  loadEntityStaffingBoard,
  loadTransitionWorkspace,
  loadContractChangeWorkspace,
  loadHiringWorkspace,
  previewPositionChange,
  loadSeparationReasons,
} from "./application/staffing.queries"

export {
  checkHiringReadiness,
  checkCandidateContractReadiness,
  checkPositionContractReadiness,
} from "./application/contract-readiness.queries"

export type { EngagementOutcome } from "./application/hiring.commands"

export { hireCandidateWithContract, hireCandidateWithResolution } from "./application/hiring.commands"

export type {
  ReincorporationOutcome,
  PositionChangeOutcome,
  ContractChangeOutcome,
  PluriemployOutcome,
} from "./application/worker-transitions.commands"

export {
  registerWorkerSeparation,
  reincorporateWorkerWithContract,
  reincorporateWorkerWithResolution,
  changeWorkerPosition,
  changeWorkerContract,
  createWorkerPluriemploy,
} from "./application/worker-transitions.commands"

/* Pluriempleo: vocabulario, lectura de contratos vigentes e identificación del contrato */
export {
  PLURIEMPLEO_ENABLED,
  PLURIEMPLEO_LABEL,
  PLURIEMPLEO_MAX_ACTIVE_CONTRACTS,
  PLURIEMPLEO_MOVEMENT_TYPE,
  PLURIEMPLEO_DISABLED_MESSAGE,
  PLURIEMPLEO_TARGET_REQUIRED_MESSAGE,
  EMPLOYMENT_MOVEMENT_LABELS,
  employmentMovementLabel,
  activeContractsOf,
  activeAssignmentsOf,
  hasPluriempleo,
  canOfferPluriempleo,
  resolveContractTarget,
  selectedContractOf,
  assignmentOfContract,
  validatePluriemployInput,
} from "./domain/pluriempleo.rules"

export type { ContractTarget, PluriemployValidationInput } from "./domain/pluriempleo.rules"

/* Casos de uso (escritura) */
export type { RegisterCandidateCommand } from "./application/people.commands"

export { registerCandidate } from "./application/people.commands"

/* Expediente de la persona: ficha de candidato y ficha de trabajador */
export type {
  ExpedientePermissions,
  DocumentTypeOption,
  ExpedienteDocumentRow,
  ExpedienteDocumentRef,
  CandidateWorkExperienceRow,
  CandidateAcademicFormationRow,
  CandidateNoteRow,
  CandidateAdditionalInfoRow,
  CandidateExpediente,
  CandidateExpedienteRelated,
  CandidateExpedienteInput,
  CandidateWorkExperienceInput,
  CandidateAcademicFormationInput,
  CandidateTextEntryInput,
  WorkerExpediente,
  WorkerAssignmentRow,
  WorkerContractRow,
  WorkerPositionRef,
  WorkerJobRef,
  WorkerEmploymentMovement,
  TenurePaymentRule,
  WorkerExpedienteCatalogs,
  WorkerExpedienteInput,
  NewWorkerInput,
  WorkerContractFormalizationInput,
} from "./domain/entities"

export {
  MISSING_BIRTH_DATE_MESSAGE,
  MISSING_PROFESSION_MESSAGE,
  MISSING_ADDRESS_MESSAGE,
  MISSING_PROVINCE_MESSAGE,
  MISSING_MUNICIPALITY_MESSAGE,
  INVALID_COMPONENTS_EXPEDIENTE_MESSAGE,
  validatePersonProfileFields,
  validateSpecialtyRequirement,
  validateVerificationDocuments,
  validateEmail,
  validateWorkerPersonalData,
  validateWorkerRegistrationInput,
  validateWorkerContractInput,
  validateWorkExperienceInput,
  validateAcademicFormationInput,
  validateExpedienteText,
  shouldUploadVerificationDocument,
  specialtyForEducationLevel,
} from "./domain/rules"

export type {
  WorkerPersonalDataValidationInput,
  WorkerRegistrationValidationInput,
  WorkerContractValidationInput,
  WorkExperienceValidationInput,
  AcademicFormationValidationInput,
} from "./domain/rules"

export type {
  CandidateExpedienteView,
  CandidateExpedientePermissions,
  CandidateExpedienteCatalogs,
  CandidateFormCatalogs,
  CandidateFormView,
} from "./application/candidate-expediente.queries"

export {
  loadCandidateExpedienteView,
  loadCandidateExpedienteReferenceData,
  loadCandidateExpedienteRelated,
  loadCandidateFormCatalogs,
  loadCandidateFormData,
} from "./application/candidate-expediente.queries"

export type { CandidateExpedienteUpdateInput } from "./application/candidate-expediente.commands"

export {
  updateCandidateExpediente,
  addCandidateExpedienteDocument,
  removeCandidateExpedienteDocument,
  downloadCandidateExpedienteDocument,
  addCandidateWorkExperience,
  removeCandidateWorkExperience,
  addCandidateAcademicFormation,
  removeCandidateAcademicFormation,
  addCandidateNote,
  removeCandidateNote,
  addCandidateAdditionalInfo,
  removeCandidateAdditionalInfo,
} from "./application/candidate-expediente.commands"

export type {
  WorkerExpedienteView,
  WorkerExpedientePermissions,
  WorkerFormPermissions,
} from "./application/worker-expediente.queries"

export {
  loadWorkerExpedienteView,
  loadWorkerReferenceCatalogs,
  loadWorkerFormPermissions,
  loadWorkerExpedienteLicenseIds,
} from "./application/worker-expediente.queries"

export {
  saveWorkerExpedientePersonalData,
  saveWorkerExpedienteLicenseIds,
  checkWorkerIdentification,
  createWorkerExpediente,
  registerWorkerExpedienteContract,
} from "./application/worker-expediente.commands"

/* Expediente DOCUMENTAL del trabajador (pestaña «Documentos» del expediente) */
export type {
  WorkerDocumentRow,
  WorkerDocumentContractRef,
  WorkerDocumentsView,
  NewWorkerDocumentRecord,
  EntityWorkerOption,
  MigrationTemplateData,
  MigrationTemplateCatalogItem,
  MigrationTemplateJob,
  MigrationTemplatePosition,
  MigrationTemplateRepresentative,
} from "./domain/entities"

export { loadWorkerDocumentsView } from "./application/worker-documents.queries"

/* Catálogos globales de la persona (color de piel y licencias de conducción) */
export { drivingLicenseLabels } from "./domain/catalogs.rules"
export { fetchPersonCatalogs } from "./infrastructure/catalogs.repository"

export {
  EXPEDIENTE_SIGNED_URL_TTL,
  uploadWorkerDocument,
  openWorkerDocument,
  downloadWorkerDocument,
  deleteWorkerDocument,
} from "./application/worker-documents.commands"

/* Plantilla operativa: trabajadores con su trayectoria de puestos y ocupación */
export type { StaffingWorkerAssignment, StaffingWorkerRow } from "./domain/entities"

export {
  isCurrentStaffingAssignment,
  currentStaffingAssignment,
  isActiveStaffingWorker,
  activeStaffingWorkers,
  pendingStaffingWorkers,
  occupiedStaffingWorkers,
  countAssignmentsByPosition,
} from "./domain/staffing.rules"

export type { EntityStaffingWorkspace } from "./application/staffing.queries"
export { loadEntityStaffingWorkspace } from "./application/staffing.queries"

/* Carga inicial de trabajadores (migración) */
export type {
  MigrationRow,
  MigrationPreviewRow,
  MigrationBatchRow,
  MigrationBatchHistory,
  WorkerMigrationCatalogs,
  WorkerMigrationImportResult,
  WorkerMigrationCreatedWorker,
  WorkerMigrationLinkedWorker,
} from "./domain/entities"

export type { MigrationCatalogIndexes, MigrationCatalogMaps } from "./domain/worker-migration.rules"

export {
  MIGRATION_IDENTIFICATION_PATTERN,
  MIGRATION_VACATION_BALANCE_MIN,
  MIGRATION_VACATION_BALANCE_MAX,
  MIGRATION_HISTORY_LIMIT,
  migrationCatalogIndexes,
  migrationCatalogMaps,
  mapMigrationCatalogValue,
  mapMigrationRowValues,
  validateMigrationRow,
  buildMigrationBatchHistory,
} from "./domain/worker-migration.rules"

export {
  mapMigrationRows,
  validateWorkerMigration,
  loadEntityMigrationHistory,
} from "./application/worker-migration.queries"

export {
  importWorkerMigration,
  createMigratedWorker,
  linkMigratedWorker,
} from "./application/worker-migration.commands"

/* Formato del archivo de la Carga inicial (plantilla oficial y lectura del .xlsx) */
export {
  MIGRATION_HEADERS,
  buildWorkerMigrationTemplate,
  downloadWorkerMigrationTemplate,
  readWorkerMigrationExcel,
  WorkerMigrationTemplateError,
} from "./infrastructure/worker-migration.workbook"

export type { WorkerMigrationFileErrorCode } from "./infrastructure/worker-migration.workbook"

/* Trayectoria laboral: antigüedad y edad del trabajador (reglas puras) */
export type { TenureResult } from "./domain/tenure.rules"

export { calculateTenure, calculateAge, ageRange } from "./domain/tenure.rules"
