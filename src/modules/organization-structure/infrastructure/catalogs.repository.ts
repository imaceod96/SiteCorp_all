import { supabase } from "@/lib/supabase"
import {
  type OccupationalCategory,
  type PreparationLevel,
} from "../domain/entities"

/**
 * Catálogo GLOBAL de categorías ocupacionales (Fase 11A.2).
 *
 * Común a todas las entidades y tenants: nunca se filtra por tenant ni entidad.
 * La lógica de negocio se apoya en `code` (estable), nunca en el nombre visible.
 */
export async function fetchOccupationalCategories(options?: {
  includeInactive?: boolean
}): Promise<OccupationalCategory[]> {
  let query = supabase
    .from("occupational_categories")
    .select("id, name, code, sort_order, is_active")
    .order("sort_order")
    .order("name")

  if (!options?.includeInactive) {
    query = query.eq("is_active", true)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as OccupationalCategory[]) || []
}

/** Texto único usado por la UI cuando un cargo histórico no tiene categoría. */
export const NO_OCCUPATIONAL_CATEGORY_LABEL = "Sin categoría ocupacional configurada"

export function occupationalCategoryLabel(
  category: { name: string } | null | undefined
): string {
  return category?.name?.trim() || NO_OCCUPATIONAL_CATEGORY_LABEL
}

export function hasOccupationalCategory(
  job: { occupational_category_id?: string | null } | null | undefined
): boolean {
  return !!job?.occupational_category_id
}

/**
 * Catálogo GLOBAL de niveles de preparación y su relación con los cargos.
 *
 * El nivel de preparación es configuración del CARGO (`organization_jobs`), no del
 * Puesto: puede haber varios por cargo (p. ej. «NS, TM»). La vista de Puestos sólo
 * los muestra de forma derivada, nunca se copian a `organization_positions`.
 */
export const NO_PREPARATION_LEVEL_LABEL = "Sin nivel de preparación configurado"

export async function fetchPreparationLevels(): Promise<PreparationLevel[]> {
  const { data, error } = await supabase
    .from("preparation_levels")
    .select("id, name, code, sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("code")
  if (error) throw error
  return (data as PreparationLevel[]) || []
}

/** Niveles configurados por cargo: { organization_job_id: niveles ordenados }. */
export async function fetchJobPreparationLevels(
  jobIds: string[]
): Promise<Record<string, PreparationLevel[]>> {
  if (jobIds.length === 0) return {}

  const [catalog, linksRes] = await Promise.all([
    fetchPreparationLevels(),
    supabase
      .from("organization_job_preparation_levels")
      .select("organization_job_id, preparation_level_id")
      .in("organization_job_id", jobIds),
  ])
  if (linksRes.error) throw linksRes.error

  const levelById = new Map(catalog.map((level) => [level.id, level]))
  const grouped: Record<string, PreparationLevel[]> = {}
  ;((linksRes.data as { organization_job_id: string; preparation_level_id: string }[]) || []).forEach(
    (row) => {
      const level = levelById.get(row.preparation_level_id)
      if (!level) return
      const list = grouped[row.organization_job_id] || (grouped[row.organization_job_id] = [])
      list.push(level)
    }
  )

  Object.values(grouped).forEach((list) =>
    list.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
  )
  return grouped
}

/** Etiqueta legible y única: «NS, TM». Nula si el cargo no tiene niveles. */
export function formatPreparationLevels(levels: PreparationLevel[] | undefined): string | null {
  if (!levels || levels.length === 0) return null
  return levels.map((level) => level.code).join(", ")
}
