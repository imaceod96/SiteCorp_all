import { supabase } from "@/lib/supabase"
import type { CatalogOption } from "../domain/entities"

/**
 * Personas — Catálogos globales de la PERSONA (infraestructura).
 *
 * `skin_colors` y `driving_license_categories` son catálogos GLOBALES de SiteCorp:
 * no tienen tenant_id ni organization_entity_id. Todos los workspaces y entidades
 * consumen exactamente los mismos valores, por lo que las consultas se centralizan
 * aquí (una sola fuente) en lugar de repetirse en cada formulario.
 *
 * Además de los catálogos, aquí vive la relación REAL de licencias de conducción
 * (candidato y trabajador) con sus dos RPC de reemplazo exacto: la selección que
 * queda en base de datos coincide siempre con la que ve el usuario (0 = sin licencia).
 *
 * Los valores y las etiquetas de los catálogos no cambian: las mismas filas, los
 * mismos filtros (`is_active`) y el mismo orden (`name` / `display_order`).
 */

/** Color de piel: mismo catálogo para candidato y trabajador. */
export const fetchSkinColors = async (): Promise<CatalogOption[]> => {
  const { data, error } = await supabase
    .from("skin_colors")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name")

  if (error) throw error
  return (data as CatalogOption[]) || []
}

/**
 * Categorías de licencia de conducción (A, B, C, D, E).
 * El orden se rige por `display_order` del catálogo, nunca por texto libre.
 */
export const fetchDrivingLicenseCategories = async (): Promise<CatalogOption[]> => {
  const { data, error } = await supabase
    .from("driving_license_categories")
    .select("id, name, code")
    .eq("is_active", true)
    .order("display_order")
    .order("name")

  if (error) throw error
  return (data as CatalogOption[]) || []
}

/** Catálogos de persona en una sola carga (color de piel + licencias). */
export const fetchPersonCatalogs = async (): Promise<{
  skinColors: CatalogOption[]
  licenseCategories: CatalogOption[]
}> => {
  const [skinColors, licenseCategories] = await Promise.all([
    fetchSkinColors(),
    fetchDrivingLicenseCategories(),
  ])
  return { skinColors, licenseCategories }
}

/** Licencias de conducción registradas para un candidato. */
export const fetchCandidateDrivingLicenseIds = async (candidateId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from("candidate_driving_license_categories")
    .select("driving_license_category_id")
    .eq("candidate_id", candidateId)

  if (error) throw error
  return ((data as { driving_license_category_id: string }[]) || []).map(
    (row) => row.driving_license_category_id
  )
}

/** Licencias de conducción registradas para un trabajador. */
export const fetchWorkerDrivingLicenseIds = async (workerId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from("worker_driving_license_categories")
    .select("driving_license_category_id")
    .eq("worker_id", workerId)

  if (error) throw error
  return ((data as { driving_license_category_id: string }[]) || []).map(
    (row) => row.driving_license_category_id
  )
}

/**
 * Reemplazo exacto de las licencias del candidato en una sola transacción:
 * el resultado en base de datos coincide siempre con la selección (0 = sin licencia).
 */
export const saveCandidateDrivingLicenseIds = async (
  candidateId: string,
  categoryIds: string[]
): Promise<void> => {
  const { error } = await supabase.rpc("save_candidate_driving_licenses", {
    p_candidate_id: candidateId,
    p_category_ids: categoryIds,
  })
  if (error) throw error
}

/** Reemplazo exacto de las licencias del trabajador en una sola transacción. */
export const saveWorkerDrivingLicenseIds = async (
  workerId: string,
  categoryIds: string[]
): Promise<void> => {
  const { error } = await supabase.rpc("save_worker_driving_licenses", {
    p_worker_id: workerId,
    p_category_ids: categoryIds,
  })
  if (error) throw error
}
