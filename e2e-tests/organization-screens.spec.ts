import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  buildOrganizationTree,
  isParentTypeAllowed,
  resolveEntityAncestors,
  resolveParentCandidates,
} from "../src/domains/organization-structure/domain/organization-entities.rules"
import { ENTITY_PERMISSION_LABELS } from "../src/domains/access-control/domain/permissions.catalog"
import type { OrganizationEntity } from "../src/domains/organization-structure/domain/entities"

/**
 * PANTALLAS DE ORGANIZACIÓN Y CONSOLIDACIÓN DE PERMISOS — reglas y frontera de Supabase.
 *
 * Comprueba, SIN escribir en la base de datos, lo que decide si la migración DDD de este
 * bloque se mantiene:
 *   1. Composición de la jerarquía Grupo Empresarial → Empresa → UEB (árbol y camino de
 *      entidades superiores), aislada por cliente.
 *   2. Que las pantallas migradas no consultan Supabase ni invocan RPC: consumen los casos
 *      de uso de `organization-structure`, `company-client` y `access-control`.
 *   3. Que las comprobaciones de permiso viven en UN solo sitio (`access-control`), con los
 *      mismos códigos legacy y el mismo comportamiento ante errores.
 *   4. Que las consultas de `organization_entities` y la lista de clientes están
 *      centralizadas en sus repositorios.
 *
 * Las importaciones son deliberadamente profundas (`domain/…`): las reglas son puras y no
 * arrastran el cliente de Supabase, igual que en el resto de pruebas del proyecto.
 */

const read = (path: string) => readFileSync(path, "utf8")

// ---------------------------------------------------------------------------
// Datos de ejemplo (mismos campos que las filas reales)
// ---------------------------------------------------------------------------

const entity = (id: string, over: Partial<OrganizationEntity> = {}): OrganizationEntity => ({
  id,
  tenant_id: "client-1",
  parent_id: null,
  entity_type: "business_group",
  name: `Entidad ${id}`,
  code: `GE-${id.toUpperCase()}`,
  regime_id: "PRESUPUESTADA",
  status: "active",
  description: null,
  address: null,
  municipality: null,
  province: null,
  postal_code: null,
  is_active: true,
  is_sitecorp_account: false,
  account_is_active: false,
  account_code: null,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Jerarquía Grupo Empresarial → Empresa → UEB
// ---------------------------------------------------------------------------

test("el árbol organizativo se compone por cliente y por entidad superior", () => {
  const entities = [
    entity("grupo", { name: "Grupo" }),
    entity("empresa", { parent_id: "grupo", entity_type: "company", name: "Empresa" }),
    entity("ueb", { parent_id: "empresa", entity_type: "ueb", name: "UEB" }),
    entity("grupo-2", { tenant_id: "client-2", name: "Grupo de otro cliente" }),
    // Entidad cuyo padre NO está entre las visibles: no se convierte en raíz.
    entity("huerfana", { parent_id: "desconocida", entity_type: "company" }),
  ]

  const { childrenByParent, rootsByCompanyClient } = buildOrganizationTree(entities)

  expect(rootsByCompanyClient["client-1"].map((e) => e.id)).toEqual(["grupo"])
  expect(rootsByCompanyClient["client-2"].map((e) => e.id)).toEqual(["grupo-2"])
  expect(childrenByParent["grupo"].map((e) => e.id)).toEqual(["empresa"])
  expect(childrenByParent["empresa"].map((e) => e.id)).toEqual(["ueb"])

  // La entidad huérfana no aparece como raíz de ningún cliente, igual que antes.
  expect(Object.values(rootsByCompanyClient).flat().map((e) => e.id)).not.toContain("huerfana")
})

test("el camino de entidades superiores se resuelve con los parent_id del mismo cliente", () => {
  const entities = [
    entity("grupo", { name: "Grupo" }),
    entity("empresa", { parent_id: "grupo", entity_type: "company", name: "Empresa" }),
    entity("ueb", { parent_id: "empresa", entity_type: "ueb", name: "UEB" }),
  ]

  expect(resolveEntityAncestors(entities, entities[0])).toEqual([])
  expect(resolveEntityAncestors(entities, entities[2]).map((e) => e.id)).toEqual([
    "grupo",
    "empresa",
  ])
  expect(resolveEntityAncestors(entities, null)).toEqual([])

  // Si un ancestro no está entre las visibles, el camino se corta (no se inventa un nodo).
  expect(resolveEntityAncestors([entities[2]], entities[2])).toEqual([])
})

test("la jerarquía admite Grupo → Empresa → UEB y no cambia de cliente", () => {
  expect(isParentTypeAllowed("business_group", "company")).toBe(true)
  expect(isParentTypeAllowed("company", "ueb")).toBe(true)

  // El nivel no se salta ni se repite: un grupo no cuelga de nada y una UEB no cuelga de
  // un grupo directamente.
  expect(isParentTypeAllowed("business_group", "business_group")).toBe(false)
  expect(isParentTypeAllowed("business_group", "ueb")).toBe(false)
  expect(isParentTypeAllowed("company", "company")).toBe(false)

  const entities = [
    entity("grupo-1"),
    entity("grupo-2", { tenant_id: "client-2" }),
    entity("empresa-1", { parent_id: "grupo-1", entity_type: "company" }),
    entity("empresa-2", { parent_id: "grupo-2", tenant_id: "client-2", entity_type: "company" }),
  ]

  const candidates = resolveParentCandidates({
    entities,
    editingEntity: null,
    companyClientId: "client-1",
    entityType: "company",
  })

  // Sólo las entidades del MISMO cliente pueden ser entidad superior (aislamiento).
  expect(candidates.map((e) => e.id)).toEqual(["grupo-1"])

  // Al editar se conserva la entidad superior actual aunque esté inactiva.
  const inactivo = resolveParentCandidates({
    entities: [entity("grupo-1", { is_active: false }), entities[2]],
    editingEntity: entities[2],
    companyClientId: "client-1",
    entityType: "company",
  })
  expect(inactivo.map((e) => e.id)).toEqual(["grupo-1"])
})

// ---------------------------------------------------------------------------
// 2. Las pantallas migradas no consultan Supabase
// ---------------------------------------------------------------------------

test("las pantallas de organización y de roles no consultan Supabase", () => {
  const presentation = [
    "src/pages/Organizations.tsx",
    "src/modules/organization-structure/presentation/pages/Organization.tsx",
    "src/modules/organization-structure/presentation/pages/OrganizationDetail.tsx",
    "src/modules/company-client/presentation/pages/CompanyClientRoles.tsx",
    "src/pages/RolesPermissions.tsx",
    "src/modules/organization-structure/presentation/pages/EntitySettings.tsx",
    "src/components/entity-route-wrapper.tsx",
    "src/hooks/use-entity-permissions.ts",
  ]

  for (const file of presentation) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe resolver nomenclatura`).not.toMatch(/schema-target/)
  }

  // Las pantallas consumen CASOS DE USO de los dominios.
  const organizations = read("src/pages/Organizations.tsx")
  expect(organizations).toMatch(/loadVisibleEntities/)
  expect(organizations).toMatch(/loadCompanyClients/)
  expect(organizations).toMatch(/buildOrganizationTree/)
  expect(organizations).toMatch(/deleteOrganizationEntity/)

  const organization = read("src/modules/organization-structure/presentation/pages/Organization.tsx")
  expect(organization).toMatch(/loadClientEntities/)
  expect(organization).toMatch(/loadEntityPermission/)
  expect(organization).toMatch(/deleteOrganizationEntity/)

  const detail = read("src/modules/organization-structure/presentation/pages/OrganizationDetail.tsx")
  expect(detail).toMatch(/loadOrganizationEntityDetail/)
  expect(detail).toMatch(/loadEntityUserAccess/)
  expect(detail).toMatch(/loadEntityPermission/)

  const wrapper = read("src/components/entity-route-wrapper.tsx")
  expect(wrapper).toMatch(/loadOrganizationEntity/)
  expect(wrapper).toMatch(/canViewEntity/)
  expect(wrapper).toMatch(/loadEntitySiteCorpFlag/)

  expect(read("src/modules/company-client/presentation/pages/CompanyClientRoles.tsx")).toMatch(/loadClientEntities/)
  expect(read("src/modules/organization-structure/presentation/pages/EntitySettings.tsx")).toMatch(/useEntityPermissions/)
  expect(read("src/hooks/use-entity-permissions.ts")).toMatch(/loadEntityPermissionCodes/)
  expect(read("src/pages/RolesPermissions.tsx")).toMatch(/RolesManager/)
})

// ---------------------------------------------------------------------------
// 3. Consolidación de las comprobaciones de permiso
// ---------------------------------------------------------------------------

test("las comprobaciones de permiso viven sólo en el dominio de control de acceso", () => {
  const accessRepository = read(
    "src/domains/access-control/infrastructure/entity-access.repository.ts"
  )
  expect(accessRepository).toMatch(/\.rpc\("can_access_entity", \{/)
  expect(accessRepository).toMatch(/permission_code: permissionCode/)
  expect(accessRepository).toMatch(/\.rpc\("can_view_entity", \{/)
  expect(accessRepository).toMatch(/\.rpc\("list_entity_permissions", \{/)

  // Ningún dominio mantiene ya su propio envoltorio de `can_access_entity`, ni la
  // presentación la invoca directamente.
  const sinEnvoltorioPropio = [
    "src/domains/organization-structure/infrastructure/entity-configuration.repository.ts",
    "src/domains/people/infrastructure/staffing.repository.ts",
    "src/domains/people/infrastructure/people.repository.ts",
    "src/modules/organization-structure/presentation/pages/Organization.tsx",
    "src/modules/organization-structure/presentation/pages/OrganizationDetail.tsx",
    "src/pages/Organizations.tsx",
    "src/pages/EntitySettingsDocumentTemplates.tsx",
    "src/pages/EntitySettingsDocumentTemplateDetail.tsx",
  ]

  for (const file of sinEnvoltorioPropio) {
    expect(read(file), `${file} no debe invocar can_access_entity`).not.toMatch(
      /\.rpc\("can_access_entity"/
    )
  }

  // Las dos políticas de error se conservan y sólo viven aquí: la que PROPAGA el fallo y la
  // que lo traduce a «sin permiso» (nunca a «permitido»).
  const queries = read("src/domains/access-control/application/entity-access.queries.ts")
  expect(queries).toMatch(/export async function loadEntityPermission\(/)
  expect(queries).toMatch(/export async function loadEntityPermissionSafe\(/)
  expect(queries).toMatch(/return await rpcCanAccessEntity\(entityId, permissionCode\)/)
  expect(queries).toMatch(/catch \{\s*return false/)

  // Los dominios consumen los casos de uso públicos de access-control.
  expect(read("src/domains/organization-structure/application/salary-administration.queries.ts")).toMatch(
    /loadEntityPermission\(entityId, "salary\.(view|manage)"\)/
  )
  expect(read("src/domains/people/application/people.queries.ts")).toMatch(/loadEntityPermission/)
  expect(read("src/domains/people/application/candidate-expediente.queries.ts")).toMatch(
    /loadEntityPermissionSafe/
  )

  // Sin dependencias circulares: access-control no depende de ningún otro dominio.
  const accessControlFiles = [
    "src/domains/access-control/index.ts",
    "src/domains/access-control/domain/entities.ts",
    "src/domains/access-control/domain/permissions.catalog.ts",
    "src/domains/access-control/domain/roles.rules.ts",
    "src/domains/access-control/domain/access.rules.ts",
    "src/domains/access-control/application/entity-access.queries.ts",
    "src/domains/access-control/application/entity-access.commands.ts",
    "src/domains/access-control/application/roles.queries.ts",
    "src/domains/access-control/application/roles.commands.ts",
    "src/domains/access-control/application/platform-permissions.queries.ts",
    "src/domains/access-control/infrastructure/entity-access.repository.ts",
    "src/domains/access-control/infrastructure/permissions.repository.ts",
    "src/domains/access-control/infrastructure/platform-permissions.repository.ts",
    "src/domains/access-control/infrastructure/roles.repository.ts",
  ]

  for (const file of accessControlFiles) {
    expect(read(file), `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/domains\/(organization-structure|people|company-client|contracts|representations|representatives|resolutions|entity-summary|vacations-licenses)/
    )
  }
})

test("los códigos de permiso legacy de las pantallas migradas se conservan", () => {
  const codes = [
    "organization.view",
    "organization.manage",
    "users.view",
    "users.manage",
    "users.invite",
    "roles.view",
    "roles.manage",
    "staffing.view",
    "staffing.manage",
    "salary.view",
    "salary.manage",
    "tenure_scale.view",
    "tenure_scale.manage",
    "contract_data.view",
    "contract_data.manage",
    "document_templates.view",
    "document_templates.manage",
  ]

  for (const code of codes) {
    expect(ENTITY_PERMISSION_LABELS[code], `${code} debe seguir existiendo`).toBeTruthy()
  }
})

// ---------------------------------------------------------------------------
// 4. Consultas centralizadas de entidades y de clientes
// ---------------------------------------------------------------------------

test("las consultas de organization_entities y de clientes viven en sus repositorios", () => {
  const entitiesRepository = read(
    "src/domains/organization-structure/infrastructure/organization-entities.repository.ts"
  )

  expect(entitiesRepository).toMatch(/@\/lib\/supabase/)
  expect(entitiesRepository).toMatch(/\.from\("organization_entities"\)/)
  expect(entitiesRepository).toMatch(/\.order\("name"\)/)
  // El ámbito por cliente se filtra con la nomenclatura resuelta, nunca con la clave física.
  expect(entitiesRepository).toMatch(/\.eq\(columnName\("clientId"\), clientId\)/)
  expect(entitiesRepository).toMatch(/\.eq\("parent_id", parentId\)/)
  expect(entitiesRepository).toMatch(/\.delete\(\)\.eq\("id", entityId\)/)
  // El cliente NUNCA se envía como dato de escritura en estas consultas.
  expect(entitiesRepository).not.toMatch(/company_client_id:/)

  // El dominio no compone consultas: sólo la infraestructura conoce la tabla.
  const queries = read(
    "src/domains/organization-structure/application/organization-entities.queries.ts"
  )
  expect(queries).not.toMatch(/@\/lib\/supabase/)
  expect(queries).toMatch(/resolveEntityAncestors/)

  // La lista de clientes la sirve su propio dominio.
  const clientsRepository = read(
    "src/domains/company-client/infrastructure/company-client.repository.ts"
  )
  expect(clientsRepository).toMatch(/\.from\(tableName\("clients"\)\)/)
  expect(clientsRepository).toMatch(/\.order\("name"\)/)

  const clientsQueries = read(
    "src/domains/company-client/application/company-clients.queries.ts"
  )
  expect(clientsQueries).toMatch(/loadCompanyClients/)
  expect(clientsQueries).not.toMatch(/@\/lib\/supabase/)
})

// ---------------------------------------------------------------------------
// 5. Consolidación de los permisos de PLATAFORMA
// ---------------------------------------------------------------------------

test("la consulta de permisos de plataforma también vive sólo en control de acceso", () => {
  const platformRepository = read(
    "src/domains/access-control/infrastructure/platform-permissions.repository.ts"
  )
  expect(platformRepository).toMatch(/@\/lib\/supabase/)
  expect(platformRepository).toMatch(/\.rpc\("has_platform_permission", \{/)
  // El nombre del argumento es el contrato del backend y no cambia.
  expect(platformRepository).toMatch(/permission_code: permissionCode/)

  // Las dos políticas de error de los consumidores se conservan, y sólo aquí.
  const platformQueries = read(
    "src/domains/access-control/application/platform-permissions.queries.ts"
  )
  expect(platformQueries).toMatch(/export async function loadPlatformPermission\(/)
  expect(platformQueries).toMatch(/export async function loadPlatformPermissionSafe\(/)
  expect(platformQueries).toMatch(/catch \{\s*return false/)

  // Ningún dominio ni la presentación mantienen ya su propia invocación de la RPC.
  const sinEnvoltorioPropio = [
    "src/contexts/AuthProvider.tsx",
    "src/pages/PlatformUsers.tsx",
    "src/domains/organization-structure/application/salary-administration.queries.ts",
    "src/domains/organization-structure/infrastructure/salary-administration.repository.ts",
  ]

  for (const file of sinEnvoltorioPropio) {
    expect(read(file), `${file} no debe invocar has_platform_permission`).not.toMatch(
      /rpc\("has_platform_permission"/
    )
  }

  // El contrato público de AuthContext no cambia y el atajo del superadministrador se
  // conserva: la consulta la responde el backend, que ya contempla ese privilegio.
  expect(read("src/contexts/AuthContext.ts")).toMatch(
    /hasPlatformPermission: \(code: string\) => Promise<boolean>/
  )
  const provider = read("src/contexts/AuthProvider.tsx")
  expect(provider).toMatch(/if \(isPlatformSuperAdmin\) return true/)
  expect(provider).toMatch(/loadPlatformPermissionSafe\(code\)/)

  // El consumidor que trata el fallo como error real sigue propagándolo.
  expect(
    read("src/domains/organization-structure/application/salary-administration.queries.ts")
  ).toMatch(/loadPlatformPermission\("salary\.(view|manage)"\)/)
  expect(read("src/pages/PlatformUsers.tsx")).toMatch(/loadPlatformPermission\("users\.view_all"\)/)

  // Sin ciclos: el proveedor de autenticación depende del dominio, nunca al revés.
  expect(platformRepository).not.toMatch(/@\/contexts\//)
  expect(platformQueries).not.toMatch(/@\/contexts\//)
  expect(read("src/domains/access-control/index.ts")).toMatch(/loadPlatformPermissionSafe/)
})

// ---------------------------------------------------------------------------
// 6. Hallazgo de `organization.manage` (documentado, sin corregir)
// ---------------------------------------------------------------------------

test("el hallazgo de organization.manage sigue documentado y sin corregir", () => {
  const page = read("src/modules/organization-structure/presentation/pages/Organization.tsx")

  // La comprobación sigue pasando el id del CLIENTE como id de entidad, tal como estaba.
  expect(page).toMatch(
    /loadEntityPermission\(\s*currentCompanyClientId,\s*"organization\.manage"\s*\)/
  )
  expect(page).toMatch(/HALLAZGO PENDIENTE/)

  // Y NO se ha sustituido por una autorización calculada en la interfaz.
  expect(page).not.toMatch(/has_platform_permission/)
  expect(page).not.toMatch(/@\/lib\/supabase/)
})
