import { supabase } from "@/lib/supabase"
import {
  fetchGeneratedDocuments,
  generateResolutionDocument,
  type DocumentGenerationResult,
} from "@/domains/document-generation"
import {
  RESOLUTION_DOCUMENT_TYPE,
  type ResolutionContext,
  type CreateResolutionInput,
  type CreatedResolution,
  type ResolutionTemplateStatus,
  type ResolutionTemplateAvailability,
  type WorkerResolutionRow,
} from "../domain/entities"

/** Contexto resuelto automáticamente para el formulario de Resolución (§13/§16). */
export const fetchResolutionContext = async (input: {
  workerId?: string | null
  positionId: string
  resolutionDate?: string | null
  representativeAssignmentId?: string | null
}): Promise<ResolutionContext> => {
  const { data, error } = await supabase.rpc("resolution_worker_context", {
    p_worker_id: input.workerId ?? null,
    p_position_id: input.positionId,
    p_resolution_date: input.resolutionDate ?? null,
    p_representative_assignment_id: input.representativeAssignmentId ?? null,
  })
  if (error) throw error
  return data as ResolutionContext
}

/** Crea el registro histórico de la Resolución (snapshot) del evento laboral. */
export const createWorkerResolution = async (
  input: CreateResolutionInput
): Promise<CreatedResolution> => {
  const { data, error } = await supabase.rpc("create_worker_resolution", {
    p_worker_id: input.workerId,
    p_assignment_id: input.assignmentId,
    p_position_id: input.positionId,
    p_resolution_date: input.resolutionDate,
    p_representative_assignment_id: input.representativeAssignmentId ?? null,
    p_work_content_override: input.workContentOverride?.trim() || null,
    p_event_type: input.eventType ?? "HIRE",
  })
  if (error) throw error
  return data as CreatedResolution
}

/** Persista las Funciones / contenido de trabajo en el Cargo (fuente de verdad). */
export const updateJobWorkContent = async (jobId: string, workContent: string): Promise<void> => {
  const { error } = await supabase.rpc("update_job_work_content", {
    p_job_id: jobId,
    p_work_content: workContent,
  })
  if (error) throw error
}

/** ¿Existe una plantilla RESOLUTION activa aplicable a la fecha? (nunca Contract). */
export const resolveResolutionTemplateAvailability = async (
  entityId: string,
  referenceDate: string | null
): Promise<ResolutionTemplateAvailability> => {
  if (!entityId) {
    return { status: "UNKNOWN", versionId: null, versionNumber: null, templateName: null }
  }
  const { data, error } = await supabase.rpc("resolve_document_template_version", {
    p_entity_id: entityId,
    p_document_type_code: RESOLUTION_DOCUMENT_TYPE,
    p_reference_date: referenceDate || new Date().toISOString().slice(0, 10),
  })
  if (error) throw error

  const row = (data as Record<string, unknown> | null) || {}
  const raw = row.status != null ? String(row.status) : "NONE"
  const status: ResolutionTemplateStatus =
    raw === "RESOLVED" || raw === "NONE" || raw === "AMBIGUOUS" ? raw : "UNKNOWN"

  return {
    status,
    versionId: row.version_id != null ? String(row.version_id) : null,
    versionNumber: row.version_number != null ? Number(row.version_number) : null,
    templateName: row.template_name != null ? String(row.template_name) : null,
  }
}

/** Variables realmente exigidas por la plantilla RESOLUTION aplicable (§42). */
export const fetchResolutionRequiredVariables = async (
  versionId: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("document_template_versions")
    .select("analysis")
    .eq("id", versionId)
    .maybeSingle()
  if (error) throw error
  const analysis = (data as { analysis: { required_variables?: unknown } | null } | null)?.analysis
  const required = analysis?.required_variables
  return Array.isArray(required) ? required.map((value) => String(value)) : []
}

export interface ResolutionAutomationResult {
  generated: boolean
  skipped: boolean
  result: DocumentGenerationResult | null
}

/** Evita duplicados: no genera si ya existe un documento completado para la Resolución. */
export const ensureResolutionDocumentGenerated = async (
  resolutionId: string
): Promise<ResolutionAutomationResult> => {
  const existing = await fetchGeneratedDocuments({ resolutionId })
  if (existing.length > 0) return { generated: false, skipped: true, result: null }
  const result = await generateResolutionDocument(resolutionId)
  return { generated: result.success, skipped: false, result }
}

/** Resoluciones históricas del trabajador (todas permanecen, nunca se sobrescriben). */
export const fetchWorkerResolutions = async (workerId: string): Promise<WorkerResolutionRow[]> => {
  const { data, error } = await supabase
    .from("worker_resolutions")
    .select(
      "id, worker_id, position_id, resolution_date, job_name_snapshot, work_content_snapshot, status, worker_document_id, generated_at, created_at"
    )
    .eq("worker_id", workerId)
    .order("resolution_date", { ascending: false })
  if (error) throw error
  return (data as WorkerResolutionRow[]) || []
}
