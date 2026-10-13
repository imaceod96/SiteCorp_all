import { test, expect } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { movementAlreadyDocumented } from "../src/domains/payroll-movements/domain/rules"
import type { GeneratedDocumentRow } from "../src/domains/document-generation/domain/entities"
import { ENTITY_PERMISSION_LABELS } from "../src/domains/access-control/domain/permissions.catalog"

/**
 * MOVIMIENTOS DE NÓMINA Y EVENTOS MASIVOS — reglas, contratos y frontera del dominio.
 *
 * Comprueba, SIN crear movimientos ni disparar ningún cierre masivo real, lo que decide si la
 * migración de este bloque se mantiene:
 *   1. La única regla propia del dominio: un evento laboral se documenta UNA sola vez (§73).
 *   2. La consulta del movimiento: la RPC y sus parámetros no cambian.
 *   3. La automatización: sin movimiento no se genera nada, lo ya documentado no se duplica y
 *      el motor documental no se reimplementa.
 *   4. El evento masivo: selección de trabajadores, resultado por trabajador, errores parciales
 *      y prevención de duplicados.
 *   5. La integración documental: una sola resolución de versión de plantilla en todo el código
 *      y ninguna dependencia circular entre dominios.
 *   6. La presentación migrada no consulta Supabase, y los códigos de permiso legacy no cambian.
 *
 * Distinción explícita de lo verificado:
 *   · PRUEBAS DE REGLAS      → funciones puras (idempotencia), ejecutadas de verdad.
 *   · PRUEBAS DE CONTRATOS   → se lee el código y se comprueba la RPC, sus parámetros, el orden
 *                              de las decisiones y la forma del resultado (contratos de backend
 *                              SIMULADOS: nada se ejecuta contra la base de datos).
 *   · PRUEBAS FUNCIONALES    → ninguna operación masiva real se ejecuta aquí. El flujo real del
 *                              cambio salarial masivo se ejerce por la interfaz en la pantalla
 *                              que lo gobierna, fuera de este archivo.
 *
 * Las importaciones profundas traen reglas PURAS: no arrastran el cliente de Supabase.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: lo que el módulo HACE, no lo que documenta. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

/** Todos los módulos de `src`: comprueba la frontera sin enumerar archivos a mano. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : []
  )

/** Documento YA EMITIDO del expediente, con la forma que devuelve el motor documental. */
const generatedDocument = (index = 1): GeneratedDocumentRow => ({
  id: `documento-movimiento-${index}`,
  worker_id: "trabajador-1",
  file_name: `Movimiento de Nomina ${index}.xlsx`,
  storage_path: `trabajador-1/movimiento-${index}.xlsx`,
  file_size: 2048,
  mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  generation_number: index,
  created_at: "2026-01-15T10:00:00.000Z",
  document_template_version_id: "version-plantilla-1",
  version_number: 1,
  template_name: "Movimiento de Nómina",
})

/* --------------------------------------------------------------------------- */
/* 1. Reglas puras                                                             */
/* --------------------------------------------------------------------------- */

test("un evento laboral se documenta una sola vez y por eso la idempotencia es una regla", () => {
  // Sin documento emitido SÍ hay algo que generar.
  expect(movementAlreadyDocumented([])).toBe(false)

  // Con un documento ya emitido, el movimiento queda documentado: no se duplica (§73).
  expect(movementAlreadyDocumented([generatedDocument()])).toBe(true)

  // Y si por cualquier motivo hubiera varios, el criterio no cambia.
  expect(movementAlreadyDocumented([generatedDocument(1), generatedDocument(2)])).toBe(true)
})

/* --------------------------------------------------------------------------- */
/* 2. Contratos: la consulta del movimiento                                    */
/* --------------------------------------------------------------------------- */

test("la consulta del movimiento conserva la RPC y sus parámetros", () => {
  const repository = code(
    "src/domains/payroll-movements/infrastructure/payroll-movements.repository.ts"
  )

  // Mismo nombre de RPC y mismos parámetros que antes de la migración.
  expect(repository).toMatch(/\.rpc\("find_payroll_movement", \{/)
  expect(repository).toMatch(/p_worker_id: input\.workerId/)
  expect(repository).toMatch(/p_event_type: input\.eventType/)
  expect(repository).toMatch(/p_effective_date: input\.effectiveDate/)
  // El identificador del movimiento se normaliza igual (texto o nulo), sin inventar nada.
  expect(repository).toMatch(/return data \? String\(data\) : null/)

  // El dominio sólo LOCALIZA el movimiento: no compone consultas ni escribe.
  expect(repository).not.toMatch(/\.from\(/)
  expect(repository).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
})

test("el movimiento se localiza por trabajador, evento y fecha efectiva, nunca por estado vivo", () => {
  const queries = code(
    "src/domains/payroll-movements/application/payroll-movements.queries.ts"
  )
  expect(queries).toMatch(
    /export async function findPayrollMovement\(\s*workerId: string,\s*eventType: PayrollMovementEventType,\s*effectiveDate: string\s*\)/
  )
  expect(queries).toMatch(
    /return rpcFindPayrollMovement\(\{ workerId, eventType, effectiveDate \}\)/
  )
  expect(queries).not.toMatch(/@\/lib\/supabase/)
})

/* --------------------------------------------------------------------------- */
/* 3. Contratos: la automatización del documento                               */
/* --------------------------------------------------------------------------- */

test("sin movimiento no se genera nada y el movimiento ya documentado no se duplica", () => {
  const commands = code(
    "src/domains/payroll-movements/application/payroll-movements.commands.ts"
  )

  // Evento sin movimiento registrado (p. ej. reincorporación sin Alta): no se hace nada.
  expect(commands).toMatch(
    /if \(!movementId\) return \{ generated: false, skipped: true, result: null \}/
  )

  // §73: primero el historial del movimiento, después decidir, y sólo entonces generar.
  // El orden se comprueba sobre el CUERPO del caso de uso (las importaciones no deciden nada).
  const body = commands.slice(commands.indexOf("export async function"))
  const historial = body.indexOf("fetchGeneratedDocuments")
  const regla = body.indexOf("movementAlreadyDocumented")
  const generacion = body.indexOf("generatePayrollMovementDocument")
  expect(historial).toBeGreaterThan(-1)
  expect(regla).toBeGreaterThan(historial)
  expect(generacion).toBeGreaterThan(regla)
  expect(commands).toMatch(
    /if \(movementAlreadyDocumented\(documents\)\) \{\s*return \{ generated: false, skipped: true, result: null \}/
  )

  // El resultado conserva la misma forma que devolvía el módulo anterior.
  expect(commands).toMatch(/return \{ generated: result\.success, skipped: false, result \}/)

  // Y el movimiento NO escribe en la base de datos.
  expect(commands).not.toMatch(/\.from\(/)
  expect(commands).not.toMatch(/\.rpc\(/)
})

test("la transición laboral consume el dominio de movimientos y no un módulo puente", () => {
  const transitions = code("src/domains/people/infrastructure/transition-documents.ts")

  expect(transitions).toMatch(/from "@\/domains\/payroll-movements"/)
  expect(transitions).not.toMatch(/@\/lib\/payroll-movements/)
  // El documento del movimiento sigue siendo SILENCIOSO: su fallo nunca interrumpe la operación.
  expect(transitions).toMatch(/await ensurePayrollMovementDocumentGenerated\(workerId, movementType, effectiveDate\)/)

  // La fachada anterior se retiró con la migración (limpieza controlada).
  expect(existsSync("src/lib/payroll-movements.ts")).toBe(false)
})

/* --------------------------------------------------------------------------- */
/* 4. Contratos: eventos masivos                                               */
/* --------------------------------------------------------------------------- */

test("la selección de trabajadores del evento masivo no cambia", () => {
  const salary = code("src/domains/contracts/infrastructure/salary.repository.ts")

  // Impacto previsto (qué trabajadores y con qué salario anterior) y previsualización.
  expect(salary).toMatch(/\.rpc\("salary_change_impact", \{/)
  expect(salary).toMatch(/p_salary_group_id: groupId/)
  expect(salary).toMatch(/p_new_amount: newAmount/)
  expect(salary).toMatch(/p_effective_date: effectiveDate \|\| null/)
  expect(salary).toMatch(/\.rpc\("preview_salary_change", \{/)
  expect(salary).toMatch(/p_effective_from: effectiveFrom \|\| null/)
  // El histórico salarial sigue leyéndose con los mismos filtros y orden.
  expect(salary).toMatch(/\.from\("worker_salary_history"\)/)
  expect(salary).toMatch(/\.eq\("worker_id", workerId\)/)
  expect(salary).toMatch(/\.order\("effective_date", \{ ascending: false \}\)/)
})

test("el cierre del evento conserva sus parámetros y devuelve resultado por trabajador", () => {
  const salary = code("src/domains/contracts/infrastructure/salary.repository.ts")

  expect(salary).toMatch(/\.rpc\("finalize_salary_change_event", \{/)
  expect(salary).toMatch(/p_salary_group_id: groupId/)
  expect(salary).toMatch(/p_effective_date: effectiveDate/)
  expect(salary).toMatch(/p_description: description\?\.trim\(\) \|\| null/)
  expect(salary).toMatch(/p_workers: workers\.map\(\(w\) => \(\{ worker_id: w\.worker_id, previous_amount: w\.previous_amount \}\)\)/)

  // La pantalla captura los afectados ANTES de aplicar y envía el salario anterior real.
  const dialog = code("src/components/salary/ReviewSalaryChangeDialog.tsx")
  expect(dialog).toMatch(
    /impact\.map\(\(row\) => \(\{\s*worker_id: row\.worker_id,\s*previous_amount: row\.previous_amount,?\s*\}\)\)/
  )
  // Si falla la materialización del evento, el cambio salarial ya aplicado no se revierte:
  // el error se registra y la operación se reporta como aplicada.
  expect(dialog).toMatch(
    /console\.error\("No se pudo materializar el evento documental del cambio salarial", eventError\)/
  )
  expect(dialog).toMatch(/ensureEventDocumentation\(event\.event_id\)/)
})

test("la generación por lotes del evento tolera errores parciales y no regenera lo correcto", () => {
  const batches = code(
    "src/domains/document-generation/application/document-batches.commands.ts"
  )

  // Un documento por movimiento pendiente; el fallo de uno no detiene el resto.
  expect(batches).toMatch(/const pending = await selectUngeneratedEventMovements\(eventId\)/)
  expect(batches).toMatch(/const generated = await generatePayrollMovementDocument\(movement\.id\)/)
  expect(batches).toMatch(/result\.generated \+= 1/)
  expect(batches).toMatch(/result\.failed \+= 1/)
  expect(batches).toMatch(/result\.errors\.push\(\{ movement_id: movement\.id, message: generated\.error \?\? "Error" \}\)/)
  // El cierre devuelve un resumen por evento (generados, fallidos, lotes y ZIP).
  expect(batches).toMatch(
    /return \{ generated: generated\.generated, failed: generated\.failed, batchesReady, zipsCreated \}/
  )

  // Prevención de duplicados: sólo se reintentan los movimientos SIN documento generado.
  const repository = code(
    "src/domains/document-generation/infrastructure/document-batches.repository.ts"
  )
  expect(repository).toMatch(/\.from\("worker_payroll_movements"\)/)
  expect(repository).toMatch(/\.eq\("event_id", eventId\)/)
  expect(repository).toMatch(/\.or\("worker_document_id\.is\.null,status\.neq\.GENERATED"\)/)
  // El aislamiento por entidad lo sigue aplicando RLS: aquí no se filtra por cliente.
  expect(repository).not.toMatch(/company_client_id/)
})

/* --------------------------------------------------------------------------- */
/* 5. Integración documental y resolución de plantillas                        */
/* --------------------------------------------------------------------------- */

test("la versión de plantilla se resuelve en un único punto de todo el código", () => {
  const resolvers = sourceFiles("src").filter((file) =>
    code(file).includes("resolve_document_template_version")
  )
  // Una sola implementación: el dominio de plantillas. Ni contratos ni resoluciones duplican la RPC.
  expect(resolvers).toEqual([
    "src/domains/document-templates/infrastructure/document-templates.repository.ts",
  ])

  // Los repositorios que la necesitaban la consumen ahora desde el dominio.
  for (const file of [
    "src/domains/contracts/infrastructure/contract-documents.repository.ts",
    "src/domains/resolutions/infrastructure/resolutions.repository.ts",
  ]) {
    expect(read(file), `${file} debe resolver la vigencia en el dominio`).toMatch(
      /resolveDocumentTemplateVersion\(/
    )
    expect(read(file), `${file} no debe duplicar la RPC`).not.toMatch(
      /resolve_document_template_version/
    )
  }

  // Los contratos ya no consultan Supabase para la vigencia: sólo consumen dominios.
  expect(code("src/domains/contracts/infrastructure/contract-documents.repository.ts")).not.toMatch(
    /@\/lib\/supabase/
  )

  // La resolución tampoco consulta ya la tabla de versiones en su cuenta.
  const resolutions = code("src/domains/resolutions/infrastructure/resolutions.repository.ts")
  expect(resolutions).not.toMatch(/document_template_versions/)
  expect(resolutions).toMatch(/requiredVariableKeys\(version\?\.analysis \?\? null\)/)
})

test("el movimiento consume el motor documental en una sola dirección, sin ciclos", () => {
  const domain = sourceFiles("src/domains/payroll-movements")

  for (const file of domain) {
    const source = code(file)
    // No depende de la presentación.
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
    // Único dominio permitido como dependencia: la generación documental.
    expect(source, `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/domains\/(?!document-generation)/
    )
    // No reimplementa renderizado, Storage ni selección de versión de plantilla.
    expect(source, `${file} no debe reimplementar el motor`).not.toMatch(
      /docx-render|xlsx-render|supabase\.storage|document_template_versions/
    )
  }

  // Y la dependencia inversa NO existe: el motor no conoce a los movimientos.
  const engine = sourceFiles("src/domains/document-generation").filter((file) =>
    /@\/domains\/payroll-movements/.test(read(file))
  )
  expect(engine, "la generación documental no debe depender de los movimientos").toEqual([])

  // El punto de entrada del dominio expone exactamente lo que ya se consumía.
  const entry = read("src/domains/payroll-movements/index.ts")
  for (const name of [
    "findPayrollMovement",
    "ensurePayrollMovementDocumentGenerated",
    "movementAlreadyDocumented",
    "PayrollMovementEventType",
    "PayrollMovementAutomationResult",
  ]) {
    expect(entry, `el dominio debe exportar ${name}`).toMatch(new RegExp(`\\b${name}\\b`))
  }
})

/* --------------------------------------------------------------------------- */
/* 6. Presentación, permisos y aislamiento                                     */
/* --------------------------------------------------------------------------- */

test("las pantallas y componentes migrados ya no consultan Supabase", () => {
  const presentation = [
    "src/components/workers/ChangePositionDialog.tsx",
    "src/components/workers/SeparateWorkerDialog.tsx",
    "src/components/candidates/HireCandidateDialog.tsx",
    "src/components/salary/ReviewSalaryChangeDialog.tsx",
  ]

  for (const file of presentation) {
    const source = code(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar la fachada retirada`).not.toMatch(
      /@\/lib\/(payroll-movements|document-generation)/
    )
    // Consumen los dominios de personas/contratos y, para la documentación, el motor.
    expect(source, `${file} debe consumir los dominios`).toMatch(/from "@\/domains\//)
  }

  // El cierre documental del evento se pide al motor, no se reimplementa en la pantalla.
  expect(read("src/components/salary/ReviewSalaryChangeDialog.tsx")).toMatch(
    /import \{ ensureEventDocumentation \} from "@\/domains\/document-generation"/
  )
})

test("los códigos de permiso legacy del ámbito no cambian con la migración", () => {
  // Mismos códigos que gobiernan las pantallas que producen y cierran movimientos.
  expect(ENTITY_PERMISSION_LABELS["workers.view"]).toBe("Ver trabajadores")
  expect(ENTITY_PERMISSION_LABELS["workers.manage"]).toBe("Gestionar trabajadores")
  expect(ENTITY_PERMISSION_LABELS["contracts.view"]).toBe("Ver contratos")
  expect(ENTITY_PERMISSION_LABELS["contracts.manage"]).toBe("Formalizar y gestionar contratos")
  expect(ENTITY_PERMISSION_LABELS["salary.view"]).toBe("Ver compensación (escala empresarial)")
  expect(ENTITY_PERMISSION_LABELS["salary.manage"]).toBe("Gestionar compensación (escala empresarial)")

  // El dominio de movimientos no decide permisos ni filtra por cliente: eso es del backend (RLS)
  // y de las pantallas, que preguntan al dominio de control de acceso.
  for (const file of sourceFiles("src/domains/payroll-movements")) {
    const source = code(file)
    expect(source, `${file} no debe decidir permisos`).not.toMatch(
      /permission|company_client_id|organization_entity_id/
    )
  }
})
