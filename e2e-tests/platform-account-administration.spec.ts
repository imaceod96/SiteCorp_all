import { test, expect } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import {
  isPlatformUserFlag,
  passwordChangeError,
  profileIsActive,
} from "../src/domains/access-control/domain/authentication.rules"
import { invitationExpiresAt } from "../src/domains/access-control/domain/access.rules"
import {
  SITECORP_MODULES_DISABLED_MESSAGE,
  SITECORP_MODULES_DISABLED_TITLE,
  buildAccountCode,
  canUseInternalModules,
  hasSiteCorpAccount,
  organizationFallbackPath,
} from "../src/domains/organization-structure/domain/account.rules"
import {
  ENTITY_INTERNAL_MODULES,
  ENTITY_NAV,
  contractAlertsPath,
} from "../src/domains/organization-structure/domain/entity-modules.catalog"
import { companyClientMetrics } from "../src/domains/company-client/domain/rules"

/**
 * ADMINISTRACIÓN GLOBAL, CUENTAS Y CIERRE DE LA CAPA DE PRESENTACIÓN — reglas, contratos y
 * frontera de Supabase.
 *
 * Comprueba, CON DATOS SIMULADOS y sin escribir nada en la base de datos, lo que decide si la
 * migración DDD de este bloque se mantiene:
 *   1. Cuenta SiteCorp de la entidad y catálogo de módulos internos (navegación sin cambios).
 *   2. Reglas de la cuenta y la sesión (contraseña, perfil inactivo, nivel de plataforma).
 *   3. Vigencia de las invitaciones.
 *   4. Métricas de la administración global de clientes.
 *   5. Contratos de las consultas y RPC de plataforma, usuarios/invitaciones de cliente,
 *      cuenta/sesión y documentos rectores (tablas, filtros, columnas y argumentos).
 *   6. Presentación sin consultas directas a Supabase en las pantallas migradas.
 *   7. Fachadas retiradas y utilidades legítimas conservadas.
 *   8. Ausencia de dependencias circulares entre dominios.
 *
 * Distinción explícita de lo verificado:
 *   · PRUEBAS DE REGLAS  → funciones puras ejecutadas de verdad (cuenta, sesión, invitación,
 *     métricas y catálogo de módulos).
 *   · PRUEBAS DE CONTRATOS → se lee el código y se comprueban tablas, filtros, órdenes, RPC,
 *     Edge Functions, bucket y rutas de Storage.
 *   · PRUEBAS FUNCIONALES REALES → NINGUNA: no se inicia sesión, no se envía ninguna
 *     invitación, no se crea ni desactiva ningún usuario y no se sube ni borra ningún archivo.
 *     Los flujos completos de las pantallas se ejercen por la interfaz, fuera de este archivo.
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

/* --------------------------------------------------------------------------- */
/* 1. Cuenta SiteCorp y módulos internos                                       */
/* --------------------------------------------------------------------------- */

test("la cuenta SiteCorp de la entidad decide los módulos internos sin cambiar rutas", () => {
  // Sólo `true` explícito es Cuenta SiteCorp: ni `null` ni ausencia de la bandera.
  expect(hasSiteCorpAccount({ is_sitecorp_account: true })).toBe(true)
  expect(hasSiteCorpAccount({ is_sitecorp_account: false })).toBe(false)
  expect(hasSiteCorpAccount({ is_sitecorp_account: null })).toBe(false)
  expect(hasSiteCorpAccount(null)).toBe(false)

  // La regla central sigue exigiendo las DOS condiciones: cuenta + autorización.
  expect(canUseInternalModules({ is_sitecorp_account: true }, { isAuthorized: true })).toBe(true)
  expect(canUseInternalModules({ is_sitecorp_account: true }, { isAuthorized: false })).toBe(false)
  expect(canUseInternalModules({ is_sitecorp_account: false }, { isAuthorized: true })).toBe(false)

  // El código de cuenta se deriva del código interno, en mayúsculas.
  expect(buildAccountCode("emp-001")).toBe("CUENTA-EMP-001")

  // Ruta externa de retorno: estructura del cliente o administración de clientes.
  expect(
    organizationFallbackPath({
      isPlatformSuperAdmin: false,
      hasPlatformOrganizationAccess: false,
    })
  ).toBe("/organization")
  expect(
    organizationFallbackPath({
      isPlatformSuperAdmin: false,
      hasPlatformOrganizationAccess: true,
    })
  ).toBe("/admin/companies")
  expect(
    organizationFallbackPath({
      isPlatformSuperAdmin: true,
      hasPlatformOrganizationAccess: false,
    })
  ).toBe("/admin/companies")

  // Textos del bloqueo de módulos internos (no cambian).
  expect(SITECORP_MODULES_DISABLED_TITLE).toBe("Módulos internos no habilitados")
  expect(SITECORP_MODULES_DISABLED_MESSAGE).toBe(
    "Esta entidad no tiene habilitados los módulos internos de SiteCorp."
  )
})

test("el catálogo de módulos internos conserva el orden y las rutas del menú", () => {
  const simple = ENTITY_NAV.filter((entry) => entry.kind === "link").map((entry) => entry.key)
  const group = ENTITY_NAV.find((entry) => entry.kind === "group")

  // Orden definitivo del menú: Resumen · Personas (…) · Contratación · Plantilla · Vacaciones ·
  // Licencias · Prenómina · Documentos pendientes · Ajustes.
  expect(simple).toEqual([
    "summary",
    "hiring",
    "staffing",
    "vacations",
    "medical-certificates",
    "prenomina",
    "pending-documents",
    "settings",
  ])
  expect(group?.key).toBe("personas")
  expect(group && group.kind === "group" ? group.items.map((item) => item.key) : []).toEqual([
    "candidates",
    "workers",
    "reentries",
  ])

  // Ninguna entrada se duplica y Vencimientos no es un elemento directo del menú.
  const keys = ENTITY_NAV.flatMap((entry) =>
    entry.kind === "group" ? [entry.key, ...entry.items.map((item) => item.key)] : [entry.key]
  )
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys).not.toContain("contract-alerts")

  // Las rutas internas no cambian y la de Vencimientos sigue existiendo.
  const summary = ENTITY_INTERNAL_MODULES.find((module) => module.key === "summary")
  expect(summary?.path("entidad-1")).toBe("/entity/entidad-1/summary")
  expect(contractAlertsPath("entidad-1")).toBe("/entity/entidad-1/contracts/alerts")
})

/* --------------------------------------------------------------------------- */
/* 2. Reglas de cuenta y sesión                                                */
/* --------------------------------------------------------------------------- */

test("las reglas de la cuenta y la sesión son las mismas que aplicaba la pantalla", () => {
  // Contraseñas nuevas: mismo mensaje de usuario y ninguna validación nueva.
  expect(passwordChangeError("nueva-1234", "nueva-1234")).toBeNull()
  expect(passwordChangeError("nueva-1234", "otra-1234")).toBe(
    "Las contraseñas nuevas no coinciden."
  )

  // Un perfil inactivo (`is_active === false`) no mantiene la sesión.
  expect(profileIsActive({ is_active: true })).toBe(true)
  expect(profileIsActive({ is_active: false })).toBe(false)
  expect(profileIsActive(null)).toBe(true)
  expect(profileIsActive(undefined)).toBe(true)

  // El superadministrador de plataforma ES usuario de plataforma (mismo atajo que antes).
  expect(isPlatformUserFlag(false, true)).toBe(true)
  expect(isPlatformUserFlag(true, false)).toBe(true)
  expect(isPlatformUserFlag(false, false)).toBe(false)
})

test("las invitaciones de cliente caducan en la misma semana que las de entidad", () => {
  const now = new Date("2026-01-01T00:00:00.000Z")
  expect(invitationExpiresAt(now)).toBe("2026-01-08T00:00:00.000Z")
  expect(new Date(invitationExpiresAt(now)).getTime() - now.getTime()).toBe(
    7 * 24 * 60 * 60 * 1000
  )
})

test("las métricas de la administración global cuentan como antes", () => {
  const simulated = [
    { isActive: true },
    { isActive: true },
    { isActive: false },
    { isActive: null },
  ]

  // Un cliente sin estado se cuenta como inactivo: total = activos + inactivos.
  expect(companyClientMetrics(simulated)).toEqual({ total: 4, active: 2, inactive: 2 })
  expect(companyClientMetrics([])).toEqual({ total: 0, active: 0, inactive: 0 })
})

/* --------------------------------------------------------------------------- */
/* 3. Contratos de consultas, RPC y Storage                                    */
/* --------------------------------------------------------------------------- */

test("la cuenta y la sesión se resuelven con los mismos contratos de Auth y RPC", () => {
  const repository = code("src/domains/access-control/infrastructure/authentication.repository.ts")

  expect(repository).toMatch(/supabase\.auth\.getSession\(\)/)
  expect(repository).toMatch(/supabase\.auth\.onAuthStateChange\(/)
  expect(repository).toMatch(/supabase\.auth\.signInWithPassword\(\{ email, password \}\)/)
  expect(repository).toMatch(/supabase\.auth\.signOut\(\)/)
  expect(repository).toMatch(/supabase\.auth\.updateUser\(\{ password \}\)/)
  expect(repository).toMatch(/\.rpc\("is_platform_superadmin"\)/)
  expect(repository).toMatch(/\.rpc\("is_platform_user"\)/)
  // Permiso de cliente: misma RPC y mismo argumento.
  expect(repository).toMatch(/\.rpc\(rpcName\("hasClientPermission"\), \{/)
  expect(repository).toMatch(/permission_code: permissionCode/)
  // Membresías ACTIVAS con su cliente propietario embebido.
  expect(repository).toMatch(/tableName\("memberships"\)/)
  expect(repository).toMatch(/tenant:\$\{tableName\("clients"\)\}/)
  expect(repository).toMatch(/\.eq\("is_active", true\)/)
  // Avatares: bucket PRIVADO, ruta `<usuario>/<archivo>` construida por la regla del dominio y
  // URL TEMPORAL firmada. Nunca se guarda ni se devuelve una URL pública.
  expect(repository).toMatch(/AVATARS_BUCKET = "avatars"/)
  expect(repository).toMatch(/avatarObjectPath\(userId, file\.name\)/)
  expect(repository).toMatch(/\.createSignedUrl\(path, expiresInSeconds\)/)
  expect(repository).toMatch(/export async function deleteAvatarObject/)
  expect(repository).not.toMatch(/getPublicUrl/)
  // La consulta de identidad NO decide autorización por su cuenta.
  expect(repository).not.toMatch(/is_superadmin/i)

  const queries = code("src/domains/access-control/application/authentication.queries.ts")
  // Una única secuencia de identidad para la carga inicial y los eventos de Auth.
  expect(queries).toMatch(/selectUserProfileById\(userId\)/)
  expect(queries).toMatch(/if \(!isProfileActive\)/)
  expect(queries).toMatch(/signedOut: true/)
  expect(queries).toMatch(/selectActiveMemberships\(userId\)/)
  // La política segura de permisos de cliente: un fallo NUNCA habilita nada.
  expect(queries).toMatch(/loadClientPermissionSafe/)
  expect(queries).toMatch(/catch \{\n    return false\n  \}/)

  // El perfil lo escribe un único repositorio, con las mismas columnas.
  const profiles = code("src/domains/access-control/infrastructure/user-profiles.repository.ts")
  expect(profiles).toMatch(/\.from\("profiles"\)/)
  expect(profiles).toMatch(/full_name: input\.fullName/)
  expect(profiles).toMatch(/username: input\.username/)
  // El avatar se escribe SÓLO con la RUTA del objeto, en su operación dedicada: el formulario
  // de la cuenta ya no arrastra ninguna URL.
  expect(profiles).toMatch(/export async function updateUserProfileAvatar\(/)
  expect(profiles).toMatch(/\.update\(\{ avatar_url: avatarPath \}\)/)
  expect(profiles).not.toMatch(/avatarUrl/)
  expect(profiles).toMatch(/update\(\{ is_active: isActive \}\)/)
  expect(profiles).toMatch(/\.order\("created_at", \{ ascending: false \}\)/)
})

test("la administración de plataforma conserva sus tablas, su Edge Function y sus privilegios", () => {
  const repository = code("src/domains/access-control/infrastructure/platform-users.repository.ts")

  expect(repository).toMatch(/\.from\("platform_user_roles"\)/)
  expect(repository).toMatch(/\.select\("platform_role_id, platform_roles\(name, is_system_role\)"\)/)
  expect(repository).toMatch(/\.from\("platform_roles"\)/)
  expect(repository).toMatch(/\.eq\("is_active", true\)/)
  expect(repository).toMatch(/\.order\("name"\)/)
  expect(repository).toMatch(/\.insert\(\{ user_id: userId, platform_role_id: roleId \}\)/)
  expect(repository).toMatch(/\.eq\("platform_role_id", roleId\)/)
  // El alta sigue pasando por la Edge Function, con su contrato de cuerpo intacto.
  expect(repository).toMatch(/functions\.invoke\("create-sitecorp-user", \{/)
  for (const key of ["full_name", "username", "email", "password", "is_active", "platform_role_id"]) {
    expect(repository, `el cuerpo debe conservar ${key}`).toMatch(new RegExp(`${key}: `))
  }
  expect(repository).toMatch(/Respuesta vacía del servidor/)
  // RLS sigue siendo la autoridad: aquí no se comprueban privilegios.
  expect(repository).not.toMatch(/is_superadmin/i)

  const queries = code("src/domains/access-control/application/platform-users.queries.ts")
  expect(queries).toMatch(/selectAllUserProfiles\(\)/)
  expect(queries).toMatch(/selectPlatformUserRoles\(profile\.id\)/)
  expect(queries).toMatch(/\.map\(\(row\) => row\.platform_roles\)\.flat\(\)/)

  const commands = code("src/domains/access-control/application/platform-users.commands.ts")
  expect(commands).toMatch(/createPlatformUser/)
  expect(commands).toMatch(/updatePlatformUser/)
  expect(commands).toMatch(/setPlatformUserActive/)
  expect(commands).toMatch(/assignPlatformRole/)
  expect(commands).toMatch(/removePlatformRole/)
})

test("los usuarios y las invitaciones de un cliente conservan su aislamiento y sus contratos", () => {
  const repository = code("src/domains/access-control/infrastructure/client-access.repository.ts")

  // El listado ADMINISTRATIVO de membresías no filtra por estado y se acota al cliente.
  const membershipsBlock = repository.slice(
    repository.indexOf("export async function selectClientMembershipRows"),
    repository.indexOf("export async function selectClientUserRoles")
  )
  expect(membershipsBlock).toMatch(/tableName\("memberships"\)/)
  expect(membershipsBlock).toMatch(/\$\{selectColumn\("clientId"\)\}/)
  expect(membershipsBlock).toMatch(/\.eq\(columnName\("clientId"\), companyClientId\)/)
  expect(membershipsBlock).not.toMatch(/is_active", true/)

  // Roles de las membresías, con el rol embebido y su misma proyección.
  expect(repository).toMatch(/tableName\("userRoles"\)/)
  expect(repository).toMatch(/selectEmbed\("roles", "tenant_roles"\)\}\(name\)/)
  expect(repository).toMatch(/\.in\(columnName\("membershipId"\), membershipIds\)/)

  // Invitaciones: la LECTURA pasa por la RPC (el rol ajeno llega enmascarado desde el
    // backend y el identificador del rol no se consulta nunca) y el orden lo fija la RPC.
    expect(repository).toMatch(/tableName\("invitations"\)/)
    expect(repository).toMatch(/\.rpc\("list_company_client_invitations", \{/)
    expect(repository).toMatch(/p_company_client_id: companyClientId,/)
    expect(repository).not.toMatch(/tenant_role:\$\{tableName\("roles"\)\}/)
    expect(repository).not.toMatch(/company_client_role_id/)
    expect(repository).not.toMatch(/\.order\(/)
    // El alta conserva sus columnas y la vigencia la fija el dominio.
    expect(repository).toMatch(/\[columnName\("clientId"\)\]: input\.clientId/)
  expect(repository).toMatch(/\[columnName\("roleId"\)\]: input\.roleId/)
  expect(repository).toMatch(/invited_by: input\.invitedBy/)
  expect(repository).toMatch(/status: "pending"/)
  expect(repository).toMatch(/expires_at: expiresAt/)
  expect(repository).toMatch(/\.update\(\{ status \}\)/)
  expect(repository).not.toMatch(/is_superadmin/i)

  // La vigencia la fija la regla única del dominio, no la pantalla.
  const commands = code("src/domains/access-control/application/client-access.commands.ts")
  expect(commands).toMatch(/insertClientInvitation\(input, invitationExpiresAt\(\)\)/)

  const queries = code("src/domains/access-control/application/client-access.queries.ts")
  expect(queries).toMatch(/selectUserProfiles\(memberships\.map\(\(member\) => member\.user_id\)\)/)
  expect(queries).toMatch(/selectClientUserRoles\(memberships\.map\(\(member\) => member\.id\)\)/)
  expect(queries).toMatch(/profile\?\.full_name \|\| "Usuario"/)
  expect(queries).toMatch(/role_name: rolesByMembership\[member\.id\]\?\.name \|\| "Sin rol"/)
    // El rol de una invitación se etiqueta con la regla del dominio: «Restringido» cuando el
      // backend lo enmascara, nunca como si la invitación no llevara rol.
      expect(queries).toMatch(/role_name: accessRoleLabel\(invitation\)/)
    })

test("los documentos rectores conservan bucket, ruta, metadatos y ciclo de vida", () => {
  const repository = code(
    "src/domains/organization-structure/infrastructure/governing-documents.repository.ts"
  )

  expect(repository).toMatch(/GOVERNING_DOCUMENTS_BUCKET = "documents"/)
  expect(repository).toMatch(
    /\$\{GOVERNING_DOCUMENTS_PREFIX\}\/\$\{entityId\}\/\$\{documentId\}\/\$\{sanitizeFileName\(fileName\)\}/
  )
  expect(repository).toMatch(/from "@\/lib\/documents"/)
  // Lectura no concluyente de la entidad y listado por entidad.
  expect(repository).toMatch(/\.from\("organization_entities"\)/)
  expect(repository).toMatch(/\.maybeSingle\(\)/)
  expect(repository).toMatch(/\.from\("governing_documents"\)/)
  expect(repository).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(repository).toMatch(/\.order\("created_at", \{ ascending: false \}\)/)
  // Subida, apertura, descarga y borrado: mismos parámetros de Storage.
  expect(repository).toMatch(/cacheControl: "3600", upsert: false/)
  expect(repository).toMatch(/createSignedUrl\(storagePath, SIGNED_URL_EXPIRES_IN\)/)
  expect(repository).toMatch(/\.download\(storagePath\)/)
  expect(repository).toMatch(/\.remove\(\[storagePath\]\)/)
  // Metadatos del registro.
  expect(repository).toMatch(/organization_entity_id: record\.entityId/)
  expect(repository).toMatch(/file_name: record\.fileName/)
  expect(repository).toMatch(/created_by: record\.createdBy/)
  expect(repository).toMatch(/\.delete\(\)\.eq\("id", documentId\)/)

  const commands = code(
    "src/domains/organization-structure/application/governing-documents.commands.ts"
  )
  // Identificador y ruta se generan igual, y no quedan archivos huérfanos.
  expect(commands).toMatch(/crypto\.randomUUID\(\)/)
  expect(commands).toMatch(/await removeGoverningDocumentObject\(storagePath\)/)
  // El borrado retira primero el objeto y después el registro.
  expect(commands).toMatch(
    /await removeGoverningDocumentObject\(document\.storage_path\)\n  await deleteGoverningDocumentRow\(document\.id\)/
  )

  const queries = code(
    "src/domains/organization-structure/application/governing-documents.queries.ts"
  )
  expect(queries).toMatch(/selectGoverningDocumentEntity\(entityId\)/)
  expect(queries).toMatch(/selectGoverningDocuments\(entityId\)/)
  expect(queries).toMatch(/name: entity\?\.name \|\| ""/)
  expect(queries).toMatch(/companyClientId: entity\?\.tenant_id \?\? null/)
})

/* --------------------------------------------------------------------------- */
/* 4. Presentación sin consultas directas a Supabase                           */
/* --------------------------------------------------------------------------- */

test("las pantallas de cuenta, administración y cliente no consultan Supabase directamente", () => {
  const presentation = [
    "src/pages/Login.tsx",
    "src/pages/Account.tsx",
    "src/pages/Admin.tsx",
    "src/pages/PlatformUsers.tsx",
    "src/modules/company-client/presentation/pages/CompanyClientUsers.tsx",
    "src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx",
    "src/pages/EntitySettingsGoverningDocuments.tsx",
    "src/components/entity-layout.tsx",
    "src/components/entity-route-wrapper.tsx",
    "src/contexts/AuthProvider.tsx",
    "src/contexts/AuthContext.ts",
  ]

  for (const file of presentation) {
    const source = code(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    expect(source, `${file} no debe invocar Edge Functions`).not.toMatch(/supabase\.functions/)
    expect(source, `${file} no debe resolver nomenclatura`).not.toMatch(/schema-target/)
    // Consumen casos de uso del dominio.
    expect(source, `${file} debe consumir el dominio`).toMatch(
      /@\/domains\/(access-control|organization-structure|company-client)/
    )
  }

  // Cada pantalla consume SU caso de uso, no una consulta propia.
  expect(code("src/pages/Login.tsx")).toMatch(/signIn\(email, password\)/)
  expect(code("src/pages/Account.tsx")).toMatch(/updateOwnProfile\(/)
  expect(code("src/pages/Account.tsx")).toMatch(/updateOwnAvatar\(/)
  expect(code("src/pages/Account.tsx")).toMatch(/passwordChangeError\(/)
  expect(code("src/pages/Account.tsx")).toMatch(/changePassword\(/)
  expect(code("src/pages/Admin.tsx")).toMatch(/loadCompanyClients\(\)/)
  expect(code("src/pages/Admin.tsx")).toMatch(/companyClientMetrics\(companyClients\)/)
  expect(code("src/pages/PlatformUsers.tsx")).toMatch(/loadPlatformUsers\(\)/)
  expect(code("src/pages/PlatformUsers.tsx")).toMatch(/loadActivePlatformRoles\(\)/)
  expect(code("src/pages/PlatformUsers.tsx")).toMatch(/createPlatformUser\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientUsers.tsx")).toMatch(/loadClientUsers\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientUsers.tsx")).toMatch(/setClientMembershipActive\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx")).toMatch(/loadClientInvitations\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx")).toMatch(/sendClientInvitation\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx")).toMatch(/cancelClientInvitation\(/)
  expect(code("src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx")).toMatch(/resendClientInvitation\(/)
  expect(code("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(/loadGoverningDocuments\(/)
  expect(code("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(/saveGoverningDocument\(/)
  expect(code("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(/removeGoverningDocument\(/)
  expect(code("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(/openGoverningDocument\(/)
  expect(code("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(/downloadGoverningDocument\(/)

  // Mensajes de usuario conservados en las pantallas migradas.
  expect(read("src/modules/company-client/presentation/pages/CompanyClientInvitations.tsx")).toMatch(
    /No se pudo enviar la invitación\./
  )
  expect(read("src/pages/EntitySettingsGoverningDocuments.tsx")).toMatch(
    /Usuario no autenticado/
  )
  expect(read("src/pages/PlatformUsers.tsx")).toMatch(/No se pudo cargar la lista de usuarios\./)
  // El mensaje de la contraseña nueva vive en la regla pura del dominio y la pantalla la usa.
  expect(code("src/domains/access-control/domain/authentication.rules.ts")).toMatch(
    /"Las contraseñas nuevas no coinciden\."/
  )
})

test("el proveedor de autenticación delega la sesión y conserva el contrato del contexto", () => {
  const provider = code("src/contexts/AuthProvider.tsx")

  // La carga inicial y los eventos de Auth aplican la MISMA identidad del dominio.
  expect(provider).toMatch(/loadSessionUser\(\)/)
  expect(provider).toMatch(/loadAuthenticatedIdentity\(sessionUser\.id\)/)
  expect(provider).toMatch(/subscribeAuthChanges\(/)
  expect(provider).toMatch(/if \(event === "SIGNED_IN" \|\| event === "INITIAL_SESSION"\)/)
  expect(provider).toMatch(/else if \(event === "SIGNED_OUT"\)/)
  // Un perfil inactivo cierra la sesión con el comando del dominio.
  expect(provider).toMatch(/if \(identity\.signedOut\) \{/)
  expect(provider).toMatch(/await signOutSession\(\)/)
  // El atajo del superadministrador se conserva en los DOS permisos.
  expect(provider).toMatch(/if \(isPlatformSuperAdmin\) return true/)
  expect(provider).toMatch(/loadPlatformPermissionSafe\(code\)/)
  expect(provider).toMatch(/loadClientPermissionSafe\(code\)/)

  // El contexto publica el mismo contrato y los mismos tipos del dominio.
  const context = code("src/contexts/AuthContext.ts")
  expect(context).toMatch(/hasPlatformPermission: \(code: string\) => Promise<boolean>/)
  expect(context).toMatch(/hasTenantPermission: \(code: string\) => Promise<boolean>/)
  expect(context).toMatch(/logout: \(\) => Promise<void>/)
  expect(context).toMatch(/user: User \| null/)
  expect(context).toMatch(/export type AuthProfile = AuthProfileRecord/)
  expect(context).toMatch(/export type AuthMembership = AuthMembershipRecord/)
})

test("ninguna pantalla, componente ni hook conserva accesos directos a Supabase", () => {
  const directories = ["src/pages", "src/components", "src/hooks", "src/contexts"]
  const offenders: string[] = []

  for (const directory of directories) {
    for (const file of sourceFiles(directory)) {
      const source = code(file)
      if (
        /@\/lib\/supabase/.test(source) ||
        /supabase\.from\(/.test(source) ||
        /supabase\.storage/.test(source) ||
        /supabase\.auth/.test(source) ||
        /supabase\.functions/.test(source) ||
        /\.rpc\(/.test(source) ||
        /schema-target/.test(source)
      ) {
        offenders.push(file)
      }
    }
  }

  expect(offenders, "la capa de presentación no debe hablar con Supabase").toEqual([])
})

/* --------------------------------------------------------------------------- */
/* 5. Fachadas retiradas y utilidades conservadas                              */
/* --------------------------------------------------------------------------- */

test("las fachadas sin consumidores se retiraron y las utilidades legítimas se conservan", () => {
  expect(existsSync("src/lib/sitecorp-account.ts")).toBe(false)
  expect(existsSync("src/lib/academic-payment.ts")).toBe(false)

  // Ninguna fachada retirada conserva importaciones.
  for (const pattern of [/@\/lib\/sitecorp-account/, /@\/lib\/academic-payment/]) {
    const offenders = sourceFiles("src").filter((file) => pattern.test(code(file)))
    expect(offenders).toEqual([])
  }

  // Las reglas y el catálogo viven ahora en el dominio de estructura organizativa.
  expect(code("src/components/entity-layout.tsx")).toMatch(
    /from "@\/domains\/organization-structure"/
  )
  expect(code("src/components/entity-route-wrapper.tsx")).toMatch(
    /from "@\/domains\/organization-structure"/
  )
  expect(code("src/domains/organization-structure/domain/organization-entities.rules.ts")).toMatch(
    /from "\.\/account\.rules"/
  )

  // La utilidad compartida del sistema documental se conserva: no es una fachada de dominio.
  expect(existsSync("src/lib/documents.ts")).toBe(true)
  expect(code("src/lib/documents.ts")).toMatch(/export function sanitizeFileName/)
})

/* --------------------------------------------------------------------------- */
/* 6. Dependencias entre dominios                                              */
/* --------------------------------------------------------------------------- */

test("la administración global no forma ciclos ni depende de la presentación", () => {
  // Se excluyen las PRUEBAS de contrato del propio dominio (`__tests__`): son artefactos de
  // verificación, no módulos del dominio, y algunas comprueban justamente que el tipo de la
  // presentación coincide con el del dominio.
  const domainFiles = sourceFiles("src/domains").filter((file) => !file.includes("/__tests__/"))

  for (const file of domainFiles) {
    const source = code(file)
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
  }

  // El dominio de control de acceso no depende de ningún otro dominio: la dependencia va en
  // un solo sentido (estructura organizativa → control de acceso cuando lo necesita).
  const accessControl = domainFiles.filter((file) => file.includes("domains/access-control"))
  for (const file of accessControl) {
    expect(code(file), `${file} no debe depender de otro dominio`).not.toMatch(/@\/domains\//)
  }

  // Las reglas de la estructura organizativa no dependen de utilidades sueltas de `src/lib`.
  const organizationDomain = domainFiles.filter((file) =>
    file.includes("domains/organization-structure/domain/")
  )
  for (const file of organizationDomain) {
    expect(code(file), `${file} no debe depender de src/lib`).not.toMatch(/@\/lib\//)
  }
})
