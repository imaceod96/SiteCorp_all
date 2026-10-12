import { afterEach, describe, expect, it } from "vitest"
import {
  COMPANY_CLIENT_NAMES,
  LEGACY_NAMES,
  __setSchemaTargetForTests,
  columnName,
  currentSchemaTarget,
  physicalColumns,
  rpcName,
  schemaNames,
  selectColumn,
  selectEmbed,
  tableName,
} from "../schema-target"

/**
 * La frontera de nomenclatura es el ÚNICO punto donde se decide qué nombre físico
 * viaja a PostgREST. Estos contratos fijan las dos traducciones y, muy
 * importante, que las CLAVES que consume la interfaz se mantienen en los dos
 * estados (compatibilidad decidida en la Fase 2).
 */
describe("schema-target · estado legacy (el actual de producción)", () => {
  afterEach(() => __setSchemaTargetForTests("legacy"))

  it("usa los nombres físicos actuales", () => {
    __setSchemaTargetForTests("legacy")
    expect(currentSchemaTarget()).toBe("legacy")
    expect(tableName("clients")).toBe("tenants")
    expect(tableName("memberships")).toBe("tenant_memberships")
    expect(tableName("roles")).toBe("tenant_roles")
    expect(tableName("rolePermissions")).toBe("tenant_role_permissions")
    expect(tableName("userRoles")).toBe("tenant_user_roles")
    expect(tableName("invitations")).toBe("tenant_invitations")
    expect(tableName("permissions")).toBe("tenant_permissions")
  })

  it("usa las columnas físicas actuales en filtros y escrituras", () => {
    __setSchemaTargetForTests("legacy")
    expect(columnName("clientId")).toBe("tenant_id")
    expect(columnName("membershipId")).toBe("tenant_membership_id")
    expect(columnName("roleId")).toBe("tenant_role_id")
    expect(columnName("permissionId")).toBe("tenant_permission_id")
  })

  it("usa los nombres de RPC actuales y conserva los argumentos", () => {
    __setSchemaTargetForTests("legacy")
    expect(rpcName("createClient")).toBe("create_workspace")
    expect(rpcName("deletionSummary")).toBe("workspace_deletion_summary")
    expect(rpcName("deleteClient")).toBe("delete_workspace")
    expect(rpcName("hasClientPermission")).toBe("has_tenant_permission")
  })

  it("no necesita alias en los select: la clave JS y la columna coinciden", () => {
    __setSchemaTargetForTests("legacy")
    expect(selectColumn("clientId")).toBe("tenant_id")
    expect(selectEmbed("roles", "tenant_roles")).toBe("tenant_roles")
    expect(selectEmbed("clients")).toBe("tenants")
  })
})

describe("schema-target · estado definitivo (company_client)", () => {
  afterEach(() => __setSchemaTargetForTests("legacy"))

  it("usa las tablas definitivas", () => {
    __setSchemaTargetForTests("company_client")
    expect(tableName("clients")).toBe("company_clients")
    expect(tableName("memberships")).toBe("company_client_memberships")
    expect(tableName("roles")).toBe("company_client_roles")
    expect(tableName("rolePermissions")).toBe("company_client_role_permissions")
    expect(tableName("userRoles")).toBe("company_client_user_roles")
    expect(tableName("invitations")).toBe("company_client_invitations")
    expect(tableName("permissions")).toBe("company_client_permissions")
  })

  it("usa las columnas definitivas en filtros y escrituras", () => {
    __setSchemaTargetForTests("company_client")
    expect(columnName("clientId")).toBe("company_client_id")
    expect(columnName("membershipId")).toBe("company_client_membership_id")
    expect(columnName("roleId")).toBe("company_client_role_id")
    expect(columnName("permissionId")).toBe("company_client_permission_id")
  })

  it("usa los nombres de RPC definitivos", () => {
    __setSchemaTargetForTests("company_client")
    expect(rpcName("createClient")).toBe("create_company_client")
    expect(rpcName("deletionSummary")).toBe("company_client_deletion_summary")
    expect(rpcName("deleteClient")).toBe("delete_company_client")
    expect(rpcName("hasClientPermission")).toBe("has_company_client_permission")
  })

  it("ALIASa la columna física a la clave JS que ya consume la interfaz", () => {
    __setSchemaTargetForTests("company_client")
    expect(selectColumn("clientId")).toBe("tenant_id:company_client_id")
    expect(selectColumn("membershipId")).toBe("tenant_membership_id:company_client_membership_id")
    expect(selectColumn("roleId")).toBe("tenant_role_id:company_client_role_id")
    expect(selectColumn("permissionId")).toBe("tenant_permission_id:company_client_permission_id")
  })

  it("ALIASa la tabla física del recurso embebido conservando la clave JS", () => {
    __setSchemaTargetForTests("company_client")
    expect(selectEmbed("roles", "tenant_roles")).toBe("tenant_roles:company_client_roles")
    expect(selectEmbed("clients", "tenant")).toBe("tenant:company_clients")
    expect(selectEmbed("clients")).toBe("company_clients:tenants")
  })
})

describe("schema-target · invariantes", () => {
  afterEach(() => __setSchemaTargetForTests("legacy"))

  it("las claves JS de las columnas se mantienen idénticas en los dos estados", () => {
    const jsKeysLegacy = Object.values(LEGACY_NAMES.columns)
    __setSchemaTargetForTests("company_client")
    // En el estado nuevo, cada select devuelve "<clave JS>:<columna física>".
    const aliases = physicalColumns()
    expect(Object.values(aliases)).toEqual([
      COMPANY_CLIENT_NAMES.columns.clientId,
      COMPANY_CLIENT_NAMES.columns.membershipId,
      COMPANY_CLIENT_NAMES.columns.roleId,
      COMPANY_CLIENT_NAMES.columns.permissionId,
    ])
    expect(selectColumn("clientId").split(":")[0]).toBe(jsKeysLegacy[0])
    expect(selectColumn("membershipId").split(":")[0]).toBe(jsKeysLegacy[1])
    expect(selectColumn("roleId").split(":")[0]).toBe(jsKeysLegacy[2])
    expect(selectColumn("permissionId").split(":")[0]).toBe(jsKeysLegacy[3])
  })

  it("los dos estados no comparten ningún nombre físico", () => {
    const legacy = [
      ...Object.values(LEGACY_NAMES.tables),
      ...Object.values(LEGACY_NAMES.columns),
      ...Object.values(LEGACY_NAMES.rpcs),
    ]
    const definitive = [
      ...Object.values(COMPANY_CLIENT_NAMES.tables),
      ...Object.values(COMPANY_CLIENT_NAMES.columns),
      ...Object.values(COMPANY_CLIENT_NAMES.rpcs),
    ]
    expect(legacy.some((name) => definitive.includes(name))).toBe(false)
  })

  it("el estado por defecto conserva el esquema actual (no activa nada por su cuenta)", () => {
    __setSchemaTargetForTests("legacy")
    expect(schemaNames().tables.clients).toBe("tenants")
    expect(schemaNames("company_client").tables.clients).toBe("company_clients")
  })
})
