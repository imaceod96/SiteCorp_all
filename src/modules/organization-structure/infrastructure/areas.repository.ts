import { supabase } from "@/lib/supabase"
import type { OrganizationArea, SaveAreaInput } from "../domain/entities"

/**
 * Estructura organizativa — Repositorio de áreas (infraestructura).
 *
 * Único punto que habla con Supabase para las áreas de la entidad. El código del área
 * (`AREA`, `RRHH`, …) y su unicidad los genera e impone el trigger de la base de datos:
 * aquí nunca se envía. La jerarquía se escribe como `parent_area_id`.
 *
 * El aislamiento es el de siempre: `organization_entity_id` en la consulta y RLS por
 * `company_client_id` en el backend. `company_client_id` NUNCA se envía desde el cliente.
 */

/** Áreas de la entidad, sin filtrar por estado (la vista aplica el estado que muestra). */
export async function selectEntityAreas(entityId: string): Promise<OrganizationArea[]> {
  const { data, error } = await supabase
    .from("organization_areas")
    .select("*")
    .eq("organization_entity_id", entityId)

  if (error) throw error
  return (data as OrganizationArea[]) || []
}

/** Áreas ACTIVAS de la entidad, en el orden de la estructura (selector del cargo). */
export async function selectActiveEntityAreas(entityId: string): Promise<OrganizationArea[]> {
  const { data, error } = await supabase
    .from("organization_areas")
    .select("*")
    .eq("organization_entity_id", entityId)
    .eq("is_active", true)
    .order("hierarchy_order")

  if (error) throw error
  return (data as OrganizationArea[]) || []
}

/** Alta o edición de un área. En el alta se envía la entidad y el área queda activa. */
export async function saveOrganizationArea(input: SaveAreaInput): Promise<void> {
  if (input.areaId) {
    const { error } = await supabase
      .from("organization_areas")
      .update({
        name: input.name,
        description: input.description,
        parent_area_id: input.parentAreaId,
        hierarchy_order: input.hierarchyOrder,
      })
      .eq("id", input.areaId)

    if (error) throw error
    return
  }

  const { error } = await supabase.from("organization_areas").insert({
    organization_entity_id: input.entityId,
    name: input.name,
    description: input.description,
    parent_area_id: input.parentAreaId,
    hierarchy_order: input.hierarchyOrder,
    is_active: true,
  })

  if (error) throw error
}

/**
 * Activa o desactiva un área: las áreas nunca se eliminan.
 * El backend impide desactivar un área con subáreas activas.
 */
export async function setOrganizationAreaActive(
  areaId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from("organization_areas")
    .update({ is_active: isActive })
    .eq("id", areaId)

  if (error) throw error
}
