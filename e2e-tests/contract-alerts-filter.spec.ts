import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  ATTENTION_STATES,
  CONTRACT_ALERT_META,
  isContractAlertFilter,
  matchesContractAlertFilter,
  requiresAttention,
  summarizeContractAlerts,
  type ContractAlertRow,
  type ContractAlertState,
} from "../src/modules/contracts/domain/contract-alerts.rules"

/**
 * FILTRO DE VENCIMIENTOS CONTRACTUALES — regresión del listado vacío con «Requieren atención».
 *
 * El módulo de Vencimientos (`src/modules/contracts/presentation/pages/EntityContractAlerts.tsx`) arranca con el filtro
 * «Requieren atención». Ese valor es un AGRUPADOR, no un estado contractual, así que
 * compararlo directamente contra `alert_state` nunca coincide con ninguna fila: el contador
 * mostraba contratos y el listado quedaba vacío.
 *
 * Estas pruebas fijan las dos mitades de la corrección:
 *   1. REGLAS (en memoria, sin base de datos): la regla pura `matchesContractAlertFilter`
 *      resuelve «ALL», el agrupador y los estados individuales, y el número de contratos
 *      filtrados por «ATTENTION» coincide EXACTAMENTE con `summarizeContractAlerts(rows).attention`
 *      cuando no hay otros filtros activos.
 *   2. ESTRUCTURA: la presentación delega en la regla del dominio (no duplica la pertenencia
 *      al grupo ni compara un agrupador contra un estado) y el dominio la publica en su API.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: la frontera se mide por lo que el módulo HACE, no por su doc. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

/** Los siete estados reales, tomados del catálogo canónico del dominio. */
const ALL_STATES = Object.keys(CONTRACT_ALERT_META) as ContractAlertState[]

const alertRow = (alert_state: ContractAlertState): ContractAlertRow => ({
  worker_id: "w-1",
  worker_code: "T-1",
  worker_name: "Ana Pérez",
  identification: "85010112345",
  area_name: "Producción",
  job_name: "Especialista",
  position_name: "Especialista A",
  position_code: "P-01",
  contract_id: `c-${alert_state}`,
  contract_type_name: "Determinado",
  contract_type_code: "DETERMINADO",
  contract_start_date: "2025-01-01",
  contract_end_date: "2026-03-01",
  salary_group_id: "g-1",
  salary_scale_id: "s-1",
  salary_group_sequence_number: 12,
  days_remaining: 10,
  alert_state,
})

/* ------------------------------------------------------------------ */
/* 1. Regla pura del dominio                                           */
/* ------------------------------------------------------------------ */

test.describe("requieren atención: regla de filtrado del dominio", () => {
  test("«ATTENTION» filtra por los estados que requieren atención, no por coincidencia exacta", () => {
    const matched = ALL_STATES.filter((state) =>
      matchesContractAlertFilter(alertRow(state), "ATTENTION")
    )

    expect(matched).toEqual(ATTENTION_STATES)
    expect(matched).toHaveLength(5)
    // Los dos estados que NO generan alerta quedan fuera del agrupador.
    expect(matched).not.toContain("DUE_AFTER_30")
    expect(matched).not.toContain("NO_END_DATE")
  })

  test("un estado individual coincide sólo con su propio estado", () => {
    for (const filter of ALL_STATES) {
      const matched = ALL_STATES.filter((state) =>
        matchesContractAlertFilter(alertRow(state), filter)
      )

      expect(matched).toEqual([filter])
    }
  })

  test("«ALL» no restringe ningún estado", () => {
    for (const state of ALL_STATES) {
      expect(matchesContractAlertFilter(alertRow(state), "ALL")).toBe(true)
    }
  })

  test("la regla coincide con `requiresAttention` estado por estado", () => {
    for (const state of ALL_STATES) {
      expect(matchesContractAlertFilter(alertRow(state), "ATTENTION")).toBe(
        requiresAttention(alertRow(state))
      )
    }
  })

  test("el vocabulario de filtros se estrecha sin conversiones ciegas", () => {
    expect(isContractAlertFilter("ATTENTION")).toBe(true)
    expect(isContractAlertFilter("ALL")).toBe(true)
    for (const state of ALL_STATES) {
      expect(isContractAlertFilter(state)).toBe(true)
    }

    expect(isContractAlertFilter("TODAS")).toBe(false)
    expect(isContractAlertFilter("attention")).toBe(false)
    expect(isContractAlertFilter("")).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Regresión del defecto: contador vs. listado                      */
/* ------------------------------------------------------------------ */

test.describe("regresión: el contador y el listado cuentan lo mismo", () => {
  test("los contratos filtrados por «ATTENTION» coinciden con el contador del módulo", () => {
    const rows = ALL_STATES.map((state) => alertRow(state))
    const summary = summarizeContractAlerts(rows)

    // Sin otros filtros activos (los demás filtros en «ALL» y sin término de búsqueda), el
    // listado del módulo debe mostrar EXACTAMENTE los contratos del contador.
    const visible = rows.filter((row) => matchesContractAlertFilter(row, "ATTENTION"))

    expect(summary.attention).toBe(5)
    expect(visible).toHaveLength(summary.attention)
    // El defecto producía 0 filas con un contador mayor que 0.
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(rows.length)
  })

  test("el invariante se mantiene con varios contratos por estado", () => {
    const rows = ALL_STATES.flatMap((state) => [
      alertRow(state),
      { ...alertRow(state), contract_id: `c-${state}-2` },
    ])
    const summary = summarizeContractAlerts(rows)

    const visible = rows.filter((row) => matchesContractAlertFilter(row, "ATTENTION"))

    expect(summary.attention).toBe(10)
    expect(visible).toHaveLength(summary.attention)
  })

  test("sin filas, contador y listado coinciden en 0", () => {
    const rows: ContractAlertRow[] = []

    expect(summarizeContractAlerts(rows).attention).toBe(0)
    expect(rows.filter((row) => matchesContractAlertFilter(row, "ATTENTION"))).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Estructura: la presentación consume la regla del dominio         */
/* ------------------------------------------------------------------ */

test.describe("filtro de vencimientos: frontera de la presentación", () => {
  test("la página usa la regla del dominio y ya no compara el agrupador con el estado", () => {
    const page = code("src/modules/contracts/presentation/pages/EntityContractAlerts.tsx")

    expect(page).toContain("matchesContractAlertFilter(row, stateFilter)")
    // La regla se consume por la API PÚBLICA del dominio, no desde el módulo interno.
    expect(page).toContain('from "@/modules/contracts"')
    expect(page).not.toContain("contract-alerts.rules")
    // La presentación no duplica la pertenencia al grupo ni interpreta el vocabulario.
    expect(page).not.toContain("ATTENTION_STATES")
    expect(page).not.toContain("alert_state !== stateFilter")
    expect(page).not.toContain("alert_state === stateFilter")
  })

  test("el estado del filtro está tipado con el vocabulario del dominio", () => {
    const page = code("src/modules/contracts/presentation/pages/EntityContractAlerts.tsx")

    expect(page).toContain('React.useState<ContractAlertFilter>("ATTENTION")')
    // El valor del control de selección (siempre `string`) se estrecha con la regla.
    expect(page).toContain("isContractAlertFilter(value)")
  })

  test("el dominio publica la regla, el tipo y el validador en su API pública", () => {
    const api = code("src/modules/contracts/index.ts")

    expect(api).toContain("matchesContractAlertFilter")
    expect(api).toContain("isContractAlertFilter")
    expect(api).toContain("ContractAlertFilter")
  })

  test("la pertenencia al grupo vive sólo en el dominio", () => {
    const rules = code("src/modules/contracts/domain/contract-alerts.rules.ts")

    expect(rules).toContain("export function matchesContractAlertFilter(")
    expect(rules).toContain("export function isContractAlertFilter(")
    expect(rules).toContain("export type ContractAlertFilter")
    // El agrupador sigue definido por los estados de `requiresAttention`, sin duplicar la lista.
    expect(rules).toContain('if (filter === "ATTENTION") return requiresAttention(row)')
  })
})
