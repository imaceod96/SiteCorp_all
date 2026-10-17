import { test, expect } from "@playwright/test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import * as React from "react"
import { renderToString } from "react-dom/server"
import {
  calculateAge,
  calculateTenure,
  ageRange,
} from "../src/domains/people/domain/tenure.rules"
import {
  MIGRATION_HEADERS,
  WorkerMigrationTemplateError,
  buildWorkerMigrationTemplate,
  downloadWorkerMigrationTemplate,
  readWorkerMigrationExcel,
} from "../src/domains/people/infrastructure/worker-migration.workbook"
import {
  applyEntityFilters,
  matchesEntityFilter,
  useEntityFilters,
  type EntityFilterDefinition,
} from "../src/modules/organization-structure/presentation/hooks/use-entity-filters"
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  DOCUMENT_ACCEPT_ATTR,
  MAX_DOCUMENT_SIZE_BYTES,
  formatDocumentDate,
  formatFileSize,
  getFileExtension,
  isViewableDocument,
  sanitizeFileName,
  validateDocumentFile,
} from "../src/lib/documents"

/**
 * BLOQUE 10 — Cierre de las utilidades transversales.
 *
 * `src/lib` queda con las utilidades técnicas compartidas (cliente de Supabase, `cn` y el
 * tratamiento de archivos documentales). Las otras tres utilidades tenían dueño claro:
 * la antigüedad es del dominio Personas, el formato del Excel de la Carga inicial es un
 * adaptador de la infraestructura de Personas y los filtros acumulativos son lógica de
 * presentación.
 *
 * Esta prueba fija DOS cosas:
 *   · Estructura: dónde vive cada cosa ahora y quién la consume (sin fachadas huérfanas).
 *   · Comportamiento: los cálculos, los filtros, el saneado de nombres y la lectura del Excel
 *     se ejercitan con datos SIMULADOS en memoria. No hay ninguna escritura ni consulta
 *     contra Supabase (las pruebas funcionales completas de los flujos requieren la base de
 *     datos real y no forman parte de este bloque).
 */

const read = (path: string) => readFileSync(path, "utf8")

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const sourceFiles = (dir: string) => walk(dir).filter((file) => /\.(ts|tsx)$/.test(file))

/* ------------------------------------------------------------------ */
/* 1. Inventario final de src/lib                                       */
/* ------------------------------------------------------------------ */

test("src/lib queda con las utilidades técnicas compartidas, ni una más", () => {
  const modules = readdirSync("src/lib")
    .filter((name) => name.endsWith(".ts"))
    .sort()

  expect(modules).toEqual(["documents.ts", "supabase.ts", "utils.ts"])
})

test("las utilidades con dueño propio ya no viven en src/lib y nadie las importa", () => {
  for (const legacy of [
    "src/lib/tenure.ts",
    "src/lib/entity-filters.ts",
    "src/lib/worker-migration.ts",
  ]) {
    expect(existsSync(legacy), `${legacy} se retiró`).toBe(false)
  }

  const pattern = /@\/lib\/(tenure|entity-filters|worker-migration)/
  const offenders = sourceFiles("src").filter((file) => pattern.test(read(file)))
  expect(offenders, "ningún módulo debe importar las utilidades retiradas").toEqual([])
})

/* ------------------------------------------------------------------ */
/* 2. Antigüedad: dominio Personas                                      */
/* ------------------------------------------------------------------ */

test("la antigüedad se calcula en las reglas puras del dominio Personas, sin dependencias", () => {
  const rules = read("src/domains/people/domain/tenure.rules.ts")

  // Reglas puras: no tiene una sola importación (ni React, ni Supabase, ni infraestructura,
  // ni otros módulos). El encabezado puede NOMBRAR esas dependencias para explicar por qué no
  // las usa, así que se comprueban las sentencias reales y no el texto del comentario.
  expect(rules).not.toMatch(/^\s*import\s/m)
  expect(rules).not.toMatch(/from "@\//)
  expect(rules).not.toMatch(/require\(/)
  expect(rules).not.toMatch(/\.rpc\(/)
  expect(rules).toMatch(/export function calculateTenure/)

  // Y el dominio lo publica en su interfaz pública.
  const barrel = read("src/domains/people/index.ts")
  for (const symbol of ["calculateTenure", "calculateAge", "ageRange", "TenureResult"]) {
    expect(barrel, `el dominio debe exportar ${symbol}`).toContain(symbol)
  }

  // La ficha del trabajador ya no importa de `src/lib`.
  const workerDetail = read("src/modules/people/presentation/pages/WorkerDetail.tsx")
  expect(workerDetail).toMatch(/calculateTenure/)
  expect(workerDetail).not.toMatch(/@\/lib\//)
})

test("la antigüedad respeta el calendario, la fecha de referencia y los casos vacíos", () => {
  // Años y meses completos, con referencia explícita (Prenómina evalúa al cierre del período).
  expect(calculateTenure("2021-12-20", "2026-12-20")).toEqual({
    years: 5,
    months: 0,
    totalMonths: 60,
    humanDescription: "5 años",
  })

  // Ajuste por día del mes: el 30/11/2026 todavía NO cumple los 5 años.
  expect(calculateTenure("2021-12-20", "2026-11-30")).toEqual({
    years: 4,
    months: 11,
    totalMonths: 59,
    humanDescription: "4 años y 11 meses",
  })

  // Singular y plural de la descripción humana.
  expect(calculateTenure("2025-11-20", "2026-12-20").humanDescription).toBe("1 año y 1 mes")
  expect(calculateTenure("2024-12-20", "2026-12-20").humanDescription).toBe("2 años")
  expect(calculateTenure("2026-11-01", "2026-12-20").humanDescription).toBe("1 mes")
  expect(calculateTenure("2026-12-01", "2026-12-20").humanDescription).toBe("Menos de 1 mes")

  // El total de meses siempre es coherente con años y meses.
  const tenure = calculateTenure("2023-03-15", "2026-12-20")
  expect(tenure.totalMonths).toBe(tenure.years * 12 + tenure.months)

  // Fechas nulas, vacías, inválidas o futuras: no hay antigüedad que mostrar.
  expect(calculateTenure(null)).toBeNull()
  expect(calculateTenure(undefined)).toBeNull()
  expect(calculateTenure("")).toBeNull()
  expect(calculateTenure("no-es-fecha")).toBeNull()
  expect(calculateTenure("2027-01-01", "2026-12-20")).toBeNull()
  expect(calculateTenure("2021-12-20", "no-es-fecha")).toBeNull()

  // Admite Date además de texto ISO.
  expect(calculateTenure(new Date(2021, 11, 20), new Date(2026, 11, 20)).years).toBe(5)
})

test("la edad y su rango conservan los límites de siempre", () => {
  const today = new Date()
  const birthday = (years: number, monthOffset = 0) => {
    const date = new Date(today.getFullYear() - years, today.getMonth() + monthOffset, today.getDate())
    return date
  }

  expect(calculateAge(birthday(30))).toBe(30)
  // Cumple años mañana: todavía no los tiene.
  expect(calculateAge(birthday(30, 1))).toBe(29)
  expect(calculateAge(null)).toBeNull()
  expect(calculateAge("no-es-fecha")).toBeNull()

  expect(ageRange(null)).toBe("Sin información")
  expect(ageRange(19)).toBe("Menos de 20")
  expect(ageRange(20)).toBe("20-29")
  expect(ageRange(29)).toBe("20-29")
  expect(ageRange(30)).toBe("30-39")
  expect(ageRange(40)).toBe("40-49")
  expect(ageRange(50)).toBe("50-59")
  expect(ageRange(60)).toBe("60 o más")
  expect(ageRange(90)).toBe("60 o más")
})

/* ------------------------------------------------------------------ */
/* 3. Filtros compartidos: presentación                                 */
/* ------------------------------------------------------------------ */

const workerDefinitions: EntityFilterDefinition[] = [
  {
    key: "status",
    label: "Estado",
    type: "select",
    options: [{ value: "active", label: "Activo" }],
    getValue: (item) => (item as { status: string }).status,
  },
  {
    key: "licencias",
    label: "Licencias",
    type: "multiselect",
    getValues: (item) => (item as { licenses: string[] }).licenses,
  },
  {
    key: "activo",
    label: "Activo",
    type: "boolean",
    getValue: (item) => (item as { active: boolean }).active,
  },
  {
    key: "nombre",
    label: "Nombre",
    type: "text",
    getValue: (item) => (item as { name: string }).name,
  },
  {
    key: "incorporacion",
    label: "Incorporación",
    type: "date",
    getValue: (item) => (item as { start: string }).start,
  },
  {
    key: "rango",
    label: "Rango",
    type: "daterange",
    getValue: (item) => (item as { start: string }).start,
  },
]

const workers = [
  { name: "Ana Pérez", status: "active", licenses: ["A", "B"], active: true, start: "2021-05-02T00:00:00Z" },
  { name: "Luis Gómez", status: "inactive", licenses: ["B"], active: false, start: "2024-01-15" },
  { name: "Marta Díaz", status: "active", licenses: [], active: true, start: "2025-09-30" },
]

test("los filtros se combinan con AND y el multivalor con OR", () => {
  // Sin filtros activos se devuelven las mismas filas.
  expect(applyEntityFilters(workers, workerDefinitions, [])).toEqual(workers)

  // Un mismo criterio con varios valores: OR (basta con coincidir en uno).
  expect(
    applyEntityFilters(workers, workerDefinitions, [
      { key: "status", values: ["active", "inactive"] },
    ]).length
  ).toBe(3)

  // Criterios distintos: AND acumulativo.
  expect(
    applyEntityFilters(workers, workerDefinitions, [
      { key: "status", values: ["active"] },
      { key: "licencias", values: ["B"] },
    ]).map((worker) => worker.name)
  ).toEqual(["Ana Pérez"])

  // Un criterio que la pantalla no declara no descarta filas (se ignora).
  expect(
    applyEntityFilters(workers, workerDefinitions, [{ key: "inexistente", values: ["x"] }])
  ).toEqual(workers)

  // Un criterio declarado sin lector de valor no coincide con nada (comportamiento de siempre).
  expect(
    matchesEntityFilter({ key: "sin-lector", label: "Sin lector", type: "select" }, workers[0], {
      key: "sin-lector",
      values: ["x"],
    })
  ).toBe(false)

  // Un filtro activo sin valores todavía no filtra.
  expect(applyEntityFilters(workers, workerDefinitions, [{ key: "status", values: [] }])).toHaveLength(3)
})

test("los criterios booleanos, de texto y de fecha siguen comparando igual", () => {
  const activos = { key: "activo", values: ["true"] }
  expect(applyEntityFilters(workers, workerDefinitions, [activos]).map((w) => w.name)).toEqual([
    "Ana Pérez",
    "Marta Díaz",
  ])
  expect(applyEntityFilters(workers, workerDefinitions, [{ key: "activo", values: ["false"] }])).toHaveLength(1)

  // Texto: contiene, sin distinguir mayúsculas ni acentos de caja.
  expect(
    applyEntityFilters(workers, workerDefinitions, [{ key: "nombre", values: ["gómez"] }]).map(
      (worker) => worker.name
    )
  ).toEqual(["Luis Gómez"])

  // Fecha exacta: se compara solo el día, aunque el dato traiga hora.
  expect(
    applyEntityFilters(workers, workerDefinitions, [
      { key: "incorporacion", values: ["2021-05-02"] },
    ]).map((worker) => worker.name)
  ).toEqual(["Ana Pérez"])

  // Rango: desde/hasta inclusivos y extremos abiertos.
  expect(
    applyEntityFilters(workers, workerDefinitions, [
      { key: "rango", values: ["2024-01-01", "2025-12-31"] },
    ]).map((worker) => worker.name)
  ).toEqual(["Luis Gómez", "Marta Díaz"])
  // Los valores vacíos se descartan antes de comparar: un rango con un solo extremo se
  // comporta como «desde esa fecha» (nunca como «sin tope»), igual que antes.
  expect(
    applyEntityFilters(workers, workerDefinitions, [{ key: "rango", values: ["", "2021-06-01"] }]).map(
      (worker) => worker.name
    )
  ).toEqual(["Luis Gómez", "Marta Díaz"])
  expect(
    applyEntityFilters(workers, workerDefinitions, [{ key: "rango", values: ["2026-01-01", ""] }])
  ).toEqual([])
  // Extremos inclusivos.
  expect(
    applyEntityFilters(workers, workerDefinitions, [{ key: "rango", values: ["2021-05-02", "2021-05-02"] }]).map(
      (worker) => worker.name
    )
  ).toEqual(["Ana Pérez"])

  // Sin fecha en el registro, un rango no lo incluye.
  expect(
    applyEntityFilters(
      [{ ...workers[1], start: "" }],
      workerDefinitions,
      [{ key: "rango", values: ["2020-01-01", "2030-01-01"] }]
    )
  ).toEqual([])
})

test("el hook de filtros arranca sin filtros activos y con todos los criterios disponibles", () => {
  function Probe({ items, definitions }: { items: typeof workers; definitions: EntityFilterDefinition[] }) {
    const filters = useEntityFilters(items, definitions)
    return React.createElement(
      "span",
      null,
      [
        `active=${filters.active.length}`,
        `available=${filters.available.map((definition) => definition.key).join("+")}`,
        `result=${filters.result.length}`,
        `tools=${[filters.add, filters.remove, filters.setValues, filters.clear]
          .map((tool) => typeof tool)
          .join(",")}`,
      ].join("|")
    )
  }

  const html = renderToString(
    React.createElement(Probe, { items: workers, definitions: workerDefinitions })
  )

  expect(html).toContain("active=0")
  expect(html).toContain(
    "available=status+licencias+activo+nombre+incorporacion+rango"
  )
  expect(html).toContain("result=3")
  expect(html).toContain("tools=function,function,function,function")
})

test("el motor de filtros es presentación: lo consumen las pantallas y no conoce dominios", () => {
  const hook = read("src/modules/organization-structure/presentation/hooks/use-entity-filters.ts")
  // Solo depende de React: no importa dominios, ni casos de uso, ni el cliente de Supabase.
  expect(hook).toMatch(/^import \* as React from "react"/m)
  expect(hook).not.toMatch(/from "@\/lib\//)
  expect(hook).not.toMatch(/from "@\/domains\//)
  expect(hook).not.toMatch(/\.rpc\(/)

  const consumers = [
    "src/modules/people/presentation/pages/EntityCandidates.tsx",
    "src/modules/people/presentation/pages/EntityHiring.tsx",
    "src/pages/EntityMedicalCertificates.tsx",
    "src/modules/payroll-preparation/presentation/pages/EntityPrenomina.tsx",
    "src/modules/people/presentation/pages/EntityReentries.tsx",
    "src/modules/organization-structure/presentation/pages/EntityStaffing.tsx",
    "src/pages/EntityVacations.tsx",
    "src/modules/people/presentation/pages/EntityWorkers.tsx",
  ]

  for (const consumer of consumers) {
    const source = read(consumer)
    expect(source, `${consumer} debe consumir el hook de presentación`).toMatch(
      /from "@\/modules\/organization-structure\/presentation\/hooks\/use-entity-filters"/
    )
    expect(source, `${consumer} no debe importar utilidades retiradas`).not.toMatch(
      /@\/lib\/(entity-filters|tenure|worker-migration)/
    )
  }

  // El constructor de filtros compartido ya no depende de la presentación de un módulo
  // de negocio: consume el contrato compartido del sistema de filtros.
  const filterBuilder = read("src/shared/components/filter-builder.tsx")
  expect(filterBuilder, "filter-builder debe consumir el contrato compartido").toMatch(
    /from "@\/shared\/components\/entity-filter-types"/
  )
  expect(filterBuilder, "filter-builder no debe importar módulos de negocio").not.toMatch(
    /from "@\/modules\//
  )
  expect(filterBuilder, "filter-builder no debe importar utilidades retiradas").not.toMatch(
    /@\/lib\/(entity-filters|tenure|worker-migration)/
  )
})

/* ------------------------------------------------------------------ */
/* 4. Archivos documentales: la utilidad compartida sigue siendo única   */
/* ------------------------------------------------------------------ */

test("el saneado de nombres sigue siendo el único y lo usan las dos fronteras de Storage", () => {
  const file = read("src/lib/documents.ts")
  expect(file).toMatch(/export function sanitizeFileName/)
  expect(file).not.toMatch(/@\/lib\/supabase/)
  expect(file).not.toMatch(/\.rpc\(/)

  // Una sola implementación en todo el código.
  const implementations = sourceFiles("src").filter((path) =>
    /function sanitizeFileName/.test(read(path))
  )
  expect(implementations).toEqual(["src/lib/documents.ts"])

  // Los expedientes y los documentos rectores siguen usando ESA implementación: las rutas
  // ya almacenadas en Storage no cambian.
  for (const repository of [
    "src/domains/people/infrastructure/worker-expediente.repository.ts",
    "src/domains/organization-structure/infrastructure/governing-documents.repository.ts",
  ]) {
    expect(read(repository), `${repository} usa la utilidad compartida`).toMatch(
      /from "@\/lib\/documents"/
    )
  }
})

test("el saneado de nombres y el formato de tamaños conservan sus resultados", () => {
  expect(sanitizeFileName("mi archivo.pdf")).toBe("mi_archivo.pdf")
  expect(sanitizeFileName("a//b.txt")).toBe("a_b.txt")
  expect(sanitizeFileName("Informe 2024.docx")).toBe("Informe_2024.docx")
  expect(sanitizeFileName("")).toBe("documento")
  expect(sanitizeFileName("   ")).toBe("documento")
  expect(sanitizeFileName("___")).toBe("documento")
  // Nunca puede aportar separadores a la ruta de Storage.
  expect(sanitizeFileName("../../etc/passwd")).not.toContain("/")

  expect(getFileExtension("Reporte.PDF")).toBe("pdf")
  expect(getFileExtension("sin-extension")).toBe("")
  expect(getFileExtension("carpeta.archivo.tar.gz")).toBe("gz")

  expect(formatFileSize(null)).toBe("—")
  expect(formatFileSize(undefined)).toBe("—")
  expect(formatFileSize(512)).toBe("512 B")
  expect(formatFileSize(1536)).toBe("1.5 KB")
  expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB")

  expect(DOCUMENT_ACCEPT_ATTR).toBe(
    ALLOWED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",")
  )
})

test("la validación de archivos y la previsualización conservan sus reglas", () => {
  const asFile = (name: string, size: number) =>
    ({ name, size } as unknown as File)

  expect(validateDocumentFile(asFile("acta.pdf", 1024))).toBeNull()
  expect(validateDocumentFile(asFile("foto.PNG", 1024))).toBeNull()
  expect(validateDocumentFile(asFile("acta.docx", 1024))).toBeNull()
  expect(validateDocumentFile(asFile("acta.exe", 1024))).toMatch(/Formato no permitido/)
  expect(validateDocumentFile(asFile("acta", 1024))).toMatch(/Formato no permitido/)
  expect(validateDocumentFile(asFile("acta.pdf", MAX_DOCUMENT_SIZE_BYTES + 1))).toMatch(
    /tamaño máximo permitido/
  )

  expect(isViewableDocument("application/pdf", "acta.pdf")).toBe(true)
  expect(isViewableDocument("image/jpeg", "foto")).toBe(true)
  expect(isViewableDocument(null, "foto.PNG")).toBe(true)
  expect(isViewableDocument(null, "acta.docx")).toBe(false)

  const iso = "2024-03-05"
  expect(formatDocumentDate(iso)).toBe(new Date(iso).toLocaleDateString("es-CU"))
  expect(formatDocumentDate(null)).toBe("—")
  expect(formatDocumentDate("no-es-fecha")).toBe("—")
})

/* ------------------------------------------------------------------ */
/* 5. Carga inicial: adaptador del Excel dentro de Personas             */
/* ------------------------------------------------------------------ */

type ExcelWorkbook = {
  addWorksheet: (name: string) => { addRow: (values: unknown[]) => unknown }
  xlsx: { writeBuffer: () => Promise<unknown> }
}

const loadExcelJS = async () => {
  const mod = (await import("exceljs")) as unknown as {
    default?: { Workbook: new () => ExcelWorkbook }
    Workbook: new () => ExcelWorkbook
  }
  return mod?.default ?? mod
}

async function buildWorkbookFile(rows: unknown[][], titleRows: unknown[][] = []): Promise<File> {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Trabajadores")
  for (const row of [...titleRows, ...rows]) sheet.addRow(row)
  const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
  return { name: "carga.xlsx", size: buffer.byteLength, arrayBuffer: async () => buffer } as unknown as File
}

const HEADERS = ["Identificación", "Nombre", "Primer apellido", "Fecha de incorporación"]

/** Fila alineada con los encabezados oficiales: solo se indican las columnas con dato. */
const rowFor = (values: Partial<Record<string, string>>): string[] =>
  MIGRATION_HEADERS.map((header) => values[header] ?? "")

test("el formato del Excel es un adaptador de la infraestructura de Personas", () => {
  const adapter = read("src/domains/people/infrastructure/worker-migration.workbook.ts")

  // Consume los tipos del propio dominio (sin volver a pasar por su interfaz pública).
  expect(adapter).toMatch(/from "\.\.\/domain\/entities"/)
  expect(adapter).toMatch(/await import\("exceljs"\)/)
  expect(adapter).toMatch(/export async function readWorkerMigrationExcel/)
  expect(adapter).toMatch(/export async function buildWorkerMigrationTemplate/)

  // No habla con Supabase, no compone consultas y no conoce la presentación.
  expect(adapter).not.toMatch(/@\/lib\/supabase/)
  expect(adapter).not.toMatch(/\.rpc\(/)
  expect(adapter).not.toMatch(/supabase\.from\(/)
  expect(adapter).not.toMatch(/@\/(components|pages)\//)
  expect(adapter).not.toMatch(/company_client_id|organization_entity_id/)

  // Y el dominio publica la API del formato para la pantalla de Carga inicial.
  const barrel = read("src/domains/people/index.ts")
  for (const symbol of [
    "MIGRATION_HEADERS",
    "buildWorkerMigrationTemplate",
    "downloadWorkerMigrationTemplate",
    "readWorkerMigrationExcel",
    "WorkerMigrationTemplateError",
  ]) {
    expect(barrel, `el dominio debe exportar ${symbol}`).toContain(symbol)
  }
})

test("la lectura del Excel mapea las filas igual que siempre", async () => {
  // Con títulos por encima de la fila de encabezados, la lectura busca la cabecera real.
  const withTitle = await buildWorkbookFile(
    [
      rowFor({
        "Identificación": "85010112345",
        "Nombre": "Ana",
        "Primer apellido": "Pérez",
        "Segundo apellido": "Gómez",
        "Sexo": "Femenino",
        "Color de piel": "Blanca",
        "Estado civil": "Soltera",
        "Dirección": "Calle 1",
        "Fecha de incorporación": "05/03/2024",
        "Saldo inicial vacaciones": "12,5",
        "Fecha corte vacaciones": "31/12/2023",
        "Teléfono": "55512345",
        "Correo": "ana@example.com",
        "Provincia": "La Habana",
        "Municipio": "Plaza",
        "Nivel educacional": "Superior",
        "Especialidad": "Informática",
        "Profesión u oficio": "Analista",
        "Tiene licencia": "Sí",
        "Categorías licencia": "A, B",
      }),
    ],
    [["CARGA INICIAL DE TRABAJADORES"], [""], [...MIGRATION_HEADERS]]
  )

  const [row] = await readWorkerMigrationExcel(withTitle)

  expect(row).toEqual({
    identification: "85010112345",
    first_name: "Ana",
    first_surname: "Pérez",
    second_surname: "Gómez",
    birth_date: "",
    gender_id: "Femenino",
    marital_status_id: "Soltera",
    skin_color_id: "Blanca",
    phone: "55512345",
    email: "ana@example.com",
    address: "Calle 1",
    province: "La Habana",
    municipality: "Plaza",
    employment_start_date: "2024-03-05",
    education_level_id: "Superior",
    specialty: "Informática",
    profession_or_trade: "Analista",
    driving_license_category_ids: ["A", "B"],
    position_code: "",
    initial_vacation_balance: "12.5",
    vacation_cutoff_date: "2023-12-31",
  })

  // Fechas en DD/MM/AAAA, AAA-MM-DD y DD-MM-AAAA; licencias separadas por coma o punto y coma.
  const simple = await buildWorkbookFile([
    [...MIGRATION_HEADERS],
    rowFor({
      "Identificación": "90020223456",
      "Nombre": "Luis",
      "Primer apellido": "Gómez",
      "Fecha de incorporación": "15/01/2024",
    }),
    rowFor({
      "Identificación": "90030334567",
      "Nombre": "Marta",
      "Primer apellido": "Díaz",
      "Fecha de incorporación": "2025-09-30",
      "Saldo inicial vacaciones": "12,5",
      "Tiene licencia": "Sí",
      "Categorías licencia": "A; C",
    }),
    rowFor({
      "Identificación": "90040445678",
      "Nombre": "Otro",
      "Primer apellido": "Sin",
      "Fecha de incorporación": "01-02-2024",
      "Tiene licencia": "No",
      "Categorías licencia": "B",
    }),
  ])
  const rows = await readWorkerMigrationExcel(simple)

  expect(rows).toHaveLength(3)
  expect(rows.map((entry) => entry.employment_start_date)).toEqual([
    "2024-01-15",
    "2025-09-30",
    "2024-02-01",
  ])
  expect(rows.map((entry) => entry.driving_license_category_ids)).toEqual([[], ["A", "C"], []])
  expect(rows[1].initial_vacation_balance).toBe("12.5")

  // Las columnas que la plantilla oficial NO incluye no rompen la lectura.
  expect(rows[0].birth_date).toBe("")
  expect(rows[0].position_code).toBe("")
  expect(rows[0].initial_vacation_balance).toBe("")
})

test("los errores del archivo se clasifican con su código y su lista de columnas", async () => {
  // Faltan columnas requeridas: el usuario recibe exactamente qué falta.
  const incomplete = await buildWorkbookFile([
    ["Identificación", "Fecha de incorporación"],
    ["85010112345", "05/03/2024"],
  ])

  const missing = await readWorkerMigrationExcel(incomplete).catch((error) => error)
  expect(missing).toBeInstanceOf(WorkerMigrationTemplateError)
  expect((missing as WorkerMigrationTemplateError).code).toBe("MISSING_COLUMNS")
  expect((missing as WorkerMigrationTemplateError).missingColumns).toEqual(["nombre", "primer apellido"])
  expect((missing as WorkerMigrationTemplateError).message).toMatch(/Faltan columnas requeridas/)

  // Extensión y tamaño: archivo inválido.
  const wrongExtension = await readWorkerMigrationExcel({
    name: "carga.csv",
    size: 10,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as File).catch((error) => error)
  expect((wrongExtension as WorkerMigrationTemplateError).code).toBe("INVALID_FILE")

  const tooBig = await readWorkerMigrationExcel({
    name: "carga.xlsx",
    size: 11 * 1024 * 1024,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as File).catch((error) => error)
  expect((tooBig as WorkerMigrationTemplateError).code).toBe("INVALID_FILE")
  expect((tooBig as WorkerMigrationTemplateError).message).toMatch(/10 MB/)

  // Sin filas de trabajadores (solo encabezados) no hay nada que validar.
  const empty = await buildWorkbookFile([[...MIGRATION_HEADERS], rowFor({})])
  const noRows = await readWorkerMigrationExcel(empty).catch((error) => error)
  expect((noRows as Error).message).toBe("No se encontraron filas de trabajadores para validar.")
})

test("la plantilla oficial se construye y se vuelve a leer con las mismas columnas", async () => {
  const blob = await buildWorkerMigrationTemplate()
  const buffer = Buffer.from((await blob.arrayBuffer()) as ArrayBuffer)

  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)

  const sheet = (workbook as unknown as {
    getWorksheet: (name: string) => { getRow: (index: number) => { values: unknown[] } } | undefined
  }).getWorksheet("Trabajadores")
  expect(sheet, "la plantilla trae la hoja Trabajadores").toBeTruthy()

  const headerRow = sheet!.getRow(1).values.slice(1)
  expect(headerRow).toEqual([...MIGRATION_HEADERS])

  // La descarga es una acción de interfaz: solo se comprueba que sigue existiendo.
  expect(typeof downloadWorkerMigrationTemplate).toBe("function")
})

/* ------------------------------------------------------------------ */
/* 6. Compatibilidad con los demás contextos                            */
/* ------------------------------------------------------------------ */

test("ningún otro contexto cambió por el traslado de las utilidades", () => {
  // Contratos, generación documental y prenómina no consumen ninguna utilidad movida.
  for (const file of [
    ...sourceFiles("src/domains/contracts"),
    ...sourceFiles("src/domains/document-generation"),
    ...sourceFiles("src/domains/document-templates"),
    ...sourceFiles("src/domains/payroll-preparation"),
    ...sourceFiles("src/domains/payroll-movements"),
  ]) {
    expect(read(file), `${file} no debe depender de las utilidades movidas`).not.toMatch(
      /@\/lib\/(tenure|entity-filters|worker-migration)|@\/modules\/organization-structure\/presentation\/hooks\/use-entity-filters/
    )
  }

  // Prenómina calcula la antigüedad de cada período en el backend: su etiqueta propia
  // («X años, Y meses») sigue siendo la suya y no se duplica con el cálculo de Personas.
  const payrollFormatters = read("src/domains/payroll-preparation/domain/formatters.ts")
  expect(payrollFormatters).toMatch(/export const formatTenureLabel/)
  expect(payrollFormatters).not.toMatch(/calculateTenure|TenureResult/)

  // Los diálogos ajenos a este bloque siguen intactos (trasladados al módulo Personas en el
  // Bloque 25) y sin la utilidad retirada.
  for (const dialog of [
    "src/modules/people/presentation/components/MigrationDialog.tsx",
    "src/modules/people/presentation/components/ExcelImportDialog.tsx",
  ]) {
    expect(existsSync(dialog), `${dialog} se conserva`).toBe(true)
    expect(read(dialog), `${dialog} no debe importar la utilidad retirada`).not.toMatch(
      /@\/lib\/worker-migration/
    )
  }

  // La pantalla de Carga inicial consume el dominio, no `src/lib`.
  const initialImport = read("src/modules/organization-structure/presentation/pages/EntitySettingsInitialImport.tsx")
  expect(initialImport).toMatch(/from "@\/domains\/people"/)
  expect(initialImport).not.toMatch(/@\/lib\/(worker-migration|tenure|entity-filters)/)
})

test("las utilidades movidas no construyen consultas de esquema ni de entidad", () => {
  const schemaHelpers = /\b(tableName|columnName|rpcName|selectColumn|selectEmbed|physicalColumns|selectQuery)\s*\(/

  for (const file of [
    "src/domains/people/domain/tenure.rules.ts",
    "src/domains/people/infrastructure/worker-migration.workbook.ts",
    "src/modules/organization-structure/presentation/hooks/use-entity-filters.ts",
    "src/lib/documents.ts",
  ]) {
    const scope = read(file)
    // Ni consultas al esquema físico, ni filtros por cliente/entidad: no acceden a datos.
    expect(scope, `${file} no construye consultas de esquema`).not.toMatch(schemaHelpers)
    expect(scope, `${file} no filtra por cliente`).not.toMatch(/company_client_id/)
    expect(scope, `${file} no filtra por entidad`).not.toMatch(/organization_entity_id/)
  }

  // La frontera de esquema conserva su detección asíncrona (no se ha tocado).
  const target = read("src/integrations/supabase/schema-target.ts")
  expect(target).toMatch(/export function initSchemaTarget\(\): Promise<SchemaTarget>/)
  expect(target).toMatch(/let initPromise: Promise<SchemaTarget> \| null = null/)
})
