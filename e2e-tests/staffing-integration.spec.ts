import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  buildPositionCapacity,
  capacityFromRows,
  sumAuthorizedPlazas,
  vacantPlazas,
} from "../src/domains/organization-structure/domain/staffing.rules"
import {
  activeStaffingWorkers,
  countAssignmentsByPosition,
  currentStaffingAssignment,
  occupiedStaffingWorkers,
  pendingStaffingWorkers,
} from "../src/domains/people/domain/staffing.rules"
import {
  buildMigrationBatchHistory,
  mapMigrationRowValues,
  migrationCatalogIndexes,
  migrationCatalogMaps,
  validateMigrationRow,
} from "../src/domains/people/domain/worker-migration.rules"
import type {
  MigrationBatchRow,
  MigrationPreviewRow,
  MigrationRow,
  StaffingWorkerAssignment,
  StaffingWorkerRow,
  WorkerMigrationCatalogs,
} from "../src/domains/people/domain/entities"
import type { StaffingExportRow } from "../src/domains/organization-structure/domain/entities"
import type { StaffingPosition } from "../src/domains/people/domain/entities"

/**
 * PLANTILLA OPERATIVA Y CARGA INICIAL — reglas y frontera de Supabase.
 *
 * Comprueba, sin escribir en la base de datos, lo que decide si la migración DDD se
 * mantiene:
 *   1. El cálculo de plazas autorizadas, ocupadas y vacantes (incluidos los puestos con
 *      varias plazas) y la vinculación de trabajadores a puestos.
 *   2. La validación de la carga inicial por fila, con sus mensajes y estados.
 *   3. Que las identificaciones repetidas no bloqueen la carga.
 *   4. Que el historial de lotes no toque las relaciones laborales.
 *   5. Que la presentación de ambos módulos no hable con Supabase y que las RPC de la
 *      migración vivan en un único repositorio, aisladas por entidad.
 *
 * Las importaciones son deliberadamente profundas (`domain/…`): las reglas son puras y no
 * arrastran el cliente de Supabase, igual que en el resto de pruebas del expediente.
 */

const read = (path: string) => readFileSync(path, "utf8")

// ---------------------------------------------------------------------------
// Datos de ejemplo (mismos campos que las filas reales)
// ---------------------------------------------------------------------------

const capability = (over: Partial<StaffingExportRow> = {}): StaffingExportRow => ({
  area_id: "area-1",
  area_name: "Producción",
  job_id: "job-1",
  job_name: "Operario",
  position_id: "position-1",
  position_name: "Operario de línea",
  occupational_category: "Operario",
  worker_id: null,
  worker_name: null,
  gender_code: null,
  identification: null,
  preparation_level: null,
  salary_group_sequence: 1,
  salary: 5000,
  cla_amount: null,
  academic_amount: null,
  academic_category: null,
  service_start: null,
  has_masters_degree: null,
  has_doctorate_degree: null,
  ...over,
})

const position = (id: string, over: Partial<StaffingPosition> = {}): StaffingPosition => ({
  id,
  name: `Puesto ${id}`,
  code: `PST-${id}`,
  is_active: true,
  authorized_quantity: 1,
  work_location: null,
  daily_hours: null,
  weekly_hours: null,
  monthly_hours: null,
  break_minutes: null,
  schedule_notes: null,
  job: {
    id: "job-1",
    name: "Operario",
    area: { id: "area-1", name: "Producción" },
    salary_group: null,
  },
  ...over,
})

const assignment = (over: Partial<StaffingWorkerAssignment> = {}): StaffingWorkerAssignment => ({
  id: "assignment-1",
  position_id: "position-1",
  start_date: "2024-01-01",
  end_date: null,
  is_current: true,
  position: position("position-1"),
  ...over,
})

const worker = (over: Partial<StaffingWorkerRow> = {}): StaffingWorkerRow => ({
  id: "worker-1",
  code: "TRB-000001",
  first_name: "Ana",
  first_surname: "Pérez",
  second_surname: null,
  identification: "12345678901",
  hire_date: "2024-01-01",
  employment_start_date: "2024-01-01",
  employment_status: "active",
  birth_date: "1990-05-04",
  gender_id: "gender-1",
  marital_status_id: "marital-1",
  education_level_id: "education-1",
  specialty: null,
  has_masters_degree: null,
  has_doctorate_degree: null,
  profession_or_trade: "Operaria",
  skin_color_id: "skin-1",
  address: "Calle 1",
  province: "La Habana",
  municipality: "Plaza",
  phone: null,
  email: null,
  assignments: [],
  ...over,
})

const migrationCatalogs: WorkerMigrationCatalogs = {
  genders: [{ id: "gender-1", name: "Masculino" }],
  maritalStatuses: [{ id: "marital-1", name: "Soltero" }],
  skinColors: [{ id: "skin-1", name: "Blanca" }],
  educationLevels: [{ id: "education-1", name: "Superior" }],
  drivingLicenseCategories: [{ id: "license-1", name: "A", code: "A" }],
}

const migrationRow = (over: Partial<MigrationRow> = {}): MigrationRow => ({
  identification: "12345678901",
  first_name: "Ana",
  first_surname: "Pérez",
  second_surname: "",
  birth_date: "1990-05-04",
  gender_id: "gender-1",
  marital_status_id: "marital-1",
  skin_color_id: "skin-1",
  phone: "",
  email: "",
  address: "Calle 1",
  province: "La Habana",
  municipality: "Plaza",
  employment_start_date: "2024-01-15",
  education_level_id: "education-1",
  specialty: "",
  profession_or_trade: "",
  driving_license_category_ids: ["license-1"],
  position_code: "",
  initial_vacation_balance: "",
  vacation_cutoff_date: "",
  ...over,
})

const backendRow = (over: Partial<MigrationPreviewRow> = {}): MigrationPreviewRow => ({
  index: 0,
  status: "VALID",
  messages: [],
  position_id: null,
  position_label: null,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Plazas autorizadas, ocupadas y vacantes
// ---------------------------------------------------------------------------

test("la plantilla cuenta plazas ocupadas y vacantes por puesto", () => {
  const rows = [
    capability({ worker_id: "w1", worker_name: "Ana Pérez" }),
    capability({ worker_id: "w2", worker_name: "Luis Gómez" }),
    capability(),
  ]

  // Un puesto con varias plazas: 3 capacidades, 2 con trabajador y 1 vacante.
  expect(buildPositionCapacity(rows)["position-1"]).toEqual({
    authorized: 3,
    occupied: 2,
    vacant: 1,
  })
  expect(capacityFromRows(rows)).toEqual({ authorized: 3, occupied: 2, vacant: 1 })

  // Las capacidades sin puesto no entran en ningún recuento.
  expect(buildPositionCapacity([capability({ position_id: null })])).toEqual({})

  // Plazas autorizadas de la entidad: suma de la cantidad autorizada de cada puesto.
  expect(
    sumAuthorizedPlazas([
      { authorized_quantity: 3 },
      { authorized_quantity: 2 },
      { authorized_quantity: null },
    ])
  ).toBe(5)
  expect(sumAuthorizedPlazas([])).toBe(0)

  // Las vacantes nunca quedan en negativo (más ocupados que plazas autorizadas).
  expect(vacantPlazas(5, 2)).toBe(3)
  expect(vacantPlazas(2, 5)).toBe(0)
})

test("la ocupación se cuenta con los trabajadores activos vinculados a la plantilla", () => {
  const workers = [
    worker({ id: "w1", assignments: [assignment({ id: "a1" })] }),
    worker({ id: "w2", assignments: [assignment({ id: "a2" })] }),
    worker({ id: "w3", assignments: [] }),
  ]

  const active = activeStaffingWorkers(workers)
  const occupied = occupiedStaffingWorkers(active).length
  const totalAuthorized = sumAuthorizedPlazas([position("position-1", { authorized_quantity: 2 })])

  expect(active).toHaveLength(3)
  expect(occupied).toBe(2)
  expect(vacantPlazas(totalAuthorized, occupied)).toBe(0)
  expect(pendingStaffingWorkers(active).map((row) => row.id)).toEqual(["w3"])
  expect(countAssignmentsByPosition(active)).toEqual({ "position-1": 2 })
})

// ---------------------------------------------------------------------------
// 2. Trabajadores vinculados a puestos y relaciones laborales conservadas
// ---------------------------------------------------------------------------

test("un trabajador ocupa plaza solo con una asignación vigente sobre un puesto activo", () => {
  const active = assignment({ id: "a1" })
  const current = worker({ id: "w1", assignments: [active] })
  const closed = worker({
    id: "w2",
    assignments: [assignment({ id: "a2", is_current: false, end_date: "2024-12-31" })],
  })
  const inactivePosition = worker({
    id: "w3",
    assignments: [
      assignment({ id: "a3", position: position("position-2", { is_active: false }) }),
    ],
  })
  const separated = worker({
    id: "w4",
    employment_status: "inactive",
    assignments: [assignment({ id: "a4" })],
  })

  expect(currentStaffingAssignment(current)).toBe(active)
  expect(currentStaffingAssignment(closed)).toBeNull()
  expect(currentStaffingAssignment(inactivePosition)).toBeNull()
  expect(currentStaffingAssignment(worker({ id: "w5", assignments: null }))).toBeNull()

  // Solo los trabajadores activos entran en la ocupación de la plantilla.
  expect(activeStaffingWorkers([current, closed, inactivePosition, separated]).map((w) => w.id)).toEqual([
    "w1",
    "w2",
    "w3",
  ])

  // La asignación cerrada NO se borra: la trayectoria laboral se conserva tal cual.
  expect(closed.assignments).toHaveLength(1)
  expect(closed.assignments?.[0].end_date).toBe("2024-12-31")
})

// ---------------------------------------------------------------------------
// 3. Validación de la carga inicial
// ---------------------------------------------------------------------------

test("la validación de la carga inicial conserva los mensajes y el estado por fila", () => {
  const maps = migrationCatalogMaps(migrationCatalogs)
  const indexes = migrationCatalogIndexes(migrationCatalogs)

  // Resolución de catálogos: nombre o código → identificador.
  const mapped = mapMigrationRowValues(
    migrationRow({ gender_id: "Masculino", driving_license_category_ids: ["a"] }),
    maps
  )
  expect(mapped.gender_id).toBe("gender-1")
  expect(mapped.driving_license_category_ids).toEqual(["license-1"])
  // Un valor que no existe en el catálogo se conserva tal cual: la fila lo reportará.
  expect(mapMigrationRowValues(migrationRow({ skin_color_id: "Verde" }), maps).skin_color_id).toBe(
    "Verde"
  )

  const valid = validateMigrationRow(migrationRow(), indexes, backendRow())
  expect(valid.status).toBe("VALID")
  expect(valid.messages).toEqual([])

  const shortIdentification = validateMigrationRow(
    migrationRow({ identification: "1234" }),
    indexes,
    backendRow()
  )
  expect(shortIdentification.status).toBe("ERROR")
  expect(shortIdentification.messages).toContain(
    "El número de identificación debe contener exactamente 11 dígitos."
  )

  const unknownCatalog = validateMigrationRow(
    migrationRow({ gender_id: "gender-x", driving_license_category_ids: ["license-x"] }),
    indexes,
    backendRow()
  )
  expect(unknownCatalog.status).toBe("ERROR")
  expect(unknownCatalog.messages).toContain("Sexo no existe en el catálogo.")
  expect(unknownCatalog.messages).toContain(
    "Una o más categorías de licencia no existen en el catálogo."
  )

  // Las fechas deben llegar en formato ISO (las normaliza la lectura del Excel): un valor
  // con otro formato bloquea la fila.
  const badDates = validateMigrationRow(
    migrationRow({
      birth_date: "04/05/1990",
      employment_start_date: "15/01/2024",
      vacation_cutoff_date: "ayer",
    }),
    indexes,
    backendRow()
  )
  expect(badDates.messages).toEqual([
    "Fecha de nacimiento inválida.",
    "Fecha de incorporación inválida.",
    "Fecha de corte de vacaciones inválida.",
  ])

  const badBalance = validateMigrationRow(
    migrationRow({ initial_vacation_balance: "30" }),
    indexes,
    backendRow()
  )
  expect(badBalance.status).toBe("ERROR")
  expect(badBalance.messages).toContain(
    "Saldo inicial de vacaciones inválido; debe estar entre 0 y 24 días."
  )

  // La información que puede completarse después avisa, pero no bloquea la carga.
  const incomplete = validateMigrationRow(
    migrationRow({
      birth_date: "",
      gender_id: "",
      marital_status_id: "",
      skin_color_id: "",
      address: "",
    }),
    indexes,
    backendRow()
  )
  expect(incomplete.status).toBe("WARNING")
  expect(incomplete.messages[0]).toBe(
    "Información incompleta: falta fecha de nacimiento, sexo, estado civil, color de piel, dirección. Podrá completarse después desde Trabajadores."
  )

  // Una fila que el backend marca con ERROR nunca se rebaja: la carga se detiene.
  const backendError = validateMigrationRow(
    migrationRow(),
    indexes,
    backendRow({ status: "ERROR", messages: ["El nombre es obligatorio"] })
  )
  expect(backendError.status).toBe("ERROR")
  expect(backendError.messages).toEqual(["El nombre es obligatorio"])

  // El aviso de «pendiente de vinculación» es el estado normal de la carga inicial: no
  // convierte por sí solo una fila válida en advertencia (comportamiento conservado).
  const pendingLink = validateMigrationRow(
    migrationRow(),
    indexes,
    backendRow({ status: "WARNING", messages: ["Se importará como pendiente de vinculación a plantilla"] })
  )
  expect(pendingLink.status).toBe("VALID")
  expect(pendingLink.messages).toEqual(["Se importará como pendiente de vinculación a plantilla"])
})

// ---------------------------------------------------------------------------
// 4. Identidades duplicadas
// ---------------------------------------------------------------------------

test("las identificaciones repetidas no bloquean la carga", () => {
  const duplicateMessage =
    "Identificación repetida dentro del archivo (12345678901): otra fila usa el mismo carné. Corrija la identificación."
  const preview = validateMigrationRow(
    migrationRow(),
    migrationCatalogIndexes(migrationCatalogs),
    backendRow({ status: "WARNING", messages: [duplicateMessage] })
  )

  // No es un error: la persona se crea igualmente y solo hay que corregir el carné.
  expect(preview.status).not.toBe("ERROR")
  expect(preview.messages).toContain(duplicateMessage)

  // La importación devuelve la lista de identificaciones repetidas para corregirlas.
  const commands = read("src/domains/people/application/worker-migration.commands.ts")
  expect(commands).toMatch(/duplicate_identifications: result\.duplicate_identifications \|\| \[\]/)

  const repository = read("src/domains/people/infrastructure/worker-migration.repository.ts")
  expect(repository).toMatch(/\.rpc\("migration_import_rows"/)

  // La pantalla sigue avisando de las identificaciones repetidas del lote importado.
  const screen = read("src/pages/EntitySettingsInitialImport.tsx")
  expect(screen).toMatch(/duplicateIdentifications/)
  expect(screen).toMatch(/Identificaciones repetidas detectadas/)
})

// ---------------------------------------------------------------------------
// 5. Historial de lotes (lectura, sin tocar relaciones laborales)
// ---------------------------------------------------------------------------

test("el historial de lotes cuenta vinculados y pendientes sin tocar las relaciones laborales", () => {
  const rows: MigrationBatchRow[] = [
    {
      migration_batch_id: "MIG-1",
      migrated_at: "2024-05-01T10:00:00Z",
      employment_status: "active",
      worker_position_assignments: [{ is_current: true, end_date: null }],
    },
    {
      migration_batch_id: "MIG-1",
      migrated_at: "2024-05-01T10:00:00Z",
      employment_status: "active",
      worker_position_assignments: [{ is_current: false, end_date: "2024-04-30" }],
    },
    {
      migration_batch_id: "MIG-1",
      migrated_at: "2024-05-01T10:00:00Z",
      employment_status: "inactive",
      worker_position_assignments: [{ is_current: false, end_date: "2024-04-30" }],
    },
    {
      migration_batch_id: "MIG-2",
      migrated_at: "2024-04-01T10:00:00Z",
      employment_status: "active",
      worker_position_assignments: [{ is_current: true, end_date: null }],
    },
  ]

  expect(buildMigrationBatchHistory(rows)).toEqual([
    { batchId: "MIG-1", migratedAt: "2024-05-01T10:00:00Z", total: 3, linked: 1, pending: 1 },
    { batchId: "MIG-2", migratedAt: "2024-04-01T10:00:00Z", total: 1, linked: 1, pending: 0 },
  ])

  // Un lote sin identificador (o sin filas) no genera historial.
  expect(buildMigrationBatchHistory([])).toEqual([])
  expect(
    buildMigrationBatchHistory([
      {
        migration_batch_id: null,
        migrated_at: null,
        employment_status: "active",
        worker_position_assignments: null,
      },
    ])
  ).toEqual([])

  // La lectura no modifica las filas: la relación laboral sigue intacta.
  expect(rows).toHaveLength(4)
  expect(rows[1].worker_position_assignments).toEqual([{ is_current: false, end_date: "2024-04-30" }])
})

// ---------------------------------------------------------------------------
// 6. Presentación sin consultas directas a Supabase
// ---------------------------------------------------------------------------

test("la Plantilla y la Carga inicial no consultan Supabase desde la presentación", () => {
  const presentation = [
    "src/pages/EntityStaffing.tsx",
    "src/pages/EntitySettingsInitialImport.tsx",
    "src/components/migration/MigratedWorkerDialog.tsx",
    "src/components/migration/LinkWorkerToPositionDialog.tsx",
    "src/components/migration/MigrationDialog.tsx",
    "src/components/migration/ExcelImportDialog.tsx",
  ]

  for (const file of presentation) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
  }

  // La Pantilla consume el caso de uso y las reglas de plazas; no conoce las tablas.
  const staffing = read("src/pages/EntityStaffing.tsx")
  expect(staffing).toMatch(/loadEntityStaffingWorkspace/)
  expect(staffing).toMatch(/activeStaffingWorkers/)
  expect(staffing).toMatch(/pendingStaffingWorkers/)
  expect(staffing).toMatch(/buildPositionCapacity/)
  expect(staffing).toMatch(/sumAuthorizedPlazas/)
  expect(staffing).toMatch(/vacantPlazas/)
  expect(staffing).not.toMatch(/organization_positions/)
  expect(staffing).not.toMatch(/organization_jobs/)
  expect(staffing).not.toMatch(/worker_position_assignments/)

  // La Carga inicial reparte el trabajo: formato del archivo y casos de uso del dominio.
  const initialImport = read("src/pages/EntitySettingsInitialImport.tsx")
  expect(initialImport).toMatch(/@\/domains\/people/)
  expect(initialImport).toMatch(/loadEntityMigrationHistory/)
  expect(initialImport).toMatch(/validateWorkerMigration/)
  expect(initialImport).toMatch(/importWorkerMigration/)
  expect(initialImport).toMatch(/readWorkerMigrationExcel/)
  expect(initialImport).not.toMatch(/\.from\("workers"\)/)

  // El adaptador del formato del Excel vive en el dominio Personas: no resuelve catálogos
  // ni llama a las RPC (las filas que produce son las que consumen sus casos de uso).
  const excel = read("src/domains/people/infrastructure/worker-migration.workbook.ts")
  expect(excel).toMatch(/from "\.\.\/domain\/entities"/)
  expect(excel).toMatch(/readWorkerMigrationExcel/)
  expect(excel).not.toMatch(/migration_validate_rows/)
  expect(excel).not.toMatch(/migration_import_rows/)

  // Las cuatro RPC de la migración viven en un único repositorio, con sus parámetros.
  const repository = read("src/domains/people/infrastructure/worker-migration.repository.ts")
  expect(repository).toMatch(/@\/lib\/supabase/)
  expect(repository).toMatch(/\.rpc\("get_migration_template_data"/)
  expect(repository).toMatch(/\.rpc\("migration_validate_rows", \{\s*p_entity_id: entityId,\s*p_rows: rows,/)
  expect(repository).toMatch(
    /\.rpc\("migration_import_rows", \{\s*p_entity_id: entityId,\s*p_rows: rows,\s*p_batch_id: batchId,/
  )
  expect(repository).toMatch(/\.rpc\("migration_create_single_worker", \{\s*p_entity_id: entityId,\s*p_row: row,/)
  expect(repository).toMatch(
    /\.rpc\("link_worker_to_position", \{\s*p_worker_id: workerId,\s*p_position_id: positionId,\s*p_start_date: null,/
  )

  for (const file of [
    "src/pages/EntityStaffing.tsx",
    "src/pages/EntitySettingsInitialImport.tsx",
    "src/domains/people/infrastructure/worker-migration.workbook.ts",
    "src/domains/people/application/worker-migration.queries.ts",
    "src/domains/people/application/worker-migration.commands.ts",
  ]) {
    const source = read(file)
    for (const rpc of [
      "migration_validate_rows",
      "migration_import_rows",
      "migration_create_single_worker",
      "link_worker_to_position",
    ]) {
      expect(source, `${file} no debe invocar ${rpc}`).not.toContain(rpc)
    }
  }
})

// ---------------------------------------------------------------------------
// 7. Aislamiento por cliente y por entidad
// ---------------------------------------------------------------------------

test("las consultas de plantilla y de migración quedan aisladas por entidad", () => {
  const repositories = [
    "src/domains/organization-structure/infrastructure/entity-staffing.repository.ts",
    "src/domains/people/infrastructure/staffing.repository.ts",
    "src/domains/people/infrastructure/worker-migration.repository.ts",
  ]

  for (const repository of repositories) {
    const source = read(repository)
    expect(source, `${repository} es la frontera de Supabase`).toMatch(/@\/lib\/supabase/)
    expect(source, `${repository} filtra por entidad`).toMatch(
      /\.eq\("organization_entity_id", entityId\)/
    )
    // El cliente (company_client_id) NUNCA se envía desde el frontend: lo impone RLS.
    expect(source, `${repository} no filtra por cliente`).not.toMatch(/\.eq\("company_client_id"/)
    expect(source, `${repository} no envía el cliente`).not.toMatch(/company_client_id:/)
  }

  // Los casos de uso reciben la entidad, no el cliente.
  const staffingUseCase = read("src/domains/people/application/staffing.queries.ts")
  expect(staffingUseCase).toMatch(/loadEntityStaffingWorkspace\(/)
  expect(staffingUseCase).not.toMatch(/companyClientId/)
  expect(staffingUseCase).not.toMatch(/@\/lib\/supabase/)
  expect(staffingUseCase).not.toMatch(/\.rpc\(/)

  const migrationCommands = read("src/domains/people/application/worker-migration.commands.ts")
  expect(migrationCommands).toMatch(/entityId: string/)
  expect(migrationCommands).not.toMatch(/companyClientId/)
  expect(migrationCommands).not.toMatch(/@\/lib\/supabase/)

  const migrationQueries = read("src/domains/people/application/worker-migration.queries.ts")
  expect(migrationQueries).not.toMatch(/companyClientId/)
  expect(migrationQueries).not.toMatch(/@\/lib\/supabase/)

  // La estructura organizativa sigue siendo la dueña de áreas, cargos y grupos salariales.
  const structureRepository = read(
    "src/domains/organization-structure/infrastructure/entity-staffing.repository.ts"
  )
  expect(structureRepository).toMatch(/organization_jobs/)
  expect(structureRepository).toMatch(/organization_areas/)
  expect(structureRepository).toMatch(/salary_groups/)

  // El dominio de personas no consulta esas tablas por su cuenta: solo las recibe
  // incrustadas en el puesto del trabajador y pide los cargos a su dueño.
  const peopleStaffingRepository = read("src/domains/people/infrastructure/staffing.repository.ts")
  expect(peopleStaffingRepository).toMatch(/\.from\("organization_positions"\)/)
  expect(peopleStaffingRepository).not.toMatch(/\.from\("organization_jobs"\)/)
  expect(peopleStaffingRepository).not.toMatch(/\.from\("organization_areas"\)/)
  expect(peopleStaffingRepository).not.toMatch(/\.from\("salary_groups"\)/)
})
