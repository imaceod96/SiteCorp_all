import {
  selectChildEntities,
  selectEntitiesByClient,
  selectEntityById,
  selectEntitySiteCorpFlag,
  selectVisibleEntities,
} from "../infrastructure/organization-entities.repository"
import { resolveEntityAncestors } from "../domain/organization-entities.rules"
import type { OrganizationEntity, OrganizationEntityRow } from "../domain/entities"

/**
 * Entidades organizativas — Casos de uso de lectura (aplicación).
 *
 * Las pantallas de organización (árbol de clientes, estructura del cliente, detalle de la
 * entidad y envoltorio de los módulos internos) piden aquí lo que necesitan y reciben los
 * datos YA compuestos: ninguna pantalla compone consultas ni conoce la tabla.
 *
 * Reglas que se conservan intactas:
 *   · la VISIBILIDAD la decide RLS: la lista sin filtro es «lo que el usuario puede ver»;
 *   · la lectura por identificador es UNITARIA y propaga el error del servidor, incluida
 *     la ausencia de fila;
 *   · el camino de entidades superiores se resuelve con los `parent_id` de las entidades
 *     del mismo cliente, y el detalle mantiene la comprobación de cliente activo que ya
 *     hacía la pantalla (una ayuda de navegación: la autorización real es de RLS).
 */

/** Todas las entidades visibles para la sesión, ordenadas por nombre. */
export async function loadVisibleEntities(): Promise<OrganizationEntity[]> {
  return selectVisibleEntities()
}

/** Entidades de un cliente concreto, ordenadas por nombre. */
export async function loadClientEntities(companyClientId: string): Promise<OrganizationEntity[]> {
  return selectEntitiesByClient(companyClientId)
}

/** Una entidad con la fila completa de la tabla (la consumen los módulos internos). */
export async function loadOrganizationEntity(entityId: string): Promise<OrganizationEntityRow> {
  return selectEntityById(entityId)
}

/**
 * Todo lo que la pantalla de detalle necesita de la estructura: la entidad, su camino de
 * entidades superiores, sus hijas directas y las entidades del cliente propietario (las
 * de su mismo cliente, que es con las que se puede cambiar de entidad).
 */
export interface OrganizationEntityDetail {
  entity: OrganizationEntityRow
  ancestors: OrganizationEntity[]
  children: OrganizationEntity[]
  tenantEntities: OrganizationEntity[]
}

export interface LoadOrganizationEntityDetailInput {
  entityId: string
  /** Cliente activo de la sesión (`null` cuando no hay ninguno seleccionado). */
  currentCompanyClientId: string | null | undefined
  isPlatformSuperAdmin: boolean
}

export async function loadOrganizationEntityDetail(
  input: LoadOrganizationEntityDetailInput
): Promise<OrganizationEntityDetail> {
  const { entityId, currentCompanyClientId, isPlatformSuperAdmin } = input

  const entity = await selectEntityById(entityId)

  // La entidad debe pertenecer al cliente activo. NO sustituye a RLS: es la misma
  // comprobación de navegación que ya hacía la pantalla, con su mismo mensaje.
  if (currentCompanyClientId && entity.tenant_id !== currentCompanyClientId) {
    throw new Error("No tienes permiso para acceder a esta entidad")
  }

  if (!currentCompanyClientId && !isPlatformSuperAdmin) {
    throw new Error("No tienes permiso para acceder a esta entidad")
  }

  const tenantEntities = await selectEntitiesByClient(entity.tenant_id)
  const ancestors = resolveEntityAncestors(tenantEntities, entity)
  const children = await selectChildEntities(entityId)

  return { entity, ancestors, children, tenantEntities }
}

/**
 * Bandera de Cuenta SiteCorp de una entidad. Tolerante: un fallo de la lectura devuelve
 * `null` para que la revalidación de los módulos internos no cambie de estado.
 */
export async function loadEntitySiteCorpFlag(entityId: string): Promise<boolean | null> {
  try {
    return await selectEntitySiteCorpFlag(entityId)
  } catch {
    return null
  }
}
