import { supabase } from "@/lib/supabase"
import type { SalaryGroupRef } from "../domain/entities"

/**
 * Estructura organizativa — Repositorio de la Plantilla operativa (infraestructura).
 *
 * Lo que la pantalla de Plantilla necesita del dominio de estructura: el nombre de la
 * entidad y sus cargos con el área y el grupo salarial de los que dependen el salario y
 * la agrupación de la plantilla. Los puestos (y su ocupación) los aporta el dominio de
 * personas, que es el dueño de los trabajadores y de sus asignaciones.
 *
 * Consultas, `select`, ordenación y ámbito (`organization_entity_id` + RLS por
 * `company_client_id`) son EXACTAMENTE los que ya usaba la pantalla.
 */

/**
 * Cargo de la entidad con su área y su grupo salarial.
 *
 * Forma cruda devuelta por PostgREST: las relaciones embebidas pueden llegar como arreglo
 * o como objeto antes de normalizarse en el mapeo (igual que en la pantalla).
 */
export interface EntityStaffingJob {
  id: string
  name: string
  code?: string | null
  hierarchy_order?: number
  is_active: boolean
  area_id: string
  area: { id: string | null; name: string | null; hierarchy_order?: number } | null
  salary_group: SalaryGroupRef | null
}

interface RawEntityStaffingJob {
  id: string
  name: string
  code?: string | null
  hierarchy_order?: number
  is_active: boolean
  area_id: string
  area:
    | { id: string; name: string; hierarchy_order?: number }[]
    | { id: string; name: string; hierarchy_order?: number }
    | null
  salary_group: SalaryGroupRef | SalaryGroupRef[] | null
}

/** Nombre de la entidad (el único dato de la entidad que muestra la plantilla). */
export async function fetchEntityName(entityId: string): Promise<string> {
  const { data } = await supabase
    .from("organization_entities")
    .select("name")
    .eq("id", entityId)
    .maybeSingle()
  return (data as { name: string } | null)?.name || ""
}

/** Cargos de la entidad con su área y su grupo salarial, en el orden de la estructura. */
export async function fetchEntityStaffingJobs(entityId: string): Promise<EntityStaffingJob[]> {
  const { data, error } = await supabase
    .from("organization_jobs")
    .select(
      `id, name, hierarchy_order, is_active, area_id,
       area:organization_areas(id, name, hierarchy_order),
       salary_group:salary_groups(id, salary_scale_id, sequence_number)`
    )
    .eq("organization_entity_id", entityId)
    .order("hierarchy_order", { ascending: true })
    .order("name", { ascending: true })
  if (error) throw error

  return ((data as RawEntityStaffingJob[] | null) || [])
    .map((job) => {
      const areaObj = Array.isArray(job.area) ? job.area[0] : job.area
      return {
        ...job,
        area: areaObj
          ? {
              id: areaObj.id || null,
              name: areaObj.name || null,
              hierarchy_order: areaObj.hierarchy_order,
            }
          : null,
        salary_group: Array.isArray(job.salary_group) ? job.salary_group[0] ?? null : job.salary_group,
      }
    })
    .sort(
      (a, b) =>
        (a.area?.hierarchy_order ?? Number.MAX_SAFE_INTEGER) -
          (b.area?.hierarchy_order ?? Number.MAX_SAFE_INTEGER) ||
        (a.area?.name || "").localeCompare(b.area?.name || "") ||
        (a.hierarchy_order ?? 0) - (b.hierarchy_order ?? 0) ||
        a.name.localeCompare(b.name)
    )
}

