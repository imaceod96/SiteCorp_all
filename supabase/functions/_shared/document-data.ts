/**
 * Contratos compartidos de DATOS DOCUMENTALES (frontend, Vitest y Edge Functions).
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
 * La fuente es `worker_resolutions` (snapshot histórico).
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
 * La fuente es `worker_payroll_movements` (snapshot histórico).
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
    start_date: string | null
    end_date: string | null
    natural_days: number | null
    charged_days: number | null
    days: number | null
    return_date: string | null
    incorporation_date: string | null
  }
  entity: {
    name: string | null
    code: string | null
  }
  worker: {
    full_name: string | null
    identification: string | null
    first_name: string | null
    first_surname: string | null
    second_surname: string | null
  }
  area_name: string | null
  issued_at: string
}

export interface DocumentDataValidation {
  document_type: string
  contract_type_code?: string | null
  addendum_status?: string | null
  ready: boolean
  missing: { key: string; label: string }[]
}
