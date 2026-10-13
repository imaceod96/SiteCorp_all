import { supabase } from "@/lib/supabase"
import type { JobClaNightSegment } from "../domain/entities"

/**
 * Estructura organizativa — Repositorio de cargos (infraestructura).
 *
 * Único punto que habla con Supabase para los cargos, sus tramos nocturnos de CLA y los
 * niveles de preparación que admite cada cargo. El código del cargo lo genera el trigger
 * (`organization_jobs_generate_code`) a partir del área y el nombre: nunca se envía.
 *
 * La categoría ocupacional y el grupo salarial son obligatorios para un cargo nuevo; la
 * obligatoriedad la impone el backend (`enforce_job_occupational_category`). El
 * aislamiento es `organization_entity_id` + RLS por `company_client_id`.
 */

/** Forma cruda devuelta por PostgREST: el grupo salarial trae su histórico de valores. */
export interface ConfigurationJobRow {
  id: string
  organization_entity_id: string
  area_id: string
  code: string
  name: string
  description: string | null
  salary_group_id: string
  hierarchy_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  occupational_category_id: string | null
  required_profession_or_trade: string | null
  work_content: string | null
  is_cuadro: boolean | null
  is_principal_specialist: boolean | null
  has_abnormal_conditions?: boolean | null
  cla_day_enabled?: boolean | null
  cla_day_hourly_rate?: number | null
  cla_night_enabled?: boolean | null
  area: {
    id: string
    name: string
    code: string
    is_active: boolean
    organization_entity_id: string
  } | null
  salary_group: {
    id: string
    salary_scale_id: string
    sequence_number: number
    description: string | null
    is_active: boolean
    salary_group_values: {
      id: string
      amount: number
      currency_code: string
      effective_from: string
      effective_to: string | null
      is_active: boolean
    }[] | null
  } | null
}

/** Cargos de la entidad con su área y su grupo salarial (incluido su histórico de valores). */
export async function selectConfigurationJobRows(
  entityId: string
): Promise<ConfigurationJobRow[]> {
  const { data, error } = await supabase
    .from("organization_jobs")
    .select(`
      *,
      area:organization_areas(id, name, code, is_active, organization_entity_id),
      salary_group:salary_groups(
        id,
        salary_scale_id,
        sequence_number,
        description,
        is_active,
        salary_group_values(
          id,
          amount,
          currency_code,
          effective_from,
          effective_to,
          is_active
        )
      )
    `)
    .eq("organization_entity_id", entityId)
    .order("hierarchy_order")

  if (error) throw error
  return (data as ConfigurationJobRow[]) || []
}

/** Cargo completo por identificador (para el formulario y sus validaciones). */
export async function selectConfigurationJobRow(
  jobId: string
): Promise<ConfigurationJobRow | null> {
  const { data, error } = await supabase
    .from("organization_jobs")
    .select(`
      *,
      area:organization_areas(id, name, code, is_active, organization_entity_id),
      salary_group:salary_groups(
        id,
        salary_scale_id,
        sequence_number,
        description,
        is_active,
        salary_group_values(
          id,
          amount,
          currency_code,
          effective_from,
          effective_to,
          is_active
        )
      )
    `)
    .eq("id", jobId)
    .maybeSingle()

  if (error) throw error
  return (data as ConfigurationJobRow | null) || null
}

/** Alta de un cargo. Devuelve su identificador (el código lo asigna el backend). */
export async function insertOrganizationJob(payload: {
  organization_entity_id: string
  name: string
  area_id: string
  description: string | null
  salary_group_id: string
  hierarchy_order: number
  occupational_category_id: string
  required_profession_or_trade: string | null
  work_content: string | null
  has_abnormal_conditions: boolean
  cla_day_enabled: boolean
  cla_day_hourly_rate: number | null
  cla_night_enabled: boolean
  is_cuadro: boolean
  is_principal_specialist: boolean
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("organization_jobs")
    .insert({ ...payload, is_active: true })
    .select("id")
    .single()

  if (error) throw error
  return (data as { id: string } | null)?.id || null
}

/** Edición de un cargo (la categoría ocupacional nunca puede quedar vacía). */
export async function updateOrganizationJob(
  jobId: string,
  payload: {
    name: string
    area_id: string
    description: string | null
    salary_group_id: string
    hierarchy_order: number
    occupational_category_id: string | null
    required_profession_or_trade: string | null
    work_content: string | null
    has_abnormal_conditions: boolean
    cla_day_enabled: boolean
    cla_day_hourly_rate: number | null
    cla_night_enabled: boolean
    is_cuadro: boolean
    is_principal_specialist: boolean
  }
): Promise<void> {
  const { error } = await supabase.from("organization_jobs").update(payload).eq("id", jobId)
  if (error) throw error
}

/** Activa o desactiva un cargo: los cargos nunca se eliminan. */
export async function setOrganizationJobActive(jobId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("organization_jobs")
    .update({ is_active: isActive })
    .eq("id", jobId)

  if (error) throw error
}

/** Tramos nocturnos de CLA configurados en el cargo. */
export async function selectJobClaNightSegments(
  jobId: string
): Promise<JobClaNightSegment[]> {
  const { data, error } = await supabase
    .from("organization_job_cla_night_segments")
    .select("segment_order, start_time, end_time, hourly_rate")
    .eq("organization_job_id", jobId)
    .order("segment_order")

  if (error) throw error
  return ((data as JobClaNightSegment[]) || []).map((segment) => ({
    segment_order: segment.segment_order,
    // La base de datos guarda `time`: la interfaz usa "HH:MM".
    start_time: String(segment.start_time).slice(0, 5),
    end_time: String(segment.end_time).slice(0, 5),
    hourly_rate: segment.hourly_rate,
  }))
}

/**
 * Reemplazo atómico de los dos tramos nocturnos de CLA del cargo. Cuando el pago nocturno
 * está desactivado se eliminan (no se guardan horarios huérfanos).
 */
export async function replaceJobClaNightSegments(
  jobId: string,
  entityId: string,
  segments: JobClaNightSegment[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("organization_job_cla_night_segments")
    .delete()
    .eq("organization_job_id", jobId)

  if (deleteError) throw deleteError

  if (segments.length === 0) return

  const { error } = await supabase.from("organization_job_cla_night_segments").insert(
    segments.map((segment) => ({
      organization_job_id: jobId,
      organization_entity_id: entityId,
      segment_order: segment.segment_order,
      start_time: segment.start_time,
      end_time: segment.end_time,
      hourly_rate: segment.hourly_rate,
    }))
  )

  if (error) throw error
}

/** Niveles de preparación configurados en el cargo. */
export async function selectJobPreparationLevelIds(jobId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("organization_job_preparation_levels")
    .select("preparation_level_id")
    .eq("organization_job_id", jobId)

  if (error) throw error
  return ((data as { preparation_level_id: string }[]) || []).map(
    (row) => row.preparation_level_id
  )
}

/** Reemplazo exacto de los niveles de preparación del cargo (varios por cargo). */
export async function replaceJobPreparationLevels(
  jobId: string,
  preparationLevelIds: string[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("organization_job_preparation_levels")
    .delete()
    .eq("organization_job_id", jobId)

  if (deleteError) throw deleteError

  if (preparationLevelIds.length === 0) return

  const { error } = await supabase.from("organization_job_preparation_levels").insert(
    preparationLevelIds.map((preparation_level_id) => ({
      organization_job_id: jobId,
      preparation_level_id,
    }))
  )

  if (error) throw error
}
