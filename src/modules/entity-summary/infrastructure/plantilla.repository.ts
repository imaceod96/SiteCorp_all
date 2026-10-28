import { supabase } from "@/lib/supabase"
import type { PlantillaSummary, PositionRef } from "../domain/entities"

/** Plantilla autorizada: requiere `staffing.view` o `staffing.manage`. */
export async function fetchPlantillaSummary(entityIds: string[]): Promise<PlantillaSummary> {
  const { data: positionsData, error: positionsError } = await supabase
    .from("organization_positions")
    .select("id, job_id, authorized_quantity")
    .in("organization_entity_id", entityIds)
    .eq("is_active", true)
  if (positionsError) throw positionsError

  const positions = (positionsData as PositionRef[]) || []
  const authorized = positions.reduce((sum, p) => sum + (p.authorized_quantity || 0), 0)

  const empty: PlantillaSummary = {
    authorized,
    positionsTotal: positions.length,
    positions,
    areaByJob: {},
    categoryByJob: {},
    areaNameById: {},
    categoryNameById: {},
  }
  if (positions.length === 0) return empty

  const jobIds = Array.from(new Set(positions.map((p) => p.job_id)))
  const { data: jobsData, error: jobsError } = await supabase
    .from("organization_jobs")
    .select("id, area_id, occupational_category_id")
    .in("id", jobIds)
  if (jobsError) throw jobsError

  const jobs = (jobsData as {
    id: string
    area_id: string | null
    occupational_category_id: string | null
  }[]) || []

  const areaByJob: Record<string, string | null> = {}
  const categoryByJob: Record<string, string | null> = {}
  const areaIds = new Set<string>()
  const categoryIds = new Set<string>()
  jobs.forEach((job) => {
    areaByJob[job.id] = job.area_id
    categoryByJob[job.id] = job.occupational_category_id
    if (job.area_id) areaIds.add(job.area_id)
    if (job.occupational_category_id) categoryIds.add(job.occupational_category_id)
  })

  const areaNameById: Record<string, string> = {}
  const categoryNameById: Record<string, string> = {}

  if (areaIds.size > 0) {
    const { data: areasData, error: areasError } = await supabase
      .from("organization_areas")
      .select("id, name")
      .in("id", Array.from(areaIds))
    if (areasError) throw areasError
    ;(areasData as { id: string; name: string }[] | null)?.forEach((a) => {
      areaNameById[a.id] = a.name
    })
  }

  if (categoryIds.size > 0) {
    const { data: categoriesData, error: categoriesError } = await supabase
      .from("occupational_categories")
      .select("id, name")
      .in("id", Array.from(categoryIds))
    if (categoriesError) throw categoriesError
    ;(categoriesData as { id: string; name: string }[] | null)?.forEach((c) => {
      categoryNameById[c.id] = c.name
    })
  }

  return {
    authorized,
    positionsTotal: positions.length,
    positions,
    areaByJob,
    categoryByJob,
    areaNameById,
    categoryNameById,
  }
}
