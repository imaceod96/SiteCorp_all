import { supabase } from "@/lib/supabase"

/**
 * Estructura organizativa — Repositorio de puestos (infraestructura).
 *
 * Lecturas del puesto con su jerarquía (Área → Cargo → Puesto) que necesitan las pantallas
 * del expediente para mostrar dónde se ubica una persona sin componer la consulta.
 *
 * La consulta, el `select` embebido y los valores por defecto son EXACTAMENTE los que ya
 * usaba la aplicación.
 */

/** Ubicación de un puesto en la estructura: nombre del área y del cargo. */
export interface PositionHierarchyEntry {
  area: string
  job: string
}

interface PositionHierarchyArea {
  name: string | null
}

interface PositionHierarchyJob {
  name: string | null
  area: PositionHierarchyArea | PositionHierarchyArea[] | null
}

interface PositionHierarchyRow {
  id: string
  job: PositionHierarchyJob | PositionHierarchyJob[] | null
}

/** Jerarquía (área y cargo) de TODOS los puestos de la entidad, por puesto. */
export async function fetchEntityPositionHierarchy(
  entityId: string
): Promise<Record<string, PositionHierarchyEntry>> {
  const { data, error } = await supabase
    .from("organization_positions")
    .select("id,job:organization_jobs(name,area:organization_areas(name))")
    .eq("organization_entity_id", entityId)
  if (error) throw error

  const hierarchy: Record<string, PositionHierarchyEntry> = {}
  for (const item of (data || []) as PositionHierarchyRow[]) {
    const job = Array.isArray(item.job) ? item.job[0] : item.job
    const area = Array.isArray(job?.area) ? job.area[0] : job?.area
    hierarchy[item.id] = { area: area?.name || "—", job: job?.name || "—" }
  }
  return hierarchy
}
