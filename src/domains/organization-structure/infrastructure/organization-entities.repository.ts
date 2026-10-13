import { supabase } from "@/lib/supabase"
import { columnName } from "@/integrations/supabase/schema-target"

/**
 * Entidades organizativas — Repositorio (infraestructura).
 *
 * Único punto que escribe en `organization_entities`. La tabla es la misma en los dos
 * estados de la frontera de nomenclatura; lo único que cambia de nombre es la COLUMNA
 * del cliente propietario, que se resuelve con `columnName("clientId")`.
 *
 * `company_client_id` (clave JS `tenant_id`) identifica al CLIENTE y nunca debe
 * confundirse con `organization_entity_id`, que identifica a la ENTIDAD.
 *
 * No se cambia ningún permiso: RLS sigue decidiendo quién puede crear o editar.
 */

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
