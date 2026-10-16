/**
 * Personas — Entidades y tipos del dominio.
 *
 * Vocabulario del dominio: PERSONA (identificada por su número de identificación
 * dentro de un cliente) → RELACIÓN LABORAL (`workers`) → ESTADO de esa relación.
 * De ahí salen las tres vistas operativas excluyentes: Candidatos (persona todavía
 * sin relación laboral), Trabajadores (relación vigente) y Reingresos (relación
 * finalizada y sin otra vigente).
 *
 * Las definiciones son EXACTAMENTE las que ya consumía la interfaz: la migración a
 * DDD es un traslado estructural, no un cambio de contrato. Los nombres de campo
 * conservan la nomenclatura de las columnas (`first_surname`, `employment_status`…)
 * igual que hacen los demás dominios migrados.
 */

/** Vista operativa en la que aparece una persona. Nunca en dos a la vez. */
export type PeopleView = "candidates" | "workers" | "reentries"

/** Estado laboral tal y como lo escriben las RPC del backend. */
export const EMPLOYMENT_STATUS = {
  active: "active",
  inactive: "inactive",
} as const

/** Identidad de persona: (cliente, número de identificación). */
export interface PersonIdentity {
  identification: string
}

/** Relación laboral registrada para una persona del cliente. */
export interface EmploymentRecord extends PersonIdentity {
  employment_status: string | null
}

/**
 * Índice de relaciones laborales del cliente, por número de identificación.
 * Se construye con las filas de `workers` del cliente (nunca de otro cliente).
 */
export interface EmploymentIndex {
  /** Identificaciones con ALGUNA relación laboral (vigente o finalizada). */
  withAnyWorker: ReadonlySet<string>
  /** Identificaciones con relación laboral VIGENTE. */
  withActiveWorker: ReadonlySet<string>
}

/**
 * Fila de `candidates`: persona PENDIENTE de contratación.
 * `worker_id` es el vínculo con el trabajador creado al contratar (`hire_candidate`);
 * `status` es un campo manual que ninguna parte del sistema pasa a 'archived', por lo
 * que NO se usa para clasificar.
 */
export interface PersonCandidate {
  id: string
  tenant_id: string
  organization_entity_id: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  municipality: string | null
  province: string | null
  education_level_id: string | null
  specialty: string | null
  skin_color_id: string | null
  profession_or_trade: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
  political_affiliation: string | null
  is_retired_or_rehired: boolean | null
  has_disciplinary_measures: boolean | null
  /** Vínculo con el trabajador creado al contratar (NULL = nunca contratada). */
  worker_id: string | null
  status: "active" | "archived"
  created_at: string
  updated_at: string
}

/** Fila del directorio de trabajadores vigentes de una entidad. */
export interface PersonDirectoryWorker {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  gender_id: string | null
  marital_status_id: string | null
  skin_color_id: string | null
  education_level_id: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  province: string | null
  municipality: string | null
  address: string | null
  employment_start_date: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
}

/** Fila del expediente de reingreso (trabajador con la relación finalizada). */
export interface PersonReentryWorker {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  gender_id: string | null
  education_level_id: string | null
  employment_status: string
  hire_date: string
  employment_start_date: string | null
}

/** Última baja registrada de un trabajador (bitácora de movimientos). */
export interface PersonSeparation {
  effective_date: string
  reason: string | null
}

/** Opción de catálogo (sexo, estado civil, nivel educacional, color de piel…). */
export interface CatalogRow {
  id: string
  name: string
}

/** Opción de catálogo con código visible (licencias de conducción: A, B, C…). */
export interface CatalogOption extends CatalogRow {
  code?: string
}

/** Datos de referencia que necesitan las vistas de personas. */
export interface PersonRegistryCatalogs {
  genders: CatalogRow[]
  maritalStatuses: CatalogRow[]
  educationLevels: CatalogRow[]
  skinColors: CatalogOption[]
  licenseCategories: CatalogOption[]
}

/**
 * Estado de identificación de una persona en el cliente, tal y como lo resuelve el
 * backend (`person_identification_status`): es la MISMA autoridad que usan el trigger
 * de unicidad y RLS, de modo que el frontend no decide por su cuenta.
 */
export interface PersonIdentificationStatus {
  worker_id?: string | null
  worker_status?: string | null
  candidate_count?: number | null
}

/** Elemento de catálogo de la plantilla de carga inicial (área, tipo de contrato…). */
export interface MigrationTemplateCatalogItem {
  id: string
  name: string
  code: string
}

/** Cargo de la entidad dentro de la plantilla de carga inicial. */
export interface MigrationTemplateJob {
  id: string
  name: string
  code: string
  area_id: string
}

/** Puesto de la entidad dentro de la plantilla de carga inicial. */
export interface MigrationTemplatePosition {
  id: string
  name: string
  code: string
  job_id: string
  authorized_quantity: number
}

/** Representante vigente ofrecido por la plantilla de carga inicial. */
export interface MigrationTemplateRepresentative {
  id: string
  person_name: string
  title: string | null
}

/**
 * Datos de referencia de la carga inicial de trabajadores
 * (`get_migration_template_data`). Cada catálogo llega como `jsonb_agg(...)`, de modo que las
 * claves son exactamente las que aparecen aquí.
 */
export interface MigrationTemplateData {
  areas: MigrationTemplateCatalogItem[]
  jobs: MigrationTemplateJob[]
  positions: MigrationTemplatePosition[]
  contract_types: MigrationTemplateCatalogItem[]
  payment_methods: MigrationTemplateCatalogItem[]
  representatives: MigrationTemplateRepresentative[]
}

/**
 * Datos capturados en el alta de una persona como candidata.
 * El dominio solo comprueba la PRESENCIA de los documentos (`File | null`): subirlos
 * al Storage es tarea de infraestructura y se hace después de crear el candidato.
 */
export interface CandidateRegistrationInput {
  first_name: string
  first_surname: string
  second_surname: string
  identification: string
  /** Fecha en formato de pantalla (dd/mm/aaaa). */
  birth_date: string
  gender_id: string
  marital_status_id: string
  skin_color_id: string
  education_level_id: string
  /** Nombre del nivel educacional elegido: determina si exige especialidad. */
  education_level_name: string
  specialty: string
  phone: string
  email: string
  address: string
  municipality: string
  province: string
  profession_or_trade: string
  political_affiliation: string
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  /** "yes" | "no" | "" — como lo entrega el formulario. */
  is_retired_or_rehired: string
  has_disciplinary_measures: boolean
  driving_license_ids: string[]
  has_pre_employment_check: boolean
  has_criminal_record_check: boolean
  pre_employment_check_file: File | null
  criminal_record_check_file: File | null
  disciplinary_document: File | null
  /**
   * El expediente YA tiene registrado ese documento verificador (edición de la ficha): la
   * obligatoriedad del archivo se satisface sin volver a adjuntarlo. En el alta no se usa.
   */
  pre_employment_check_present?: boolean
  criminal_record_check_present?: boolean
}

/* ------------------------------------------------------------------------- */
/* Estructura de plantilla (proyección de lectura para los flujos de personal) */
/* ------------------------------------------------------------------------- */

export interface SalaryGroupRef {
  id: string
  salary_scale_id: string
  sequence_number: number
}

export interface PositionJobRef {
  id: string
  name: string
  is_cuadro?: boolean
  is_principal_specialist?: boolean
  area: { id: string; name: string } | null
  salary_group: SalaryGroupRef | null
}

/**
 * Puesto con su estructura (cargo, área y grupo salarial) tal y como lo necesitan la
 * contratación y las transiciones. Es una proyección de lectura: la autoridad sobre la
 * plantilla sigue siendo la del dominio de estructura organizativa.
 */
export interface StaffingPosition {
  id: string
  name: string
  code: string | null
  is_active: boolean
  authorized_quantity: number
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  job: PositionJobRef | null
}

/** Ocupante vigente de un puesto (asignación actual sin fecha de fin). */
export interface PositionOccupant {
  workerId: string
  name: string
  code: string
}

/** Ocupación de la entidad: cuántos trabajadores activos ocupan cada puesto y quiénes. */
export interface EntityOccupancy {
  counts: Record<string, number>
  occupants: Record<string, PositionOccupant[]>
}

export interface ContractTypeOption {
  id: string
  name: string
  code: string
}

/** Identidad de la persona para los resúmenes contractuales. */
export interface WorkerIdentity {
  workerId: string
  fullName: string
  identification: string
}

export interface SeparationReason {
  id: string
  name: string
}

/** Vínculo de una persona con su expediente laboral (aunque esté inactivo). */
export interface EmploymentLink {
  id: string
  code: string
  employment_status: string
}

/**
 * Persona candidata tal y como la necesita la contratación: sus datos de identificación
 * y —si ya tuvo expediente en el cliente— el vínculo con su trabajador. Tener vínculo
 * inactivo significa que el alta será una RECONTRATACIÓN: vuelve a Trabajadores sin
 * duplicar la persona.
 */
export interface HireablePerson {
  id: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  email: string | null
  phone: string | null
  worker: EmploymentLink | null
}

/* ------------------------------------------------------------------------- */
/* Preparación contractual (integridad antes de formalizar)                    */
/* ------------------------------------------------------------------------- */

export interface ReadinessItem {
  code: string
  label: string
  source: string | null
  sourceId: string | null
  section: string
}

export interface ReadinessSection {
  key: string
  label: string
  ready: boolean
  missing: ReadinessItem[]
}

export interface ReadinessResult {
  ready: boolean
  missing: ReadinessItem[]
  sections?: ReadinessSection[]
}

/** Datos que el backend evalúa con `validate_hiring_readiness`. */
export interface ContractReadinessParams {
  candidateId?: string | null
  workerId?: string | null
  positionId?: string | null
  signatureDate?: string | null
  contractTypeId?: string | null
  signaturePlace?: string | null
  paymentMethodId?: string | null
  representativeAssignmentId?: string | null
  contractStartDate?: string | null
  contractEndDate?: string | null
}

/* ------------------------------------------------------------------------- */
/* Transiciones del vínculo laboral                                           */
/* ------------------------------------------------------------------------- */

export type WorkerTransitionKind =
  | "hire"
  | "separation"
  | "reincorporation"
  | "position_change"
  | "contract_change"

/** Resultado esperado de una transición sobre la vista donde aparece la persona. */
/** Movimiento de nómina del expediente del trabajador (mismo vocabulario que el backend). */
export type PayrollMovementType = "ALTA" | "BAJA" | "REUBICACION"

export interface TransitionEffect {
  kind: WorkerTransitionKind
  /** Vista operativa a la que pertenece la persona DESPUÉS de la transición. */
  view: PeopleView
  /** Qué ocurre con la asignación de puesto. */
  assignment: "created" | "closed" | "replaced" | "kept"
  /** Qué ocurre con el contrato vigente. */
  contract: "created" | "closed" | "replaced" | "kept"
  /** La trayectoria laboral anterior se conserva siempre: nunca se borra ni se duplica. */
  preservesHistory: true
}

/** Condiciones formalizadas de un contrato: comunes a contratación y reincorporación. */
export interface ContractFormalizationInput {
  representativeAssignmentId: string | null
  signatureDate: string | null
  signaturePlace: string
  paymentMethodId: string
  paymentScheduleText: string
  /** Conceptos retributivos ya validados por el formulario. */
  hasInvalidComponents: boolean
  /** Datos bloqueantes de la formalización (los calcula el backend). */
  blocking: string[]
}

/** Concepto retributivo ya construido para el backend (nunca el total). */
export interface CompensationComponentPayload {
  component_type: string
  description: string
  amount: number
}

/** Alta o reincorporación del Cargo «Especialista Principal»: el documento es una Resolución. */
export interface ResolutionFormalizationInput {
  representativeAssignmentId: string | null
  resolutionDate: string | null
}

/** Alta de una persona como trabajadora (`hire_candidate`, vía contrato). */
export interface CandidateHireInput {
  candidateId: string
  positionId: string
  hireDate: string
  notes: string
  contractTypeId: string
  contractStartDate: string
  contractEndDate: string
  isDetermined: boolean
  /** Cargo Cuadro o Especialista Principal: el alta no genera contrato ni documento. */
  specialDocumentRole: boolean
  representativeAssignmentId: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  paymentScheduleText: string
  compensationComponents: CompensationComponentPayload[]
}

/** Alta de una persona como trabajadora (`hire_candidate`, vía Resolución). */
export interface CandidateHireWithResolutionInput {
  candidateId: string
  positionId: string
  hireDate: string
  notes: string
  resolution: ResolutionFormalizationInput
}

/** Reincorporación directa de un trabajador inactivo (`reincorporate_worker`, vía contrato). */
export interface WorkerReincorporationInput {
  workerId: string
  positionId: string
  reincorporationDate: string
  contractTypeId: string
  contractStartDate: string
  contractEndDate: string
  isDetermined: boolean
  representativeAssignmentId: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  paymentScheduleText: string
  compensationComponents: CompensationComponentPayload[]
}

/** Reincorporación directa hacia un Cargo Especialista Principal (vía Resolución). */
export interface WorkerReincorporationWithResolutionInput {
  workerId: string
  positionId: string
  reincorporationDate: string
  resolution: ResolutionFormalizationInput
}

/** Baja del trabajador: cierra puesto y contrato vigentes y lo deja inactivo. */
export interface WorkerSeparationInput {
  workerId: string
  effectiveDate: string
  separationReasonId: string
  notes: string
}

/** Cambio de tipo de contrato: cierra el vigente y crea uno nuevo con sus condiciones. */
export interface WorkerContractChangeInput {
  workerId: string
  newContractTypeId: string
  effectiveDate: string
  newEndDate: string
  isDetermined: boolean
  notes: string
  representativeAssignmentId: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  paymentScheduleText: string
  compensationComponents: CompensationComponentPayload[]
}

/** Reubicación del trabajador: nueva asignación y, si procede, anexo al contrato vigente. */
export interface WorkerPositionChangeInput {
  workerId: string
  newPositionId: string
  effectiveDate: string
  reason: string
  notes: string
  /** Sólo cuando el cambio genera anexo al contrato vigente (§21/§22). */
  addendum?: {
    /** Se registra anexo en la misma transacción del movimiento. */
    create: boolean
    /** El anexo se formaliza ahora (fecha de firma, lugar y representante). */
    formalize: boolean
    signatureDate: string
    signaturePlace: string
    representativeAssignmentId: string | null
  }
  /**
   * Representante que suscribe la Resolución, cuando el Cargo destino es Especialista
   * Principal (§45). En la vía de contrato el representante es el del anexo.
   */
  representativeAssignmentId?: string | null
  /** Fecha de la Resolución cuando el Cargo destino es Especialista Principal (§45). */
  resolutionDate?: string | null
}

/** Diferencia contractual detectada por el backend entre dos condiciones. */
export interface ContractualChange {
  id?: string
  field_code: string
  old_value: string | null
  new_value: string | null
  old_display_value: string | null
  new_display_value: string | null
  display_order: number
  old_reference_id?: string | null
  new_reference_id?: string | null
}

/** Resultado de `position_change_preview` (diferencias contractuales del movimiento). */
export interface PositionChangePreview {
  worker_id: string
  employment_contract_id: string | null
  current_assignment_id: string | null
  current_position_id: string | null
  new_position_id: string
  effective_date: string
  currency_code: string | null
  salary_before: number | null
  salary_after: number | null
  total_before: number | null
  total_after: number | null
  components_total: number
  payment_method_id: string | null
  payment_method_name: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  changes: ContractualChange[]
  has_contractual_changes: boolean
}

/** Anexo creado (o preparado) por el cambio de puesto. */
export interface PositionChangeAddendum {
  status: string
  addendum_id?: string
  addendum_number?: number | null
  addendum_status?: string
  changes?: number
  pending?: string[]
}

/** Resultado de `change_worker_position` (movimiento + anexo en la misma transacción). */
export interface WorkerPositionChangeResult {
  previous_assignment_id: string
  new_assignment_id: string
  employment_contract_id: string | null
  salary_history_id: string | null
  changes: ContractualChange[]
  has_contractual_changes: boolean
  is_principal_specialist: boolean
  resolution_id: string | null
  /** 'NO_CONTRACT' cuando el cambio no registró anexo por falta de contrato vigente. */
  addendum_skipped: string | null
  addendum: PositionChangeAddendum | null
}

/** Resultado del alta o de la reincorporación (`hire_candidate` / `reincorporate_worker`). */
export interface WorkerEngagementResult {
  workerId: string | null
  contractId: string | null
  resolutionId: string | null
}

/** Resultado del cambio de contrato (`change_worker_contract`). */
export interface WorkerContractChangeResult {
  newContractId: string | null
}

/* ------------------------------------------------------------------------- */
/* Expediente de la persona (ficha de candidato y ficha de trabajador)        */
/* ------------------------------------------------------------------------- */

/**
 * Permiso efectivo sobre la entidad para gobernar el expediente. Es el resultado de
 * `can_access_entity`: la AUTORIDAD real sigue siendo RLS y las RPC, aquí solo se decide
 * qué se puede ver y qué se puede editar en la pantalla.
 */
export interface ExpedientePermissions {
  canView: boolean
  canManage: boolean
}

/** Catálogo global de tipos de documento (`document_types`). */
export interface DocumentTypeOption {
  id: string
  name: string
  description: string | null
  sort_order: number | null
}

/**
 * Documento del expediente: fila de `candidate_documents` más su archivo en el Storage
 * privado (`storage_path`). Los UUID y las rutas son los mismos que ya consumía la ficha.
 */
export interface ExpedienteDocumentRow {
  id: string
  candidate_id: string
  document_type_id: string
  original_file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  description: string | null
  is_primary: boolean
  uploaded_by: string | null
  created_at: string
  updated_at: string | null
}

/** Referencia mínima al documento embebido en una formación académica. */
export interface ExpedienteDocumentRef {
  id: string
  original_file_name: string
  storage_path: string
}

/**
 * Documento del expediente LABORAL: fila de `worker_documents` más su archivo en el Storage
 * privado. `source` distingue el documento subido a mano (MANUAL) del generado por el motor
 * documental (GENERATED), que además referencia su contrato.
 */
export interface WorkerDocumentRow {
  id: string
  worker_id: string
  document_type_id: string
  employment_contract_id: string | null
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  description: string | null
  source: string
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

/** Referencia mínima al contrato de un documento generado (solo para mostrar). */
export interface WorkerDocumentContractRef {
  id: string
  start_date: string
  contract_type: { name: string } | null
}

/** Todo lo que necesita la pestaña «Documentos» del trabajador en una sola lectura. */
export interface WorkerDocumentsView {
  documentTypes: DocumentTypeOption[]
  documents: WorkerDocumentRow[]
  /** Nombre visible de quien subió cada documento (lectura auxiliar). */
  uploaderNames: Record<string, string>
  /** Contratos referenciados por los documentos generados (lectura auxiliar). */
  contractsById: Record<string, WorkerDocumentContractRef>
}

/** Documento nuevo del expediente laboral (identificador y ruta ya resueltos). */
export interface NewWorkerDocumentRecord {
  documentId: string
  workerId: string
  documentTypeId: string
  file: File
  description: string | null
}

/** Trabajador activo de la entidad, para los selectores del expediente. */
export interface EntityWorkerOption {
  id: string
  full_name: string
  identification: string
}

/** Experiencia laboral declarada por la persona (fila de `candidate_work_experiences`). */
export interface CandidateWorkExperienceRow {
  id: string
  candidate_id: string
  organization_entity_id: string
  job_title: string
  company_name: string
  start_date: string
  end_date: string | null
  is_current: boolean | null
  description: string | null
  created_at: string
  updated_at: string
}

/** Formación académica con su título adjunto, si lo tiene. */
export interface CandidateAcademicFormationRow {
  id: string
  candidate_id: string
  organization_entity_id: string
  program_name: string
  start_date: string
  end_date: string | null
  is_studying: boolean | null
  document_id: string | null
  document: ExpedienteDocumentRef | null
  created_at: string
  updated_at: string
}

/** Nota interna del expediente (fila de `candidate_notes`). */
export interface CandidateNoteRow {
  id: string
  candidate_id: string
  organization_entity_id: string
  note_text: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Información adicional del expediente (fila de `candidate_additional_info`). */
export interface CandidateAdditionalInfoRow {
  id: string
  candidate_id: string
  organization_entity_id: string
  info_text: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Ficha del candidato: la MISMA fila de `candidates` de la vista Candidatos, con los
 * indicadores de formación académica adicional garantizados como booleanos (el formulario
 * los edita como casillas).
 */
export interface CandidateExpediente extends PersonCandidate {
  has_masters_degree: boolean
  has_doctorate_degree: boolean
}

/** Datos accesorios del expediente del candidato (se leen aparte de la ficha). */
export interface CandidateExpedienteRelated {
  documents: ExpedienteDocumentRow[]
  workExperiences: CandidateWorkExperienceRow[]
  formations: CandidateAcademicFormationRow[]
  notes: CandidateNoteRow[]
  additionalInfo: CandidateAdditionalInfoRow[]
}

/** Datos personales e identificación que el expediente del candidato escribe. */
export interface CandidateExpedienteInput {
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  municipality: string | null
  province: string | null
  education_level_id: string | null
  specialty: string | null
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string | null
  political_affiliation: string | null
  /** El formulario captura "yes"/"no"; la columna guarda el booleano. */
  is_retired_or_rehired: boolean
  has_disciplinary_measures: boolean
  skin_color_id: string | null
}

/** Alta de una experiencia laboral declarada por la persona. */
export interface CandidateWorkExperienceInput {
  candidateId: string
  organizationEntityId: string
  jobTitle: string
  companyName: string
  startDate: string
  endDate: string | null
  isCurrent: boolean
  description: string | null
}

/** Alta de una formación académica, con su título adjunto opcional. */
export interface CandidateAcademicFormationInput {
  candidateId: string
  organizationEntityId: string
  programName: string
  startDate: string
  endDate: string | null
  isStudying: boolean
  /** Título (opcional): se sube al Storage y se registra como documento del expediente. */
  titleFile: File | null
}

/** Alta de una nota o de una información adicional del expediente. */
export interface CandidateTextEntryInput {
  candidateId: string
  organizationEntityId: string
  text: string
}

/* --- Expediente laboral del trabajador ------------------------------------ */

/** Cargo y área del puesto, con el grupo salarial del que depende el salario. */
export interface WorkerPositionRef {
  id: string
  name: string
  code: string
  is_active: boolean
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  job: WorkerJobRef | null
}

export interface WorkerJobRef {
  id: string
  name: string
  code: string
  is_active: boolean
  area_id: string
  area: { id: string; name: string } | null
  salary_group: SalaryGroupRef | null
}

/** Asignación de puesto: la trayectoria laboral del trabajador (histórico incluido). */
export interface WorkerAssignmentRow {
  id: string
  position_id: string
  start_date: string
  end_date: string | null
  is_current: boolean
  position: WorkerPositionRef | null
}

/** Contrato del trabajador con las condiciones formalizadas (snapshot histórico). */
export interface WorkerContractRow {
  id: string
  assignment_id: string
  contract_type_id: string
  start_date: string
  end_date: string | null
  actual_end_date: string | null
  is_current: boolean
  salary_amount: number | null
  salary_currency_code: string | null
  salary_effective_date: string | null
  salary_snapshot_status: string
  representative_name_snapshot: string | null
  representative_position_snapshot: string | null
  representative_captured_at: string | null
  entity_name_snapshot: string | null
  signature_date: string | null
  signature_place: string | null
  payment_method_id: string | null
  payment_schedule_text: string | null
  total_compensation_snapshot: number | null
  conditions_captured_at: string | null
  salary_group: { id: string; sequence_number: number } | null
  payment_method: { name: string; code: string } | null
  contract_type: ContractTypeOption | null
}

/** Ficha del trabajador: la MISMA fila de `workers` que ya consumía la pantalla. */
export interface WorkerExpediente {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  education_level_id: string | null
  specialty: string | null
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string | null
  skin_color_id: string | null
  address: string | null
  province: string | null
  municipality: string | null
  phone: string | null
  email: string | null
  hire_date: string
  employment_start_date: string | null
  employment_status: string
  created_at: string
  updated_at: string
  assignments: WorkerAssignmentRow[] | null
  contracts: WorkerContractRow[] | null
}

/** Movimiento de la bitácora laboral (baja, reincorporación, cambio de puesto…). */
export interface WorkerEmploymentMovement {
  id: string
  movement_type: string
  effective_date: string
  reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  separation_reason: { name: string } | null
  /** Autor del movimiento, resuelto desde `profiles` (solo para mostrar). */
  authorName: string | null
}

/** Tramo de pago por antigüedad aplicable al trabajador (`resolve_tenure_payment_for_worker`). */
export interface TenurePaymentRule {
  amount: number
  from_months: number
  to_months: number | null
}

/** Catálogos que necesita el expediente laboral (los mismos de la vista de personal). */
export interface WorkerExpedienteCatalogs {
  genders: CatalogRow[]
  maritalStatuses: CatalogRow[]
  educationLevels: CatalogRow[]
  contractTypes: ContractTypeOption[]
}

/** Datos personales que el expediente del trabajador escribe. */
export interface WorkerExpedienteInput {
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  education_level_id: string | null
  specialty: string | null
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string | null
  skin_color_id: string | null
  address: string | null
  province: string | null
  municipality: string | null
  phone: string | null
  email: string | null
  /** Solo la edición del expediente desde el alta (`WorkerForm`) modifica la fecha de incorporación. */
  hire_date?: string | null
}

/** Alta de un trabajador con su puesto y su contrato en una sola transacción. */
export interface NewWorkerInput {
  entityId: string
  person: {
    first_name: string
    first_surname: string
    second_surname: string
    identification: string
    birth_date: string
    gender_id: string
    marital_status_id: string
    education_level_id: string
    specialty: string
    has_masters_degree: boolean
    has_doctorate_degree: boolean
    profession_or_trade: string
    skin_color_id: string
    address: string
    province: string
    municipality: string
    phone: string
    email: string
  }
  positionId: string
  hireDate: string
  contractTypeId: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  representativeAssignmentId: string | null
  drivingLicenseCategoryIds: string[]
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  compensationComponents: CompensationComponentPayload[]
  paymentScheduleText: string | null
}

/** Condiciones formalizadas del contrato que registra el expediente del trabajador. */
export interface WorkerContractFormalizationInput {
  workerId: string
  contractTypeId: string
  startDate: string
  endDate: string | null
  representativeAssignmentId: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  compensationComponents: CompensationComponentPayload[]
  paymentScheduleText: string | null
}

/* ------------------------------------------------------------------------- */
/* Plantilla operativa (proyección de lectura de los trabajadores)             */
/* ------------------------------------------------------------------------- */

/** Asignación de puesto de un trabajador de la plantilla, con el puesto al que apunta. */
export interface StaffingWorkerAssignment {
  id: string
  position_id: string
  start_date: string
  end_date: string | null
  is_current: boolean
  position: StaffingPosition | null
}

/**
 * Trabajador de la Plantilla operativa: su fila de `workers` (los datos personales y
 * laborales que edita el formulario) con su trayectoria de puestos. La autoridad sobre la
 * estructura del puesto sigue siendo la del dominio de estructura organizativa.
 */
export interface StaffingWorkerRow {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  hire_date: string
  employment_start_date: string | null
  employment_status: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  education_level_id: string | null
  specialty: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
  profession_or_trade: string | null
  skin_color_id: string | null
  address: string | null
  province: string | null
  municipality: string | null
  phone: string | null
  email: string | null
  assignments: StaffingWorkerAssignment[] | null
}

/* ------------------------------------------------------------------------- */
/* Carga inicial de trabajadores (migración)                                  */
/* ------------------------------------------------------------------------- */

/**
 * Fila de la carga inicial tal y como la produce la plantilla Excel. Los catálogos llegan
 * con el texto del archivo y se resuelven a identificador antes de validar o importar.
 */
export interface MigrationRow {
  identification: string
  first_name: string
  first_surname: string
  second_surname: string
  birth_date: string
  gender_id: string
  marital_status_id: string
  skin_color_id: string
  phone: string
  email: string
  address: string
  province: string
  municipality: string
  employment_start_date: string
  education_level_id: string
  specialty: string
  profession_or_trade: string
  driving_license_category_ids: string[]
  position_code: string
  position_id?: string
  initial_vacation_balance: string
  vacation_cutoff_date: string
}

/** Resultado por fila de `migration_validate_rows`, con los mensajes que ve el usuario. */
export interface MigrationPreviewRow {
  index: number
  status: "VALID" | "WARNING" | "ERROR"
  messages: string[]
  position_id: string | null
  position_label: string | null
}

/** Catálogos globales que resuelven y validan los valores de la carga inicial. */
export interface WorkerMigrationCatalogs {
  genders: CatalogRow[]
  maritalStatuses: CatalogRow[]
  skinColors: CatalogRow[]
  educationLevels: CatalogRow[]
  drivingLicenseCategories: CatalogOption[]
}

export interface WorkerMigrationImportResult {
  total_rows: number
  imported: number
  worker_ids: string[]
  /**
   * Identificaciones repetidas dentro del archivo o ya existentes en el workspace.
   * La carga NO se bloqueó por ellas: las personas se crearon y solo deben corregirse.
   */
  duplicate_identifications: string[]
}

/** Trabajador creado por la migración individual (`migration_create_single_worker`). */
export interface WorkerMigrationCreatedWorker {
  worker_id: string
  code: string
  assignment_id: string | null
  contract_id: string | null
}

/** Asignación creada al vincular un trabajador migrado a un puesto vacante. */
export interface WorkerMigrationLinkedWorker {
  assignment_id: string
  position_id: string
  position_name: string
  start_date: string
}

/** Fila cruda de un trabajador migrado, para agrupar el historial de lotes. */
export interface MigrationBatchRow {
  migration_batch_id: string | null
  migrated_at: string | null
  employment_status: string | null
  worker_position_assignments: { is_current: boolean | null; end_date: string | null }[] | null
}

/** Lote de carga inicial con su total, sus trabajadores vinculados y los pendientes. */
export interface MigrationBatchHistory {
  batchId: string
  migratedAt: string
  total: number
  linked: number
  pending: number
}
