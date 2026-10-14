import { test, expect } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import {
  CONTRACT_ALERT_FILTER_OPTIONS,
  CONTRACT_ALERT_FULL_HORIZON_DAYS,
  CONTRACT_ALERT_HORIZON_DAYS,
  CONTRACT_ALERT_LOOKAHEAD_DAYS,
  CONTRACT_ALERT_META,
  deadlineLabel,
  formatContractDate,
  needsCorrection,
  requiresAttention,
  summarizeContractAlerts,
  type ContractAlertRow,
  type ContractAlertState,
} from "../src/domains/contracts/domain/contract-alerts.rules"
import { drivingLicenseLabels } from "../src/domains/people/domain/catalogs.rules"
import type { CatalogOption } from "../src/domains/people/domain/entities"
import {
  MOVEMENTS_WINDOW_DAYS,
  summarizeCandidates,
  summarizeContractDataReadiness,
  summarizeContracts,
  summarizeDocumentTemplatesStatus,
  summarizeMovements,
  summarizeRepresentativeStatus,
} from "../src/domains/entity-summary/domain/summary.rules"
import {
  DOCUMENT_VARIABLES,
  describeDocumentDuration,
  documentSignatureDay,
  documentSignatureMonth,
  documentSignatureYear,
  documentVariableByKey,
  documentVariablesByCategory,
  formatDocumentAmount,
  formatDocumentDate,
  formatDocumentDateShort,
  formatDocumentDateTextual,
  formatDocumentHours,
  formatSc404Dias,
} from "../src/domains/document-templates/domain/document-variables"
import {
  resolveAllDocumentVariables,
  resolveDocumentVariable,
} from "../src/domains/document-generation/domain/document-resolution.rules"
import type { ContractDocumentData } from "../src/domains/document-generation/domain/document-data"

/**
 * CIERRE DE `src/lib` — catálogos, alertas contractuales, resumen de entidades y contratos
 * documentales compartidos.
 *
 * Comprueba, SIN escribir en la base de datos y con datos en memoria, lo que decide si la
 * consolidación de este bloque se mantiene:
 *   1. Las REGLAS que la aplicación ya aplicaba (categorías y textos de alerta, etiquetas del
 *      catálogo de licencias, contadores del Resumen) dan exactamente el mismo resultado.
 *   2. El CATÁLOGO documental (variables, formatos, resolutores y tipos compartidos) sigue
 *      completo y resuelve igual, ahora repartido entre plantillas y generación.
 *   3. La arquitectura: cada consulta vive en UN repositorio de su dominio, no hay ciclos
 *      entre dominios, la presentación no consulta Supabase y las fachadas sin consumidores
 *      se retiraron.
 *   4. REGRESIÓN de la frontera de esquema: ninguna constante de módulo puede construir
 *      consultas con el esquema físico antes de `initSchemaTarget()`.
 *
 * Distinción explícita: estas pruebas son de REGLAS, CONTRATOS y ESTRUCTURA (no tocan datos
 * reales). Las pruebas funcionales contra la base de datos son las de los demás guiones del
 * proyecto (`expediente-*`, `people-*`, `document-*`), que se siguen ejecutando aparte.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: la frontera se mide por lo que el módulo HACE, no por su doc. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

/** Todos los módulos de `src`: permite comprobar la frontera sin enumerar archivos a mano. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : []
  )

const alertRow = (over: Partial<ContractAlertRow> = {}): ContractAlertRow => ({
  worker_id: "w-1",
  worker_code: "T-1",
  worker_name: "Ana Pérez",
  identification: "85010112345",
  area_name: "Producción",
  job_name: "Especialista",
  position_name: "Especialista A",
  position_code: "P-01",
  contract_id: "c-1",
  contract_type_name: "Determinado",
  contract_type_code: "DETERMINADO",
  contract_start_date: "2025-01-01",
  contract_end_date: "2026-03-01",
  salary_group_id: "g-1",
  salary_scale_id: "s-1",
  salary_group_sequence_number: 12,
  days_remaining: 10,
  alert_state: "DUE_IN_15",
  ...over,
})

/* ------------------------------------------------------------------ */
/* 1. Alertas contractuales — criterios, prioridades y textos          */
/* ------------------------------------------------------------------ */

test.describe("alertas contractuales", () => {
  test("los estados, las prioridades y los filtros no cambian", () => {
    expect(CONTRACT_ALERT_HORIZON_DAYS).toBe(30)
    expect(CONTRACT_ALERT_LOOKAHEAD_DAYS).toBe(3650)
    expect(CONTRACT_ALERT_FULL_HORIZON_DAYS).toBe(CONTRACT_ALERT_LOOKAHEAD_DAYS)

    expect(Object.keys(CONTRACT_ALERT_META)).toEqual([
      "OVERDUE",
      "DUE_TODAY",
      "DUE_IN_7",
      "DUE_IN_15",
      "DUE_IN_30",
      "DUE_AFTER_30",
      "NO_END_DATE",
    ])
    // Etiquetas y prioridad visual (badge) exactas.
    expect(CONTRACT_ALERT_META.OVERDUE).toEqual({ label: "Vencido", badge: "danger" })
    expect(CONTRACT_ALERT_META.DUE_TODAY).toEqual({ label: "Vence hoy", badge: "danger" })
    expect(CONTRACT_ALERT_META.DUE_IN_7).toEqual({ label: "Vence en 7 días", badge: "warning" })
    expect(CONTRACT_ALERT_META.DUE_IN_15).toEqual({ label: "Vence en 15 días", badge: "warning" })
    expect(CONTRACT_ALERT_META.DUE_IN_30).toEqual({ label: "Vence en 30 días", badge: "info" })
    expect(CONTRACT_ALERT_META.DUE_AFTER_30).toEqual({ label: "Más de 30 días", badge: "neutral" })
    expect(CONTRACT_ALERT_META.NO_END_DATE).toEqual({
      label: "Sin fecha de finalización",
      badge: "neutral",
    })

    // Rangos EXCLUYENTES, con su orden y sus etiquetas.
    expect(CONTRACT_ALERT_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "ATTENTION",
      "OVERDUE",
      "DUE_TODAY",
      "DUE_IN_7",
      "DUE_IN_15",
      "DUE_IN_30",
      "DUE_AFTER_30",
      "NO_END_DATE",
    ])
    expect(CONTRACT_ALERT_FILTER_OPTIONS[0].label).toBe("Todos los que requieren atención")
    expect(CONTRACT_ALERT_FILTER_OPTIONS[5].label).toBe("16–30 días")
    expect(CONTRACT_ALERT_FILTER_OPTIONS[7].label).toBe("Sin fecha de finalización")
  })

  test("«requiere atención» incluye los 5 rangos de seguimiento y ninguno más", () => {
    const states: ContractAlertState[] = [
      "OVERDUE",
      "DUE_TODAY",
      "DUE_IN_7",
      "DUE_IN_15",
      "DUE_IN_30",
      "DUE_AFTER_30",
      "NO_END_DATE",
    ]

    const attention = states.filter((state) => requiresAttention(alertRow({ alert_state: state })))
    expect(attention).toEqual(["OVERDUE", "DUE_TODAY", "DUE_IN_7", "DUE_IN_15", "DUE_IN_30"])

    // Sólo el contrato determinado sin fecha de fin es una inconsistencia administrativa.
    const corrections = states.filter((state) => needsCorrection(alertRow({ alert_state: state })))
    expect(corrections).toEqual(["NO_END_DATE"])
  })

  test("los contadores del módulo y del Resumen son los mismos", () => {
    const rows: ContractAlertRow[] = [
      alertRow({ contract_id: "c-1", alert_state: "OVERDUE" }),
      alertRow({ contract_id: "c-2", alert_state: "DUE_TODAY" }),
      alertRow({ contract_id: "c-3", alert_state: "DUE_IN_7" }),
      alertRow({ contract_id: "c-4", alert_state: "DUE_IN_7" }),
      alertRow({ contract_id: "c-5", alert_state: "DUE_IN_15" }),
      alertRow({ contract_id: "c-6", alert_state: "DUE_IN_30" }),
      alertRow({ contract_id: "c-7", alert_state: "DUE_AFTER_30" }),
      alertRow({ contract_id: "c-8", alert_state: "NO_END_DATE" }),
    ]

    expect(summarizeContractAlerts(rows)).toEqual({
      overdue: 1,
      dueToday: 1,
      dueIn7: 2,
      dueIn15: 1,
      dueIn30: 1,
      after30: 1,
      attention: 6,
      correction: 1,
    })

    // Sin filas: todos los contadores a cero (nunca NaN ni undefined).
    expect(summarizeContractAlerts([])).toEqual({
      overdue: 0,
      dueToday: 0,
      dueIn7: 0,
      dueIn15: 0,
      dueIn30: 0,
      after30: 0,
      attention: 0,
      correction: 0,
    })
  })

  test("el texto del vencimiento y la fecha laboral se mantienen", () => {
    expect(deadlineLabel(null, null)).toBe("Sin fecha de finalización")
    expect(deadlineLabel(5, null)).toBe("Sin fecha de finalización")
    expect(deadlineLabel(5, "2026-03-01")).toBe("Vence en 5 días")
    expect(deadlineLabel(1, "2026-03-01")).toBe("Vence mañana")
    expect(deadlineLabel(0, "2026-03-01")).toBe("Vence hoy")
    expect(deadlineLabel(-1, "2026-03-01")).toBe("Vencido hace 1 día")
    expect(deadlineLabel(-12, "2026-03-01")).toBe("Vencido hace 12 días")

    expect(formatContractDate("2026-03-01")).toBe("01/03/2026")
    expect(formatContractDate(null)).toBe("—")
    expect(formatContractDate(undefined)).toBe("—")
    expect(formatContractDate("")).toBe("—")
    // Una fecha no ISO se devuelve tal cual: nunca se inventa un formato.
    expect(formatContractDate("sin fecha")).toBe("sin fecha")
  })
})

/* ------------------------------------------------------------------ */
/* 2. Catálogos de persona y licencias de conducción                   */
/* ------------------------------------------------------------------ */

test.describe("catálogos de persona", () => {
  test("las etiquetas de licencia salen en el orden del catálogo", () => {
    const categories: CatalogOption[] = [
      { id: "cat-a", name: "Categoría A", code: "A" },
      { id: "cat-b", name: "Categoría B", code: "B" },
      { id: "cat-c", name: "Categoría C" },
    ]

    // El orden es el del catálogo (A, B, C), no el de los identificadores recibidos,
    // y sin código visible se muestra el nombre del catálogo.
    expect(drivingLicenseLabels(["cat-c", "cat-a", "cat-b"], categories)).toEqual([
      "A",
      "B",
      "Categoría C",
    ])
    // Un identificador desconocido no aporta etiqueta.
    expect(drivingLicenseLabels(["cat-c", "cat-x"], categories)).toEqual(["Categoría C"])
    expect(drivingLicenseLabels([], categories)).toEqual([])
  })

  test("los catálogos globales se consultan en el repositorio del dominio", () => {
    const repository = code("src/domains/people/infrastructure/catalogs.repository.ts")

    // Mismas tablas, mismos filtros y mismos órdenes de siempre.
    expect(repository).toMatch(/\.from\("skin_colors"\)/)
    expect(repository).toMatch(/\.eq\("is_active", true\)/)
    expect(repository).toMatch(/\.from\("driving_license_categories"\)/)
    expect(repository).toMatch(/\.order\("display_order"\)/)
    expect(repository).toMatch(/\.order\("name"\)/)

    // La relación real de licencias y sus dos RPC de reemplazo exacto.
    expect(repository).toMatch(/\.from\("candidate_driving_license_categories"\)/)
    expect(repository).toMatch(/\.from\("worker_driving_license_categories"\)/)
    expect(repository).toMatch(/\.rpc\("save_candidate_driving_licenses", \{/)
    expect(repository).toMatch(/p_candidate_id: candidateId/)
    expect(repository).toMatch(/p_category_ids: categoryIds/)
    expect(repository).toMatch(/\.rpc\("save_worker_driving_licenses", \{/)
    expect(repository).toMatch(/p_worker_id: workerId/)

    // El tipo de catálogo es el MISMO del dominio: no se duplica la definición.
    const entities = code("src/domains/people/domain/entities.ts")
    expect(entities).toMatch(/export interface CatalogOption extends CatalogRow \{/)
    expect(code("src/domains/people/domain/catalogs.rules.ts")).not.toMatch(
      /export interface CatalogOption/
    )
  })

  test("los catálogos globales se leen sólo desde los sitios conocidos", () => {
    // Lecturas del catálogo global (color de piel y licencias). Los tres consumidores
    // históricos siguen teniendo su motivo propio y no son candidatos de selección:
    //   · catalogs.repository  → repositorio del bloque (selección: activos y ordenados).
    //   · worker-migration     → catálogo COMPLETO (incluye inactivos) para mapear la carga.
    //   · people.repository    → índice de licencias de la vista de candidatos.
    //   · entity-summary/reports → informe demográfico por color de piel.
    const readers = sourceFiles("src")
      .filter((file) =>
        /\.from\("(skin_colors|driving_license_categories|candidate_driving_license_categories|worker_driving_license_categories)"\)/.test(
          code(file)
        )
      )
      .sort()

    expect(readers).toEqual([
      "src/domains/entity-summary/infrastructure/reports.repository.ts",
      "src/domains/people/infrastructure/catalogs.repository.ts",
      "src/domains/people/infrastructure/people.repository.ts",
      "src/domains/people/infrastructure/worker-migration.repository.ts",
    ])

    // El reemplazo exacto de licencias, en un solo punto de acceso.
    const licenseWriters = sourceFiles("src").filter((file) =>
      /\.rpc\("save_(candidate|worker)_driving_licenses"/.test(code(file))
    )
    expect(licenseWriters).toEqual(["src/domains/people/infrastructure/catalogs.repository.ts"])
  })
})

/* ------------------------------------------------------------------ */
/* 3. Resumen de entidades — contadores y agregación                   */
/* ------------------------------------------------------------------ */

test.describe("resumen de entidades", () => {
  test("los contadores de candidatos y de contratos vigentes no cambian", () => {
    expect(
      summarizeCandidates([
        { status: "archived", worker_id: null },
        { status: "active", worker_id: "w-1" },
        { status: null, worker_id: "w-2" },
      ])
    ).toEqual({ total: 3, active: 2, archived: 1, hired: 2 })

    const codeById = { t1: "DETERMINADO", t2: "INDETERMINADO", t3: "OTRO" }
    expect(
      summarizeContracts(
        [
          { contract_type_id: "t1" },
          { contract_type_id: "t2" },
          { contract_type_id: "t3" },
          { contract_type_id: null },
        ],
        codeById
      )
    ).toEqual({ current: 4, determined: 1, undetermined: 1 })
  })

  test("los movimientos del período cuentan por tipo y conservan la ventana", () => {
    const period = { from: "2026-01-01", to: "2026-01-30" }
    expect(
      summarizeMovements(period, 3, [
        { movement_type: "BAJA" },
        { movement_type: "REINCORPORACION" },
        { movement_type: "CAMBIO_PUESTO" },
        { movement_type: "CAMBIO_CONTRATO" },
        { movement_type: "OTRO" },
      ])
    ).toEqual({
      from: "2026-01-01",
      to: "2026-01-30",
      days: MOVEMENTS_WINDOW_DAYS,
      hires: 3,
      separations: 1,
      reincorporations: 1,
      positionChanges: 1,
      contractChanges: 1,
    })

    expect(MOVEMENTS_WINDOW_DAYS).toBe(30)
  })

  test("la readiness de la configuración se interpreta igual", () => {
    expect(summarizeContractDataReadiness({ ready: true, missing: ["a", "b"] })).toEqual({
      ready: true,
      missing: 2,
    })
    expect(summarizeContractDataReadiness({ ready: false, missing: [] })).toEqual({
      ready: false,
      missing: 0,
    })
    expect(summarizeContractDataReadiness(null)).toEqual({ ready: false, missing: 0 })
    expect(
      summarizeContractDataReadiness({ ready: true, missing: "no-es-lista" as unknown as unknown[] })
    ).toEqual({ ready: true, missing: 0 })

    expect(summarizeRepresentativeStatus([{ person_name: "Ana" }])).toEqual({
      ready: true,
      assigned: 1,
    })
    expect(
      summarizeRepresentativeStatus([{ person_name: "Ana" }, { person_name: " " }, { person_name: null }])
    ).toEqual({ ready: false, assigned: 1 })
    expect(summarizeRepresentativeStatus([])).toEqual({ ready: false, assigned: 0 })

    expect(
      summarizeDocumentTemplatesStatus(
        [{ code: "CONTRACT" }, { code: "ADDENDUM" }],
        [{ document_type_code: "CONTRACT" }, { document_type_code: "CONTRACT" }]
      )
    ).toEqual({ total: 2, configured: 1 })
  })

  test("las consultas del Resumen están centralizadas en su dominio", () => {
    const repository = code("src/domains/entity-summary/infrastructure/summary.repository.ts")

    // Las mismas tablas, con el ámbito por entidad intacto.
    expect(repository).toMatch(/\.from\("candidates"\)/)
    expect(repository).toMatch(/\.from\("employment_contracts"\)/)
    expect(repository).toMatch(/\.eq\("is_current", true\)/)
    expect(repository).toMatch(/\.from\("employment_contract_types"\)/)
    expect(repository).toMatch(/\.from\("workers"\)/)
    expect(repository).toMatch(/\.from\("worker_employment_movements"\)/)
    expect(repository).toMatch(/workers\.organization_entity_id/)
    expect(repository).toMatch(/\.gte\("hire_date", from\)/)

    // Las mismas RPC, con sus mismos parámetros.
    expect(repository).toMatch(/\.rpc\("validate_entity_contract_readiness", \{/)
    expect(repository).toMatch(/p_entity_id: entityId/)
    expect(repository).toMatch(/\.rpc\("resolve_entity_representatives", \{/)
    expect(repository).toMatch(/p_on_date: onDate/)
    expect(repository).toMatch(/\.rpc\("resolve_salary_scale_for_entity", \{/)
    expect(repository).toMatch(/\.from\("document_template_types"\)/)
    expect(repository).toMatch(/\.from\("document_template_versions"\)/)

    // Y estas RPC se invocan desde los sitios conocidos (las otras dos pertenecen a los
    // dominios que administran representantes y escalas salariales), nunca desde la interfaz.
    const callers = sourceFiles("src")
      .filter((file) =>
        /\.rpc\("(validate_entity_contract_readiness|resolve_entity_representatives|resolve_salary_scale_for_entity)"/.test(
          code(file)
        )
      )
      .sort()

    expect(callers).toEqual([
      "src/domains/entity-summary/infrastructure/summary.repository.ts",
      "src/domains/organization-structure/infrastructure/salary.repository.ts",
      "src/domains/representatives/infrastructure/representatives.repository.ts",
    ])

    // La validación de integridad contractual es EXCLUSIVA del Resumen.
    const readinessCallers = sourceFiles("src").filter((file) =>
      /\.rpc\("validate_entity_contract_readiness"/.test(code(file))
    )
    expect(readinessCallers).toEqual([
      "src/domains/entity-summary/infrastructure/summary.repository.ts",
    ])
  })

  test("los vencimientos del Resumen reutilizan el cálculo del dominio de contratos", () => {
    const queries = code("src/domains/entity-summary/application/entity-summary.queries.ts")

    // Una sola clasificación: la del dominio de contratos.
    expect(queries).toMatch(/from "@\/domains\/contracts"/)
    expect(queries).toMatch(/fetchContractAlerts\(/)
    expect(queries).toMatch(/summarizeContractAlerts\(/)
    expect(queries).toMatch(/CONTRACT_ALERT_HORIZON_DAYS/)
    // El Resumen NO vuelve a consultar la RPC de vencimientos.
    expect(queries).not.toMatch(/\.rpc\("contract_expiry_alerts"/)
    expect(queries).not.toMatch(/\bsupabase\b/)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Variables documentales — catálogo, formatos y resolución         */
/* ------------------------------------------------------------------ */

const contractSnapshot = (over: Partial<ContractDocumentData> = {}): ContractDocumentData => ({
  document_type: "CONTRACT",
  contract_id: "c-1",
  contract_type_code: "DETERMINADO",
  contract_type_name: "Determinado",
  entity: {
    name: "Empresa Uno",
    organism: "Organismo",
    branch: "Rama",
    labor_code: "C-01",
    address: "Calle 1",
    province: "La Habana",
    municipality: "Playa",
    revolution_year: "68",
  },
  representative: { name: "Ana Pérez", position: "Directora" },
  worker: {
    full_name: "Juan Gómez",
    identification: "90010112345",
    birth_date: "1990-01-01",
    profession: "Mecánico",
    address: "Calle 2",
    province: "La Habana",
    municipality: "Playa",
  },
  job: { name: "Especialista", occupational_category: "Técnico", salary_group_sequence: 12 },
  position: { name: "Especialista A", code: "P-01", work_location: "Taller" },
  schedule: {
    daily_hours: 8,
    weekly_hours: 40,
    monthly_hours: 176,
    break_minutes: 30,
    text: "Lunes a viernes",
  },
  contract: {
    type_name: "Determinado",
    type_code: "DETERMINADO",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    signature_date: "2026-01-05",
    signature_place: "Playa",
    payment_method: "TRANSFERENCIA",
    payment_schedule: "MENSUAL",
  },
  compensation: {
    base_salary: 4000,
    additional_payments: 200,
    abnormal_conditions_payments: 100,
    other_payments: 0,
    total: 4300,
    currency: "CUP",
  },
  formalized_addendums: [],
  ...over,
})

test.describe("variables documentales", () => {
  test("el catálogo sigue completo y sin claves repetidas", () => {
    expect(DOCUMENT_VARIABLES.length).toBeGreaterThan(100)

    const keys = DOCUMENT_VARIABLES.map((definition) => definition.key)
    expect(new Set(keys).size).toBe(keys.length)

    const kinds = new Set<string>()
    DOCUMENT_VARIABLES.forEach((definition) => {
      expect(definition.label.length, definition.key).toBeGreaterThan(0)
      expect(definition.description.length, definition.key).toBeGreaterThan(0)
      expect(definition.documentTypes.length, definition.key).toBeGreaterThan(0)
      expect(["text", "integer", "amount", "date", "hours"]).toContain(definition.dataType)
      expect(["SOURCE", "CALCULATED"]).toContain(definition.kind)
      kinds.add(definition.kind)
    })
    // Se conservan las variables calculadas y las que provienen de datos.
    expect(Array.from(kinds).sort()).toEqual(["CALCULATED", "SOURCE"])
  })

  test("las variables conocidas siguen existiendo y se agrupan por categoría", () => {
    for (const key of [
      "entity.name",
      "entity.revolution_year",
      "representative.name",
      "worker.full_name",
      "worker.identification",
      "job.name",
      "job.salary_group",
      "position.name",
      "schedule.daily_hours",
      "s.dias",
    ]) {
      expect(documentVariableByKey(key), `falta la variable ${key}`).toBeTruthy()
    }
    expect(documentVariableByKey("no.existe")).toBeUndefined()

    const grouped = documentVariablesByCategory()
    const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0)
    expect(total).toBe(DOCUMENT_VARIABLES.length)
    expect(Object.keys(grouped)).toContain("Entidad")
    expect(Object.keys(grouped)).toContain("Trabajador")
  })

  test("los formatos de presentación no cambian", () => {
    expect(formatDocumentDate("2026-10-15")).toBe("15/10/2026")
    expect(formatDocumentDate("2026-10-15T08:00:00Z")).toBe("15/10/2026")
    expect(formatDocumentDate(null)).toBeNull()
    expect(formatDocumentDateShort("2026-10-15")).toBe("15/10/26")
    expect(formatDocumentDateTextual("2026-10-15")).toBe("15 de octubre de 2026")
    expect(documentSignatureDay("2026-10-15")).toBe(15)
    expect(documentSignatureMonth("2026-10-15")).toBe("octubre")
    expect(documentSignatureYear("2026-10-15")).toBe(2026)

    expect(formatDocumentAmount(4000)).toBe("4 000,00")
    expect(formatDocumentAmount(-1234.5)).toBe("-1 234,50")
    expect(formatDocumentAmount("no-numero")).toBeNull()
    expect(formatSc404Dias(1)).toBe("1 día")
    expect(formatSc404Dias(3)).toBe("3 días")
    expect(formatDocumentHours(8)).toBe("8")
    expect(formatDocumentHours(8.5)).toBe("8,50")
    expect(describeDocumentDuration("2026-01-01", "2026-07-01")).toBe("6 meses")
    expect(describeDocumentDuration(null, "2026-07-01")).toBeNull()
  })

  test("la resolución distingue valor de faltante y no inventa texto", () => {
    const snapshot = contractSnapshot()

    expect(resolveDocumentVariable(snapshot, "entity.name")).toEqual({
      status: "value",
      value: "Empresa Uno",
    })
    // El grupo salarial se resuelve en números romanos.
    expect(resolveDocumentVariable(snapshot, "job.salary_group").value).toBe("XII")
    // Sin datos: `missing`, nunca null/undefined/[object Object].
    expect(resolveDocumentVariable(snapshot, "no.existe")).toEqual({
      status: "missing",
      value: null,
    })

    const resolved = resolveAllDocumentVariables(snapshot)
    expect(resolved.documentType).toBe("CONTRACT")
    expect(resolved.values["entity.name"]).toBe("Empresa Uno")
    expect(resolved.values["worker.full_name"]).toBe("Juan Gómez")
    expect(resolved.values["contract.start_date"]).toBe("01/01/2026")
    // Toda variable resuelta tiene su definición y su valor formateado como texto.
    Object.entries(resolved.values).forEach(([key, value]) => {
      expect(documentVariableByKey(key), `valor sin definición: ${key}`).toBeTruthy()
      expect(typeof value).toBe("string")
      expect(value.length).toBeGreaterThan(0)
    })
    resolved.missing.forEach((entry) => {
      // Cada variable sin valor viaja con su etiqueta legible y fuera de los valores.
      expect(entry.label.length).toBeGreaterThan(0)
      expect(resolved.values[entry.key]).toBeUndefined()
    })

    // Un dato ausente es `missing` y se informa con su etiqueta; nunca aparece como valor.
    const withoutProfession = contractSnapshot({
      worker: { ...contractSnapshot().worker, profession: null },
    })
    expect(resolveDocumentVariable(withoutProfession, "worker.profession").status).toBe("missing")
    const partial = resolveAllDocumentVariables(withoutProfession)
    expect(partial.values["worker.profession"]).toBeUndefined()
    expect(partial.missing.map((entry) => entry.key)).toContain("worker.profession")
    expect(partial.values["worker.full_name"]).toBe("Juan Gómez")
  })

  test("el catálogo vive en plantillas y los resolutores en generación, sin ciclos", () => {
    // El catálogo y sus formatos, en el dominio de plantillas.
    expect(existsSync("src/domains/document-templates/domain/document-variables.ts")).toBe(true)
    // Los resolutores y los contratos del snapshot, en el dominio de generación.
    expect(existsSync("src/domains/document-generation/domain/document-resolution.rules.ts")).toBe(true)
    expect(existsSync("src/domains/document-generation/domain/document-data.ts")).toBe(true)

    // Las plantillas NO conocen el motor de generación.
    const templateFiles = sourceFiles("src/domains/document-templates")
    const cycle = templateFiles.filter((file) => /from "@\/domains\/document-generation/.test(code(file)))
    expect(cycle, "document-templates no puede depender de document-generation").toEqual([])

    // La generación SÍ consume el catálogo de plantillas, y lo hace por el módulo de DOMINIO
    // (nunca por el barrel): así el dominio no arrastra la infraestructura del otro contexto.
    for (const file of [
      "src/domains/document-generation/domain/document-resolution.rules.ts",
      "src/domains/document-generation/domain/rules.ts",
    ]) {
      expect(code(file), file).toMatch(/from "@\/domains\/document-templates\/domain\/document-variables"/)
      expect(code(file), file).not.toMatch(/from "@\/domains\/document-templates"/)
    }

    // Los contratos del snapshot son tipos puros: sin Supabase y sin dependencias.
    const snapshotContracts = code("src/domains/document-generation/domain/document-data.ts")
    expect(snapshotContracts).toMatch(/export type DocumentData =/)
    expect(snapshotContracts).not.toMatch(/\bsupabase\b/)
    expect(snapshotContracts).not.toMatch(/^import /m)
  })

  test("los dominios del bloque sólo se conocen en una dirección", () => {
    /** ¿Algún módulo de `domain` importa del dominio `target` (barrel o módulo interno)? */
    const dependsOn = (domain: string, target: string) =>
      sourceFiles(`src/domains/${domain}`).some((file) =>
        new RegExp(`from "@/domains/${target}(/|\")`).test(code(file))
      )

    // Personas → Contratos (documentos de una transición), pero Contratos no conoce Personas.
    expect(dependsOn("people", "contracts")).toBe(true)
    expect(dependsOn("contracts", "people")).toBe(false)

    // Resumen → Contratos y Resumen → Personas; ninguno de los dos conoce el Resumen.
    expect(dependsOn("entity-summary", "contracts")).toBe(true)
    expect(dependsOn("entity-summary", "people")).toBe(true)
    expect(dependsOn("contracts", "entity-summary")).toBe(false)
    expect(dependsOn("people", "entity-summary")).toBe(false)

    // Generación → Plantillas (ya existía); Plantillas no conoce el motor.
    expect(dependsOn("document-generation", "document-templates")).toBe(true)
    expect(dependsOn("document-templates", "document-generation")).toBe(false)
  })

  test("el resolvedor no se apoya en el cliente de Supabase", () => {
    const resolution = code("src/domains/document-generation/domain/document-resolution.rules.ts")
    expect(resolution).not.toMatch(/\bsupabase\b/)
    expect(resolution).toMatch(/export const resolveAllDocumentVariables/)
    expect(resolution).toMatch(/export const resolveDocumentVariable/)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Consultas centralizadas y frontera de presentación               */
/* ------------------------------------------------------------------ */

test("los vencimientos se consultan sólo desde el repositorio de contratos", () => {
  const repository = code("src/domains/contracts/infrastructure/contract-alerts.repository.ts")
  expect(repository).toMatch(/\.rpc\("contract_expiry_alerts", \{/)
  expect(repository).toMatch(/target_entity_id: entityId/)
  expect(repository).toMatch(/horizon_days: options.horizonDays \?\? CONTRACT_ALERT_HORIZON_DAYS/)
  expect(repository).toMatch(/target_worker_id: options.workerId \?\? null/)

  const offenders = sourceFiles("src").filter((file) => {
    if (file === "src/domains/contracts/infrastructure/contract-alerts.repository.ts") return false
    const text = code(file)
    return (
      /\.rpc\("contract_expiry_alerts"/.test(text) || /\.from\("contract_expiry_alerts"\)/.test(text)
    )
  })
  expect(offenders, "la RPC de vencimientos tiene un solo punto de acceso").toEqual([])
})

test("la presentación no consulta Supabase por su cuenta", () => {
  const offenders = sourceFiles("src").filter(
    (file) =>
      /^src\/(pages|components|hooks|contexts)\//.test(file) &&
      /from "@\/lib\/supabase"/.test(code(file))
  )
  expect(offenders, "la presentación consume casos de uso, nunca el cliente").toEqual([])
})

/* ------------------------------------------------------------------ */
/* 6. Limpieza controlada: fachadas retiradas y utilidades conservadas */
/* ------------------------------------------------------------------ */

test("las fachadas sin consumidores se retiraron y nadie las importa", () => {
  const retired = [
    "src/lib/catalogs.ts",
    "src/lib/contract-alerts.ts",
    "src/lib/entity-summary.ts",
    "src/lib/entity-summary-reports.ts",
    "src/lib/document-data.ts",
    "src/lib/document-variables.ts",
    "src/lib/positions-export.ts",
    "src/lib/staffing-export.ts",
    "src/lib/job-preparation-levels.ts",
    "src/lib/occupational-categories.ts",
    "src/lib/position-schedule.ts",
    "src/lib/representatives.ts",
    "src/lib/resolutions.ts",
    "src/lib/salary.ts",
    "src/lib/vacations.ts",
    "src/lib/rpc/medical-certificates.ts",
    "src/lib/addendums.ts",
    "src/lib/contract-conditions.ts",
    "src/lib/contract-automation.ts",
    "src/lib/worker-salary.ts",
  ]

  for (const facade of retired) {
    expect(existsSync(facade), `${facade} no debe seguir existiendo`).toBe(false)
  }

  // Ningún módulo puede quedarse importando un módulo puente que ya no existe.
  const pattern = new RegExp(
    `from "@\\/lib\\/(${retired
      .map((path) => path.replace("src/lib/", "").replace(/\.ts$/, ""))
      .join("|")
      .replace(/\//g, "\\/")})"`
  )
  const offenders = sourceFiles("src").filter((file) => pattern.test(code(file)))
  expect(offenders, "ningún módulo debe importar una fachada retirada").toEqual([])
})

test("las utilidades técnicas legítimas se conservan intactas", () => {
  const kept = [
    "src/lib/supabase.ts",
    "src/lib/utils.ts",
    "src/lib/documents.ts",
  ]
  for (const module of kept) {
    expect(existsSync(module), `${module} se conserva`).toBe(true)
  }

  // Sigue siendo la utilidad de nombres de archivo (no se ha vaciado).
  expect(code("src/lib/documents.ts")).toMatch(/export function sanitizeFileName/)

  // Y los diálogos ajenos a este bloque siguen en su sitio.
  expect(existsSync("src/components/migration/MigrationDialog.tsx")).toBe(true)
  expect(existsSync("src/components/migration/ExcelImportDialog.tsx")).toBe(true)
})

/* ------------------------------------------------------------------ */
/* 7. Regresión: nada construye consultas de esquema a nivel de módulo  */
/* ------------------------------------------------------------------ */

/**
 * Inicializador de cada declaración de nivel de módulo (columna 0), SIN el cuerpo de sus
 * funciones: lo que se ejecuta al importar el módulo es el inicializador, no las funciones
 * que define. Por eso el texto se corta en el primer `=>`, `function` o `{`.
 */
function moduleLevelInitializers(text: string): string[] {
  const lines = text.split("\n")
  const initializers: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^(export )?(const|let|var)\b/.test(lines[index])) continue

    let statement = ""
    for (let cursor = index; cursor < lines.length && cursor < index + 12; cursor += 1) {
      statement += `${lines[cursor]}\n`
      const body = statement.search(/=>|function|\{/)
      if (body >= 0) {
        statement = statement.slice(0, body)
        break
      }
      // Sin cuerpo: la declaración termina cuando se cierran los paréntesis abiertos.
      const depth =
        (statement.match(/\(/g) || []).length - (statement.match(/\)/g) || []).length
      if (depth <= 0 && cursor > index) break
    }
    initializers.push(statement)
  }

  return initializers
}

test("ninguna constante de módulo construye consultas antes de initSchemaTarget", () => {
  const schemaHelpers =
    /\b(tableName|columnName|rpcName|selectColumn|selectEmbed|physicalColumns|selectQuery)\s*\(/

  const offenders = sourceFiles("src")
    // La propia frontera declara los mapas de nombres: es el único sitio donde se permite.
    .filter((file) => file !== "src/integrations/supabase/schema-target.ts")
    .filter((file) =>
      moduleLevelInitializers(code(file)).some((initializer) => schemaHelpers.test(initializer))
    )

  expect(
    offenders,
    "las consultas de esquema se construyen dentro de funciones, después de initSchemaTarget()"
  ).toEqual([])
})

test("la frontera de esquema conserva su detección asíncrona", () => {
  const target = read("src/integrations/supabase/schema-target.ts")

  // Los mapas legacy y del cliente conviven, y la frontera expone las mismas funciones.
  for (const symbol of [
    "export const LEGACY_NAMES",
    "export const COMPANY_CLIENT_NAMES",
    "export function currentSchemaTarget",
    "export function tableName",
    "export function columnName",
    "export function rpcName",
    "export function selectColumn",
    "export function selectEmbed",
    "export function physicalColumns",
    "export function selectQuery",
    "export function schemaTargetSetting",
    "export function initSchemaTarget",
  ]) {
    expect(target, `falta ${symbol}`).toContain(symbol)
  }

  // La detección es ASÍNCRONA y se resuelve UNA sola vez (promesa memoizada).
  expect(target).toMatch(/async function detectSchemaTarget\(\): Promise<SchemaTarget>/)
  expect(target).toMatch(/let initPromise: Promise<SchemaTarget> \| null = null/)
  expect(target).toMatch(/export function initSchemaTarget\(\): Promise<SchemaTarget>/)
  expect(target).toMatch(/if \(!initPromise\) \{/)
  expect(target).toMatch(/activeTarget = target/)

  // Y sigue leyendo el ajuste por entorno de siempre.
  expect(target).toMatch(/VITE_SCHEMA_TARGET/)
})
