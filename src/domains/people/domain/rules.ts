/**
 * Personas — Reglas puras del dominio.
 *
 * Únicamente lógica independiente de React y de Supabase: la clasificación
 * excluyente de las tres vistas operativas, la regla de ficha completa, la exigencia
 * de especialidad por nivel educacional, la conversión de la fecha de nacimiento, las
 * precondiciones del alta de una persona como candidata, el efecto esperado de cada
 * transición laboral y las validaciones previas de contratación, baja, reincorporación,
 * reubicación y cambio de contrato (con sus mensajes, que son los que ve el usuario).
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
 *     `hire_candidate` / `reincorporate_worker` lo devuelven a 'active'. Reubicar
 *     (`change_worker_position`) o cambiar de contrato (`change_worker_contract`)
 *     NO tocan ese estado.
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
  ContractFormalizationInput,
  EmploymentIndex,
  EmploymentRecord,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonIdentificationStatus,
  PayrollMovementType,
  ReadinessResult,
  TransitionEffect,
  WorkerTransitionKind,
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
  // correctamente un contrato laboral (mismas reglas que el expediente).
  const profileError = validatePersonProfileFields(input)
  if (profileError) return profileError

  const specialtyError = validateSpecialtyRequirement(input)
  if (specialtyError) return specialtyError

  // Los documentos verificadores son obligatorios mientras su casilla esté activada.
  const documentsError = validateVerificationDocuments(input)
  if (documentsError) return documentsError

  const emailError = validateEmail(input.email)
  if (emailError) return emailError

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

// ---------------------------------------------------------------------------
// Efecto esperado de cada transición laboral
// ---------------------------------------------------------------------------

/**
 * Qué debe conseguir cada operación, en términos de la clasificación. Es la tabla que
 * las pruebas de los cinco flujos comprueban y la que impide que una operación deje a la
 * persona en dos vistas a la vez.
 *
 * Notas de negocio:
 *   · Contratar a una persona que YA fue trabajador en el cliente es una
 *     reincorporación: la RPC es la misma (`hire_candidate` resuelve la persona por su
 *     `worker_id` y abre un período nuevo), por eso `hire` y `reincorporation` comparten
 *     efecto: la persona vuelve a Trabajadores y NO se duplica su identidad.
 *   · La baja NO elimina nada: cierra la asignación y el contrato vigentes y deja la
 *     persona en Reingresos con todo su historial.
 *   · Reubicar y cambiar de contrato son movimientos DENTRO de Trabajadores: la persona
 *     no cambia de vista y su historial (asignaciones y contratos anteriores) se conserva.
 */
export const TRANSITION_EFFECTS: Record<WorkerTransitionKind, TransitionEffect> = {
  hire: {
    kind: "hire",
    view: "workers",
    assignment: "created",
    contract: "created",
    preservesHistory: true,
  },
  separation: {
    kind: "separation",
    view: "reentries",
    assignment: "closed",
    contract: "closed",
    preservesHistory: true,
  },
  reincorporation: {
    kind: "reincorporation",
    view: "workers",
    assignment: "created",
    contract: "created",
    preservesHistory: true,
  },
  position_change: {
    kind: "position_change",
    view: "workers",
    assignment: "replaced",
    contract: "kept",
    preservesHistory: true,
  },
  contract_change: {
    kind: "contract_change",
    view: "workers",
    assignment: "kept",
    contract: "replaced",
    preservesHistory: true,
  },
}

export const transitionEffect = (kind: WorkerTransitionKind): TransitionEffect =>
  TRANSITION_EFFECTS[kind]

/**
 * Movimiento de nómina que documenta cada transición en el expediente del trabajador.
 * `null` cuando la operación no registra movimiento de nómina (reincorporación y cambio
 * de contrato se documentan con el contrato o la Resolución).
 */
export const TRANSITION_MOVEMENT_DOCUMENT: Record<
  WorkerTransitionKind,
  PayrollMovementType | null
> = {
  hire: "ALTA",
  separation: "BAJA",
  reincorporation: null,
  position_change: "REUBICACION",
  contract_change: null,
}

// ---------------------------------------------------------------------------
// Documento sustitutivo del contrato (§44/§45)
// ---------------------------------------------------------------------------

interface JobDocumentRole {
  is_cuadro?: boolean
  is_principal_specialist?: boolean
}

/** El Cargo destino se documenta con una RESOLUCIÓN, nunca con un contrato. */
export const requiresResolution = (job: JobDocumentRole | null | undefined): boolean =>
  job?.is_principal_specialist === true

/**
 * Cargo Cuadro o Especialista Principal: el alta no genera contrato ni documento
 * contractual alguno; la trayectoria del trabajador concluye ahí.
 */
export const isSpecialDocumentRole = (job: JobDocumentRole | null | undefined): boolean =>
  job?.is_cuadro === true || job?.is_principal_specialist === true

// ---------------------------------------------------------------------------
// Preparación contractual: etiquetas y mensaje humano
// ---------------------------------------------------------------------------

/** Mapea los títulos técnicos de sección a las etiquetas de la lista de verificación. */
export const READINESS_SECTION_LABELS: Record<string, string> = {
  Entidad: "Entidad",
  Representante: "Representante",
  Candidato: "Datos personales",
  Trabajador: "Datos personales",
  Cargo: "Cargo",
  Puesto: "Puesto y jornada",
  Contrato: "Condiciones contractuales",
}

/** Orden en el que se presentan las secciones de la preparación contractual. */
export const READINESS_SECTION_ORDER = [
  "Candidato",
  "Trabajador",
  "Entidad",
  "Representante",
  "Cargo",
  "Puesto",
  "Contrato",
]

/**
 * Construye el mensaje humano (§38) a partir de los datos faltantes que devuelve el
 * validador del backend: agrupa por sección, sin repetir conceptos, en el orden
 * canónico de secciones.
 */
export function formatReadinessMessage(
  readiness: ReadinessResult | null | undefined,
  title = "No se puede realizar la contratación."
): string {
  const missing = readiness?.missing
  if (!missing || missing.length === 0) return ""

  const grouped = new Map<string, string[]>()
  for (const item of missing) {
    const key = READINESS_SECTION_LABELS[item.section] || item.section
    const list = grouped.get(key) || []
    if (!list.includes(item.label)) list.push(item.label)
    grouped.set(key, list)
  }

  const ordered = [...grouped.keys()].sort((a, b) => {
    const ai = READINESS_SECTION_ORDER.findIndex(
      (s) => (READINESS_SECTION_LABELS[s] || s) === a
    )
    const bi = READINESS_SECTION_ORDER.findIndex(
      (s) => (READINESS_SECTION_LABELS[s] || s) === b
    )
    return ai - bi
  })

  let out = `${title}\n\nFalta completar:`
  for (const section of ordered) {
    out += `\n\n${section}`
    for (const label of grouped.get(section) || []) {
      out += `\n• ${label}`
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Validaciones previas de las transiciones
//
// Cada flujo conserva EXACTAMENTE el orden y los mensajes que ya mostraba su diálogo:
// la regla vive aquí una sola vez y la aplican tanto el diálogo (para no lanzar la
// operación) como el caso de uso (autoridad final).
// ---------------------------------------------------------------------------

const isBlank = (value: string | null | undefined): boolean => !value || !value.trim()

export const MISSING_SIGNATURE_PLACE_MESSAGE = "El lugar de firma es obligatorio."
export const MISSING_PAYMENT_METHOD_MESSAGE = "Selecciona la forma de pago."
export const INVALID_COMPONENTS_MESSAGE =
  "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)."
export const MISSING_REPRESENTATIVE_MESSAGE =
  "No hay representantes configurados para la fecha de firma seleccionada."
export const MISSING_HIRING_REPRESENTATIVE_MESSAGE =
  "No existe ningún representante autorizado configurado para la fecha del contrato. Configure los representantes de la entidad para continuar."

/** Lugar de firma del contrato o del anexo. */
export const validateSignaturePlace = (value: string): string | null =>
  isBlank(value) ? MISSING_SIGNATURE_PLACE_MESSAGE : null

/** Forma de pago (catálogo global A tiempo / A rendimiento). */
export const validatePaymentMethod = (paymentMethodId: string): string | null =>
  !paymentMethodId ? MISSING_PAYMENT_METHOD_MESSAGE : null

/** Conceptos retributivos: descripción e importe (>= 0) en cada uno. */
export const validateCompensationComponents = (hasInvalidComponents: boolean): string | null =>
  hasInvalidComponents ? INVALID_COMPONENTS_MESSAGE : null

/** Datos bloqueantes de la formalización (los calcula el backend). */
export const validateFormalizationPending = (blocking: string[]): string | null =>
  blocking.length > 0
    ? `No se puede completar la formalización del contrato. Datos pendientes: ${blocking.join(" · ")}`
    : null

/** Representante que suscribe, autorizado en la fecha de firma. */
export const validateRepresentative = (
  assignmentId: string | null,
  message: string = MISSING_REPRESENTATIVE_MESSAGE
): string | null => (!assignmentId ? message : null)

/** Vigencia del contrato: fecha de fin obligatoria para el tiempo determinado y posterior al inicio. */
export function validateContractEndDate(input: {
  isDetermined: boolean
  endDate: string
  startDate: string
  requiredMessage: string
  orderMessage: string
}): string | null {
  if (input.isDetermined && !input.endDate) return input.requiredMessage
  if (input.endDate && input.endDate <= input.startDate) return input.orderMessage
  return null
}

/** Validaciones comunes del bloque de condiciones formalizadas del contrato. */
function validateFormalizationBlock(
  formalization: ContractFormalizationInput
): string | null {
  return (
    validateSignaturePlace(formalization.signaturePlace) ||
    validatePaymentMethod(formalization.paymentMethodId) ||
    validateCompensationComponents(formalization.hasInvalidComponents) ||
    validateFormalizationPending(formalization.blocking)
  )
}

// --- Contratación (alta y reincorporación de persona que ya fue trabajador) ---

export interface HireValidationInput {
  hasCandidate: boolean
  positionId: string
  hireDate: string
  /**
   * El Cargo destino es Especialista Principal: el documento es una Resolución, así que
   * las condiciones del contrato NO se validan (las valida el formulario de Resolución).
   */
  resolutionDocument: boolean
  /** Cargo Cuadro o Especialista Principal: no exige tipo de contrato ni plantilla. */
  skipsContractTerms: boolean
  contractTypeId: string
  signatureDate: string
  formalization: ContractFormalizationInput
  /** Preparación contractual evaluada por el backend. */
  readiness: ReadinessResult | null
  /** Mensaje de plantilla documental ausente, si el cargo exige contrato. */
  templateBlockedMessage: string | null
  isDetermined: boolean
  contractStartDate: string
  contractEndDate: string
}

export function validateHireInput(input: HireValidationInput): string | null {
  if (!input.hasCandidate) return "Selecciona la persona a contratar."
  if (!input.positionId) return "Selecciona un puesto."
  if (!input.hireDate) return "La fecha de incorporación es obligatoria."
  if (input.resolutionDocument) return null

  if (!input.skipsContractTerms) {
    if (!input.contractTypeId) return "Selecciona un tipo de contrato."
    if (!input.signatureDate) return "La fecha de firma del contrato es obligatoria."
  }

  const formalization = validateFormalizationBlock(input.formalization)
  if (formalization) return formalization

  const representative = validateRepresentative(
    input.formalization.representativeAssignmentId,
    MISSING_HIRING_REPRESENTATIVE_MESSAGE
  )
  if (representative) return representative

  if (input.readiness && !input.readiness.ready) return formatReadinessMessage(input.readiness)

  if (!input.skipsContractTerms && input.templateBlockedMessage) {
    return input.templateBlockedMessage
  }

  return validateContractEndDate({
    isDetermined: input.isDetermined,
    endDate: input.contractEndDate,
    startDate: input.contractStartDate || input.hireDate,
    requiredMessage: "El contrato por tiempo determinado requiere una fecha final.",
    orderMessage: "La fecha final del contrato debe ser posterior a su inicio.",
  })
}

// --- Reincorporación directa de un trabajador inactivo ---

export interface ReincorporationValidationInput {
  positionId: string
  reincorporationDate: string
  /**
   * El Cargo destino es Especialista Principal: el documento es una Resolución y las
   * condiciones del contrato NO aplican (las valida el formulario de Resolución).
   */
  resolutionDocument: boolean
  contractTypeId: string
  signatureDate: string
  formalization: ContractFormalizationInput
  isDetermined: boolean
  contractStartDate: string
  contractEndDate: string
}

export function validateReincorporationInput(
  input: ReincorporationValidationInput
): string | null {
  if (!input.positionId) return "Selecciona un nuevo puesto."
  if (!input.reincorporationDate) return "La fecha de reincorporación es obligatoria."
  if (input.resolutionDocument) return null

  if (!input.contractTypeId) return "Selecciona un tipo de contrato."
  if (!input.signatureDate) return "La fecha de firma del contrato es obligatoria."

  const formalization = validateFormalizationBlock(input.formalization)
  if (formalization) return formalization

  const endDate = validateContractEndDate({
    isDetermined: input.isDetermined,
    endDate: input.contractEndDate,
    startDate: input.contractStartDate || input.reincorporationDate,
    requiredMessage: "El contrato por tiempo determinado requiere una fecha de fin.",
    orderMessage: "La fecha de fin del contrato debe ser posterior a su inicio.",
  })
  if (endDate) return endDate

  return validateRepresentative(input.formalization.representativeAssignmentId)
}

// --- Baja del trabajador ---

export interface SeparationValidationInput {
  effectiveDate: string
  currentPositionStartDate: string | null
  separationReasonId: string
}

export function validateSeparationInput(input: SeparationValidationInput): string | null {
  if (!input.effectiveDate) return "La fecha efectiva de baja es obligatoria."
  if (input.currentPositionStartDate && input.effectiveDate < input.currentPositionStartDate) {
    return "La fecha de baja no puede ser anterior al inicio del puesto actual."
  }
  if (!input.separationReasonId) return "Selecciona un motivo de baja."
  return null
}

// --- Cambio de contrato ---

export interface ContractChangeValidationInput {
  newContractTypeId: string
  effectiveDate: string
  currentContractStartDate: string | null
  isDetermined: boolean
  newEndDate: string
  signatureDate: string
  formalization: ContractFormalizationInput
}

export function validateContractChangeInput(
  input: ContractChangeValidationInput
): string | null {
  if (!input.newContractTypeId) return "Selecciona el nuevo tipo de contrato."
  if (!input.effectiveDate) return "La fecha efectiva es obligatoria."
  if (input.currentContractStartDate && input.effectiveDate <= input.currentContractStartDate) {
    return "La fecha efectiva debe ser posterior al inicio del contrato vigente."
  }

  const endDate = validateContractEndDate({
    isDetermined: input.isDetermined,
    endDate: input.newEndDate,
    startDate: input.effectiveDate,
    requiredMessage: "El contrato por tiempo determinado requiere una fecha de finalización.",
    orderMessage: "La fecha de finalización debe ser posterior a la fecha efectiva.",
  })
  if (endDate) return endDate

  if (!input.signatureDate) return "La fecha de firma del contrato es obligatoria."

  const formalization = validateFormalizationBlock(input.formalization)
  if (formalization) return formalization

  return validateRepresentative(input.formalization.representativeAssignmentId)
}

// --- Reubicación (cambio de puesto) ---

export interface PositionChangeValidationInput {
  newPositionId: string
  effectiveDate: string
  currentPositionStartDate: string | null
  addendum: {
    /** El cambio genera anexo al contrato vigente. */
    create: boolean
    /** El anexo se formaliza en esta misma operación. */
    formalize: boolean
    /** Las diferencias contractuales todavía se están calculando. */
    previewLoading: boolean
    signatureDate: string
    signaturePlace: string
    representativeAssignmentId: string | null
    /** Plantilla documental del anexo ausente o ambigua. */
    templateBlockedMessage: string | null
  }
}

export function validatePositionChangeInput(
  input: PositionChangeValidationInput
): string | null {
  if (!input.newPositionId) return "Selecciona un nuevo puesto."
  if (!input.effectiveDate) return "La fecha efectiva es obligatoria."
  if (input.currentPositionStartDate && input.effectiveDate <= input.currentPositionStartDate) {
    return "La fecha efectiva debe ser posterior al inicio del puesto actual."
  }
  if (input.addendum.previewLoading) {
    return "Espere a que se calculen las diferencias contractuales."
  }
  if (!input.addendum.create || !input.addendum.formalize) return null

  if (!input.addendum.signatureDate) {
    return "La fecha de firma es obligatoria para formalizar el anexo."
  }
  if (isBlank(input.addendum.signaturePlace)) {
    return "El lugar de firma es obligatorio para formalizar el anexo."
  }
  if (!input.addendum.representativeAssignmentId) {
    return "Seleccione el representante vigente en la fecha de firma del anexo."
  }
  if (input.addendum.templateBlockedMessage) return input.addendum.templateBlockedMessage
  return null
}

// ---------------------------------------------------------------------------
// Expediente de la persona (ficha de candidato y ficha de trabajador)
// ---------------------------------------------------------------------------
//
// Las cuatro pantallas del expediente (detalle y formulario de candidato, detalle y
// formulario de trabajador) comparten estas comprobaciones. Están aquí, y no en cada
// formulario, para que el criterio y los MENSAJES sean idénticos en todas: los textos son
// EXACTAMENTE los que ya mostraba cada pantalla.

export const MISSING_BIRTH_DATE_MESSAGE = "La fecha de nacimiento es obligatoria"
export const MISSING_PROFESSION_MESSAGE = "La profesión u oficio es obligatoria"
export const MISSING_ADDRESS_MESSAGE = "La dirección particular es obligatoria"
export const MISSING_PROVINCE_MESSAGE = "La provincia es obligatoria"
export const MISSING_MUNICIPALITY_MESSAGE = "El municipio es obligatorio"
export const INVALID_COMPONENTS_EXPEDIENTE_MESSAGE =
  "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)"

/** Datos personales indispensables para formalizar un contrato (candidato y trabajador). */
export function validatePersonProfileFields(input: {
  birth_date: string | null
  profession_or_trade: string | null
  address: string | null
  province: string | null
  municipality: string | null
}): string | null {
  if (isBlank(input.birth_date)) return MISSING_BIRTH_DATE_MESSAGE
  if (isBlank(input.profession_or_trade)) return MISSING_PROFESSION_MESSAGE
  if (isBlank(input.address)) return MISSING_ADDRESS_MESSAGE
  if (isBlank(input.province)) return MISSING_PROVINCE_MESSAGE
  if (isBlank(input.municipality)) return MISSING_MUNICIPALITY_MESSAGE
  return null
}

/** La especialidad se exige solo en los niveles educacionales que la requieren. */
export function validateSpecialtyRequirement(input: {
  education_level_id: string
  education_level_name: string
  specialty: string
}): string | null {
  if (!input.education_level_id) return null
  if (!candidateRequiresSpecialty(input.education_level_name)) return null
  if (isBlank(input.specialty)) return `La especialidad es obligatoria para ${input.education_level_name}`
  return null
}

/**
 * Documentos verificadores (Chequeo Preempleo y Antecedentes Penales): son obligatorios
 * mientras su casilla esté activada. `*_present` indica que el expediente YA tiene un
 * documento registrado de ese tipo (edición), por lo que no hace falta volver a adjuntarlo.
 */
export function validateVerificationDocuments(input: {
  has_pre_employment_check: boolean
  pre_employment_check_file: File | null
  has_criminal_record_check: boolean
  criminal_record_check_file: File | null
  pre_employment_check_present?: boolean
  criminal_record_check_present?: boolean
}): string | null {
  if (input.has_pre_employment_check && !input.pre_employment_check_file && !input.pre_employment_check_present) {
    return "Debe seleccionar el documento de Chequeo Preempleo"
  }
  if (input.has_criminal_record_check && !input.criminal_record_check_file && !input.criminal_record_check_present) {
    return "Debe seleccionar el documento de Antecedentes Penales"
  }
  return null
}

/** Correo electrónico, cuando se informa. */
export function validateEmail(email: string): string | null {
  if (!email.trim()) return null
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim()) ? null : "El formato del email no es válido"
}

// --- Datos personales del trabajador (alta y edición del expediente) ---

export interface WorkerPersonalDataValidationInput {
  first_name: string
  first_surname: string
  identification: string
  birth_date: string
  profession_or_trade: string
  address: string
  province: string
  municipality: string
  education_level_id: string
  education_level_name: string
  specialty: string
  hire_date: string
}

/**
 * Datos personales y laborales del trabajador. `identificationFormatError` lo aporta el
 * caso de uso desde el kernel compartido (`@/utils/ci`) y se comprueba en su posición
 * original: justo después de exigir que el carné no esté vacío.
 */
export function validateWorkerPersonalData(
  input: WorkerPersonalDataValidationInput,
  identificationFormatError: string | null = null
): string | null {
  if (!input.first_name.trim() || !input.first_surname.trim()) {
    return "El nombre y el primer apellido son obligatorios"
  }
  if (!input.identification.trim()) return "El carné de identidad es obligatorio"
  if (identificationFormatError) return identificationFormatError
  return (
    validatePersonProfileFields(input) ||
    validateSpecialtyRequirement(input) ||
    (!input.hire_date ? "La fecha de incorporación es obligatoria" : null)
  )
}

/** Alta de un trabajador nuevo: puesto disponible y condiciones formalizadas del contrato. */
export interface WorkerRegistrationValidationInput {
  positionId: string
  positionAvailable: boolean
  contractTypeId: string
  isDetermined: boolean
  contractStartDate: string
  contractEndDate: string
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  hasInvalidComponents: boolean
  blocking: string[]
  representativeAssignmentId: string | null
}

export function validateWorkerRegistrationInput(
  input: WorkerRegistrationValidationInput
): string | null {
  if (!input.positionId) return "El puesto es obligatorio"
  if (!input.positionAvailable) {
    return "El puesto seleccionado ya no tiene plazas disponibles. Selecciona otro puesto."
  }
  if (!input.contractTypeId) return "Debes seleccionar un tipo de contrato"
  if (input.isDetermined && !input.contractEndDate) {
    return "El contrato por tiempo determinado requiere una fecha de fin"
  }
  if (input.contractEndDate && input.contractStartDate && input.contractEndDate <= input.contractStartDate) {
    return "La fecha de fin del contrato debe ser posterior a su inicio"
  }
  if (!input.signatureDate) return "La fecha de firma del contrato es obligatoria"
  if (isBlank(input.signaturePlace)) return "El lugar de firma es obligatorio"
  if (!input.paymentMethodId) return "Selecciona la forma de pago"
  if (input.hasInvalidComponents) return INVALID_COMPONENTS_EXPEDIENTE_MESSAGE

  return (
    validateFormalizationPending(input.blocking) ||
    validateRepresentative(input.representativeAssignmentId)
  )
}

/**
 * Registro del contrato desde el expediente del trabajador (`complete_worker_contract`):
 * las condiciones se validan con los mensajes que ya mostraba esa pantalla.
 */
export interface WorkerContractValidationInput {
  contractTypeId: string
  startDate: string
  hireDate: string
  isDetermined: boolean
  endDate: string
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  hasInvalidComponents: boolean
  blocking: string[]
  representativeAssignmentId: string | null
}

export function validateWorkerContractInput(input: WorkerContractValidationInput): string | null {
  if (!input.contractTypeId) return "Selecciona un tipo de contrato"
  if (!input.startDate) return "La fecha de inicio del contrato es obligatoria"
  if (input.isDetermined && !input.endDate) {
    return "El contrato por tiempo determinado requiere una fecha de fin"
  }
  if (input.endDate && input.endDate <= input.startDate) {
    return "La fecha de fin debe ser posterior al inicio"
  }
  if (!input.signatureDate) return "La fecha de firma del contrato es obligatoria"
  if (isBlank(input.signaturePlace)) return "El lugar de firma es obligatorio"
  if (!input.paymentMethodId) return "Selecciona la forma de pago"
  if (input.hasInvalidComponents) return INVALID_COMPONENTS_EXPEDIENTE_MESSAGE

  return (
    validateFormalizationPending(input.blocking) ||
    validateRepresentative(input.representativeAssignmentId)
  )
}

// --- Secciones del expediente del candidato ---

export interface WorkExperienceValidationInput {
  jobTitle: string
  companyName: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

export function validateWorkExperienceInput(input: WorkExperienceValidationInput): string | null {
  if (!input.jobTitle.trim()) return "El puesto de trabajo es obligatorio"
  if (!input.companyName.trim()) return "La empresa u organización es obligatoria"
  if (!input.startDate) return "La fecha de inicio es obligatoria"
  if (!input.isCurrent && !input.endDate) return "Indique la fecha de fin o marque «Puesto actual»"
  if (!input.isCurrent && input.endDate && input.endDate < input.startDate) {
    return "La fecha de fin no puede ser anterior a la fecha de inicio"
  }
  return null
}

export interface AcademicFormationValidationInput {
  programName: string
  startDate: string
  endDate: string
  isStudying: boolean
}

export function validateAcademicFormationInput(
  input: AcademicFormationValidationInput
): string | null {
  if (!input.programName.trim()) return "Indique qué estudió (carrera o programa)"
  if (!input.startDate) return "La fecha de inicio es obligatoria"
  if (!input.isStudying && !input.endDate) return "Indique la fecha de fin o marque «Estudios en curso»"
  if (!input.isStudying && input.endDate && input.endDate < input.startDate) {
    return "La fecha de fin no puede ser anterior a la fecha de inicio"
  }
  return null
}

/** Texto libre de una nota o de una información adicional del expediente. */
export const validateExpedienteText = (text: string, message: string): string | null =>
  !text.trim() ? message : null

/**
 * ¿Hay que subir (o reemplazar) el documento verificador?
 *
 * Regla de conservación del expediente: desmarcar la casilla NUNCA borra el documento
 * histórico y marcar sin archivo nuevo mantiene el documento existente. Solo se escribe
 * cuando la casilla está activada Y el usuario adjuntó un archivo.
 */
export const shouldUploadVerificationDocument = (
  hasDocument: boolean,
  file: File | null
): file is File => hasDocument && file !== null

/**
 * Especialidad que se guarda: solo se conserva en los niveles educacionales que la exigen,
 * de modo que cambiar de nivel no deje una especialidad heredada sin sentido.
 */
export const specialtyForEducationLevel = (
  educationLevelName: string | null | undefined,
  specialty: string
): string | null => (candidateRequiresSpecialty(educationLevelName) ? specialty.trim() || null : null)
