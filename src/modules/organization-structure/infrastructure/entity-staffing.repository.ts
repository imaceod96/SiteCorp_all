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
  code: string
  is_active: boolean
  area_id: string
  area: { id: string | null; name: string | null } | null
  salary_group: SalaryGroupRef | null
}

interface RawEntityStaffingJob {
  id: string
  name: string
  code: string
  is_active: boolean
  area_id: string
  area: { id: string; name: string }[] | null
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
      `id, name, code, is_active, area_id,
       area:organization_areas(id, name),
       salary_group:salary_groups(id, salary_scale_id, sequence_number)`
    )
    .eq("organization_entity_id", entityId)
    .order("name")
  if (error) throw error

  return ((data as RawEntityStaffingJob[] | null) || []).map((job) => ({
    ...job,
    area: job.area ? { id: job.area[0]?.id || null, name: job.area[0]?.name || null } : null,
    salary_group: Array.isArray(job.salary_group) ? job.salary_group[0] ?? null : job.salary_group,
  }))
}
