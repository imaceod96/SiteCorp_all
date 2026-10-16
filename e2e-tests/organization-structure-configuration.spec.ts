import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  areaDescendantIds,
  areaParentOptions,
  areaSaveErrorMessage,
  buildAreaTree,
  validateAreaInput,
} from "../src/domains/organization-structure/domain/areas.rules"
import {
  jobSaveErrorMessage,
  parseJobCla,
  validateJobInput,
} from "../src/domains/organization-structure/domain/jobs.rules"
import {
  MAX_AUTHORIZED_QUANTITY,
  addDraftScheduleSegments,
  normalizeScheduleTime,
  positionSaveErrorMessage,
  positionSchedulePayload,
  sortScheduleSegments,
  validatePositionInput,
} from "../src/domains/organization-structure/domain/positions.rules"
import type {
  JobClaDraft,
  OrganizationArea,
  PositionScheduleSegment,
} from "../src/domains/organization-structure/domain/entities"

/**
 * CONFIGURACIÓN DE LA ESTRUCTURA ORGANIZATIVA — reglas y frontera de Supabase.
 *
 * Comprueba, sin escribir en la base de datos, lo que decide si la migración DDD del bloque
 * se mantiene:
 *   1. Áreas: alta, edición y jerarquía (qué áreas pueden ser «Área superior»).
 *   2. Cargos: validación, asociación al grupo salarial de la escala y CLA del cargo.
 *   3. Puestos: cantidad autorizada, jornada y horarios (segmentos y tramos que cruzan
 *      medianoche) en una única llamada atómica.
 *   4. Que las plazas ocupadas y vacantes NO se dupliquen aquí: la ocupación la siguen
 *      resolviendo las asignaciones de personas.
 *   5. Que la presentación no hable con Supabase y que cada consulta viva en un solo
 *      repositorio, aislada por entidad y nunca por cliente.
 *
 * Las importaciones son deliberadamente profundas (`domain/…`): las reglas son puras y no
 * arrastran el cliente de Supabase, igual que en el resto de pruebas del proyecto.
 */

const read = (path: string) => readFileSync(path, "utf8")

// ---------------------------------------------------------------------------
// Datos de ejemplo (mismos campos que las filas reales)
// ---------------------------------------------------------------------------

const area = (id: string, over: Partial<OrganizationArea> = {}): OrganizationArea => ({
  id,
  organization_entity_id: "entity-1",
  parent_area_id: null,
  code: id.toUpperCase(),
  name: `Área ${id}`,
  description: null,
  hierarchy_order: 0,
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...over,
})

const cla = (over: Partial<JobClaDraft> = {}): JobClaDraft => ({
  hasAbnormalConditions: false,
  dayEnabled: false,
  dayRate: "",
  nightEnabled: false,
  night1: { start: "", end: "", rate: "" },
  night2: { start: "", end: "", rate: "" },
  ...over,
})

const segment = (over: Partial<PositionScheduleSegment> = {}): PositionScheduleSegment => ({
  day_of_week: 1,
  start_time: "08:00",
  end_time: "16:30",
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Áreas: alta, edición y jerarquía
// ---------------------------------------------------------------------------

test("el alta y la edición de áreas validan nombre y pertenencia del área superior", () => {
  const areas = [
    area("casa-matriz"),
    area("rh", { organization_entity_id: "entity-2", name: "Recursos Humanos" }),
  ]

  // El nombre es obligatorio.
  expect(
    validateAreaInput({ name: "", parentAreaId: null, entityId: "entity-1", areas })
  ).toBe("El nombre es obligatorio")

  // Un área superior de OTRA entidad no es admisible.
  expect(
    validateAreaInput({ name: "Producción", parentAreaId: "rh", entityId: "entity-1", areas })
  ).toBe("El área superior seleccionada no pertenece a esta entidad")

  // Un área superior de la misma entidad sí lo es; y sin área superior es un área raíz.
  expect(
    validateAreaInput({
      name: "Producción",
      parentAreaId: "casa-matriz",
      entityId: "entity-1",
      areas,
    })
  ).toBeNull()
  expect(
    validateAreaInput({ name: "Producción", parentAreaId: null, entityId: "entity-1", areas })
  ).toBeNull()

  // El conflicto de código lo detecta la base de datos y la interfaz lo explica.
  expect(
    areaSaveErrorMessage(
      new Error('duplicate key value violates unique constraint "organization_areas_organization_entity_id_code_unique"')
    )
  ).toBe("Ya existe un área con ese código en esta entidad")
  expect(areaSaveErrorMessage(new Error("otro fallo"))).toBe("otro fallo")
  expect(areaSaveErrorMessage("fallo sin Error")).toBe("Error al guardar el área")
})

test("la jerarquía de áreas evita ciclos y ordena el árbol", () => {
  const areas = [
    area("raiz", { name: "Casa Matriz", hierarchy_order: 0 }),
    area("produccion", { name: "Producción", parent_area_id: "raiz", hierarchy_order: 1 }),
    area("linea", { name: "Línea 1", parent_area_id: "produccion", hierarchy_order: 0 }),
    area("comercial", { name: "Comercial", parent_area_id: "raiz", hierarchy_order: 0 }),
    area("inactiva", { name: "Antigua", parent_area_id: "raiz", is_active: false }),
    area("huerfana", { name: "Sin padre visible", parent_area_id: "desconocida" }),
  ]

  // El área y todas sus descendientes quedan excluidas del selector de «Área superior».
  expect([...areaDescendantIds("produccion", areas)].sort()).toEqual([
    "linea",
    "produccion",
  ])

  const options = areaParentOptions(areas, area("produccion", { parent_area_id: "raiz" }))
  // Se ordena por orden y nombre; «Producción» y su rama quedan fuera.
  expect(options.map((o) => o.id)).toEqual(["raiz", "comercial", "huerfana"])

  // Al editar, el área superior actual siempre es visible aunque ya no sea elegible.
  const sinPadreActivo = areaParentOptions(
    [area("raiz", { is_active: false }), area("hija", { parent_area_id: "raiz" })],
    area("hija", { parent_area_id: "raiz" })
  )
  expect(sinPadreActivo.map((o) => o.id)).toEqual(["raiz"])

  // Un área cuyo padre no está en la lista se muestra como raíz: nunca se oculta información.
  const tree = buildAreaTree(areas)
  expect(tree.map((n) => n.id).sort()).toEqual(["huerfana", "raiz"])

  // Dentro de cada rama: primero por orden (0 antes que 1) y después por nombre.
  const raiz = tree.find((n) => n.id === "raiz")!
  expect(raiz.children.map((n) => n.id)).toEqual(["inactiva", "comercial", "produccion"])
  expect(raiz.children[2].children.map((n) => n.id)).toEqual(["linea"])
})

// ---------------------------------------------------------------------------
// 2. Cargos: validación, grupo salarial y CLA
// ---------------------------------------------------------------------------

test("el alta y la edición de cargos validan área, categoría, grupo salarial y CLA", () => {
  const areas = [area("raiz"), area("ajena", { organization_entity_id: "entity-2" })]
  const base = {
    name: "Especialista",
    areaId: "raiz",
    categoryId: "cat-operario",
    salaryGroupId: "grupo-1",
    areas,
    entityId: "entity-1",
    cla: cla(),
  }

  expect(validateJobInput({ ...base, name: "" })).toBe("El nombre es obligatorio")
  expect(validateJobInput({ ...base, areaId: "" })).toBe("El área es obligatoria")
  // Integridad contractual: la categoría ocupacional alimenta el contrato.
  expect(validateJobInput({ ...base, categoryId: "" })).toBe(
    "La categoría ocupacional es obligatoria"
  )
  expect(validateJobInput({ ...base, salaryGroupId: "" })).toBe(
    "El grupo salarial es obligatorio"
  )
  expect(validateJobInput({ ...base, areaId: "ajena" })).toBe(
    "El área seleccionada no pertenece a esta entidad"
  )
  expect(validateJobInput(base)).toBeNull()

  // CLA: nunca se guarda una configuración incompleta.
  expect(
    validateJobInput({
      ...base,
      cla: cla({ hasAbnormalConditions: true, dayEnabled: true, dayRate: "" }),
    })
  ).toBe("Indica una tarifa horaria válida (≥ 0) para el pago diurno de CLA")
  expect(
    validateJobInput({
      ...base,
      cla: cla({ hasAbnormalConditions: true, nightEnabled: true, night1: { start: "23:00", end: "", rate: "3" } }),
    })
  ).toBe("Tramo nocturno 1: indica hora de inicio y hora de fin")
  expect(
    validateJobInput({
      ...base,
      cla: cla({
        hasAbnormalConditions: true,
        nightEnabled: true,
        night1: { start: "23:00", end: "07:00", rate: "3" },
        night2: { start: "19:00", end: "23:00", rate: "-1" },
      }),
    })
  ).toBe("Tramo nocturno 2: indica una tarifa horaria válida (≥ 0)")

  // El cargo nuevo exige categoría ocupacional (mensaje del backend).
  expect(jobSaveErrorMessage(new Error("La categoría ocupacional es obligatoria"))).toBe(
    "La categoría ocupacional es obligatoria para los cargos nuevos."
  )
})

test("la CLA del cargo se guarda con sus dos tramos nocturnos o sin ninguno", () => {
  // Sin condiciones anormales: no queda ninguna tarifa ni horario huérfano.
  expect(parseJobCla(cla({ hasAbnormalConditions: false, dayRate: "5" }))).toEqual({
    has_abnormal_conditions: false,
    cla_day_enabled: false,
    cla_day_hourly_rate: null,
    cla_night_enabled: false,
    night_segments: [],
  })

  // Desactivar el pago nocturno elimina los tramos (no se guardan horarios huérfanos).
  expect(
    parseJobCla(
      cla({ hasAbnormalConditions: true, nightEnabled: false, night1: { start: "23:00", end: "07:00", rate: "3" } })
    ).night_segments
  ).toEqual([])

  // Activado: dos tramos independientes, con la tarifa del formulario.
  const parsed = parseJobCla(
    cla({
      hasAbnormalConditions: true,
      dayEnabled: true,
      dayRate: "4.5",
      nightEnabled: true,
      night1: { start: "23:00", end: "07:00", rate: "3" },
      night2: { start: "19:00", end: "23:00", rate: "2.25" },
    })
  )
  expect(parsed.cla_day_enabled).toBe(true)
  expect(parsed.cla_day_hourly_rate).toBe(4.5)
  expect(parsed.cla_night_enabled).toBe(true)
  expect(parsed.night_segments).toEqual([
    { segment_order: 1, start_time: "23:00", end_time: "07:00", hourly_rate: 3 },
    { segment_order: 2, start_time: "19:00", end_time: "23:00", hourly_rate: 2.25 },
  ])

  // Los tramos nocturnos son una tabla hija del CARGO, no del trabajador.
  const repository = read("src/domains/organization-structure/infrastructure/jobs.repository.ts")
  expect(repository).toMatch(/organization_job_cla_night_segments/)
  expect(repository).toMatch(/organization_job_id: jobId/)
})

// ---------------------------------------------------------------------------
// 3. Puestos: cantidad autorizada, jornada y horarios
// ---------------------------------------------------------------------------

test("el puesto con varias plazas valida cantidad, jornada, descanso y horario", () => {
  const base = {
    jobId: "job-1",
    jobExists: true,
    name: "Operario de línea",
    authorizedQuantity: "5",
    workLocation: "Almacén Central",
    dailyHours: "8",
    weeklyHours: "44",
    monthlyHours: "190.6",
    breakMinutes: "30",
    segmentsCount: 5,
    scheduleNotes: "",
  }

  // Un puesto con varias plazas: es UN puesto con N plazas autorizadas.
  const valid = validatePositionInput(base)
  expect(valid.error).toBeNull()
  expect(valid.quantity).toBe(5)

  expect(validatePositionInput({ ...base, jobId: "" }).error).toBe("El cargo es obligatorio")
  expect(validatePositionInput({ ...base, name: "" }).error).toBe(
    "El nombre del puesto es obligatorio"
  )
  expect(validatePositionInput({ ...base, jobExists: false }).error).toBe(
    "El cargo seleccionado no es válido"
  )
  expect(validatePositionInput({ ...base, authorizedQuantity: "0" }).error).toBe(
    "La cantidad de puestos debe ser un número entero mayor o igual a 1"
  )
  expect(
    validatePositionInput({ ...base, authorizedQuantity: String(MAX_AUTHORIZED_QUANTITY + 1) }).error
  ).toBe(`La cantidad de puestos no puede superar ${MAX_AUTHORIZED_QUANTITY}`)
  expect(validatePositionInput({ ...base, workLocation: "  " }).error).toBe(
    "El lugar de trabajo es obligatorio"
  )
  expect(validatePositionInput({ ...base, dailyHours: "" }).error).toBe(
    "La jornada es obligatoria: indica horas diarias, semanales y mensuales mayores que 0"
  )
  expect(validatePositionInput({ ...base, breakMinutes: "" }).error).toBe(
    "El descanso (minutos) es obligatorio"
  )
  expect(validatePositionInput({ ...base, breakMinutes: "30.5" }).error).toBe(
    "El descanso debe expresarse en minutos enteros"
  )
  expect(validatePositionInput({ ...base, dailyHours: "ocho" }).error).toBe(
    "Horas diarias debe ser un número mayor o igual a 0"
  )
  expect(validatePositionInput({ ...base, segmentsCount: 0, scheduleNotes: "" }).error).toBe(
    "El horario es obligatorio: añade segmentos de horario o una descripción"
  )

  // Código duplicado: la interfaz explica el conflicto y no inventa un código nuevo.
  expect(
    positionSaveErrorMessage(new Error("violates unique constraint organization_positions_entity_code_unique"))
  ).toBe("Conflicto de código, inténtalo de nuevo")
})

test("el horario habitual de un puesto normaliza, deduplica y acepta turnos que cruzan medianoche", () => {
  expect(normalizeScheduleTime("08:00:00")).toBe("08:00")
  expect(normalizeScheduleTime("8:5")).toBe("08:05")

  // Un día sin rango horario no añade nada.
  expect(addDraftScheduleSegments([], { days: [], start: "08:00", end: "16:30" }).error).toBe(
    "Selecciona al menos un día para el horario"
  )
  expect(addDraftScheduleSegments([], { days: [1], start: "08:00", end: "" }).error).toBe(
    "Indica la hora desde y hasta del horario"
  )
  expect(addDraftScheduleSegments([], { days: [1], start: "08:00", end: "08:00" }).error).toBe(
    "La hora desde y hasta no pueden ser iguales"
  )

  // El mismo rango se añade a cada día seleccionado, sin duplicar el segmento repetido.
  const added = addDraftScheduleSegments([], { days: [1, 3, 1], start: "08:00", end: "16:30" })
  expect(added.error).toBeNull()
  expect(sortScheduleSegments(added.segments)).toEqual([
    segment({ day_of_week: 1 }),
    segment({ day_of_week: 3 }),
  ])
  const repeated = addDraftScheduleSegments(added.segments, {
    days: [1],
    start: "08:00",
    end: "16:30",
  })
  expect(repeated.segments).toHaveLength(2)

  // Turno que cruza medianoche: 20:00 → 04:00 se conserva tal cual.
  const midnight = addDraftScheduleSegments([], { days: [6], start: "20:00", end: "04:00" })
  expect(midnight.segments).toEqual([
    { day_of_week: 6, start_time: "20:00", end_time: "04:00" },
  ])

  // El orden del envío es por día y hora, con `display_order` correlativo desde 1.
  const payload = positionSchedulePayload([
    segment({ day_of_week: 3, start_time: "14:00", end_time: "22:00" }),
    segment({ day_of_week: 1, start_time: "08:00", end_time: "16:30" }),
    segment({ day_of_week: 1, start_time: "06:00", end_time: "14:00" }),
  ])
  expect(payload.map((s) => s.display_order)).toEqual([1, 2, 3])
  expect(payload.map((s) => s.day_of_week)).toEqual([1, 1, 3])
  expect(payload[0].start_time).toBe("06:00")

  // La escritura del puesto y su horario es UNA llamada atómica con sus parámetros reales.
  const positions = read("src/domains/organization-structure/infrastructure/positions.repository.ts")
  expect(positions).toMatch(/\.rpc\("save_position_with_schedule", \{/)
  expect(positions).toMatch(/p_authorized_quantity: input\.authorizedQuantity/)
  expect(positions).toMatch(/p_break_minutes: input\.breakMinutes/)
  expect(positions).toMatch(/p_segments: input\.segments/)
})

// ---------------------------------------------------------------------------
// 4. Plazas ocupadas y vacantes: no se duplican aquí
// ---------------------------------------------------------------------------

test("la configuración de la estructura no repite el cálculo de plazas ocupadas y vacantes", () => {
  const useCase = read(
    "src/domains/organization-structure/application/staffing-configuration.queries.ts"
  )
  const page = read("src/pages/EntitySettingsStaffing.tsx")
  const positions = read("src/domains/organization-structure/infrastructure/positions.repository.ts")

  for (const source of [useCase, page, positions]) {
    // La ocupación es de las asignaciones (personas), no de la configuración de plantilla.
    expect(source).not.toMatch(/worker_position_assignments/)
    expect(source).not.toMatch(/vacantPlazas/)
  }

  // La regla de plazas sigue siendo única y vive en el dominio, no en la interfaz.
  const rules = read("src/domains/organization-structure/domain/staffing.rules.ts")
  expect(rules).toMatch(/export const vacantPlazas/)
  expect(rules).toMatch(/export const sumAuthorizedPlazas/)
  expect(page).toMatch(/authorized_quantity/)

  // La escala aplicable la resuelve el backend (una sola vez para todo el dominio).
  const repository = read("src/domains/organization-structure/infrastructure/salary.repository.ts")
  expect(repository).toMatch(/\.rpc\("resolve_salary_scale_for_entity"/)
  expect(repository).toMatch(/\.rpc\("resolve_salary_group_values"/)
})

// ---------------------------------------------------------------------------
// 5. Presentación sin consultas directas a Supabase
// ---------------------------------------------------------------------------

test("la configuración de la estructura no consulta Supabase desde la presentación", () => {
  const presentation = [
    "src/components/AreaForm.tsx",
    "src/components/JobForm.tsx",
    "src/components/PositionForm.tsx",
    "src/pages/EntitySettingsStaffing.tsx",
    "src/components/salary-group-dialog.tsx",
    "src/contexts/SalaryProvider.tsx",
    "src/contexts/SalaryContext.ts",
    "src/pages/EntitySettingsSalary.tsx",
    "src/modules/organization-structure/presentation/pages/AdminSettingsSalaryScale.tsx",
  ]

  for (const file of presentation) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
  }

  // Las pantallas y formularios consumen CASOS DE USO del dominio.
  expect(read("src/components/AreaForm.tsx")).toMatch(/saveArea/)
  expect(read("src/components/AreaForm.tsx")).toMatch(/validateAreaInput/)
  expect(read("src/components/JobForm.tsx")).toMatch(/loadJobFormWorkspace/)
  expect(read("src/components/JobForm.tsx")).toMatch(/saveJob/)
  expect(read("src/components/PositionForm.tsx")).toMatch(/savePosition/)
  expect(read("src/components/PositionForm.tsx")).toMatch(/validatePositionInput/)
  expect(read("src/pages/EntitySettingsStaffing.tsx")).toMatch(/loadStaffingConfiguration/)
  expect(read("src/pages/EntitySettingsStaffing.tsx")).toMatch(/setAreaActive/)
  expect(read("src/pages/EntitySettingsStaffing.tsx")).toMatch(/setJobActive/)
  expect(read("src/pages/EntitySettingsStaffing.tsx")).toMatch(/setPositionActive/)
})

test("las consultas y escrituras del bloque viven en sus repositorios, aisladas por entidad", () => {
  const repositories = [
    "src/domains/organization-structure/infrastructure/areas.repository.ts",
    "src/domains/organization-structure/infrastructure/jobs.repository.ts",
    "src/domains/organization-structure/infrastructure/positions.repository.ts",
    "src/domains/organization-structure/infrastructure/entity-configuration.repository.ts",
    "src/domains/organization-structure/infrastructure/salary-administration.repository.ts",
  ]

  for (const repository of repositories) {
    const source = read(repository)
    expect(source, `${repository} es la frontera de Supabase`).toMatch(/@\/lib\/supabase/)
    // El cliente (company_client_id) NUNCA se envía desde el frontend: lo impone RLS.
    expect(source, `${repository} no filtra por cliente`).not.toMatch(/\.eq\("company_client_id"/)
    expect(source, `${repository} no envía el cliente`).not.toMatch(/company_client_id:/)
  }

  expect(read(repositories[0])).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(read(repositories[1])).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(read(repositories[2])).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(read(repositories[4])).toMatch(/\.eq\("organization_entity_id", entityId\)/)

  // Los permisos se preguntan al backend por permiso interno de la entidad, y SÓLO desde
  // el dominio de control de acceso: la configuración ya no mantiene su propio envoltorio.
  const configuration = read(repositories[3])
  expect(configuration).not.toMatch(/export async function fetchEntityPermission/)
  expect(configuration).not.toMatch(/\.rpc\(/)

  const accessRepository = read(
    "src/domains/access-control/infrastructure/entity-access.repository.ts"
  )
  expect(accessRepository).toMatch(/\.rpc\("can_access_entity", \{/)
  expect(accessRepository).toMatch(/permission_code: permissionCode/)

  // Un único envoltorio en toda la aplicación: ningún otro dominio invoca esa RPC.
  for (const source of [
    ...repositories.map(read),
    read("src/domains/people/infrastructure/people.repository.ts"),
    read("src/domains/people/infrastructure/staffing.repository.ts"),
  ]) {
    expect(source).not.toMatch(/\.rpc\("can_access_entity"/)
  }

  // Quien puede ver o gestionar la configuración lo decide `staffing.view` / `staffing.manage`,
  // con los mismos códigos y el mismo comportamiento ante errores (el error se propaga).
  const useCase = read(
    "src/domains/organization-structure/application/staffing-configuration.queries.ts"
  )
  expect(useCase).toMatch(/loadEntityPermission\(entityId, "staffing\.view"\)/)
  expect(useCase).toMatch(/loadEntityPermission\(entityId, "staffing\.manage"\)/)
  expect(useCase).toMatch(/@\/domains\/access-control/)
  expect(useCase).not.toMatch(/@\/lib\/supabase/)
  expect(useCase).not.toMatch(/companyClientId/)

  // Los casos de uso de escritura tampoco hablan con Supabase.
  const commands = read(
    "src/domains/organization-structure/application/staffing-configuration.commands.ts"
  )
  expect(commands).not.toMatch(/@\/lib\/supabase/)
  expect(commands).not.toMatch(/companyClientId/)
})

// ---------------------------------------------------------------------------
// 6. Escalas, grupos y valores salariales
// ---------------------------------------------------------------------------

test("los grupos y escalas salariales se administran sin duplicar la RPC del cambio de importe", () => {
  const provider = read("src/contexts/SalaryProvider.tsx")
  const context = read("src/contexts/SalaryContext.ts")

  // El contexto ya no habla con Supabase: usa los casos de uso del dominio.
  expect(provider).toMatch(/@\/domains\/organization-structure/)
  expect(provider).not.toMatch(/@\/lib\/supabase/)
  expect(provider).toMatch(/loadSalaryScaleWithGroups/)
  expect(provider).toMatch(/createGlobalPresupuestadaScale/)

  // La interfaz pública del contexto no cambia: las pantallas siguen igual.
  expect(context).toMatch(/useSalary/)
  expect(context).toMatch(/canManageGlobalSalary/)

  // Un importe nunca se sobrescribe: la vigencia la aplica la RPC atómica ya migrada.
  const commands = read(
    "src/domains/organization-structure/application/salary-administration.commands.ts"
  )
  expect(commands).toMatch(/applySalaryChange/)
  expect(commands).not.toMatch(/apply_salary_group_value_change/)
  expect(commands).toMatch(/deactivateSalaryGroup/)
  expect(commands).not.toMatch(/@\/lib\/supabase/)

  // El importe vigente se resuelve por vigencia temporal, nunca por un flag del cliente.
  const repository = read(
    "src/domains/organization-structure/infrastructure/salary-administration.repository.ts"
  )
  expect(repository).toMatch(/\.rpc\("resolve_salary_group_values", \{/)
  expect(repository).toMatch(/\.rpc\("resolve_salary_value", \{/)

  // La escala aplicable se resuelve por régimen: presupuestada global o empresarial propia.
  const queries = read(
    "src/domains/organization-structure/application/salary-administration.queries.ts"
  )
  expect(queries).toMatch(/resolveApplicableScaleId/)
  expect(queries).not.toMatch(/@\/lib\/supabase/)
})

test("la escala presupuestada es de solo lectura en el contexto de la entidad, con independencia del usuario", () => {
  const page = read("src/pages/EntitySettingsSalary.tsx")

  // El contexto PRESUPUESTADA nunca ofrece gestión: ni alta de grupo, ni cambio de salario,
  // ni creación de la escala. La administración vive en la pantalla de plataforma de SiteCorp.
  expect(page).not.toMatch(/canManageGlobal/)
  expect(page).not.toMatch(/handleCreateGlobalScale/)

  // La única vía hacia la escala global desde la entidad es la consulta.
  expect(page).toMatch(/Ver escala/)

  // La gestión de la escala empresarial sigue dependiendo del permiso organizativo.
  expect(page).toMatch(/canManageEntitySalary && \(/)

  // La pantalla de plataforma sólo habilita la gestión con `salary.manage` de plataforma:
  // nunca por el simple hecho de ser superadministrador.
  const admin = read("src/modules/organization-structure/presentation/pages/AdminSettingsSalaryScale.tsx")
  expect(admin).toMatch(/canManageGlobalSalary/)
  expect(admin).not.toMatch(/isPlatformSuperAdmin/)
})
