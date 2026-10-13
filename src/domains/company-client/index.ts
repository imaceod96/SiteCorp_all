/**
 * Company Client — Interfaz pública del dominio.
 *
 * Punto único de entrada para consumidores:
 *   import { toCompanyClient } from "@/domains/company-client"
 *
 * Estructura:
 *   domain/entities.ts                             → tipos y contratos
 *   domain/rules.ts                                → reglas puras (incluidos los mensajes de error)
 *   infrastructure/company-client.mapper.ts        → compatibilidad con `tenant_id`
 *   infrastructure/company-client.repository.ts    → ÚNICO acceso a `tenants` y a sus RPC
 *   application/company-clients.queries.ts         → casos de uso de lectura
 *   application/company-clients.commands.ts        → casos de uso de escritura y ciclo de vida
 *
 * Alcance: el dominio cubre el CICLO DE VIDA completo del cliente propietario — lectura
 * (unitaria y de lista), alta, edición, resumen previo al borrado y borrado definitivo con
 * confirmación. La presentación (layouts, pantalla de organización y administración de
 * clientes) consume estos casos de uso con el vocabulario de dominio.
 *
 * ADAPTADOR DE LECTURA: `LegacyTenantSummary` (la forma de la fila legacy de
 * `tenants`) es EXACTAMENTE el tipo que la presentación expone como
 * `CompanyClientSummary` (`src/contexts/CurrentCompanyClientContext.ts`), por lo
 * que `toCompanyClient(...)` acepta directamente el objeto del contexto mediante
 * compatibilidad ESTRUCTURAL y sin ningún adapter intermedio. La equivalencia es
 * una garantía del compilador: si ambas formas divergen, `tsc` falla. La ruta de
 * lectura es, por tanto: CompanyClientSummary → toCompanyClient → CompanyClient.
 * No se importa ningún contexto de React desde el dominio, y el contexto sigue
 * siendo la ÚNICA fuente de verdad del cliente activo.
 *
 * El dominio NO importa de `@/lib/*` ni de la presentación: la dependencia va en
 * un solo sentido (presentación → dominio; infrastructure → domain), por lo que
 * no puede formarse ningún ciclo.
 *
 * `getCompanyClientById` es una lectura UNITARIA y `loadCompanyClients` la lectura de
 * LISTA (ambas de solo lectura de `tenants`). Ninguna es una autorización: RLS y las RPC
 * de Supabase siguen siendo la autoridad final.
 */

/* Identificadores y contratos de dominio */
export type {
  CompanyClientId,
  CompanyClient,
  CompanyClientScope,
  CompanyClientInput,
  CompanyClientDeletionSummary,
  CompanyClientDeletionResult,
} from "./domain/entities"

/* Reglas puras (incluidos los mensajes de usuario de cada operación) */
export {
  isCompanyClientId,
  sameCompanyClient,
  companyClientNameError,
  companyClientDeletionError,
} from "./domain/rules"

/* Mapper de compatibilidad (legacy `tenant_id` ↔ `companyClientId`) */
export type { LegacyTenantSummary, CompanyClientRecord } from "./infrastructure/company-client.mapper"

export {
  tenantIdToCompanyClientId,
  companyClientIdToTenantId,
  toCompanyClient,
} from "./infrastructure/company-client.mapper"

/* Repositorio: lecturas de la tabla legacy `tenants` (el resto son de su capa de escritura) */
export { getCompanyClientById } from "./infrastructure/company-client.repository"

/* Casos de uso de lectura */
export {
  loadCompanyClients,
  loadCompanyClientDeletionSummary,
} from "./application/company-clients.queries"

/* Casos de uso de escritura y ciclo de vida */
export {
  createCompanyClient,
  updateCompanyClient,
  deleteCompanyClient,
} from "./application/company-clients.commands"
