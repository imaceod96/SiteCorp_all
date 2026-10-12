/**
 * Personas — Reglas puras del dominio.
 *
 * Únicamente lógica independiente de React y de Supabase: la clasificación
 * excluyente de las tres vistas operativas, la regla de ficha completa, la exigencia
 * de especialidad por nivel educacional, la conversión de la fecha de nacimiento y las
 * precondiciones del alta de una persona como candidata.
 *
 * CLASIFICACIÓN — una persona solo puede estar en UNA vista:
 *
 *   · Candidato  → la persona NO tiene ninguna relación laboral en el cliente
 *     (ni vigente ni finalizada) y su fila de candidato no está vinculada.
 *     `hire_candidate` es la única función que modifica `candidates` y fija
 *     `worker_id` al contratar, pero pueden quedar filas antiguas sin vincular de una
 *     persona ya contratada: por eso NO basta con mirar `worker_id`.
 *
 *   · Trabajador → fila de trabajador con `employment_status = 'active'`.
 *     `register_worker_separation` lo pasa a 'inactive' al dar la baja y
 *     `reincorporate_worker` lo devuelve a 'active'. Reubicar (`change_position`) o
 *     cambiar de contrato (`change_worker_contract`) NO tocan ese estado.
 *
 *   · Reingreso  → fila de trabajador con la relación finalizada y NINGUNA otra
 *     relación vigente en el cliente.
 *
 * IDENTIDAD DE PERSONA = (cliente, número de identificación). Es exactamente la que
 * usa el backend: `person_identification_status` y el trigger de unicidad
 * `candidates_prevent_duplicate_person` resuelven la persona por
 * `company_client_id` + `identification`.
 *
 * Los filtros de consulta (`filterUnlinkedCandidates`, `filterActiveWorkers`,
 * `filterReentryWorkers`) viven aquí a propósito, junto a los predicados con los que
 * deben coincidir: así el criterio del servidor y el del cliente no pueden divergir.
 *
 * Este módulo NO importa nada: puede verificarse de forma aislada (lo hace
 * `e2e-tests/people-classification.spec.ts`). El formato del carnet de identidad es un
 * objeto de valor del kernel compartido (`@/utils/ci`); el caso de uso lo aporta a
 * `validateCandidateRegistration` en vez de duplicar la regla de 11 dígitos.
 */

import { EMPLOYMENT_STATUS } from "./entities"
import type {
  CandidateRegistrationInput,
  EmploymentIndex,
  EmploymentRecord,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonIdentificationStatus,
} from "./entities"

/** Niveles educacionales que exigen especialidad. */
const SPECIALTY_EDUCATION_LEVELS = ["Obrero Calificado", "Técnico Medio", "Superior"]

/**
 * Incumplimiento de una regla de negocio del dominio (validación del alta o conflicto
 * de identidad). La presentación muestra su mensaje tal cual.
 */
export class PeopleRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PeopleRuleError"
  }
}

// ---------------------------------------------------------------------------
// Índice de relaciones laborales
// ---------------------------------------------------------------------------

export const emptyEmploymentIndex: EmploymentIndex = {
  withAnyWorker: new Set<string>(),
  withActiveWorker: new Set<string>(),
}

export const buildEmploymentIndex = (rows: EmploymentRecord[]): EmploymentIndex => {
  const withAnyWorker = new Set<string>()
  const withActiveWorker = new Set<string>()
  rows.forEach((row) => {
    const identification = (row.identification ?? "").trim()
    if (!identification) return
    withAnyWorker.add(identification)
    if (row.employment_status === EMPLOYMENT_STATUS.active) withActiveWorker.add(identification)
  })
  return { withAnyWorker, withActiveWorker }
}

/** ¿La fila de candidato quedó vinculada al trabajador creado al contratar? */
export const hasLinkedWorker = (candidate: Pick<PersonCandidate, "worker_id">): boolean =>
  !!candidate.worker_id

// ---------------------------------------------------------------------------
// Predicados de clasificación (criterio compartido por las tres vistas)
// ---------------------------------------------------------------------------

/** 1. Candidato: persona que nunca ha tenido relación laboral en el cliente. */
export const isPendingCandidate = (
  candidate: Pick<PersonCandidate, "identification" | "worker_id">,
  index: EmploymentIndex
): boolean =>
  !hasLinkedWorker(candidate) &&
  !index.withAnyWorker.has((candidate.identification ?? "").trim())

/** 2. Trabajador: fila de trabajador con relación laboral vigente. */
export const isActiveWorker = (worker: { employment_status: string | null }): boolean =>
  worker.employment_status === EMPLOYMENT_STATUS.active

/**
 * 3. Reingreso: relación laboral finalizada y ninguna otra vigente en el cliente.
 * Exige estado no nulo para coincidir exactamente con el filtro de la consulta
 * (`neq` descarta los nulos): así cliente y servidor no pueden divergir.
 */
export const isReentryWorker = (
  worker: { identification: string; employment_status: string | null },
  index: EmploymentIndex
): boolean =>
  worker.employment_status !== null &&
  worker.employment_status !== EMPLOYMENT_STATUS.active &&
  !index.withActiveWorker.has((worker.identification ?? "").trim())

// ---------------------------------------------------------------------------
// Filtros de consulta de cada vista (condición física aplicada en Supabase)
// ---------------------------------------------------------------------------

/** Operadores de consulta de Supabase que usan las vistas (forma mínima). */
interface PeopleQuery {
  is(column: string, value: null): unknown
  eq(column: string, value: string): unknown
  neq(column: string, value: string): unknown
}

/**
 * Aplica el filtro y devuelve LA MISMA consulta, para poder seguir encadenando
 * (`.order()`, `.limit()`…). El parámetro queda deliberadamente sin restringir: los
 * constructores de Supabase son genéricos muy profundos y restringirlos agota el
 * instanciador de TypeScript («Type instantiation is excessively deep and possibly
 * infinite»). La forma esperada se declara una sola vez aquí.
 */
const applyPeopleFilter = <Q>(query: Q, apply: (builder: PeopleQuery) => unknown): Q => {
  apply(query as unknown as PeopleQuery)
  return query
}

/**
 * Condición NECESARIA de Candidatos: la fila no está vinculada a un trabajador.
 * La condición completa (persona sin ninguna relación laboral) se resuelve con
 * `isPendingCandidate` sobre el índice del cliente.
 */
export function filterUnlinkedCandidates<Q>(query: Q): Q {
  return applyPeopleFilter(query, (builder) => builder.is("worker_id", null))
}

/** Vista Trabajadores: solo filas con relación laboral vigente. */
export function filterActiveWorkers<Q>(query: Q): Q {
  return applyPeopleFilter(query, (builder) =>
    builder.eq("employment_status", EMPLOYMENT_STATUS.active)
  )
}

/** Vista Reingresos: solo filas con la relación laboral finalizada. */
export function filterReentryWorkers<Q>(query: Q): Q {
  return applyPeopleFilter(query, (builder) =>
    builder.neq("employment_status", EMPLOYMENT_STATUS.active)
  )
}

// ---------------------------------------------------------------------------
// Reglas de la ficha personal
// ---------------------------------------------------------------------------

/** Nombre completo tal y como lo muestran los listados. */
export const personFullName = (person: {
  first_name: string
  first_surname: string
  second_surname: string | null
}): string => [person.first_name, person.first_surname, person.second_surname].filter(Boolean).join(" ")

/** Datos personales pendientes de la ficha (nunca se guarda un indicador). */
export function missingPersonProfileFields(worker: PersonDirectoryWorker): string[] {
  const fields: string[] = []
  if (!worker.birth_date) fields.push("fecha de nacimiento")
  if (!worker.gender_id) fields.push("sexo")
  if (!worker.marital_status_id) fields.push("estado civil")
  if (!worker.skin_color_id) fields.push("color de piel")
  if (!worker.address) fields.push("dirección")
  if (!worker.employment_start_date) fields.push("fecha de incorporación")
  return fields
}

// ---------------------------------------------------------------------------
// Alta de una persona como candidata
// ---------------------------------------------------------------------------

/** ¿El nivel educacional elegido exige especialidad? */
export const candidateRequiresSpecialty = (educationLevelName: string | null | undefined): boolean =>
  SPECIALTY_EDUCATION_LEVELS.includes(educationLevelName || "")

/** Convierte la fecha de pantalla (dd/mm/aaaa) al formato ISO de la base de datos. */
export const convertDisplayDateToISO = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    }
    return null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

/**
 * Precondiciones del alta de una persona como candidata. Devuelve el primer mensaje
 * incumplido o `null` si todo es correcto; el orden de comprobación es el que ya
 * mostraba el formulario.
 *
 * `identificationFormatError` lo aporta el caso de uso desde el kernel compartido
 * (`@/utils/ci`) y se comprueba en su posición original: justo después de exigir que el
 * número no esté vacío.
 */
export function validateCandidateRegistration(
  input: CandidateRegistrationInput,
  identificationFormatError: string | null = null
): string | null {
  if (!input.first_name.trim()) return "El nombre es obligatorio"
  if (!input.first_surname.trim()) return "El primer apellido es obligatorio"
  if (!input.identification.trim()) return "La identificación es obligatoria"
  if (identificationFormatError) return identificationFormatError

  // Integridad contractual: datos personales indispensables para formalizar
  // correctamente un contrato laboral.
  if (!input.birth_date.trim()) return "La fecha de nacimiento es obligatoria"
  if (!input.profession_or_trade.trim()) return "La profesión u oficio es obligatoria"
  if (!input.address.trim()) return "La dirección particular es obligatoria"
  if (!input.province.trim()) return "La provincia es obligatoria"
  if (!input.municipality.trim()) return "El municipio es obligatorio"

  if (input.education_level_id && candidateRequiresSpecialty(input.education_level_name)) {
    if (!input.specialty.trim()) {
      return `La especialidad es obligatoria para ${input.education_level_name}`
    }
  }

  // Los documentos verificadores son obligatorios mientras su casilla esté activada.
  if (input.has_pre_employment_check && !input.pre_employment_check_file) {
    return "Debe seleccionar el documento de Chequeo Preempleo"
  }
  if (input.has_criminal_record_check && !input.criminal_record_check_file) {
    return "Debe seleccionar el documento de Antecedentes Penales"
  }

  if (input.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.email.trim())) return "El formato del email no es válido"
  }

  if (!convertDisplayDateToISO(input.birth_date)) {
    return "El formato de la fecha de nacimiento no es válido (dd/mm/aaaa)"
  }

  return null
}

/**
 * Conflicto de unicidad de persona (§27–§33): una misma persona no puede duplicarse
 * entre Candidatos, Trabajadores y Reingresos del mismo cliente. Devuelve el mensaje
 * que debe ver el usuario, o `null` si la identificación está libre.
 */
export function personRegistrationConflict(
  status: PersonIdentificationStatus
): string | null {
  if (status.worker_id) {
    return status.worker_status === EMPLOYMENT_STATUS.active
      ? "Esta persona ya está registrada como trabajador. Solo puede actualizar su información."
      : "Esta persona ya existe y actualmente se encuentra en Reingresos. Debe utilizar el expediente existente."
  }
  if ((status.candidate_count ?? 0) > 0) {
    return "Ya existe una persona con este número de identificación. Solo puede actualizar su información."
  }
  return null
}
