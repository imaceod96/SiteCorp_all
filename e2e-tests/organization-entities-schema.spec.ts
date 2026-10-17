import { test, expect, type Page } from "@playwright/test"
import { readdirSync, readFileSync, statSync } from "node:fs"

/**
 * REGRESIÓN — `organization_entities` y la frontera de nomenclatura física.
 *
 * El fallo que dejó sin grupos empresariales, empresas y UEB a la vista de SiteCorp fue un
 * `GET /rest/v1/organization_entities?select=*,tenant_id` (HTTP 400): la proyección de la
 * tabla se calculaba en una CONSTANTE DE MÓDULO, así que quedaba congelada con el nombre
 * físico LEGACY (`tenant_id`) antes de que la frontera resolviera el nombre real
 * (`company_client_id`) tras el renombrado.
 *
 * Este guion cubre las dos caras del fallo:
 *   1. REGLA/CONTRATO: ninguna consulta puede capturar la frontera de nomenclatura al
 *      importar el módulo — debe resolver el nombre físico EN CADA CONSULTA.
 *   2. FUNCIONAL REAL: con la sesión de prueba y una lectura autenticada de verdad, la
 *      tabla vuelve a responder con el alias correcto y la vista pinta sus entidades.
 *
 * Todo es de SÓLO LECTURA: no se crea, modifica ni borra ningún registro.
 */

const readSource = (path: string) => readFileSync(path, "utf8")

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

// ---------------------------------------------------------------------------
// 1. Regla y contrato: la frontera se resuelve en cada consulta
// ---------------------------------------------------------------------------

test("ninguna consulta captura la frontera de nomenclatura al importar el módulo", () => {
  // `selectQuery` se excluye a propósito: sólo declara el tipo del literal de `select()`.
  const frontierCall = /(selectColumn|selectEmbed|columnName|tableName|rpcName)\s*\(/
  const offenders: string[] = []

  for (const file of walk("src").filter((path) => /\.tsx?$/.test(path))) {
    readSource(file)
      .split("\n")
      .forEach((line, index) => {
        // Declaración de ámbito de módulo (sin indentación).
        if (!/^(export\s+)?(const|let|var)\s/.test(line)) return
        const call = line.search(frontierCall)
        if (call === -1) return
        // Si el nombre se calcula dentro de una función (`… => …`), se resuelve al llamarla.
        const arrow = line.indexOf("=>")
        if (arrow !== -1 && arrow < call) return
        offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
  }

  expect(
    offenders,
    "el nombre físico debe resolverse en cada consulta, no al importar el módulo"
  ).toEqual([])
})

test("las lecturas de organization_entities construyen la proyección en cada consulta", () => {
  const repository = readSource(
    "src/modules/organization-structure/infrastructure/organization-entities.repository.ts"
  )

  // La proyección pasa SIEMPRE por la frontera de compatibilidad.
  expect(repository).toMatch(
    /const entityProjection = \(\) => selectQuery\(`\*, \$\{selectColumn\("clientId"\)\}`\)/
  )
  expect(repository).not.toMatch(/ENTITY_PROJECTION/)

  // Las cuatro lecturas de la tabla la usan (lista, por cliente, por id y por padre).
  expect(repository.match(/\.select\(entityProjection\(\)\)/g) ?? []).toHaveLength(4)

  // Y no queda ninguna columna física escrita a mano.
  expect(repository).not.toMatch(/`\*, ?tenant_id`/)
  expect(repository).not.toMatch(/`\*, ?company_client_id`/)
  expect(repository).not.toMatch(/select\("?, ?tenant_id"?\)/)
  expect(repository).not.toMatch(/select\("?, ?company_client_id"?\)/)

  // El filtro por cliente sigue saliendo de la frontera (y no de un nombre fijo).
  expect(repository).toMatch(/\.eq\(columnName\("clientId"\), clientId\)/)
})

// ---------------------------------------------------------------------------
// 2. Funcional real: la vista vuelve a leer y a mostrar la jerarquía
// ---------------------------------------------------------------------------

test("la vista de organización vuelve a leer las entidades sin errores de esquema", async ({
  page,
}) => {
  const schemaFailures: string[] = []
  const entityReads: { url: string; status: number }[] = []

  // Base, clave publicable y sesión reales, tomadas de las peticiones de la aplicación.
  let baseUrl: string | null = null
  let apiKey: string | null = null
  let sessionAuth: string | null = null

  page.on("request", (request) => {
    const url = request.url()
    if (!url.includes("/rest/v1/")) return

    baseUrl = baseUrl ?? url.split("/rest/v1/")[0]
    apiKey = apiKey ?? request.headers()["apikey"] ?? null

    const header = request.headers()["authorization"] ?? ""
    const token = header.replace(/^Bearer\s+/i, "")
    // La sesión del USUARIO, nunca la clave anónima con la que también viaja la cabecera.
    if (token && token !== apiKey) sessionAuth = header
  })

  page.on("response", (response) => {
    const url = response.url()
    if (!url.includes("/rest/v1/")) return

    if (response.status() === 400 || response.status() === 404) {
      schemaFailures.push(`${response.status()} ${url}`)
    }
    if (url.includes("/rest/v1/organization_entities")) {
      entityReads.push({ url, status: response.status() })
    }
  })

  await signInWithProvisionedUser(page)

  // La rama de la aplicación depende del tipo de usuario: administración global
  // (`/admin/companies`) o cliente (`/organization`). Ambas leen `organization_entities`.
  const platformBranch = page.url().includes("/admin")

  // La espera se arma ANTES de navegar para no perder la respuesta de la vista.
  const observedRead = page
    .waitForResponse((response) => response.url().includes("/rest/v1/organization_entities"), {
      timeout: 15000,
    })
    .catch(() => null)

  await page.goto(platformBranch ? "/admin/companies" : "/organization")

  // La vista se ha montado de verdad (encabezado propio) y sin pantalla de error.
  await expect(
    page.getByRole("heading", { name: /^(Organización|Clientes)$/ })
  ).toBeVisible()
  await expect(page.getByText("Error de la aplicación")).toHaveCount(0)

  // (a) NINGUNA respuesta de la sesión ha fallado por esquema: es la firma exacta del fallo
  // corregido (antes, `GET …?select=*,tenant_id` respondía 400).
  expect(schemaFailures).toEqual([])

  // (b) Lectura real autenticada, con la sesión y el esquema que usa la propia aplicación.
  if (!sessionAuth) sessionAuth = await sessionFromStorage(page)
  expect(baseUrl, "debe observarse la URL de Supabase").toBeTruthy()
  expect(apiKey, "debe observarse la clave publicable").toBeTruthy()
  expect(sessionAuth, "debe observarse una sesión autenticada").toBeTruthy()

  const get = (query: string) =>
    page.request.get(`${baseUrl}/rest/v1/${query}`, {
      headers: { apikey: apiKey as string, authorization: sessionAuth as string },
    })

  // El nombre físico lo declara la propia base: `company_clients` (renombrado) o la tabla
  // legacy. La prueba se adapta al estado real, sin suposiciones.
  const renamedSchema = (await get("company_clients?select=id&limit=1")).status() !== 404
  const projection = renamedSchema ? "*,tenant_id:company_client_id" : "*,tenant_id"

  const entityRead = await get(
    `organization_entities?select=${projection}&order=name.asc&limit=50`
  )
  expect(
    entityRead.status(),
    `la lectura real de organization_entities debe responder 200 (proyección ${projection})`
  ).toBe(200)

  // Con el esquema renombrado, el nombre legacy SUELTO ya no existe: era la causa del 400.
  if (renamedSchema) {
    const legacyProjection = await get(
      "organization_entities?select=*,tenant_id&order=name.asc&limit=1"
    )
    expect(
      legacyProjection.status(),
      "el nombre físico legacy suelto debe seguir siendo inválido"
    ).toBe(400)
  }

  // (c) La lectura que hizo LA VISTA (si la hizo: depende de que haya cliente activo) debe
  // haber sido correcta y con el alias de la frontera, nunca con el nombre legacy suelto.
  const viewRead = await observedRead
  if (viewRead) {
    expect(viewRead.status()).toBe(200)
    expect(decode(viewRead.url())).not.toMatch(/select=\*,tenant_id(&|$)/)
    if (renamedSchema) {
      expect(decode(viewRead.url())).toContain("tenant_id:company_client_id")
    }
  }
  expect(entityReads.every((entry) => entry.status === 200)).toBe(true)

  // (d) Los registros EXISTENTES vuelven a mostrarse: se abre una entidad real —su id y su
  // nombre se acaban de leer de la base— y la vista tiene que pintarla.
  const rows = (await entityRead.json().catch(() => [])) as { id?: string; name?: string }[]
  expect(Array.isArray(rows)).toBe(true)

  const sample = rows.find(
    (row) => typeof row.id === "string" && typeof row.name === "string" && row.name.length > 0
  )

  if (sample?.id && sample.name) {
    const detailRead = page
      .waitForResponse((response) => response.url().includes("/rest/v1/organization_entities"), {
        timeout: 15000,
      })
      .catch(() => null)

    await page.goto(`/organization/${sample.id}`)
    await expect(page.getByText(sample.name, { exact: false }).first()).toBeVisible()

    const detailResponse = await detailRead
    if (detailResponse) expect(detailResponse.status()).toBe(200)
    expect(schemaFailures).toEqual([])
  }
})

/** Sesión guardada por el cliente de Supabase, como último recurso. */
async function sessionFromStorage(page: Page): Promise<string | null> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((entry) => entry.endsWith("-auth-token"))
    if (!key) return null
    const raw = window.localStorage.getItem(key) ?? ""
    try {
      const parsed = JSON.parse(raw) as { access_token?: string }
      return parsed.access_token ?? null
    } catch {
      return null
    }
  })

  return token ? `Bearer ${token}` : null
}

async function signInWithProvisionedUser(page: Page): Promise<void> {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)

  await page.getByPlaceholder("tu@email.com").fill(process.env.DYAD_TEST_USER_EMAIL ?? "")
  await page.getByPlaceholder("••••••••").fill(process.env.DYAD_TEST_USER_PASSWORD ?? "")
  await page.getByRole("button", { name: "Iniciar sesión" }).click()

  await expect(page).not.toHaveURL(/\/login$/)
}
