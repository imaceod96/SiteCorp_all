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
