import { test, expect } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import {
  friendlyRoleSaveError,
  isProtectedRole,
  permissionGroupsFor,
  selectablePermissionsFor,
} from "../src/domains/access-control/domain/roles.rules"
import {
  ACCESS_SCOPE_LABELS,
  INVITATION_VALIDITY_DAYS,
  RESTRICTED_ROLE_LABEL,
  accessDisplayName,
  accessRoleLabel,
  accessRowsByOwnership,
  accessUsername,
  friendlyAccessError,
  invitationExpiresAt,
  membershipLabel,
} from "../src/domains/access-control/domain/access.rules"
import {
  ENTITY_PERMISSION_LABELS,
  LEGACY_PERMISSION_PATTERN,
  entityPermissionLabel,
  groupEntityPermissions,
  groupPlatformPermissions,
  isInternalPermissionCode,
  platformPermissionLabel,
} from "../src/domains/access-control/domain/permissions.catalog"
import {
  ENTITY_TYPE_OPTIONS,
  REGIME_OPTIONS,
  buildOrganizationEntityPayload,
  describeEntityError,
  generateEntityCode,
  isParentTypeAllowed,
  resolveParentCandidates,
} from "../src/domains/organization-structure/domain/organization-entities.rules"
import {
  EMPTY_TENURE_FORM,
  formatTenureRange,
  tenureFormToValues,
  tenureRangeToForm,
} from "../src/domains/organization-structure/domain/tenure-scale.rules"
import {
  academicCategoryLabel,
  formatAcademicAmount,
  parseAcademicAmount,
  resolveAcademicCategory,
} from "../src/domains/organization-structure/domain/academic-payment.rules"
import type {
  OrganizationEntity,
  OrganizationEntityFormData,
} from "../src/domains/organization-structure/domain/entities"
import type {
  EntityAccessRow,
  PermissionOption,
  RoleRecord,
} from "../src/domains/access-control/domain/entities"

/**
 * CONTROL DE ACCESO Y CONFIGURACIÓN DE ENTIDAD — reglas, contratos de RPC y frontera de
 * Supabase.
 *
 * Comprueba, SIN escribir en la base de datos, lo que decide si la migración DDD de este
 * bloque se mantiene:
 *   1. Creación y edición de roles (ámbito, protección de los roles del sistema, errores).
 *   2. Asignación y revocación de permisos (catálogo ofrecible y RPC reales).
 *   3. Usuarios con distintos niveles de acceso (permisos efectivos y visibilidad).
 *   4. Aislamiento entre CompanyClients.
 *   5. Jerarquía y asociación de entidades (Grupo → Empresa → UEB y Cuenta SiteCorp).
 *   6. Datos contractuales, escala de antigüedad y pago por categoría académica.
 *   7. Conservación de los contratos de RPC y ausencia de cambios en el esquema.
 *   8. Ausencia de consultas directas a Supabase en los componentes migrados.
 *
 * Las importaciones son deliberadamente profundas (`domain/…`): las reglas son puras y no
 * arrastran el cliente de Supabase, igual que en el resto de pruebas del proyecto.
 */

const read = (path: string) => readFileSync(path, "utf8")

// ---------------------------------------------------------------------------
// Datos de ejemplo (mismos campos que las filas reales)
// ---------------------------------------------------------------------------

const role = (over: Partial<RoleRecord> = {}): RoleRecord => ({
  id: "role-1",
  name: "Operador",
  description: null,
  is_system_role: false,
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
  permissionIds: [],
  permissionCodes: [],
  assignedUserCount: 0,
  organizationEntityId: "entity-1",
  ...over,
})

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

const formData = (over: Partial<OrganizationEntityFormData> = {}): OrganizationEntityFormData => ({
  name: "Nueva entidad",
  entity_type: "business_group",
  regime_id: "PRESUPUESTADA",
  is_active: true,
  description: null,
  is_sitecorp_account: false,
  account_code: null,
  parent_id: null,
  ...over,
})

const accessRow = (over: Partial<EntityAccessRow> = {}): EntityAccessRow => ({
  access_id: "access-1",
  tenant_membership_id: "membership-1",
  user_id: "user-1",
  full_name: "Ana Pérez",
  username: "ana",
  profile_is_active: true,
  tenant_role_id: "role-1",
  role_name: "Operador",
  source_entity_id: "entity-1",
  source_entity_name: "Casa Matriz",
  access_scope: "SELF",
  is_direct: true,
  ...over,
})

// ---------------------------------------------------------------------------
// 1. Creación y edición de roles
// ---------------------------------------------------------------------------

test("la creación y la edición de roles validan el nombre y protegen los roles del sistema", () => {
  // El nombre es obligatorio: la precondición es del dominio y el mensaje no cambia.
  expect(friendlyRoleSaveError("organization", new Error("Role name is required"))).toBe(
    "El nombre del rol es obligatorio."
  )

  // El ámbito forma parte del mensaje: un mismo fallo se explica distinto en cada nivel.
  expect(
    friendlyRoleSaveError("organization", new Error("duplicate key value violates unique constraint"))
  ).toBe("Ya existe un rol de la entidad con ese nombre en este ámbito.")
  expect(friendlyRoleSaveError("platform", new Error("23505"))).toBe(
    "Ya existe un rol de plataforma con ese nombre en este ámbito."
  )

  // Un rol del sistema protegido no puede degradarse, y el backend lo impone.
  expect(
    friendlyRoleSaveError("organization", new Error("The system role Administrador is protected"))
  ).toBe(
    "El rol Administrador es un rol del sistema protegido: no puede modificarse, desactivarse ni eliminarse."
  )
  expect(
    friendlyRoleSaveError("organization", new Error("system organization role permissions cannot be reduced"))
  ).toBe("Los permisos del rol Administrador no pueden reducirse ni cambiarse.")
  expect(friendlyRoleSaveError("platform", new Error("superadmin permissions cannot be reduced"))).toBe(
    "Los permisos reservados de SuperAdmin no pueden reducirse ni cambiarse."
  )
  expect(friendlyRoleSaveError("organization", new Error("System role names cannot be changed"))).toBe(
    "El nombre de un rol del sistema no puede cambiarse."
  )
  expect(friendlyRoleSaveError("platform", new Error("Reserved system role name"))).toBe(
    "SuperAdmin es un nombre reservado y no puede usarse en un rol personalizado."
  )

  // Un rol de OTRA entidad no se puede editar desde aquí.
  expect(friendlyRoleSaveError("organization", new Error("Role was not found in this entity"))).toBe(
    "El rol indicado no pertenece a esta entidad."
  )

  // Borrado: nunca se elimina un rol con usuarios o invitaciones asignadas.
  expect(
    friendlyRoleSaveError("organization", new Error("A role assigned to users or invitations cannot be deleted"))
  ).toBe("El rol no puede eliminarse: tiene usuarios o invitaciones asignadas, o es un rol del sistema.")

  // Los permisos sólo pueden ser internos (nivel 2) o de plataforma (nivel 1).
  expect(friendlyRoleSaveError("organization", new Error("Permissions are invalid"))).toBe(
    "Uno o más permisos seleccionados no son válidos."
  )
  expect(friendlyRoleSaveError("organization", new Error("Not internal entity permissions"))).toBe(
    "Sólo puedes asignar permisos internos de entidad. Los permisos de plataforma no están disponibles aquí."
  )
  expect(friendlyRoleSaveError("platform", new Error("Only assign platform permissions"))).toBe(
    "Solo puedes asignar permisos de plataforma que actualmente posees."
  )

  // Sin permiso: RLS/permiso denegado se traduce a un mensaje entendible por ámbito.
  expect(friendlyRoleSaveError("organization", new Error("permission denied for table tenant_roles"))).toBe(
    "Necesitas el permiso «Gestionar roles y permisos» dentro de esta entidad."
  )
  expect(friendlyRoleSaveError("platform", new Error("new row violates row-level security policy"))).toBe(
    "No tienes permiso para gestionar roles de plataforma."
  )
})

test("los roles del sistema quedan protegidos en los dos ámbitos", () => {
  // En una entidad, el rol del sistema (Administrador) está protegido.
  expect(isProtectedRole(role({ is_system_role: true, name: "Administrador" }))).toBe(true)

  // En plataforma, TODOS los roles del sistema están protegidos, no sólo SuperAdmin.
  expect(isProtectedRole(role({ is_system_role: true, name: "SuperAdmin" }))).toBe(true)
  expect(isProtectedRole(role({ is_system_role: true, name: "OtroSistema" }))).toBe(true)

  // Un rol personalizado nunca está protegido.
  expect(isProtectedRole(role())).toBe(false)
  expect(isProtectedRole(role({ is_system_role: false, name: "SuperAdmin" }))).toBe(false)
  expect(isProtectedRole(null)).toBe(false)
})

// ---------------------------------------------------------------------------
// 2. Asignación y revocación de permisos
// ---------------------------------------------------------------------------

test("el catálogo ofrecible no mezcla permisos internos con permisos de plataforma", () => {
  const permissions: PermissionOption[] = [
    { id: "p1", code: "users.manage", description: null, is_platform_scope: false },
    {
      id: "p2",
      code: "tenants.view",
      description: null,
      category: "CLIENTES",
      is_platform_scope: true,
    },
    { id: "p3", code: "areas.view", description: null, is_platform_scope: false },
    { id: "p4", code: "salary.view_global", description: null, is_platform_scope: false },
    { id: "p5", code: "roles.view", description: null, is_platform_scope: false },
  ]

  // Nivel 2 (entidad): sólo permisos internos VIGENTES. Los legacy no se ofrecen
  // (el catálogo real lo define la base de datos; aquí sólo se excluye lo retirado).
  expect(selectablePermissionsFor("organization", permissions).map((p) => p.code)).toEqual([
    "users.manage",
    "tenants.view",
    "roles.view",
  ])

  // Nivel 1 (plataforma): sólo el catálogo de plataforma.
  expect(selectablePermissionsFor("platform", permissions).map((p) => p.code)).toEqual(["tenants.view"])

  // Los códigos legacy siguen siendo contratos válidos en la base de datos.
  expect(LEGACY_PERMISSION_PATTERN.test("areas.view")).toBe(true)
  expect(LEGACY_PERMISSION_PATTERN.test("jobs.manage")).toBe(true)
  expect(LEGACY_PERMISSION_PATTERN.test("tenant_roles.view")).toBe(true)
  expect(LEGACY_PERMISSION_PATTERN.test("salary.view_global")).toBe(true)
  expect(LEGACY_PERMISSION_PATTERN.test("salary.view_empresarial")).toBe(true)
  expect(isInternalPermissionCode("users.manage")).toBe(true)
  expect(isInternalPermissionCode("areas.view")).toBe(false)

  // Los códigos que gobiernan este bloque conservan su etiqueta y su grupo.
  for (const code of [
    "users.view",
    "users.manage",
    "users.invite",
    "roles.view",
    "roles.manage",
    "contract_data.view",
    "contract_data.manage",
    "representatives.view",
    "tenure_scale.view",
    "tenure_scale.manage",
  ]) {
    expect(ENTITY_PERMISSION_LABELS[code], `${code} debe conservar su etiqueta`).toBeTruthy()
  }
  expect(entityPermissionLabel({ code: "contract_data.manage" })).toBe("Gestionar datos contractuales")
  expect(entityPermissionLabel({ code: "users.invite" })).toBe("Invitar usuarios")
  expect(platformPermissionLabel({ code: "tenants.view", description: null })).toBe("Ver clientes")

  // Agrupación: los permisos no catalogados nunca se pierden.
  const groups = groupEntityPermissions([{ id: "x", code: "nuevo.view", description: null }])
  const other = groups[groups.length - 1]
  expect(other.title).toBe("OTROS PERMISOS INTERNOS")
  expect(other.codes).toEqual(["nuevo.view"])

  // Agrupación de plataforma: sólo lo marcado como de plataforma, por categoría del catálogo.
  const platformGroups = groupPlatformPermissions([
    { id: "s1", code: "tenants.view", description: null, category: "CLIENTES", is_platform_scope: true },
    { id: "s2", code: "users.manage", description: null, category: "USUARIOS", is_platform_scope: false },
  ])
  expect(platformGroups.map((g) => g.title)).toEqual(["CLIENTES"])
  expect(platformGroups[0].codes).toEqual(["tenants.view"])

  // Los grupos ofrecibles dependen del ámbito, nunca de una lista escrita en la interfaz.
  expect(permissionGroupsFor("organization", permissions).some((g) => g.title === "USUARIOS")).toBe(true)
  expect(permissionGroupsFor("platform", permissions).map((g) => g.title)).toEqual(["CLIENTES"])
})

test("el guardado y el borrado de roles usan las RPC reales con sus parámetros", () => {
  const repository = read("src/domains/access-control/infrastructure/roles.repository.ts")

  // Nivel 1: plataforma. Nivel 2: SIEMPRE con la entidad propietaria del rol.
  expect(repository).toMatch(/\.rpc\("save_platform_role", \{/)
  expect(repository).toMatch(/p_role_id: input\.roleId,/)
  expect(repository).toMatch(/p_name: input\.name,/)
  expect(repository).toMatch(/p_description: input\.description,/)
  expect(repository).toMatch(/p_is_active: input\.isActive,/)
  expect(repository).toMatch(/p_permission_ids: input\.permissionIds,/)
  expect(repository).toMatch(/\.rpc\("save_entity_role", \{/)
  expect(repository).toMatch(/p_entity_id: input\.organizationEntityId,/)

  // El borrado de un rol interno nunca se hace con un DELETE directo: pasa por la RPC.
  expect(repository).toMatch(/\.rpc\("delete_entity_role", \{ p_role_id: input\.roleId \}\)/)
  expect(repository).toMatch(/\.from\("platform_roles"\)\.delete\(\)\.eq\("id", input\.roleId\)/)

  // Los roles de una entidad se leen SIEMPRE acotados a esa entidad.
  expect(repository).toMatch(/\.eq\("organization_entity_id", organizationEntityId as string\)/)

  // La asignación de permisos a roles se resuelve con la frontera de nomenclatura.
  expect(repository).toMatch(/tableName\("rolePermissions"\)/)
  expect(repository).toMatch(/selectColumn\("roleId"\)/)
  expect(repository).toMatch(/selectColumn\("permissionId"\)/)
  expect(repository).toMatch(/\.in\(columnName\("roleId"\), roleIds\)/)

  // Los usuarios asignados cuentan los accesos vigentes y la tabla legacy de roles.
  expect(repository).toMatch(/\.from\("entity_user_access"\)/)
  expect(repository).toMatch(/tableName\("userRoles"\)/)
  expect(repository).toMatch(/roleId: row\.tenant_role_id, userId: row\.tenant_membership_id/)

  // El caso de uso no habla con Supabase y no duplica la consulta.
  const queries = read("src/domains/access-control/application/roles.queries.ts")
  const commands = read("src/domains/access-control/application/roles.commands.ts")
  for (const source of [queries, commands]) {
    expect(source).not.toMatch(/@\/lib\/supabase/)
    expect(source).not.toMatch(/\.rpc\(/)
    expect(source).not.toMatch(/supabase\.from\(/)
  }
  expect(commands).toMatch(/if \(!input\.name\.trim\(\)\)/)
  // La matriz de permisos se pide SÓLO si el solicitante puede consultarla.
  expect(queries).toMatch(/selectRoleScopeRows\(input\.scope, input\.organizationEntityId, \{/)
  expect(queries).toMatch(/includePermissionMatrix: canReadPermissionMatrix/)
  expect(queries).toMatch(/loadPlatformPermissionSafe\("platform_roles\.manage"\)/)
})

// ---------------------------------------------------------------------------
// 3. Usuarios con diferentes niveles de acceso
// ---------------------------------------------------------------------------

test("los distintos niveles de acceso se deciden por permisos efectivos, nunca por la interfaz", () => {
  // Sin `users.manage` no hay gestión; sin `users.invite` no hay invitación.
  const queries = read("src/domains/access-control/application/entity-access.queries.ts")
  expect(queries).toMatch(/rpcCanAccessEntity\(input\.entityId, "users\.manage"\)\.catch\(\(\) => false\)/)
  expect(queries).toMatch(/rpcCanAccessEntity\(input\.entityId, "users\.invite"\)\.catch\(\(\) => false\)/)
  expect(queries).toMatch(/rpcCanAccessEntity\(entityId, "users\.manage"\)\.catch\(\(\) => false\)/)

  // La pantalla de sólo lectura de usuarios pregunta por el permiso real.
  const overview = read("src/pages/EntitySettingsUsers.tsx")
  expect(overview).toMatch(/loadEntityAccessOverview/)
  expect(overview).not.toMatch(/@\/lib\/supabase/)
  expect(overview).not.toMatch(/\.rpc\(/)

  // La pantalla de roles exige el permiso de GESTIÓN de roles (`roles.manage`): no existe
  // una vía de consulta independiente, así que `roles.view` NO habilita la pantalla.
  const rolesPage = read("src/pages/EntitySettingsRoles.tsx")
  expect(rolesPage).toMatch(/loadEntityPermission\(entityId, "roles\.manage"\)/)
  expect(rolesPage).not.toMatch(/"roles\.view"/)
  expect(rolesPage).not.toMatch(/@\/lib\/supabase/)
  expect(rolesPage).not.toMatch(/\.rpc\(/)

  // Los permisos se preguntan al backend con la RPC real y sus parámetros.
  const repository = read("src/domains/access-control/infrastructure/entity-access.repository.ts")
  expect(repository).toMatch(/\.rpc\("can_access_entity", \{/)
  expect(repository).toMatch(/target_entity_id: entityId,/)
  expect(repository).toMatch(/permission_code: permissionCode,/)
  expect(repository).toMatch(/\.rpc\("list_entity_user_access", \{/)
  expect(repository).toMatch(/target_entity_id: entityId,/)

  // La visibilidad de usuarios la decide el backend: la interfaz no filtra por usuario.
  const dialog = read("src/components/entity-users-dialog.tsx")
  expect(dialog).toMatch(/loadEntityAccessWorkspace/)
  expect(dialog).toMatch(/assignEntityAccess/)
  expect(dialog).toMatch(/deactivateEntityAccess/)
  expect(dialog).toMatch(/inviteToEntity/)
  expect(dialog).not.toMatch(/@\/lib\/supabase/)
})

test("los roles ajenos sólo se muestran a quien puede gestionarlos", () => {
  // El backend enmascara el rol (`null`); la interfaz distingue «oculto» de «sin rol».
  expect(accessRoleLabel(accessRow())).toBe("Operador")
  expect(accessRoleLabel(accessRow({ role_name: null }))).toBe(RESTRICTED_ROLE_LABEL)
  expect(RESTRICTED_ROLE_LABEL).toBe("Restringido")

  // Las tres superficies que listan accesos usan la etiqueta del dominio, no el dato crudo.
  for (const file of [
    "src/components/entity-users-dialog.tsx",
    "src/pages/EntitySettingsUsers.tsx",
    "src/pages/OrganizationDetail.tsx",
  ]) {
    const source = read(file)
    expect(source, `${file} debe etiquetar el rol con la regla del dominio`).toMatch(/accessRoleLabel\(/)
    expect(source, `${file} no debe imprimir el rol en crudo`).not.toMatch(/role_name\}/)
  }

  // El contrato de la fila admite el rol oculto (lo decide `list_entity_user_access`).
  const entities = read("src/domains/access-control/domain/entities.ts")
  expect(entities).toMatch(/tenant_role_id: string \| null/)
  expect(entities).toMatch(/role_name: string \| null/)

  // La consulta de USUARIOS se conserva: `users.view` sigue habilitando el listado.
  expect(read("src/pages/EntitySettingsUsers.tsx")).toMatch(/loadEntityAccessOverview/)

  // El registro SQL de la fase documenta el enmascaramiento y su reversión real.
    const record = read("docs/fase-2-definiciones-sql.md")
    expect(record).toMatch(/can_view_entity_user_access/)
    expect(record).toMatch(/entity_user_access_select/)
    expect(record).toMatch(/NO recuperables/i)
  
    // Las INVITACIONES siguen la misma regla: el rol de una invitación ajena llega enmascarado
    // desde el backend y el identificador del rol no es alcanzable sin gestión de roles, porque
    // la tabla NO se lee de forma directa.
    const invitationRepository = read(
      "src/domains/access-control/infrastructure/client-access.repository.ts"
    )
    expect(invitationRepository).toMatch(/\.rpc\("list_company_client_invitations", \{/)
    expect(invitationRepository).toMatch(/p_company_client_id: companyClientId,/)
    expect(invitationRepository).not.toMatch(/company_client_role_id/)
    expect(read("src/domains/access-control/application/client-access.queries.ts")).toMatch(
      /role_name: accessRoleLabel\(invitation\)/
    )
    // La consulta de invitaciones se conserva para todos los perfiles del ámbito.
    expect(record).toMatch(/list_company_client_invitations/)
    expect(record).toMatch(/can_view_invitation_role/)
    expect(record).toMatch(/company_client_invitations_select/)
  })

test("el reparto de accesos y los mensajes de error de usuarios se conservan", () => {
  // Un acceso DIRECTO y otro HEREDADO nunca se mezclan en la interfaz.
  const rows = [
    accessRow({ access_id: "a1", is_direct: true }),
    accessRow({ access_id: "a2", is_direct: false, source_entity_name: "Casa Matriz" }),
  ]
  const { direct, inherited } = accessRowsByOwnership(rows)
  expect(direct.map((r) => r.access_id)).toEqual(["a1"])
  expect(inherited.map((r) => r.access_id)).toEqual(["a2"])

  // El alcance se etiqueta igual que antes.
  expect(ACCESS_SCOPE_LABELS.SELF).toBe("Solo esta entidad")
  expect(ACCESS_SCOPE_LABELS.SELF_AND_DESCENDANTS).toBe("Esta entidad y sus descendientes")

  // El nombre mostrado cae al perfil y, si no hay, a un valor neutro (nunca vacío).
  expect(accessDisplayName(accessRow(), undefined)).toBe("Ana Pérez")
  expect(accessDisplayName(accessRow({ full_name: null }), undefined)).toBe("Usuario")
  expect(accessDisplayName(accessRow({ full_name: null }), { id: "user-1", full_name: "Luis", username: "luis", is_active: true })).toBe("Luis")
  expect(accessUsername(accessRow({ username: null }), undefined)).toBe("sin usuario")
  expect(membershipLabel({ id: "m1", user_id: "user-9" }, undefined)).toBe("user-9")

  // Errores de escritura: mismos textos, sin exponer detalles internos.
  expect(friendlyAccessError(new Error("duplicate key value violates unique constraint"), "fallback")).toBe(
    "Ya existe una asignación idéntica para este usuario, entidad y rol."
  )
  expect(friendlyAccessError(new Error("new row violates row-level security policy"), "fallback")).toBe(
    "No tienes permiso para realizar esta acción en esta entidad."
  )
  expect(friendlyAccessError(new Error("role must belong to the same organization entity"), "fallback")).toBe(
    "El rol seleccionado no pertenece a esta entidad. Selecciona un rol interno de esta entidad."
  )
  expect(friendlyAccessError(new Error("entity invitations require an organization role"), "fallback")).toBe(
    "Las invitaciones desde una entidad requieren un rol interno de esa entidad."
  )
  expect(friendlyAccessError(new Error("missing permission users.manage"), "fallback")).toBe(
    "Necesitas permiso para gestionar usuarios en esta entidad."
  )
  expect(friendlyAccessError(new Error("missing permission users.invite"), "fallback")).toBe(
    "Necesitas permiso para invitar usuarios en esta entidad."
  )
  expect(friendlyAccessError(new Error("otro fallo"), "No se pudo cargar.")).toBe("otro fallo")
  // Un valor sin mensaje (cadena vacía) usa el texto de respaldo de la operación.
  expect(friendlyAccessError(new Error(""), "No se pudo cargar.")).toBe("No se pudo cargar.")
  expect(friendlyAccessError("", "No se pudo cargar.")).toBe("No se pudo cargar.")

  // La vigencia de la invitación sigue siendo de una semana, calculada en un solo sitio.
  expect(INVITATION_VALIDITY_DAYS).toBe(7)
  const from = new Date("2024-03-01T00:00:00.000Z")
  expect(invitationExpiresAt(from)).toBe("2024-03-08T00:00:00.000Z")
})

// ---------------------------------------------------------------------------
// 4. Aislamiento entre CompanyClients
// ---------------------------------------------------------------------------

test("las membresías y las invitaciones se acotan SIEMPRE al cliente de la entidad", () => {
  const repository = read("src/domains/access-control/infrastructure/entity-access.repository.ts")

  // Membresías del cliente: la columna física la resuelve la frontera de nomenclatura.
  expect(repository).toMatch(/tableName\("memberships"\)/)
  expect(repository).toMatch(/selectQuery\(`id,user_id,\$\{selectColumn\("clientId"\)\},is_active`\)/)
  expect(repository).toMatch(/\.eq\(columnName\("clientId"\), clientId\)/)
  expect(repository).toMatch(/\.eq\("is_active", true\)/)

  // Los roles asignables son los PROPIOS de la entidad (nunca los de otra entidad).
  expect(repository).toMatch(/tableName\("roles"\)/)
  expect(repository).toMatch(/\.eq\("organization_entity_id", entityId\)/)

  // La invitación fija el cliente propietario Y la entidad: no se deduce «el primero».
  expect(repository).toMatch(/tableName\("invitations"\)/)
  expect(repository).toMatch(/\[columnName\("clientId"\)\]: input\.clientId,/)
  expect(repository).toMatch(/organization_entity_id: input\.entityId,/)
  expect(repository).toMatch(/status: "pending",/)

  // El acceso directo se crea con su membresía, su entidad y su rol.
  expect(repository).toMatch(/\[columnName\("membershipId"\)\]: input\.membershipId,/)
  expect(repository).toMatch(/\[columnName\("roleId"\)\]: input\.roleId,/)
  expect(repository).toMatch(/assigned_by: input\.assignedBy,/)

  // Revocar un acceso es desactivarlo: el histórico no se borra.
  expect(repository).toMatch(/\.update\(\{ is_active: false \}\)/)

  // El diálogo usa la entidad del contexto y su cliente; nunca un cliente fijo.
  const dialog = read("src/components/entity-users-dialog.tsx")
  expect(dialog).toMatch(/clientId: entity\.tenant_id/)
  expect(dialog).not.toMatch(/company_client_id:/)
})

// ---------------------------------------------------------------------------
// 5. Jerarquía y asociación de entidades
// ---------------------------------------------------------------------------

test("la jerarquía de entidades admite sólo la entidad superior coherente del MISMO cliente", () => {
  const entities = [
    entity("grupo-1"),
    entity("grupo-ajeno", { tenant_id: "client-2", name: "Grupo de otro cliente" }),
    entity("empresa-1", { entity_type: "company", parent_id: "grupo-1", name: "Empresa 1" }),
    entity("empresa-2", { entity_type: "company", parent_id: "grupo-1", name: "Empresa 2" }),
    entity("empresa-inactiva", { entity_type: "company", parent_id: "grupo-1", is_active: false }),
    entity("ueb-1", { entity_type: "ueb", parent_id: "empresa-1" }),
  ]

  // Un Grupo Empresarial no tiene entidad superior.
  expect(isParentTypeAllowed("business_group", "business_group")).toBe(false)
  expect(isParentTypeAllowed("business_group", "company")).toBe(true)
  expect(isParentTypeAllowed("company", "company")).toBe(false)
  expect(isParentTypeAllowed("company", "ueb")).toBe(true)

  // Al crear una Empresa sólo se ofrecen grupos ACTIVOS del mismo cliente.
  expect(
    resolveParentCandidates({
      entities,
      editingEntity: null,
      companyClientId: "client-1",
      entityType: "company",
    }).map((e) => e.id)
  ).toEqual(["grupo-1"])

  // Un grupo empresarial nunca es candidato (la jerarquía no se puede invertir).
  expect(
    resolveParentCandidates({
      entities,
      editingEntity: null,
      companyClientId: "client-1",
      entityType: "business_group",
    })
  ).toEqual([])

  // Al crear una UEB sólo se ofrecen empresas del mismo cliente.
  expect(
    resolveParentCandidates({
      entities,
      editingEntity: null,
      companyClientId: "client-1",
      entityType: "ueb",
    }).map((e) => e.id)
  ).toEqual(["empresa-1", "empresa-2"])

  // Al editar, la entidad superior actual sigue visible aunque esté inactiva.
  expect(
    resolveParentCandidates({
      entities,
      editingEntity: entity("hija", { entity_type: "ueb", parent_id: "empresa-inactiva" }),
      companyClientId: "client-1",
      entityType: "ueb",
    }).map((e) => e.id)
  ).toEqual(["empresa-inactiva", "empresa-1", "empresa-2"])

  // La propia entidad editada nunca es candidata a ser su propia superior.
  expect(
    resolveParentCandidates({
      entities,
      editingEntity: entities[0],
      companyClientId: "client-1",
      entityType: "company",
    }).map((e) => e.id)
  ).not.toContain("grupo-1")
})

test("el alta y la edición de entidades conservan código, jerarquía y Cuenta SiteCorp", () => {
  // Código autogenerado por tipo.
  expect(generateEntityCode("business_group")).toMatch(/^GE-[0-9A-Z]{6}$/)
  expect(generateEntityCode("company")).toMatch(/^EMP-[0-9A-Z]{6}$/)
  expect(generateEntityCode("ueb")).toMatch(/^UEB-[0-9A-Z]{6}$/)

  // Alta: estado inicial activo, sin entidad superior si es Grupo Empresarial.
  const created = buildOrganizationEntityPayload({
    data: formData({ entity_type: "business_group", parent_id: "no-debe-usarse" }),
    editingEntity: null,
  })
  expect(created.parent_id).toBeNull()
  expect(created.code).toMatch(/^GE-[0-9A-Z]{6}$/)
  expect(created.is_sitecorp_account).toBe(false)
  expect(created.account_code).toBeNull()
  expect(created.account_is_active).toBe(false)

  // Alta con Cuenta SiteCorp: el código de cuenta se deriva del código interno.
  const withAccount = buildOrganizationEntityPayload({
    data: formData({ is_sitecorp_account: true, entity_type: "company", parent_id: "grupo-1" }),
    editingEntity: null,
  })
  expect(withAccount.account_code).toBe(`CUENTA-${String(withAccount.code).toUpperCase()}`)
  expect(withAccount.account_is_active).toBe(true)
  expect(withAccount.parent_id).toBe("grupo-1")

  // Edición: el código interno y el de la cuenta NO se regeneran (operación idempotente).
  const editing = entity("empresa-1", {
    entity_type: "company",
    code: "EMP-ABC123",
    is_sitecorp_account: true,
    account_code: "CUENTA-EMP-ABC123",
    account_is_active: true,
    parent_id: "grupo-1",
  })
  const updated = buildOrganizationEntityPayload({
    data: formData({
      entity_type: "company",
      parent_id: "grupo-1",
      is_sitecorp_account: true,
    }),
    editingEntity: editing,
  })
  expect(updated.code).toBe("EMP-ABC123")
  expect(updated.account_code).toBe("CUENTA-EMP-ABC123")
  expect(updated.account_is_active).toBe(true)

  // Desactivar la Cuenta SiteCorp desactiva también su cuenta.
  const deactivated = buildOrganizationEntityPayload({
    data: formData({ entity_type: "company", parent_id: "grupo-1", is_sitecorp_account: false }),
    editingEntity: editing,
  })
  expect(deactivated.is_sitecorp_account).toBe(false)
  expect(deactivated.account_code).toBeNull()
  expect(deactivated.account_is_active).toBe(false)

  // El cliente propietario NO viaja en la carga: lo añade el repositorio sólo al crear.
  expect(created).not.toHaveProperty("company_client_id")
  expect(created).not.toHaveProperty("tenant_id")

  // Las opciones de tipo y régimen no cambian.
  expect(ENTITY_TYPE_OPTIONS.map((o) => o.value)).toEqual(["business_group", "company", "ueb"])
  expect(REGIME_OPTIONS.map((o) => o.value)).toEqual(["PRESUPUESTADA", "EMPRESARIAL"])

  // Los errores del backend se siguen explicando sin exponer detalles internos.
  expect(describeEntityError({ code: "23503" })).toBe(
    "El cliente o la entidad superior seleccionada no es válida."
  )
  expect(describeEntityError({ code: "23505" })).toBe(
    "Ya existe una entidad con ese nombre en este cliente."
  )
  expect(describeEntityError({ code: "23514", message: "parent type mismatch" })).toBe(
    "La entidad superior no es válida para este tipo de entidad."
  )
  expect(describeEntityError({ code: "42501" })).toBe(
    "No tienes permiso para crear o editar entidades en este cliente."
  )
  expect(describeEntityError({ code: "PGRST204" })).toBe(
    "La estructura del formulario no coincide con la base de datos. Contacta al administrador."
  )
  expect(describeEntityError({ message: "" })).toBe("No se pudo guardar la entidad.")
})

test("la entidad se asocia al cliente actual al crear y NUNCA se reasigna al editar", () => {
  const repository = read(
    "src/domains/organization-structure/infrastructure/organization-entities.repository.ts"
  )

  // El alta fija la columna física del cliente con la frontera de nomenclatura.
  expect(repository).toMatch(/\.from\("organization_entities"\)/)
  expect(repository).toMatch(/\[columnName\("clientId"\)\]: companyClientId/)

  // La edición no toca el cliente: es lo que mantiene el aislamiento entre clientes.
  const updateBlock = repository.slice(repository.indexOf("export async function updateOrganizationEntity"))
  expect(updateBlock).not.toMatch(/columnName\("clientId"\)/)
  expect(updateBlock).not.toMatch(/companyClientId/)

  // El comando exige un cliente al crear y no lo envía al editar.
  const commands = read(
    "src/domains/organization-structure/application/organization-entities.commands.ts"
  )
  expect(commands).toMatch(/if \(!editingEntity && !companyClientId\)/)
  expect(commands).toMatch(/insertOrganizationEntity\(payload, companyClientId\)/)
  expect(commands).not.toMatch(/@\/lib\/supabase/)

  // El diálogo consume el caso de uso y no habla con Supabase.
  const dialog = read("src/components/organization-entity-dialog.tsx")
  expect(dialog).toMatch(/saveOrganizationEntity/)
  expect(dialog).toMatch(/resolveParentCandidates/)
  expect(dialog).toMatch(/describeEntityError/)
  expect(dialog).not.toMatch(/@\/lib\/supabase/)
  expect(dialog).not.toMatch(/supabase\.from\(/)
  expect(dialog).not.toMatch(/\.rpc\(/)
})

// ---------------------------------------------------------------------------
// 6. Datos contractuales, escalas y pago académico
// ---------------------------------------------------------------------------

test("la escala de antigüedad convierte meses y años sin perder tramos ni validaciones", () => {
  const range = {
    id: "r1",
    from_months: 24,
    to_months: 36,
    amount: 1500,
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }

  // 24 meses se editan como «2 años» y vuelven a guardarse como 24 meses.
  const form = tenureRangeToForm(range)
  expect(form.from_amount).toBe("2")
  expect(form.from_unit).toBe("Años")
  expect(form.to_amount).toBe("3")
  expect(form.to_unit).toBe("Años")
  expect(form.to_limit).toBe(false)
  expect(tenureFormToValues(form)).toEqual({
    values: { from_months: 24, to_months: 36, amount: 1500 },
    error: null,
  })

  // Un tramo abierto («en adelante») se conserva como to_months = null.
  const openForm = tenureRangeToForm({ ...range, to_months: null })
  expect(openForm.to_limit).toBe(true)
  expect(openForm.to_amount).toBe("")
  expect(tenureFormToValues(openForm).values).toEqual({
    from_months: 24,
    to_months: null,
    amount: 1500,
  })

  // El formulario vacío es un tramo nuevo sin datos.
  expect(EMPTY_TENURE_FORM).toEqual({
    from_amount: "",
    from_unit: "Meses",
    to_amount: "",
    to_unit: "Meses",
    to_limit: false,
    amount: "",
  })

  // Validaciones: los mismos mensajes, en el mismo orden.
  expect(
    tenureFormToValues({ ...EMPTY_TENURE_FORM, from_amount: "-1", amount: "10" }).error
  ).toBe("El valor 'Desde' debe ser un número válido positivo")
  expect(
    tenureFormToValues({
      ...EMPTY_TENURE_FORM,
      from_amount: "10",
      to_amount: "-2",
      amount: "10",
    }).error
  ).toBe("El valor 'Hasta' debe ser un número válido positivo")
  expect(
    tenureFormToValues({
      ...EMPTY_TENURE_FORM,
      from_amount: "10",
      to_amount: "5",
      amount: "10",
    }).error
  ).toBe("El valor 'Hasta' debe ser mayor que 'Desde'")
  expect(
    tenureFormToValues({ ...EMPTY_TENURE_FORM, from_amount: "10", amount: "-1" }).error
  ).toBe("El importe debe ser un número válido positivo o cero")
  expect(
    tenureFormToValues({ ...EMPTY_TENURE_FORM, from_amount: "10", amount: "" }).error
  ).toBe("El importe debe ser un número válido positivo o cero")
  // Un importe 0 es válido (configurado sin pago); un «Hasta» vacío sigue siendo abierto.
  expect(tenureFormToValues({ ...EMPTY_TENURE_FORM, from_amount: "0", amount: "0" }).values).toEqual({
    from_months: 0,
    to_months: null,
    amount: 0,
  })

  // Etiquetas legibles.
  expect(formatTenureRange(range)).toBe("2 años a 3 años")
  expect(formatTenureRange({ ...range, from_months: 5, to_months: 11 })).toBe("5 meses a 11 meses")
  expect(formatTenureRange({ ...range, to_months: null })).toBe("2 años en adelante")
  expect(formatTenureRange({ ...range, from_months: 1, to_months: 12 })).toBe("1 mes a 1 año")
})

test("los tramos de antigüedad se leen y se desactivan sin salir del dominio", () => {
  const repository = read(
    "src/domains/organization-structure/infrastructure/tenure-scale.repository.ts"
  )

  expect(repository).toMatch(/\.from\("tenure_payment_scales"\)/)
  expect(repository).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(repository).toMatch(/\.eq\("is_active", true\)/)
  expect(repository).toMatch(/\.order\("from_months"\)/)
  // Un tramo se DESACTIVA: el histórico salarial no pierde la escala vigente.
  expect(repository).toMatch(/\.update\(\{ is_active: false \}\)/)
  expect(repository).not.toMatch(/\.delete\(\)/)

  // La pantalla consume los casos de uso y no habla con Supabase.
  const page = read("src/pages/EntitySettingsTenureScale.tsx")
  expect(page).toMatch(/loadTenureScaleRanges/)
  expect(page).toMatch(/createTenureScaleRange/)
  expect(page).toMatch(/updateTenureScaleRangeById/)
  expect(page).toMatch(/deleteTenureScaleRange/)
  expect(page).not.toMatch(/@\/lib\/supabase/)
  expect(page).not.toMatch(/supabase\.from\(/)

  // Esta pantalla NO añade comprobaciones de permisos que antes no existían.
  expect(page).not.toMatch(/can_access_entity/)
  expect(repository).not.toMatch(/can_access_entity/)

  // La conversión y las validaciones no se duplican en la interfaz.
  expect(page).not.toMatch(/parseFloat/)
})

test("el pago por categoría académica conserva su regla y sus RPC", () => {
  // Doctor tiene prioridad sobre Máster y nunca se suman.
  expect(resolveAcademicCategory(true, true)).toBe("DOCTOR")
  expect(resolveAcademicCategory(true, false)).toBe("MASTER")
  expect(resolveAcademicCategory(false, false)).toBeNull()
  expect(academicCategoryLabel("DOCTOR")).toBe("Doctor")
  expect(academicCategoryLabel("MASTER")).toBe("Máster")
  expect(academicCategoryLabel(null)).toBe("Sin categoría académica")

  // Vacío = NO CONFIGURADO; 0 es un valor válido; lo negativo o no numérico es inválido.
  expect(parseAcademicAmount("")).toEqual({ valid: true, value: null })
  expect(parseAcademicAmount("0")).toEqual({ valid: true, value: 0 })
  expect(parseAcademicAmount("1234,5")).toEqual({ valid: true, value: 1234.5 })
  expect(parseAcademicAmount("-1")).toEqual({ valid: false })
  expect(parseAcademicAmount("abc")).toEqual({ valid: false })
  expect(formatAcademicAmount(null)).toBe("No configurado")
  // Un 0 configurado se muestra como importe (nunca como «No configurado»).
  expect(formatAcademicAmount(0)).toMatch(/CUP$/)
  expect(formatAcademicAmount(0)).not.toBe("No configurado")

  const repository = read(
    "src/domains/organization-structure/infrastructure/academic-payment.repository.ts"
  )
  expect(repository).toMatch(/\.rpc\("get_academic_category_payment_config", \{/)
  expect(repository).toMatch(/\.rpc\("save_academic_category_payment", \{/)
  expect(repository).toMatch(/p_category: category,/)
  expect(repository).toMatch(/p_amount: amount,/)
  expect(repository).toMatch(/\.rpc\("resolve_academic_category_payment", \{/)
  expect(repository).toMatch(/p_worker_id: workerId,/)
  expect(repository).toMatch(/\.rpc\("resolve_academic_category_payment_for_flags", \{/)
  expect(repository).toMatch(/p_has_masters: hasMastersDegree \?\? false,/)
  expect(repository).toMatch(/p_has_doctorate: hasDoctorateDegree \?\? false,/)
  // Sin fallback EMPRESARIAL → PRESUPUESTADA: el alcance lo decide el backend.
  expect(repository).toMatch(/row\.scope === "PRESUPUESTADA_GLOBAL"/)

  // Los dos importes se guardan en el orden de la pantalla (Máster y después Doctor).
  const commands = read(
    "src/domains/organization-structure/application/academic-payment.commands.ts"
  )
  expect(commands).toMatch(/saveAcademicCategoryPayment\(input\.entityId, "MASTER", input\.masterAmount\)/)
  expect(commands).toMatch(/saveAcademicCategoryPayment\(input\.entityId, "DOCTOR", input\.doctorAmount\)/)
  expect(commands).not.toMatch(/@\/lib\/supabase/)

  // La sección consume el dominio y conserva sus mensajes.
  const section = read("src/components/settings/AcademicCategoryPaymentSection.tsx")
  expect(section).toMatch(/loadAcademicCategoryPaymentConfig/)
  expect(section).toMatch(/saveAcademicCategoryPaymentAmounts/)
  expect(section).toMatch(/parseAcademicAmount/)
  expect(section).toMatch(/El importe de Máster debe ser un número mayor o igual que 0/)
  expect(section).toMatch(/El importe de Doctor debe ser un número mayor o igual que 0/)
  expect(section).not.toMatch(/@\/lib\/supabase/)
  expect(section).not.toMatch(/\.rpc\(/)

  // La fachada de compatibilidad se retiró: ya no queda ningún consumidor y el único lugar
  // donde vive el pago académico es el dominio de estructura organizativa.
  expect(existsSync("src/lib/academic-payment.ts")).toBe(false)

  const workerDetail = read("src/pages/WorkerDetail.tsx")
  expect(workerDetail).toMatch(/from "@\/domains\/organization-structure"/)
  expect(workerDetail).toMatch(/loadAcademicCategoryPayment\(entityId, workerId\)/)
  expect(workerDetail).not.toMatch(/@\/lib\/academic-payment/)
  expect(workerDetail).not.toMatch(/@\/lib\/supabase/)
  expect(workerDetail).not.toMatch(/supabase\.from\(/)
})

test("los datos contractuales y los cargos de representación no consultan Supabase desde la pantalla", () => {
  const queries = read("src/domains/representatives/application/entity-contract-data.queries.ts")

  // Los dos permisos que gobiernan la pantalla se preguntan al backend.
  expect(queries).toMatch(/loadEntityPermission\(entityId, "contract_data\.view"\)/)
  expect(queries).toMatch(/loadEntityPermission\(entityId, "contract_data\.manage"\)/)
  // Sin ninguno de los dos no se consulta NADA: la pantalla queda bloqueada.
  expect(queries).toMatch(/if \(!canView && !canManage\) return null/)
  expect(queries).not.toMatch(/@\/lib\/supabase/)

  const repository = read("src/domains/representatives/infrastructure/representatives.repository.ts")
  // El listado ADMINISTRATIVO incluye los cargos inactivos (no filtra por is_active).
  const listBlock = repository.slice(
    repository.indexOf("export async function fetchRepresentativePositionList"),
    repository.indexOf("export async function fetchRepresentativeHistory")
  )
  expect(listBlock).toMatch(/\.from\("organization_representative_positions"\)/)
  expect(listBlock).toMatch(/\.select\("id, title, display_order, is_active"\)/)
  expect(listBlock).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(listBlock).toMatch(/\.order\("display_order"\)/)
  expect(listBlock).not.toMatch(/is_active", true/)
  // La persona vigente la resuelve SIEMPRE el backend, nunca `effective_to IS NULL`.
  expect(repository).toMatch(/\.rpc\("resolve_entity_representatives", \{/)
  expect(repository).not.toMatch(/is\("effective_to", null\)/)
  // Los datos contractuales se escriben con la RPC que exige el permiso.
  expect(repository).toMatch(/\.rpc\("save_entity_contract_data", \{/)

  const page = read("src/pages/EntitySettingsContractData.tsx")
  expect(page).toMatch(/loadEntityContractDataWorkspace/)
  expect(page).toMatch(/No tiene permiso para ver los datos contractuales de esta entidad\./)
  expect(page).not.toMatch(/@\/lib\/supabase/)
  expect(page).not.toMatch(/supabase\.from\(/)
  expect(page).not.toMatch(/\.rpc\(/)
})

// ---------------------------------------------------------------------------
// 7. Contratos de RPC conservados y esquema intacto
// ---------------------------------------------------------------------------

test("las RPC de este bloque conservan su nombre y sus parámetros", () => {
  const contracts: Array<[string, RegExp[]]> = [
    [
      "src/domains/access-control/infrastructure/entity-access.repository.ts",
      [
        /\.rpc\("can_access_entity", \{/,
        /target_entity_id: entityId,/,
        /permission_code: permissionCode,/,
        /\.rpc\("list_entity_user_access", \{/,
      ],
    ],
    [
          "src/domains/access-control/infrastructure/roles.repository.ts",
          [
            /\.rpc\("save_platform_role", \{/,
            /\.rpc\("save_entity_role", \{/,
            /\.rpc\("delete_entity_role", \{ p_role_id: input\.roleId \}\)/,
          ],
        ],
        [
          "src/domains/access-control/infrastructure/client-access.repository.ts",
          [
            /\.rpc\("list_company_client_invitations", \{/,
            /p_company_client_id: companyClientId,/,
          ],
        ],
        [
          "src/domains/organization-structure/infrastructure/academic-payment.repository.ts",
      [
        /\.rpc\("get_academic_category_payment_config", \{/,
        /\.rpc\("save_academic_category_payment", \{/,
        /\.rpc\("resolve_academic_category_payment", \{/,
        /\.rpc\("resolve_academic_category_payment_for_flags", \{/,
      ],
    ],
    [
      "src/domains/representatives/infrastructure/representatives.repository.ts",
      [
        /\.rpc\("resolve_entity_representatives", \{/,
        /\.rpc\("save_entity_contract_data", \{/,
        /\.rpc\("create_representative_position", \{/,
        /\.rpc\("set_entity_representative", \{/,
        /\.rpc\("update_representative_position", \{/,
      ],
    ],
  ]

  for (const [file, patterns] of contracts) {
    const source = read(file)
    for (const pattern of patterns) {
      expect(source, `${file} debe conservar ${pattern}`).toMatch(pattern)
    }
  }

  // Ninguna RPC se renombra ni se inventa: las usadas son las que ya existían.
  const allRepositories = [
    "src/domains/access-control/infrastructure/entity-access.repository.ts",
    "src/domains/access-control/infrastructure/roles.repository.ts",
    "src/domains/access-control/infrastructure/permissions.repository.ts",
        "src/domains/organization-structure/infrastructure/academic-payment.repository.ts",
        "src/domains/representatives/infrastructure/representatives.repository.ts",
        "src/domains/access-control/infrastructure/client-access.repository.ts",
      ]
      const knownRpcs = new Set([
        "can_access_entity",
        // Consulta de invitaciones de un cliente con el rol enmascarado en el backend.
        "list_company_client_invitations",
        // Estas dos comprobaciones ya existían en el backend y las usaba la aplicación
    // (estructura organizativa y módulos internos): la consolidación las traslada al
    // único envoltorio de control de acceso sin cambiar sus parámetros.
    "can_view_entity",
    "list_entity_permissions",
    "list_entity_user_access",
    "save_platform_role",
    "save_entity_role",
    "delete_entity_role",
    "get_academic_category_payment_config",
    "save_academic_category_payment",
    "resolve_academic_category_payment",
    "resolve_academic_category_payment_for_flags",
    "resolve_entity_representatives",
    "save_entity_contract_data",
    "create_representative_position",
    "set_entity_representative",
    "update_representative_position",
  ])

  for (const file of allRepositories) {
    const source = read(file)
    for (const match of source.matchAll(/\.rpc\("([^"]+)"/g)) {
      expect(knownRpcs.has(match[1]), `${file} invoca una RPC no verificada: ${match[1]}`).toBe(true)
    }
  }
})

test("este bloque no modifica el esquema ni crea mecanismos alternativos de autorización", () => {
  const files = [
    "src/domains/access-control/infrastructure/entity-access.repository.ts",
    "src/domains/access-control/infrastructure/roles.repository.ts",
    "src/domains/access-control/infrastructure/permissions.repository.ts",
    "src/domains/access-control/application/entity-access.queries.ts",
    "src/domains/access-control/application/entity-access.commands.ts",
    "src/domains/access-control/application/roles.queries.ts",
    "src/domains/access-control/application/roles.commands.ts",
    "src/domains/organization-structure/infrastructure/organization-entities.repository.ts",
    "src/domains/organization-structure/infrastructure/tenure-scale.repository.ts",
    "src/domains/organization-structure/infrastructure/academic-payment.repository.ts",
    "src/domains/representatives/application/entity-contract-data.queries.ts",
  ]

  for (const file of files) {
    const source = read(file)
    // Sin DDL ni cambios de políticas: la base de datos no se toca desde la aplicación.
    expect(source, `${file} no debe contener DDL`).not.toMatch(/create policy/i)
    expect(source, `${file} no debe contener DDL`).not.toMatch(/alter table/i)
    expect(source, `${file} no debe contener DDL`).not.toMatch(/create table/i)
    expect(source, `${file} no debe usar el service role`).not.toMatch(/SERVICE_ROLE/i)
    // La autorización no se reimplementa en el cliente.
    expect(source, `${file} no debe reimplementar permisos`).not.toMatch(/is_superadmin/i)
  }
})

// ---------------------------------------------------------------------------
// 8. Presentación sin consultas directas a Supabase
// ---------------------------------------------------------------------------

test("los componentes y pantallas migrados no consultan Supabase directamente", () => {
  const presentation = [
    "src/components/organization-entity-dialog.tsx",
    "src/components/roles-manager.tsx",
    "src/components/entity-users-dialog.tsx",
    "src/components/settings/AcademicCategoryPaymentSection.tsx",
    "src/pages/EntitySettingsUsers.tsx",
    "src/pages/EntitySettingsRoles.tsx",
    "src/pages/EntitySettingsContractData.tsx",
    "src/pages/EntitySettingsTenureScale.tsx",
  ]

  for (const file of presentation) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    // Consumen casos de uso del dominio.
    expect(source, `${file} debe consumir el dominio`).toMatch(
      /@\/domains\/(access-control|organization-structure|representatives)/
    )
  }

  // Cada pantalla consume SU caso de uso, no una consulta propia.
  expect(read("src/components/roles-manager.tsx")).toMatch(/loadRoleScopeWorkspace/)
  expect(read("src/components/roles-manager.tsx")).toMatch(/saveRole as saveRoleCommand/)
  expect(read("src/components/roles-manager.tsx")).toMatch(/deleteRole as deleteRoleCommand/)
  expect(read("src/components/roles-manager.tsx")).toMatch(/friendlyRoleSaveError/)
  expect(read("src/components/roles-manager.tsx")).toMatch(/isProtectedRole as isProtectedRoleRule/)
  expect(read("src/components/entity-users-dialog.tsx")).toMatch(/loadEntityAccessWorkspace/)
  expect(read("src/pages/EntitySettingsUsers.tsx")).toMatch(/loadEntityAccessOverview/)
  expect(read("src/pages/EntitySettingsRoles.tsx")).toMatch(/loadEntityPermission/)
  expect(read("src/pages/EntitySettingsContractData.tsx")).toMatch(/loadEntityContractDataWorkspace/)
  expect(read("src/pages/EntitySettingsTenureScale.tsx")).toMatch(/loadTenureScaleRanges/)
  expect(read("src/components/organization-entity-dialog.tsx")).toMatch(/saveOrganizationEntity/)
})

test("el dominio de control de acceso no depende de la presentación ni de otros dominios", () => {
  const domainFiles = [
    "src/domains/access-control/domain/entities.ts",
    "src/domains/access-control/domain/permissions.catalog.ts",
    "src/domains/access-control/domain/roles.rules.ts",
    "src/domains/access-control/domain/access.rules.ts",
    "src/domains/access-control/application/entity-access.queries.ts",
    "src/domains/access-control/application/entity-access.commands.ts",
    "src/domains/access-control/application/roles.queries.ts",
    "src/domains/access-control/application/roles.commands.ts",
    "src/domains/access-control/application/platform-permissions.queries.ts",
  ]

  for (const file of domainFiles) {
    const source = read(file)
    // Sin dependencias circulares: el dominio no importa de la presentación ni de otros dominios.
    expect(source, `${file} no debe importar componentes`).not.toMatch(/@\/components\//)
    expect(source, `${file} no debe importar páginas`).not.toMatch(/@\/pages\//)
    expect(source, `${file} no debe importar otro dominio`).not.toMatch(
      /@\/domains\/(?!access-control)/
    )
  }

  // Las reglas puras no arrastran el cliente de Supabase.
  for (const file of domainFiles.filter((f) => f.includes("/domain/"))) {
    expect(read(file), `${file} debe ser puro`).not.toMatch(/@\/lib\/supabase/)
  }

  // La infraestructura es el ÚNICO punto que habla con Supabase.
  const infrastructure = [
    "src/domains/access-control/infrastructure/entity-access.repository.ts",
    "src/domains/access-control/infrastructure/roles.repository.ts",
    "src/domains/access-control/infrastructure/permissions.repository.ts",
    "src/domains/access-control/infrastructure/platform-permissions.repository.ts",
  ]
  for (const file of infrastructure) {
    expect(read(file), `${file} es la frontera de Supabase`).toMatch(/@\/lib\/supabase/)
  }
})
