import { test, expect, type Page } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"

/**
 * RESOLUCIÓN DE IDENTIDAD Y SELECCIÓN DE INTERFAZ — regresión de la interfaz provisional.
 *
 * Defecto corregido: al iniciar sesión, la aplicación publicaba la sesión (`user`) antes de
 * resolver la identidad (perfil → nivel de plataforma → membresías). Mientras la identidad se
 * resolvía, `isPlatformUser` conservaba su valor inicial `false` y la rama de cliente era el
 * caso por defecto, así que un superadministrador veía durante unos instantes el layout de
 * cliente (encabezado «SiteCorp — Cliente», menú de cliente y la ruta que tuviera el
 * navegador, con la lista en «Cargando…» porque no hay cliente activo).
 *
 * DISTINCIÓN EXPLÍCITA DE LO VERIFICADO EN ESTE ARCHIVO:
 *   · PRUEBAS DE NAVEGADOR (ejecutadas de verdad, con la cuenta de prueba aislada y con
 *     retrasos/errores simulados por interceptación de red): pantalla neutral durante la
 *     resolución, ausencia de CUALQUIER layout antes de resolver, ausencia del menú de la otra
 *     rama, recarga con sesión activa, error de identificación con reintento y ausencia de
 *     bucles de navegación. NO se escribe nada: las peticiones solo se retrasan o se fallan.
 *   · VERIFICACIONES ESTRUCTURALES (lectura de código): orden de decisión en la presentación,
 *     publicación del estado de identidad, propagación de errores de las RPC de identidad,
 *     limpieza de contextos por cambio de usuario, frontera de Supabase y ausencia de ciclos.
 *
 * LÍMITES DECLARADOS: la cuenta de prueba aislada tiene UN único perfil, así que la interfaz
 * definitiva se comprueba como «exactamente una de las dos ramas», no como «la rama de
 * superadministrador». La validación funcional por tipo de perfil (superadministrador,
 * plataforma restringida, administrador de cliente, empresa/UEB y solo lectura) requiere
 * cuentas reales de cada tipo y queda PENDIENTE de ejecución manual.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: lo que el módulo HACE, no lo que documenta. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })

/** Menú lateral EXCLUSIVO de la aplicación de cliente. */
const CLIENT_MENU = "Invitaciones"
/** Menú lateral EXCLUSIVO de la administración de plataforma. */
const PLATFORM_MENU = "Clientes"

/** Endpoints que resuelven la identidad: se retrasan o se fallan SOLO en el navegador. */
const IDENTITY_ENDPOINTS = [
  "**/rest/v1/profiles*",
  "**/rest/v1/rpc/is_platform_superadmin",
  "**/rest/v1/rpc/is_platform_user",
]

/** Retrasa la resolución de identidad para observar la interfaz durante la espera. */
async function delayIdentityResolution(page: Page, ms = 1200) {
  for (const endpoint of IDENTITY_ENDPOINTS) {
    await page.route(endpoint, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      await route.continue()
    })
  }
}

/** Inicio de sesión por la pantalla real, con la cuenta de prueba aislada del entorno. */
async function signInThroughLoginScreen(page: Page) {
  await page.goto("/")
  await page.getByPlaceholder("tu@email.com").fill(process.env.DYAD_TEST_USER_EMAIL ?? "")
  await page.getByPlaceholder("••••••••").fill(process.env.DYAD_TEST_USER_PASSWORD ?? "")
  await page.getByRole("button", { name: "Iniciar sesión" }).click()
}

async function countBothMenus(page: Page) {
  return {
    client: await page.getByRole("link", { name: CLIENT_MENU }).count(),
    platform: await page.getByRole("link", { name: PLATFORM_MENU }).count(),
  }
}

/* --------------------------------------------------------------------------- */
/* 1. INTERFAZ PROVISIONAL: pantalla neutral, nunca un layout antes de resolver */
/* --------------------------------------------------------------------------- */

test("durante la resolución de identidad se muestra la pantalla neutral, nunca un layout", async ({
  page,
}) => {
  await delayIdentityResolution(page)

  const identityStarted = page.waitForRequest("**/rest/v1/profiles*")
  await signInThroughLoginScreen(page)

  // La identidad ya se está resolviendo y su lectura está retenida: la aplicación debe estar
  // en la pantalla neutral, sin ningún menú lateral (ni de cliente ni de plataforma).
  await identityStarted
  await expect(page.getByText("Cargando SiteCorp...")).toBeVisible()
  await expect(page.getByRole("status")).toBeVisible()
  expect(await countBothMenus(page)).toEqual({ client: 0, platform: 0 })

  // Terminada la resolución: desaparece la pantalla neutral y aparece EXACTAMENTE un layout.
  await expect(page.getByText("Cargando SiteCorp...")).toHaveCount(0, { timeout: 20000 })
  const menus = await countBothMenus(page)
  expect(menus.client + menus.platform).toBe(1)
  await expect(page.getByPlaceholder("tu@email.com")).toHaveCount(0)
})

test("una recarga con la sesión activa no muestra ningún layout de otra rama", async ({ page }) => {
  await signInThroughLoginScreen(page)
  await expect(page.getByText("Cargando SiteCorp...")).toHaveCount(0, { timeout: 20000 })

  // Qué interfaz le corresponde a esta cuenta (una sola en esta ejecución).
  const resolvedOnPlatform = (await page.getByRole("link", { name: PLATFORM_MENU }).count()) === 1

  await delayIdentityResolution(page)
  const identityStarted = page.waitForRequest("**/rest/v1/profiles*")
  await page.reload()
  await identityStarted

  // Carga neutral mientras se resuelve de nuevo la identidad...
  await expect(page.getByText("Cargando SiteCorp...")).toBeVisible()
  // ...y en ningún momento el menú de la rama opuesta.
  if (resolvedOnPlatform) {
    await expect(page.getByRole("link", { name: CLIENT_MENU })).toHaveCount(0)
  } else {
    await expect(page.getByRole("link", { name: PLATFORM_MENU })).toHaveCount(0)
  }

  await expect(page.getByText("Cargando SiteCorp...")).toHaveCount(0, { timeout: 20000 })
  const menus = await countBothMenus(page)
  expect(menus.client + menus.platform).toBe(1)
})

test("no hay bucles de navegación después de resolver la identidad", async ({ page }) => {
  await signInThroughLoginScreen(page)
  await expect(page.getByText("Cargando SiteCorp...")).toHaveCount(0, { timeout: 20000 })

  const settledUrl = page.url()
  await page.waitForTimeout(1500)
  expect(page.url()).toBe(settledUrl)

  const menus = await countBothMenus(page)
  expect(menus.client + menus.platform).toBe(1)
})

/* --------------------------------------------------------------------------- */
/* 2. FALLO DE IDENTIFICACIÓN: ni privilegios por defecto ni layout provisional */
/* --------------------------------------------------------------------------- */

test("un fallo de las RPC de identificación muestra el error neutral y permite reintentar", async ({
  page,
}) => {
  let pendingFailures = 1

  await page.route("**/rest/v1/rpc/is_platform_superadmin", async (route) => {
    if (pendingFailures > 0) {
      pendingFailures -= 1
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "identidad no disponible" }),
      })
      return
    }
    await route.continue()
  })

  await signInThroughLoginScreen(page)

  // El fallo NO se interpreta como «no tiene privilegios»: estado neutral de error.
  await expect(page.getByText("No se pudo verificar tu identidad")).toBeVisible({ timeout: 20000 })
  const retry = page.getByRole("button", { name: "Reintentar" })
  await expect(retry).toBeVisible()
  // Ninguna interfaz se muestra con la identidad sin resolver.
  expect(await countBothMenus(page)).toEqual({ client: 0, platform: 0 })

  // Reintento manual (no automático): se recupera la sesión sin recargar el navegador.
  await retry.click()
  await expect(page.getByText("No se pudo verificar tu identidad")).toHaveCount(0, {
    timeout: 20000,
  })
  const menus = await countBothMenus(page)
  expect(menus.client + menus.platform).toBe(1)
})

/* --------------------------------------------------------------------------- */
/* 3. VERIFICACIONES ESTRUCTURALES                                             */
/* --------------------------------------------------------------------------- */

test("la presentación no elige interfaz antes de resolver la identidad", () => {
  const app = code("src/App.tsx")

  const errorGate = app.indexOf("if (identityError)")
  const readyGate = app.indexOf("if (!authReady)")
  const platformBranch = app.indexOf("if (isPlatformUser)")
  const clientBranch = app.indexOf("element={<CompanyClientLayout />}")

  expect(errorGate, "el error de identidad debe evaluarse").toBeGreaterThan(-1)
  expect(readyGate, "la identidad resuelta debe evaluarse").toBeGreaterThan(errorGate)
  expect(platformBranch, "la rama de plataforma existe").toBeGreaterThan(readyGate)
  expect(clientBranch, "la rama de cliente es la última").toBeGreaterThan(platformBranch)

  // La pantalla neutral: blanca, a pantalla completa, con el logo oficial y un indicador
  // accesible que respeta el movimiento reducido del sistema.
  expect(app).toMatch(/Cargando SiteCorp\.\.\./)
  expect(app).toMatch(/role="status"/)
  expect(app).toMatch(/min-h-screen/)
  expect(app).toMatch(/bg-white/)
  expect(app).toMatch(/variant="full"/)
  expect(app).toMatch(/animate-spin/)
  expect(app).toMatch(/motion-reduce:animate-none/)
  // Estado de error con reintento manual.
  expect(app).toMatch(/Reintentar/)
  expect(app).toMatch(/role="alert"/)
})

test("el proveedor no publica la sesión como resuelta y coordina las resoluciones", () => {
  const provider = code("src/contexts/AuthProvider.tsx")

  // En el MISMO turno en el que publica la sesión, marca la identidad como no preparada.
  const marksNotReady = provider.indexOf("setAuthReady(false)")
  const publishesUser = provider.indexOf("setUser(sessionUser)")
  expect(marksNotReady).toBeGreaterThan(-1)
  expect(publishesUser).toBeGreaterThan(marksNotReady)

  // Una ÚNICA secuencia de identidad sigue siendo la del dominio.
  const identityCalls = provider.match(/loadAuthenticatedIdentity\(sessionUser\.id\)/g) ?? []
  expect(identityCalls).toHaveLength(1)

  // Coordinación: número de orden por resolución, deduplicación y descarte de respuestas
  // antiguas (una sesión más reciente nunca se sobrescribe con un resultado tardío).
  expect(provider).toMatch(/resolutionEpochRef/)
  expect(provider).toMatch(/epoch !== resolutionEpochRef\.current/)
  expect(provider).toMatch(/needsResolution/)
  expect(provider).toMatch(/inFlightUserIdRef/)
  expect(provider).toMatch(/resolvedUserIdRef/)

  // Sin sesión: se puede mostrar la pantalla de acceso.
  expect(provider).toMatch(/setAuthReady\(true\)/)

  // El error se comunica como mensaje de usuario, nunca con el detalle técnico del backend.
  expect(provider).toMatch(/No se pudo verificar tu identidad/)
  expect(provider).not.toMatch(/setIdentityError\([^)]*\.message/)
  expect(provider).not.toMatch(/setIdentityError\([^)]*String\(/)
})

test("un error de las RPC de identidad no se interpreta como «no tiene privilegios»", () => {
  const repository = code(
    "src/modules/access-control/infrastructure/authentication.repository.ts"
  )

  // Las tres lecturas que determinan el nivel de acceso propagan el fallo.
  expect(repository).toMatch(
    /supabase\.rpc\("is_platform_superadmin"\)[\s\S]{0,120}?if \(error\) throw error/
  )
  expect(repository).toMatch(
    /supabase\.rpc\("is_platform_user"\)[\s\S]{0,120}?if \(error\) throw error/
  )
  expect(repository).toMatch(/selectActiveMemberships[\s\S]*?if \(error\) throw error/)
  // Ya no se degradan a un negativo implícito: NINGUNA lectura de este repositorio se queda sin
  // comprobar el error (el único `?? []` traduce `data` nulo a lista vacía y va DESPUÉS de
  // lanzar el fallo, así que un error nunca se convierte en «no tiene membresías»).
  expect(repository).not.toMatch(/const \{ data \} = await supabase/)
  expect(repository).not.toMatch(/\) \|\| \[\]/)
  expect(repository).toMatch(/if \(error\) throw error[\s\S]{0,80}?\?\? \[\]/)

  // La capa de aplicación documenta y conserva esa política: los fallos llegan a la
  // presentación, que decide (estado neutral + reintento) sin conceder nada.
  expect(
    code("src/modules/access-control/application/authentication.queries.ts")
  ).toMatch(/loadClientPermissionSafe/)
})

test("los contextos de cliente y entidad no sobreviven a un cambio de usuario", () => {
  const providers = [
    "src/contexts/CurrentCompanyClientProvider.tsx",
    "src/contexts/CurrentEntityProvider.tsx",
  ]

  for (const file of providers) {
    const source = code(file)
    // Observan la identidad del usuario autenticado...
    expect(source, `${file} debe observar el usuario`).toMatch(/useAuth\(\)/)
    expect(source).toMatch(/const activeUserId = user\?\.id \?\? null/)
    // ...y descartan su estado cuando CAMBIA (cierre de sesión incluido).
    expect(source).toMatch(/previousUserIdRef/)
    expect(source).toMatch(/if \(previousUserIdRef\.current === activeUserId\) return/)
  }

  // La limpieza es de estado local de React: no toca Supabase, ni almacenamiento, ni datos.
  for (const file of providers) {
    const source = code(file)
    expect(source).not.toMatch(/@\/lib\/supabase/)
    expect(source).not.toMatch(/supabase\./)
    expect(source).not.toMatch(/localStorage|sessionStorage/)
    expect(source).not.toMatch(/schema-target/)
  }

  // El ámbito es «por usuario», no «por cada evento de sesión»: una renovación de token del
  // mismo usuario no limpia el contexto (el identificador no cambia).
  expect(code("src/contexts/CurrentCompanyClientProvider.tsx")).toMatch(
    /setCurrentCompanyClient\(null\)/
  )
  expect(code("src/contexts/CurrentEntityProvider.tsx")).toMatch(/setCurrentEntity\(null\)/)
})

test("la corrección respeta la arquitectura DDD, la frontera de Supabase y evita ciclos", () => {
  const presentation = [
    "src/App.tsx",
    "src/contexts/AuthProvider.tsx",
    "src/contexts/AuthContext.ts",
    "src/contexts/CurrentCompanyClientProvider.tsx",
    "src/contexts/CurrentEntityProvider.tsx",
  ]

  for (const file of presentation) {
    const source = code(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    expect(source, `${file} no debe resolver nomenclatura`).not.toMatch(/schema-target/)
  }

  // El proveedor de autenticación sigue consumiendo el dominio (no crea otro sistema de
  // autenticación) y la resolución de identidad vive en aplicación.
  expect(code("src/contexts/AuthProvider.tsx")).toMatch(/from "@\/(domains|modules)\/access-control"/)
  expect(code("src/contexts/AuthProvider.tsx")).toMatch(/loadSessionUser\(\)/)
  expect(code("src/contexts/AuthProvider.tsx")).toMatch(/subscribeAuthChanges\(/)

  // Sin ciclos nuevos: el dominio nunca importa la presentación…
  const domainFiles = sourceFiles("src/modules/access-control").filter(
    (file) => !file.includes("__tests__")
  )
  for (const file of domainFiles) {
    expect(code(file), `${file} no debe depender de la presentación`).not.toMatch(/@\/contexts\//)
  }

  // …y el contrato del contexto no IMPORTA a quien lo implementa (AuthContext ↔ AuthProvider):
  // la única mención al proveedor es el mensaje del guard del hook, que explica dónde usarlo.
  const context = code("src/contexts/AuthContext.ts")
  expect(context).not.toMatch(/import[^\n]*AuthProvider/)
  expect(context).not.toMatch(/Provider\.tsx/)
  expect(context).toMatch(/throw new Error\("useAuth must be used within an AuthProvider"\)/)

  // Capas del dominio intactas (la corrección no traslada responsabilidades).
  expect(existsSync("src/modules/access-control/domain/authentication.rules.ts")).toBe(true)
  expect(existsSync("src/modules/access-control/application/authentication.queries.ts")).toBe(true)
  expect(
    existsSync("src/modules/access-control/infrastructure/authentication.repository.ts")
  ).toBe(true)
})
