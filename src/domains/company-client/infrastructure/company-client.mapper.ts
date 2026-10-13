/**
 * Company Client — Mapper de COMPATIBILIDAD (capa anticorrupción).
 *
 * Traduce entre la nomenclatura LEGACY (`tenant_id`) y la nomenclatura de
 * dominio (`companyClientId`) durante la transición. Es el ÚNICO punto donde
 * ambos nombres se tocan.
 *
 * Garantías (auditoría 6A):
 *   · NO consulta Supabase ni ningún servicio externo.
 *   · NO genera identificadores nuevos: la correspondencia es la IDENTIDAD.
 *   · NO crea clientes ni modifica datos: es una proyección en memoria.
 *   · NO concede permisos: el mapper NO es una capa de autorización.
 *   · El valor de `companyClientId` es SIEMPRE el mismo que el de `tenant_id`.
 *
 * Dirección de dependencia: infrastructure → domain. El dominio no importa este
 * archivo, por lo que no puede formarse ningún ciclo.
 */

import type { CompanyClient, CompanyClientId } from "../domain/entities"

/**
 * Forma LEGACY del cliente mientras exista la tabla `tenants`.
 *
 * Es el tipo que la presentación expone como `CompanyClientSummary`
 * (`src/contexts/CurrentCompanyClientContext.ts`) sin importar código de React,
 * y no añade ninguna propiedad que el esquema no tenga.
 */
export interface LegacyTenantSummary {
  id: string
  name: string
  code?: string | null
  description?: string | null
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Forma de la fila que devuelve la RPC de alta y que la pantalla de administración usa
 * como registro de trabajo (código y estado YA resueltos por el servidor).
 *
 * Se declara como especialización del contrato legacy —y no como una copia— para que el
 * compilador garantice que sigue siendo la MISMA fila física: los dos campos que la
 * interfaz necesita obligatorios son los que el backend siempre devuelve.
 */
export interface CompanyClientRecord extends LegacyTenantSummary {
  code: string
  is_active: boolean
}

/**
 * `tenant_id` legacy → `companyClientId` de dominio.
 * Correspondencia de identidad: conserva el valor tal cual.
 */
export function tenantIdToCompanyClientId(tenantId: string): CompanyClientId {
  return tenantId
}

/**
 * `companyClientId` de dominio → `tenant_id` legacy.
 * Necesario mientras las consultas operativas sigan filtrando por la columna
 * física `tenant_id`.
 */
export function companyClientIdToTenantId(companyClientId: CompanyClientId): string {
  return companyClientId
}

/**
 * Proyecta el cliente legacy al contrato de dominio.
 *
 * Mismos campos y misma semántica que el origen; los valores ausentes de las
 * propiedades opcionales se normalizan a `null`, que es el valor que la propia
 * base de datos usa para esas columnas.
 */
export function toCompanyClient(tenant: LegacyTenantSummary): CompanyClient {
  return {
    companyClientId: tenantIdToCompanyClientId(tenant.id),
    name: tenant.name,
    code: tenant.code ?? null,
    description: tenant.description ?? null,
    isActive: tenant.is_active ?? null,
    createdAt: tenant.created_at ?? null,
    updatedAt: tenant.updated_at ?? null,
  }
}
