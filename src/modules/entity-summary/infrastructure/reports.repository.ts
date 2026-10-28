import { supabase } from "@/lib/supabase"
import type {
  CatalogRefs,
  EducationLevelReport,
  ReportSlice,
  SexReport,
  SkinColorReport,
  WorkersByAgeData,
} from "../domain/entities"
import {
  AGE_BUCKETS,
  NO_INFO_KEY,
  ageBucketKey,
  ageFromBirthDate,
  countsToSlices,
  type AgeBucketKey,
} from "../domain/rules"

/**
 * Módulos de informes demográficos del Resumen (pestaña Reportes).
 *
 * NOTA: postgREST no soporta GROUP BY. Los informes descargan el campo a agrupar
 * (una sola columna) de los trabajadores activos del ámbito y agregan en el
 * cliente. Nunca se trae la fila completa ni se usa `array.length` como total.
 */

/** Carga una sola vez los catálogos de referencia globales (nombre real, no código). */
export async function fetchCatalogRefs(): Promise<CatalogRefs> {
  const [genders, skinColors, educationLevels] = await Promise.all([
    supabase.from("genders").select("id, name, code").order("name"),
    supabase.from("skin_colors").select("id, name, code").order("name"),
    supabase.from("education_levels").select("id, name, code").order("name"),
  ])

  if (genders.error || skinColors.error || educationLevels.error) {
    throw genders.error ?? skinColors.error ?? educationLevels.error
  }

  const label = (rows: { id: string; name: string | null; code: string | null }[] | null) =>
    Object.fromEntries(
      (rows || []).map((row) => [row.id, row.name || row.code || "—"])
    )

  return {
    genderNameById: label(genders.data),
    skinColorNameById: label(skinColors.data),
    educationNameById: label(educationLevels.data),
  }
}

const SIN_INFORMACION = "Sin información"

/** Lee una columna simple de los trabajadores ACTIVOS del ámbito. */
async function fetchActiveWorkerColumn(
  entityIds: string[],
  column: string
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const { data, error, count } = await supabase
    .from("workers")
    .select(column, { count: "exact" })
    .in("organization_entity_id", entityIds)
    .eq("employment_status", "active")
  if (error) throw error
  return { rows: (data as unknown as Record<string, unknown>[]) || [], total: count ?? 0 }
}

/**
 * Trabajadores según edad. Requiere `workers.view` o `workers.manage`.
 * La edad se deriva de `birth_date` (persistida, derivada de la identificación
 * cuando aplica). El total son TODOS los trabajadores activos del ámbito; los
 * que no tienen fecha de nacimiento van al tramo «Sin información».
 */
export async function fetchWorkersByAge(entityIds: string[]): Promise<WorkersByAgeData> {
  const empty: WorkersByAgeData = {
    total: 0,
    byAgeGroup: AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: 0 })),
  }
  if (entityIds.length === 0) return empty

  const { rows, total } = await fetchActiveWorkerColumn(entityIds, "birth_date")

  const counts = new Map<AgeBucketKey, number>()
  AGE_BUCKETS.forEach((b) => counts.set(b.key, 0))

  rows.forEach((row) => {
    const bucket = ageBucketKey(ageFromBirthDate((row.birth_date as string) ?? null))
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  })

  const byAgeGroup: ReportSlice[] = AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    value: counts.get(b.key) ?? 0,
  }))

  return { total, byAgeGroup }
}

/**
 * Agrupa una columna de catálogo de los trabajadores activos. Descarga SOLO esa
 * columna, cuenta en el cliente (postgREST no soporta GROUP BY) e incluye
 * «Sin información» para los trabajadores sin el dato.
 */
async function buildCatalogReport(
  entityIds: string[],
  column: string,
  nameById: Record<string, string>
): Promise<{ total: number; slices: ReportSlice[]; countKey: string }> {
  if (entityIds.length === 0) {
    return { total: 0, slices: [], countKey: "" }
  }
  const { rows, total } = await fetchActiveWorkerColumn(entityIds, column)
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    const key = (row[column] as string) ?? NO_INFO_KEY
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const slices = countsToSlices(counts, nameById, SIN_INFORMACION)
  return { total, slices, countKey: column }
}

export async function fetchWorkersBySex(
  entityIds: string[],
  catalogRefs: CatalogRefs
): Promise<SexReport> {
  const { total, slices } = await buildCatalogReport(
    entityIds,
    "gender_id",
    catalogRefs.genderNameById
  )
  return { total, bySex: slices }
}

export async function fetchWorkersBySkinColor(
  entityIds: string[],
  catalogRefs: CatalogRefs
): Promise<SkinColorReport> {
  const { total, slices } = await buildCatalogReport(
    entityIds,
    "skin_color_id",
    catalogRefs.skinColorNameById
  )
  return { total, bySkinColor: slices }
}

export async function fetchWorkersByEducationLevel(
  entityIds: string[],
  catalogRefs: CatalogRefs
): Promise<EducationLevelReport> {
  const { total, slices } = await buildCatalogReport(
    entityIds,
    "education_level_id",
    catalogRefs.educationNameById
  )
  return { total, byEducation: slices }
}
