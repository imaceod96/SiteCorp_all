import type {
  DistributionSlice,
  DistributionSummary,
  OccupancySummary,
  PlantillaSummary,
} from "./entities"

/**
 * Distribución resuelta por el modelo real:
 *   Assignment actual → Position → Cargo (job) → Área / Categoría ocupacional.
 * No existe `area_id` en Worker. Requiere plantilla + ocupación.
 *
 * Función PURA: sin acceso a Supabase.
 */
export function buildDistribution(
  plantilla: PlantillaSummary,
  occupancy: OccupancySummary
): DistributionSummary {
  const jobByPosition: Record<string, string> = {}
  plantilla.positions.forEach((p) => {
    jobByPosition[p.id] = p.job_id
  })

  const areaCounts = new Map<string, number>()
  const categoryCounts = new Map<string, number>()
  const NO_AREA = "sin-area"

  Object.entries(occupancy.occupiedByPosition).forEach(([positionId, count]) => {
    const jobId = jobByPosition[positionId]
    if (!jobId) return
    const areaId = plantilla.areaByJob[jobId] || NO_AREA
    areaCounts.set(areaId, (areaCounts.get(areaId) || 0) + count)

    const categoryId = plantilla.categoryByJob[jobId]
    if (categoryId) {
      categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + count)
    }
  })

  const toSlices = (
    counts: Map<string, number>,
    nameById: Record<string, string>,
    fallback: string
  ): DistributionSlice[] =>
    Array.from(counts.entries())
      .map(([key, value]) => ({
        key,
        label: nameById[key] || fallback,
        value,
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

  return {
    byArea: toSlices(areaCounts, plantilla.areaNameById, "Sin área"),
    byCategory: toSlices(categoryCounts, plantilla.categoryNameById, "Sin categoría"),
  }
}
