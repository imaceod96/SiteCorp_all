import { test, expect } from "@playwright/test"
import {
  buildEmploymentIndex,
  filterActiveWorkers,
  filterReentryWorkers,
  filterUnlinkedCandidates,
  isActiveWorker,
  isPendingCandidate,
  isReentryWorker,
  type PeopleView,
} from "../src/modules/people/domain/rules"

/**
 * CLASIFICACIÓN DE PERSONAS — Candidatos · Trabajadores · Reingresos.
 *
 * Comprueba la lógica compartida de las tres vistas operativas: cada persona
 * pertenece EXACTAMENTE a una de ellas. La regla vive en el DOMINIO
 * (`src/modules/people/domain/rules.ts`), que no importa nada y por eso puede
 * verificarse de forma aislada.
 *
 * La identidad de persona es (cliente, identificación) —la misma que usan
 * `person_identification_status` y el trigger `candidates_prevent_duplicate_person`—
 * y el estado sale de las relaciones laborales reales, no de un campo visual.
 *
 * El caso «no aparecen personas de otros clientes» es de ámbito: cada vista sigue
 * filtrando por `organization_entity_id` y el índice se construye siempre dentro del
 * cliente. El último test comprueba que el filtro compartido NO añade ni sustituye ese
 * ámbito: solo aplica el criterio de clasificación.
 */

interface CandidateRow {
  identification: string
  worker_id: string | null
}

interface WorkerRow {
  identification: string
  employment_status: string | null
  /** Contratos registrados (históricos o vigentes): NO clasifican por sí mismos. */
  contract_history?: number
}

interface PersonRows {
  candidate?: CandidateRow
  workers?: WorkerRow[]
}

/**
 * Relaciones laborales del cliente: CI-ACTIVO tiene relación vigente y CI-BAJA la
 * tiene finalizada. CI-NUEVO no aparece en el índice (nunca contratada).
 */
const INDEX = buildEmploymentIndex([
  { identification: "CI-ACTIVO", employment_status: "active" },
  { identification: "CI-BAJA", employment_status: "inactive" },
])

/** Vistas operativas en las que aparecería una persona con estas filas. */
const viewsOf = (rows: PersonRows): PeopleView[] => {
  const views = new Set<PeopleView>()
  if (rows.candidate && isPendingCandidate(rows.candidate, INDEX)) views.add("candidates")
  ;(rows.workers ?? []).forEach((worker) => {
    if (isActiveWorker(worker)) views.add("workers")
    else if (isReentryWorker(worker, INDEX)) views.add("reentries")
  })
  return Array.from(views)
}

const CASES: { name: string; rows: PersonRows; expected: PeopleView[] }[] = [
  {
    // 1. Persona que nunca ha sido contratada.
    name: "1. candidato nunca contratado",
    rows: { candidate: { identification: "CI-NUEVO", worker_id: null } },
    expected: ["candidates"],
  },
  {
    // 2. Al contratar, la persona sale de Candidatos y entra en Trabajadores.
    name: "2. candidato contratado",
    rows: {
      candidate: { identification: "CI-ACTIVO", worker_id: "w-1" },
      workers: [{ identification: "CI-ACTIVO", employment_status: "active" }],
    },
    expected: ["workers"],
  },
  {
    // 3. Al dar la baja, sale de Trabajadores y entra en Reingresos.
    name: "3. trabajador dado de baja",
    rows: { workers: [{ identification: "CI-BAJA", employment_status: "inactive" }] },
    expected: ["reentries"],
  },
  {
    // 4. Recontratado desde Reingresos: conserva la fila de la baja anterior y el
    // candidato vinculado, pero con relación vigente solo está en Trabajadores.
    name: "4. persona recontratada desde reingresos",
    rows: {
      candidate: { identification: "CI-ACTIVO", worker_id: "w-1" },
      workers: [
        { identification: "CI-ACTIVO", employment_status: "inactive" },
        { identification: "CI-ACTIVO", employment_status: "active" },
      ],
    },
    expected: ["workers"],
  },
  {
    // 5. Reubicado internamente: la relación sigue vigente, no pasa por Candidatos
    // ni por Reingresos.
    name: "5. trabajador reubicado internamente",
    rows: { workers: [{ identification: "CI-ACTIVO", employment_status: "active" }] },
    expected: ["workers"],
  },
  {
    // 6. Con contratos históricos y uno vigente sigue siendo un trabajador vigente.
    name: "6. contratos históricos y uno vigente",
    rows: {
      workers: [
        { identification: "CI-ACTIVO", employment_status: "active", contract_history: 4 },
      ],
    },
    expected: ["workers"],
  },
  {
    // 7. Fila de candidato ANTIGUA sin vincular de una persona ya contratada: no
    // puede reaparecer en Candidatos (caso real detectado en los datos).
    name: "7. fila de candidato huérfana de una persona contratada",
    rows: {
      candidate: { identification: "CI-ACTIVO", worker_id: null },
      workers: [{ identification: "CI-ACTIVO", employment_status: "active" }],
    },
    expected: ["workers"],
  },
]

test("cada persona pertenece a una sola vista operativa", () => {
  for (const testCase of CASES) {
    expect(viewsOf(testCase.rows), testCase.name).toEqual(testCase.expected)
  }
})

/** Consulta falsa: registra el filtro que recibe, sin tocar Supabase. */
interface RecordingQuery {
  calls: string[]
  is(column: string, value: null): RecordingQuery
  eq(column: string, value: string): RecordingQuery
  neq(column: string, value: string): RecordingQuery
}

const recordingQuery = (): RecordingQuery => {
  const query: RecordingQuery = {
    calls: [],
    is(column, value) {
      query.calls.push(`is ${column} ${value}`)
      return query
    },
    eq(column, value) {
      query.calls.push(`eq ${column} ${value}`)
      return query
    },
    neq(column, value) {
      query.calls.push(`neq ${column} ${value}`)
      return query
    },
  }
  return query
}

test("las tres vistas aplican su filtro físico y solo ese", () => {
  const candidates = recordingQuery()
  filterUnlinkedCandidates(candidates)
  expect(candidates.calls).toEqual(["is worker_id null"])

  const workers = recordingQuery()
  filterActiveWorkers(workers)
  expect(workers.calls).toEqual(["eq employment_status active"])

  const reentries = recordingQuery()
  filterReentryWorkers(reentries)
  expect(reentries.calls).toEqual(["neq employment_status active"])
})
