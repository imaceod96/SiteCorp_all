import { supabase } from "@/lib/supabase"
import { columnName, selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import type { OrganizationEntity, OrganizationEntityRow } from "../domain/entities"

/**
 * Entidades organizativas — Repositorio (infraestructura).
 *
 * Único punto que lee y escribe `organization_entities` (Grupo Empresarial → Empresa →
 * UEB y Cuenta SiteCorp). La tabla es la misma en los dos estados de la frontera de
 * nomenclatura; lo único que cambia de nombre es la COLUMNA del cliente propietario, que
 * se resuelve con `columnName("clientId")`.
 *
 * `company_client_id` (clave JS `tenant_id`) identifica al CLIENTE y nunca debe
 * confundirse con `organization_entity_id`, que identifica a la ENTIDAD.
 *
 * Ámbito: el cliente NO se envía desde el frontend para acotar la visibilidad —lo impone
 * RLS—; cuando una lectura se filtra por cliente es porque la pantalla muestra
 * explícitamente el árbol de ESE cliente (y RLS sigue decidiendo si se ve). No se cambia
 * ningún permiso.
 */

/**
 * Proyección única de la tabla: `*` más el alias de la columna del cliente propietario.
 *
 * Se construye EN CADA CONSULTA, nunca en una constante de módulo: la frontera de
 * nomenclatura resuelve el nombre físico UNA sola vez, de forma asíncrona, antes de montar
 * la interfaz. Una constante evaluada al importar el módulo se congelaría en el estado
 * inicial (legacy) y pediría la columna antigua —`select=*,tenant_id`— que ya no existe
 * tras el renombrado, provocando un 400 de PostgREST.
 */
const entityProjection = () => selectQuery(`*, ${selectColumn("clientId")}`)

/** Todas las entidades visibles para la sesión, ordenadas por nombre. */
export async function selectVisibleEntities(): Promise<OrganizationEntity[]> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select(entityProjection())
    .order("name")

  if (error) throw error
  return (data as OrganizationEntity[] | null) || []
}

/** Entidades de un cliente concreto, ordenadas por nombre. */
export async function selectEntitiesByClient(clientId: string): Promise<OrganizationEntity[]> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select(entityProjection())
    .eq(columnName("clientId"), clientId)
    .order("name")

  if (error) throw error
  return (data as OrganizationEntity[] | null) || []
}

/**
 * Una entidad por su identificador. Se conserva la lectura UNITARIA original
 * (`.single()`): la ausencia de fila es un error del servidor y NO se convierte en un
 * resultado vacío, porque de eso depende el mensaje de las pantallas.
 */
export async function selectEntityById(entityId: string): Promise<OrganizationEntityRow> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select(entityProjection())
    .eq("id", entityId)
    .single()

  if (error) throw error
  return data as OrganizationEntityRow
}

/** Entidades hijas directas de una entidad, ordenadas por nombre. */
export async function selectChildEntities(parentId: string): Promise<OrganizationEntity[]> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select(entityProjection())
    .eq("parent_id", parentId)
    .order("name")

  if (error) throw error
  return (data as OrganizationEntity[] | null) || []
}

/**
 * Bandera de Cuenta SiteCorp de una entidad (`is_sitecorp_account`).
 *
 * La revalidación de los módulos internos es tolerante: si la lectura falla, el caso de
 * uso devuelve `null` y la pantalla no cambia de estado (igual que antes).
 */
export async function selectEntitySiteCorpFlag(entityId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select("is_sitecorp_account")
    .eq("id", entityId)
    .single()

  if (error) throw error
  return (data as { is_sitecorp_account: boolean | null } | null)?.is_sitecorp_account ?? null
}

/**
 * Alta de la entidad. El cliente propietario se fija AQUÍ y sólo aquí: proviene del
 * cliente desde el que se abre el formulario (nunca «el primero»).
 */
export async function insertOrganizationEntity(
  payload: Record<string, unknown>,
  companyClientId: string
): Promise<void> {
  const { error } = await supabase
    .from("organization_entities")
    .insert([{ ...payload, [columnName("clientId")]: companyClientId }])
    .select()
    .single()

  if (error) throw error
}

/**
 * Edición de la entidad. El cliente de la entidad NO se modifica nunca al editar:
 * es lo que mantiene el aislamiento entre clientes.
 */
export async function updateOrganizationEntity(
  entityId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("organization_entities")
    .update(payload)
    .eq("id", entityId)

  if (error) throw error
}

/** Baja definitiva de la entidad. Quién puede borrarla lo decide RLS. */
export async function deleteOrganizationEntityById(entityId: string): Promise<void> {
  const { error } = await supabase.from("organization_entities").delete().eq("id", entityId)

  if (error) throw error
}
