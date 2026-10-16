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

/** Forma cruda del puesto devuelta por PostgREST: su cargo viene incrustado. */
export interface ConfigurationPositionRow {
  id: string
  organization_entity_id: string
  job_id: string
  code: string
  name: string
  description: string | null
  position_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  authorized_quantity: number
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  job: {
    id: string
    name: string
    code: string
    is_active: boolean
    area_id: string
    occupational_category_id: string | null
    area: { id: string; name: string; code: string } | null
    salary_group: { id: string; salary_scale_id: string; sequence_number: number } | null
  } | null
}

/** Puestos de la entidad con su cargo, su área y su grupo salarial. */
export async function selectConfigurationPositionRows(
  entityId: string
): Promise<ConfigurationPositionRow[]> {
  const { data, error } = await supabase
    .from("organization_positions")
    .select(`
      *,
      job:organization_jobs(
        id,
        name,
        code,
        is_active,
        area_id,
        occupational_category_id,
        area:organization_areas(id, name, code),
        salary_group:salary_groups(id, salary_scale_id, sequence_number)
      )
    `)
    .eq("organization_entity_id", entityId)
    .order("created_at")

  if (error) throw error
  return (data as ConfigurationPositionRow[]) || []
}

/**
 * Alta o edición de un puesto con su horario habitual en UNA sola operación atómica:
 * la RPC `save_position_with_schedule` escribe el puesto y reemplaza sus segmentos de
 * horario. Exige el cargo completo (readiness contractual) y `staffing.manage`.
 */
export async function savePositionWithSchedule(input: {
  entityId: string
  positionId: string | null
  jobId: string
  code: string
  name: string
  description: string | null
  authorizedQuantity: number
  workLocation: string | null
  dailyHours: number | null
  weeklyHours: number | null
  monthlyHours: number | null
  breakMinutes: number | null
  scheduleNotes: string | null
  segments: { day_of_week: number; start_time: string; end_time: string; display_order: number }[]
}): Promise<void> {
  const { error } = await supabase.rpc("save_position_with_schedule", {
    p_entity_id: input.entityId,
    p_position_id: input.positionId,
    p_job_id: input.jobId,
    p_code: input.code,
    p_name: input.name,
    p_description: input.description,
    p_authorized_quantity: input.authorizedQuantity,
    p_work_location: input.workLocation,
    p_daily_hours: input.dailyHours,
    p_weekly_hours: input.weeklyHours,
    p_monthly_hours: input.monthlyHours,
    p_break_minutes: input.breakMinutes,
    p_schedule_notes: input.scheduleNotes,
    p_segments: input.segments,
  })

  if (error) throw error
}

/** Activa o desactiva un puesto: los puestos nunca se eliminan. */
export async function setOrganizationPositionActive(
  positionId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from("organization_positions")
    .update({ is_active: isActive })
    .eq("id", positionId)

  if (error) throw error
}
