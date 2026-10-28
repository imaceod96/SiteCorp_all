import { test, expect } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import {
  companyClientDeletionError,
  companyClientNameError,
  isCompanyClientId,
  sameCompanyClient,
} from "../src/modules/company-client/domain/rules"

/**
 * COMPANY CLIENT (ESCRITURAS Y CICLO DE VIDA) — reglas puras y contratos del backend.
 *
 * Comprueba, SIN crear ni eliminar ningún cliente real, lo que decide si la migración de
 * este bloque se mantiene:
 *   1. Mensajes de usuario de las dos operaciones (guardar y eliminar), sin perder el
 *      diagnóstico técnico que no tiene traducción.
 *   2. Que el ciclo de vida completo del cliente vive en UN dominio: tabla y RPC resueltas
 *      por la frontera de nomenclatura, argumentos legacy intactos.
 *   3. Que el borrado exige el resumen previo y la confirmación por nombre, y que la
 *      interfaz no compone consultas ni invoca Supabase.
 *   4. Que la fachada legacy ya no existe porque sus consumidores están migrados.
 *
 * Esta prueba es de REGLAS Y CONTRATOS: no ejecuta ninguna operación de escritura. Las
 * pruebas funcionales reales de la pantalla son las de Playwright sobre la aplicación en
 * marcha, y tampoco eliminan clientes reales.
 */

const read = (path: string) => readFileSync(path, "utf8")

// ---------------------------------------------------------------------------
// 1. Mensajes de usuario de guardar y eliminar
// ---------------------------------------------------------------------------

test("los mensajes de guardar y eliminar traducen lo que tiene significado estable", () => {
  expect(companyClientNameError(new Error("new row violates row-level security policy"))).toBe(
    "No tienes permiso para crear o editar clientes."
  )
  expect(
    companyClientNameError(new Error("duplicate key value violates unique constraint"))
  ).toBe("No se pudo generar un código único para el cliente. Inténtalo de nuevo.")

  expect(companyClientDeletionError(new Error("row-level security policy"))).toBe(
    "No tienes permiso para eliminar clientes."
  )

  // Cualquier otro mensaje del servidor se conserva literal: el diagnóstico no se descarta.
  expect(companyClientNameError(new Error("El nombre del workspace es obligatorio"))).toBe(
    "El nombre del workspace es obligatorio"
  )
  expect(companyClientDeletionError(new Error("El nombre de confirmación no coincide"))).toBe(
    "El nombre de confirmación no coincide"
  )

  // Sin mensaje, se conserva el texto genérico de cada operación.
  expect(companyClientNameError(undefined)).toBe("No se pudo guardar el cliente.")
  expect(companyClientDeletionError(null)).toBe("No se pudo eliminar el cliente.")
})

test("las reglas de identificador del cliente no conceden nada", () => {
  expect(isCompanyClientId("0b7bb3ba-1c30-4b0a-9d3d-1a2f5f6a9c01")).toBe(true)
  expect(isCompanyClientId("   ")).toBe(false)
  expect(isCompanyClientId(null)).toBe(false)

  // La comparación es de forma: no consulta la base de datos ni autoriza la pertenencia.
  expect(sameCompanyClient("CLIENT-1", "client-1")).toBe(true)
  expect(sameCompanyClient("client-1", "client-2")).toBe(false)
  expect(sameCompanyClient(undefined, "client-1")).toBe(false)
})

// ---------------------------------------------------------------------------
// 2. Un único repositorio con los contratos del backend
// ---------------------------------------------------------------------------

test("el ciclo de vida del cliente vive en un único repositorio del dominio", () => {
  const repository = read(
    "src/modules/company-client/infrastructure/company-client.repository.ts"
  )

  // La tabla física y los nombres de las RPC los resuelve la frontera de nomenclatura.
  expect(repository).toMatch(/@\/lib\/supabase/)
  expect(repository).toMatch(/\.from\(tableName\("clients"\)\)/)
  expect(repository).toMatch(/rpcName\("createClient"\)/)
  expect(repository).toMatch(/rpcName\("deletionSummary"\)/)

  // Los ARGUMENTOS de las RPC se conservan tal cual (contrato preservado por la migración SQL).
  expect(repository).toMatch(/p_name: input\.name\.trim\(\)/)
  expect(repository).toMatch(/p_description: input\.description\?\.trim\(\) \|\| null/)
  expect(repository).toMatch(/p_is_active: input\.isActive \?\? true/)
  expect(repository).toMatch(/p_tenant_id: companyClientId/)

  // La edición nunca envía el código (es inmutable) y se acota al cliente indicado.
  const update = repository.slice(repository.indexOf("updateCompanyClientRow"))
  expect(update).not.toMatch(/code:/)
  expect(update).toMatch(/\.eq\("id", companyClientId\)/)

  // El borrado se ejecuta con la Edge Function existente y su cuerpo legacy.
  expect(repository).toMatch(/functions\.invoke\("delete-workspace"/)
  expect(repository).toMatch(
    /body: \{ tenant_id: companyClientId, confirmation_name: confirmationName \}/
  )

  // El dominio NO compone consultas fuera de su infraestructura ni conoce la presentación.
  for (const file of [
    "src/modules/company-client/index.ts",
    "src/modules/company-client/domain/entities.ts",
    "src/modules/company-client/domain/rules.ts",
    "src/modules/company-client/application/company-clients.queries.ts",
    "src/modules/company-client/application/company-clients.commands.ts",
  ]) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/(domains|modules)\/(?!company-client)/
    )
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
  }
})

test("los casos de uso del cliente conservan el resumen previo y la confirmación por nombre", () => {
  const queries = read("src/modules/company-client/application/company-clients.queries.ts")
  const commands = read("src/modules/company-client/application/company-clients.commands.ts")

  // Resumen (solo lectura) antes de borrar: lo calcula el backend, no la interfaz.
  expect(queries).toMatch(/loadCompanyClientDeletionSummary/)
  expect(queries).toMatch(/rpcCompanyClientDeletionSummary\(companyClientId\)/)
  expect(queries).toMatch(/loadCompanyClients/)

  // El borrado exige el nombre de confirmación y nunca oculta el mensaje del backend.
  expect(commands).toMatch(/export async function deleteCompanyClient\(/)
  expect(commands).toMatch(/confirmationName: string/)
  expect(commands).toMatch(/invocation\.backendMessage \|\| companyClientDeletionError\(invocation\.error\)/)
  expect(commands).toMatch(/export async function createCompanyClient\(/)
  expect(commands).toMatch(/export async function updateCompanyClient\(/)

  // El contrato legacy de las claves del resumen se conserva literal.
  const entities = read("src/modules/company-client/domain/entities.ts")
  for (const key of [
    "tenant_id",
    "tenant_name",
    "entities",
    "workers",
    "positions",
    "candidates",
    "contracts",
    "addendums",
    "worker_documents",
    "candidate_documents",
    "document_templates",
    "roles",
    "memberships",
    "invitations",
  ]) {
    expect(entities, `falta la clave ${key} del resumen de borrado`).toMatch(
      new RegExp(`\\b${key}\\b`)
    )
  }
  expect(read("src/modules/company-client/infrastructure/company-client.mapper.ts")).toMatch(
    /CompanyClientRecord/
  )
})

// ---------------------------------------------------------------------------
// 3. La interfaz no compone consultas y no borra sin confirmación
// ---------------------------------------------------------------------------

test("la pantalla de clientes consume el dominio y no borra sin confirmar el nombre", () => {
  const page = read("src/modules/access-control/presentation/pages/Organizations.tsx")

  expect(page).not.toMatch(/@\/lib\/supabase/)
  expect(page).not.toMatch(/\.rpc\(/)
  expect(page).not.toMatch(/supabase\.from\(/)
  expect(page).not.toMatch(/schema-target/)
  expect(page).not.toMatch(/@\/lib\/company-clients/)

  expect(page).toMatch(/from "@\/(domains|modules)\/company-client"/)
  expect(page).toMatch(/loadCompanyClients/)
  expect(page).toMatch(/loadCompanyClientDeletionSummary\(companyClient\.id\)/)
  expect(page).toMatch(/createCompanyClient\(/)
  expect(page).toMatch(/updateCompanyClient\(editingCompanyClient\.id/)
  expect(page).toMatch(/deleteCompanyClient\(companyClient\.id, deleteConfirmation\.trim\(\)\)/)
  expect(page).toMatch(/companyClientNameError/)

  // Sin el nombre exacto no se llega a la operación de borrado.
  expect(page).toMatch(/deleteConfirmation\.trim\(\) !== companyClient\.name/)
})

test("la fachada legacy del cliente ya no existe: sus consumidores están migrados", () => {
  expect(existsSync("src/lib/company-clients.ts")).toBe(false)
})
