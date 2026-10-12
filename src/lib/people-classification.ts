/**
 * CLASIFICACIÓN COMPARTIDA DE PERSONAS — Candidatos · Trabajadores · Reingresos.
 *
 * Una persona solo puede estar en UNA de las tres vistas operativas. El criterio NO
 * es un campo visual ni la mera existencia de una fila en `candidates`: se deduce del
 * estado laboral real y de las relaciones existentes.
 *
 * IDENTIDAD DE PERSONA = (cliente, número de identificación). Es exactamente la que
 * usa el backend: `person_identification_status` y el trigger de unicidad
 * `candidates_prevent_duplicate_person` resuelven la persona por
 * `company_client_id` + `identification`.
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
 * `candidates.status` ('active' | 'archived') es un campo manual: ninguna parte del
 * sistema lo escribe en 'archived', así que no sirve para clasificar.
 *
 * No se añade ninguna columna nueva: los registros actuales ya permiten determinarlo.
 * El ámbito de cada vista lo sigue imponiendo la consulta (`organization_entity_id`)
 * y la RLS (`company_client_id`).
 */

export type PeopleView = "candidates" | "workers" | "reentries"

/** Estado laboral tal y como lo escriben las RPC del backend. */
export const EMPLOYMENT_STATUS = {
  active: "active",
  inactive: "inactive",
} as const

/** Relación laboral registrada para una persona del cliente. */
export interface EmploymentRecord {
  identification: string
  employment_status: string
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
export const hasLinkedWorker = (candidate: { worker_id: string | null }): boolean =>
  !!candidate.worker_id

/** 1. Candidato: persona que nunca ha tenido relación laboral en el cliente. */
export const isPendingCandidate = (
  candidate: { identification: string; worker_id: string | null },
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
