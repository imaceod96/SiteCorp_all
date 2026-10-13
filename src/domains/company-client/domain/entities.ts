/**
 * Company Client — Entidades y contratos de datos del dominio.
 *
 * Company Client = CLIENTE PROPIETARIO de los datos (el «workspace» actual).
 *
 * Correspondencia verificada con el esquema REAL de Supabase (auditoría 6A):
 *   · El identificador del cliente es HOY `tenants.id`, y la columna física
 *     asociada es `tenant_id` (presente en 26 tablas públicas).
 *   · `company_clients` es una tabla OBJETIVO FUTURA: todavía NO existe.
 *   · `company_client_id` NO existe como columna física: es nomenclatura de
 *     dominio, no de base de datos.
 *
 * Este dominio NO confunde Company Client con `organization_entities.entity_type = 'company'`:
 *   · Company Client → cliente propietario (tenant / workspace); se identifica con
 *     `CompanyClientId`.
 *   · 'company'      → nivel «Empresa» de la jerarquía
 *     business_group → company → ueb; se identifica con `organization_entity_id`.
 *   Son dos conceptos distintos y NO son intercambiables.
 *
 * Autoridad de seguridad: RLS y `can_access_entity`. Este dominio NO autoriza
 * nada: conocer un `CompanyClientId` no equivale a tener permiso para usarlo.
 */

/**
 * Identificador del cliente propietario.
 *
 * Es EXACTAMENTE el valor de `tenants.id` (PostgreSQL `uuid`, representado como
 * cadena). No se genera ni se transforma: se conserva literalmente.
 */
export type CompanyClientId = string

/** Cliente propietario de los datos (espejo semántico del «workspace» actual). */
export interface CompanyClient {
  companyClientId: CompanyClientId
  name: string
  code: string | null
  description: string | null
  isActive: boolean | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Ámbito de datos de UN cliente propietario.
 *
 * NOTA DE SEGURIDAD: declarar un ámbito NO concede acceso. Solo expresa a qué
 * cliente se refiere una operación; la autorización real la resuelven RLS y
 * `can_access_entity` en el backend.
 */
export interface CompanyClientScope {
  companyClientId: CompanyClientId
}

/**
 * Datos editables del cliente (alta y edición).
 *
 * El CÓDIGO no forma parte de la entrada: lo genera el servidor al crear el cliente
 * (nombre normalizado + sufijo alfanumérico único) y es INMUTABLE después — la base de
 * datos rechaza cualquier cambio con el disparador `enforce_company_client_code_immutable`.
 * Por eso nunca se envía desde el formulario ni se regenera al renombrar.
 */
export interface CompanyClientInput {
  name: string
  description?: string | null
  isActive?: boolean
}

/**
 * Resumen REAL de las consecuencias de eliminar un cliente (solo lectura).
 *
 * Lo calcula el backend con el permiso de plataforma `tenants.delete`: la interfaz NUNCA
 * inventa ni estima cifras. Las claves `tenant_id` / `tenant_name` son el CONTRATO de la
 * RPC (preservado por la migración SQL) y se conservan literales por compatibilidad.
 */
export interface CompanyClientDeletionSummary {
  tenant_id: string
  tenant_name: string
  entities: number
  workers: number
  positions: number
  candidates: number
  contracts: number
  addendums: number
  worker_documents: number
  candidate_documents: number
  document_templates: number
  roles: number
  memberships: number
  invitations: number
}

/**
 * Resultado del borrado definitivo del cliente.
 *
 * El backend autoriza, exige la confirmación por nombre y borra en una única transacción;
 * además limpia del Storage privado exclusivamente los objetos del cliente eliminado y
 * reporta los fallos parciales, que la interfaz muestra como aviso y NUNCA oculta.
 */
export interface CompanyClientDeletionResult {
  status: "DELETED"
  tenant_id: string
  tenant_name: string | null
  summary: CompanyClientDeletionSummary | null
  storage: { removed: number; failed: number; failures?: string[] }
}
