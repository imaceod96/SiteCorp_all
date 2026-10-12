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
