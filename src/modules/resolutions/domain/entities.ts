/**
 * Resoluciones — documento sustitutivo del contrato cuando el Cargo destino es
 * Especialista Principal (`organization_jobs.is_principal_specialist = true`).
 *
 * Diferencias clave con el resto del motor documental:
 *   · La Resolución se genera SIEMPRE a partir de un evento laboral formal
 *     (contratación de candidato o movimiento de puesto), nunca al Vincular a
 *     plantilla (acción administrativa sin documentación).
 *   · Las variables r.* se resuelven desde el snapshot histórico de
 *     `worker_resolutions`, jamás desde el estado vivo.
 */

/** Tipo documental que identifica a las Resoluciones. */
export const RESOLUTION_DOCUMENT_TYPE = "RESOLUTION"

export interface ResolutionContextWorker {
  full_name: string | null
  identification: string | null
}

export interface ResolutionContextJob {
  id: string
  name: string | null
  is_principal_specialist: boolean
  work_content: string | null
  salary_group_sequence: number | null
  salary_amount: number | null
  currency_code: string | null
}

export interface ResolutionContextEntity {
  id: string
  name: string | null
  entity_type: string
  municipality: string | null
  revolution_year: string | null
  can_edit_contract_data: boolean
}

export interface ResolutionRepresentative {
  assignment_id: string | null
  person_name: string | null
  position_title: string | null
}

export interface ResolutionContext {
  worker_id: string | null
  position_id: string
  resolution_date: string
  worker: ResolutionContextWorker | null
  job: ResolutionContextJob
  position: { name: string | null }
  entity: ResolutionContextEntity
  parent_company: { name: string | null }
  representative: ResolutionRepresentative | null
  representatives: ResolutionRepresentative[]
  can_edit_job: boolean
}

export interface CreateResolutionInput {
  workerId: string
  assignmentId: string | null
  positionId: string
  resolutionDate: string
  representativeAssignmentId?: string | null
  workContentOverride?: string | null
  eventType?: "HIRE" | "MOVEMENT"
}

export interface CreatedResolution {
  resolution_id: string
  worker_id: string
  entity_id: string
  resolution_date: string
}

export type ResolutionTemplateStatus = "RESOLVED" | "NONE" | "AMBIGUOUS" | "UNKNOWN"

export interface ResolutionTemplateAvailability {
  status: ResolutionTemplateStatus
  versionId: string | null
  versionNumber: number | null
  templateName: string | null
}

export interface WorkerResolutionRow {
  id: string
  worker_id: string
  position_id: string | null
  resolution_date: string
  job_name_snapshot: string | null
  work_content_snapshot: string | null
  status: string
  worker_document_id: string | null
  generated_at: string | null
  created_at: string
}
