/**
 * Generación documental — Contratos de DATOS DOCUMENTALES (tipos puros, sin acceso a datos).
 *
 * Fase 11A.7 — Capa central de datos documentales.
 *
 * Estos contratos describen los SNAPSHOTS de los que se resuelven las variables de un
 * documento. La OBTENCIÓN de esos datos vive en este mismo dominio
 * (`infrastructure/document-data.repository.ts`): contratos, anexos, resoluciones y
 * movimientos se resuelven en funciones SQL (una única fuente de resolución) y el SC-4-04
 * desde la relación real del trabajador.
 *
 * Viven en el dominio, y no en un módulo puente, porque los describen el catálogo de
 * variables (`@/domains/document-templates`) y el resolvedor
 * (`./document-resolution.rules.ts`): la dependencia va en un solo sentido
 * (generación → plantillas) y no puede formarse ningún ciclo entre dominios.
 *
 * Los componentes React NUNCA resuelven variables por su cuenta.
 */

export interface DocumentPartyEntity {
  name: string | null
  organism: string | null
  branch: string | null
  labor_code: string | null
  address: string | null
  province: string | null
  municipality: string | null
  revolution_year: string | null
}

export interface DocumentRepresentative {
  name: string | null
  position: string | null
}

export interface DocumentWorker {
  full_name: string | null
  identification: string | null
  birth_date: string | null
  profession: string | null
  address: string | null
  province: string | null
  municipality: string | null
}

export interface ContractDocumentData {
  document_type: "CONTRACT"
  contract_id: string
  contract_type_code: string | null
  contract_type_name: string | null
  entity: DocumentPartyEntity
  representative: DocumentRepresentative
  worker: DocumentWorker
  job: {
    name: string | null
    occupational_category: string | null
    salary_group_sequence: number | null
  }
  position: {
    name: string | null
    code: string | null
    work_location: string | null
  }
  schedule: {
    daily_hours: number | null
    weekly_hours: number | null
    monthly_hours: number | null
    break_minutes: number | null
    text: string | null
  }
  contract: {
    type_name: string | null
    type_code: string | null
    start_date: string | null
    end_date: string | null
    signature_date: string | null
    signature_place: string | null
    payment_method: string | null
    payment_schedule: string | null
  }
  compensation: {
    base_salary: number | null
    additional_payments: number | null
    abnormal_conditions_payments: number | null
    other_payments: number | null
    total: number | null
    currency: string | null
  }
  formalized_addendums: {
    addendum_id: string
    addendum_number: number | null
    effective_date: string
  }[]
}

/** Campo antes/después incluido en un anexo (snapshot histórico, nunca datos vivos). */
export interface AddendumConditionSide {
  value: string | null
  display: string | null
}

export interface AddendumDocumentData {
  document_type: "ADDENDUM"
  addendum_id: string
  addendum: {
    number: number | null
    reason_code: string | null
    reason: string | null
    effective_date: string | null
    signature_date: string | null
    signature_place: string | null
    status: string | null
  }
  entity: DocumentPartyEntity
  representative: DocumentRepresentative
  worker: DocumentWorker
  /** field_code (JOB, SALARY, …) → valor anterior congelado en el anexo. */
  previous_conditions: Record<string, AddendumConditionSide>
  /** field_code → valor nuevo congelado en el anexo. */
  new_conditions: Record<string, AddendumConditionSide>
  totals: {
    before: number | null
    after: number | null
    currency: string | null
  }
}

/**
 * Datos documentales de una RESOLUCIÓN (Cargo Especialista Principal).
 * La fuente es `worker_resolutions` (snapshot histórico): el documento nunca se recalcula desde
 * el estado vivo una vez creada la Resolución.
 */
export interface ResolutionDocumentData {
  document_type: "RESOLUTION"
  resolution_id: string
  entity: {
    name: string | null
    municipality: string | null
    revolution_year: string | null
  }
  /** Empresa a la que pertenece la UEB (r.emp). Vacío si la entidad no es UEB. */
  parent_company: { name: string | null }
  representative: { name: string | null; position: string | null }
  worker: { full_name: string | null; identification: string | null }
  job: {
    name: string | null
    salary_group_sequence: number | null
    salary_amount: number | null
    currency_code: string | null
    work_content: string | null
  }
  resolution: { date: string | null }
}

/**
 * Datos documentales de un MOVIMIENTO DE NÓMINA (Altas / Reubicaciones / Bajas).
 * La fuente es `worker_payroll_movements` (snapshot histórico): el documento nunca se recalcula
 * desde el estado vivo una vez creado el movimiento.
 */
export interface PayrollMovementDocumentData {
  document_type: "PAYROLL_MOVEMENT"
  movement_id: string
  event_type: "ALTA" | "REUBICACION" | "BAJA"
  effective_date: string | null
  entity: {
    organism: string | null
    company: string | null
    unit: string | null
  }
  worker: {
    full_name: string | null
    first_name: string | null
    first_surname: string | null
    second_surname: string | null
    identification: string | null
    gender_code: string | null
  }
  /** Situación actual/anterior (en Alta, el puesto de incorporación). */
  actual: {
    area: string | null
    job: string | null
    salary_group_sequence: number | null
    salary_amount: number | null
    currency: string | null
  }
  /** Situación nueva/posterior (vacía en Alta y Baja). */
  next: {
    area: string | null
    job: string | null
    salary_group_sequence: number | null
    salary_amount: number | null
    currency: string | null
  }
}

export type DocumentData =
  | ContractDocumentData
  | AddendumDocumentData
  | Sc404DocumentData
  | ResolutionDocumentData
  | PayrollMovementDocumentData

export type Sc404SourceType = "VACATION" | "MEDICAL_CERTIFICATE"

export interface Sc404DocumentData {
  document_type: "SC_4_04"
  origin: {
    source_type: Sc404SourceType
    source_id: string
    /** Vacaciones y certificado: fecha de inicio del período / salida. */
    start_date: string | null
    /** Solo vacaciones: end_date del período (§20: no se inventa para médico). */
    end_date: string | null
    /** Solo vacaciones: días naturales persistidos (§14/§15). */
    natural_days: number | null
    /** Solo vacaciones: días consumidos (ledger). */
    charged_days: number | null
    /** Solo certificado médico: days explícito (§18). */
    days: number | null
    /** Solo certificado médico: return_date (reincorporación). */
    return_date: string | null
    /**
     * Fecha de incorporación (§2 Fase 21):
     *   · VACATION → primer día hábil posterior a end_date según el horario
     *     del Puesto de la asignación vigente en el período (calculada, no persistida).
     *   · MEDICAL_CERTIFICATE → return_date (fuente de verdad; nunca se consulta horario).
     */
    incorporation_date: string | null
  }
  entity: {
    name: string | null
    code: string | null
  }
  worker: {
    full_name: string | null
    identification: string | null
    /** Nombre/nombres del trabajador, SIN apellidos (dato estructurado). */
    first_name: string | null
    /** Primer apellido del trabajador (dato estructurado). */
    first_surname: string | null
    /** Segundo apellido del trabajador (dato estructurado; null → resuelve vacío). */
    second_surname: string | null
  }
  area_name: string | null
  /** Fecha de emisión del documento (día de la generación). */
  issued_at: string
}

export interface DocumentDataValidation {
  document_type: string
  contract_type_code?: string | null
  addendum_status?: string | null
  ready: boolean
  missing: { key: string; label: string }[]
}
