import { supabase } from "@/lib/supabase"

/**
 * Company Client — FRONTERA ÚNICA DE NOMENCLATURA FÍSICA.
 *
 * Migración Tenant → CompanyClient (fases 2/3). El esquema de Supabase renombra
 * tablas, columnas y RPC, pero la base de datos compartida sigue con la
 * nomenclatura legacy hasta que se ejecute la ventana de la Fase 3. Este módulo
 * es el ÚNICO lugar donde se decide qué nombre físico se envía a PostgREST, de
 * modo que no existan dos fuentes de verdad.
 *
 * Estrategia (ver 20261027_99_FASE3_RUNBOOK.md):
 *   · `VITE_SCHEMA_TARGET` = `auto` (por defecto) | `legacy` | `company_client`.
 *   · En `auto` se detecta UNA vez, antes de montar la interfaz, cuál de los dos
 *     nombres conoce PostgREST. Solo uno de los dos existe en cada momento, así
 *     que la detección es determinista.
 *   · Ante cualquier duda (error de red, respuesta ambigua) se conserva el estado
 *     ACTUAL de producción (`legacy`): la aplicación nunca se "activa" contra el
 *     esquema nuevo por su cuenta.
 *
 * Límites deliberados:
 *   · No cambia ningún permiso, ni usa claves privilegiadas, ni se salta RLS:
 *     solo elige el nombre del objeto. RLS, los grants y el aislamiento por
 *     cliente se evalúan exactamente igual en los dos estados.
 *   · No genera identificadores de cliente: los UUID siguen siendo los mismos
 *     (`companyClientId === tenants.id`, identidad preservada en el renombrado).
 *   · No altera la lógica de negocio: las CLAVES de JavaScript que ya consumía la
 *     interfaz se conservan (compatibilidad decidida en la Fase 2, decisión nº 2),
 *     porque hay contratos que la propia migración SQL preserva (parámetros y
 *     columnas de salida de las RPC, claves JSON 'tenant_id'/'tenant_name').
 */

export type SchemaTarget = "legacy" | "company_client"

export type SchemaTableKey =
  | "clients"
  | "memberships"
  | "roles"
  | "rolePermissions"
  | "userRoles"
  | "invitations"
  | "permissions"

export type SchemaColumnKey = "clientId" | "membershipId" | "roleId" | "permissionId"

export type SchemaRpcKey =
  | "createClient"
  | "deletionSummary"
  | "deleteClient"
  | "hasClientPermission"

interface SchemaNames {
  tables: Record<SchemaTableKey, string>
  columns: Record<SchemaColumnKey, string>
  rpcs: Record<SchemaRpcKey, string>
}

/** Nomenclatura ACTUAL en Supabase (la que sigue viva en producción). */
export const LEGACY_NAMES: SchemaNames = {
  tables: {
    clients: "tenants",
    memberships: "tenant_memberships",
    roles: "tenant_roles",
    rolePermissions: "tenant_role_permissions",
    userRoles: "tenant_user_roles",
    invitations: "tenant_invitations",
    permissions: "tenant_permissions",
  },
  columns: {
    clientId: "tenant_id",
    membershipId: "tenant_membership_id",
    roleId: "tenant_role_id",
    permissionId: "tenant_permission_id",
  },
  rpcs: {
    createClient: "create_workspace",
    deletionSummary: "workspace_deletion_summary",
    deleteClient: "delete_workspace",
    hasClientPermission: "has_tenant_permission",
  },
}

/** Nomenclatura DEFINITIVA (resultado de la migración de la Fase 3). */
export const COMPANY_CLIENT_NAMES: SchemaNames = {
  tables: {
    clients: "company_clients",
    memberships: "company_client_memberships",
    roles: "company_client_roles",
    rolePermissions: "company_client_role_permissions",
    userRoles: "company_client_user_roles",
    invitations: "company_client_invitations",
    permissions: "company_client_permissions",
  },
  columns: {
    clientId: "company_client_id",
    membershipId: "company_client_membership_id",
    roleId: "company_client_role_id",
    permissionId: "company_client_permission_id",
  },
  rpcs: {
    createClient: "create_company_client",
    deletionSummary: "company_client_deletion_summary",
    deleteClient: "delete_company_client",
    hasClientPermission: "has_company_client_permission",
  },
}

let activeTarget: SchemaTarget = "legacy"

export function currentSchemaTarget(): SchemaTarget {
  return activeTarget
}

export function schemaNames(target: SchemaTarget = activeTarget): SchemaNames {
  return target === "company_client" ? COMPANY_CLIENT_NAMES : LEGACY_NAMES
}

/** Nombre FÍSICO de la tabla. Usar en `.from(...)`. */
export function tableName(key: SchemaTableKey): string {
  return schemaNames().tables[key]
}

/** Nombre FÍSICO de la columna. Usar en filtros (`.eq`), escrituras y `order`. */
export function columnName(key: SchemaColumnKey): string {
  return schemaNames().columns[key]
}

/** Nombre FÍSICO de la función/RPC. Usar en `.rpc(...)`. */
export function rpcName(key: SchemaRpcKey): string {
  return schemaNames().rpcs[key]
}

/**
 * Columna para un `select()`: devuelve la columna física y, en el estado legacy,
 * la ALIASa a la clave de JavaScript que la aplicación ya consume. Así la
 * interfaz lee siempre lo mismo (`tenant_id`, `tenant_membership_id`…) mientras
 * el nombre físico que viaja a PostgREST es el correcto en cada estado.
 */
export function selectColumn(key: SchemaColumnKey): string {
  const js = LEGACY_NAMES.columns[key]
  const physical = schemaNames().columns[key]
  return physical === js ? js : `${js}:${physical}`
}

/**
 * Recurso EMBEBIDO para un `select()`: mantiene la clave de JavaScript y apunta a
 * la tabla física correcta (`tenant_roles:company_client_roles(name)`).
 */
export function selectEmbed(
  key: SchemaTableKey,
  jsAlias: string = LEGACY_NAMES.tables[key],
): string {
  const physical = schemaNames().tables[key]
  return jsAlias === physical ? physical : `${jsAlias}:${physical}`
}

/** Todas las columnas físicas, para construir cargas de escritura. */
export function physicalColumns(): Record<SchemaColumnKey, string> {
  return { ...schemaNames().columns }
}

/**
 * Texto de `select()` que viaja a PostgREST.
 *
 * El cliente de Supabase analiza el TIPO del literal de `select()`: una plantilla
 * con `${…}` da error de tipos aunque funcione en runtime. Aquí se declara el
 * literal más amplio (`"*"`), que es lo único que el analizador necesita; el texto
 * real lo construye esta frontera. Los sitios de llamada declaran el tipo de sus
 * filas al consumir el resultado.
 */
export function selectQuery(text: string): "*" {
  return text as "*"
}

export type SchemaTargetSetting = SchemaTarget | "auto"

/** Ajuste explícito por entorno; si no es válido, se usa `auto`. */
export function schemaTargetSetting(): SchemaTargetSetting {
  const raw = String(import.meta.env.VITE_SCHEMA_TARGET ?? "auto")
    .trim()
    .toLowerCase()
  return raw === "legacy" || raw === "company_client" ? raw : "auto"
}

/**
 * ¿PostgREST conoce este nombre de tabla?
 *   true  → existe (aunque RLS oculte todas las filas)
 *   false → NO existe (PGRST205: «Could not find the table»)
 *   null  → respuesta ambigua (error de permiso, red…) → no se decide con esto
 */
async function tableIsKnown(name: string): Promise<boolean | null> {
  try {
    const { error } = await supabase
      .from(name)
      .select("id", { head: true, count: "exact" })
      .limit(1)

    if (!error) return true

    const code = (error as { code?: string }).code ?? ""
    if (code === "PGRST205" || /could not find the table|does not exist/i.test(error.message)) {
      return false
    }
    // P. ej. permiso denegado: el nombre EXISTE para PostgREST, pero no se puede leer.
    return null
  } catch {
    return null
  }
}

async function detectSchemaTarget(): Promise<SchemaTarget> {
  const setting = schemaTargetSetting()
  if (setting !== "auto") return setting

  const newKnown = await tableIsKnown(COMPANY_CLIENT_NAMES.tables.clients)
  if (newKnown === true) return "company_client"
  if (newKnown === false) return "legacy"

  // Ambiguo: si el nombre legacy ya NO existe, el renombrado está hecho.
  const legacyKnown = await tableIsKnown(LEGACY_NAMES.tables.clients)
  if (legacyKnown === false) return "company_client"

  console.warn(
    "[schema-target] No se pudo determinar el esquema físico; se conserva el estado actual (legacy).",
  )
  return "legacy"
}

let initPromise: Promise<SchemaTarget> | null = null

/**
 * Resuelve el esquema físico UNA sola vez y lo fija. Debe ejecutarse (y esperarse)
 * antes de montar la interfaz: así ninguna consulta sale con el nombre equivocado.
 */
export function initSchemaTarget(): Promise<SchemaTarget> {
  if (!initPromise) {
    initPromise = detectSchemaTarget().then((target) => {
      activeTarget = target
      return target
    })
  }
  return initPromise
}

/** Solo para pruebas: fija el estado sin consultar la base de datos. */
export function __setSchemaTargetForTests(target: SchemaTarget): void {
  activeTarget = target
}
