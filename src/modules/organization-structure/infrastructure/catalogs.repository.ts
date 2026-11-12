import { supabase } from "@/lib/supabase"
import {
  type EntityRegime,
  type OccupationalCategory,
  type PreparationLevel,
} from "../domain/entities"

/**
 * Catálogo GLOBAL de categorías ocupacionales (Fase 11A.2).
 *
 * Común a todas las entidades y tenants: nunca se filtra por tenant ni entidad.
 * La lógica de negocio se apoya en `code` (estable), nunca en el nombre visible.
 */
const CANONICAL_CATEGORY_SYNONYMS: Record<string, { code: string; name: string; sortOrder: number }> = {
  cuadro: { code: "CUADRO", name: "Cuadro", sortOrder: 1 },
  directivo: { code: "CUADRO", name: "Cuadro", sortOrder: 1 },
  tecnico: { code: "TECNICO", name: "Técnico", sortOrder: 2 },
  técnico: { code: "TECNICO", name: "Técnico", sortOrder: 2 },
  administrativo: { code: "ADMINISTRATIVO", name: "Administrativo", sortOrder: 3 },
  servicio: { code: "SERVICIO", name: "Servicio", sortOrder: 4 },
  servicios: { code: "SERVICIO", name: "Servicio", sortOrder: 4 },
  operario: { code: "OPERARIO", name: "Operario", sortOrder: 5 },
  obrero: { code: "OPERARIO", name: "Operario", sortOrder: 5 },
}

/**
 * Normaliza y deduplica el catálogo de categorías ocupacionales para evitar
 * duplicados o sinónimos equivalentes (Cuadro/Directivo, Operario/Obrero, Servicio/Servicios).
 */
export function deduplicateOccupationalCategories(
  rows: OccupationalCategory[]
): OccupationalCategory[] {
  const byKey = new Map<string, OccupationalCategory>()

  for (const row of rows) {
    const rawCode = (row.code ?? "").trim().toLowerCase()
    const rawName = (row.name ?? "").trim().toLowerCase()
    const canonical =
      CANONICAL_CATEGORY_SYNONYMS[rawCode] ?? CANONICAL_CATEGORY_SYNONYMS[rawName]
    const key = canonical ? canonical.code : (rawCode || rawName).toUpperCase()

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        ...row,
        code: canonical ? canonical.code : row.code,
        name: canonical ? canonical.name : row.name.trim(),
        sort_order: row.sort_order ?? canonical?.sortOrder ?? 99,
      })
    } else if (
      canonical &&
      row.name.trim().toLowerCase() === canonical.name.toLowerCase() &&
      existing.name.trim().toLowerCase() !== canonical.name.toLowerCase()
    ) {
      // Prioriza el registro cuyo nombre ya coincide con el término canónico
      byKey.set(key, {
        ...row,
        code: canonical.code,
        name: canonical.name,
        sort_order: row.sort_order ?? canonical.sortOrder,
      })
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name, "es")
  )
}

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
  return deduplicateOccupationalCategories((data as OccupationalCategory[]) || [])
}

/**
 * Catálogo GLOBAL de regímenes de entidad (`entity_regimes`).
 *
 * Es la fuente de verdad de las opciones del selector de régimen: `code` es el valor
 * canónico que se guarda y que comparan las RPC, `name` la etiqueta visible. Común a
 * todos los tenants y entidades: nunca se filtra por cliente.
 */
export async function fetchEntityRegimes(): Promise<EntityRegime[]> {
  const { data, error } = await supabase
    .from("entity_regimes")
    .select("id, name")
    .order("name")
  if (error) throw error
  return (data as EntityRegime[]) || []
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
