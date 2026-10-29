/**
 * Capacitación — Entidades y reglas puras del dominio por entidad.
 *
 * Alcance estricto por entidad (`organization_entity_id`):
 *   Entidad → Capacitación → Carpeta de área → Tema → Documentos (Word y PDF) y sesiones.
 *
 * Reglas de negocio:
 *   · Las carpetas reutilizan exclusivamente las áreas organizativas (`organization_areas`)
 *     existentes en la entidad seleccionada, sin crear ni duplicar áreas.
 *   · Cada sesión permite registrar si fue Realizada o No realizada y, cuando se marca como
 *     Realizada, seleccionar opcionalmente a los trabajadores participantes.
 *   · Cada trabajador participante recibe un registro independiente con estado «Recibida»
 *     en su Información adicional. Un trabajador puede recibir el mismo tema varias veces
 *     y su historial se conserva aunque cambie de área o de cargo.
 *   · Al completarse la contratación de un candidato en la entidad, se genera una única
 *     notificación de capacitación inicial pendiente por contratación.
 */

export type TrainingFrequency =
  | "MENSUAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL"
  | "UNICA"
  | "SEGUN_NECESIDAD"

export const TRAINING_FREQUENCY_LABELS: Record<TrainingFrequency, string> = {
  MENSUAL: "Mensual",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
  UNICA: "Única vez",
  SEGUN_NECESIDAD: "Según necesidad",
}

export const TRAINING_FREQUENCY_OPTIONS: { value: TrainingFrequency; label: string }[] = [
  { value: "MENSUAL", label: "Mensual" },
  { value: "TRIMESTRAL", label: "Trimestral" },
  { value: "SEMESTRAL", label: "Semestral" },
  { value: "ANUAL", label: "Anual" },
  { value: "UNICA", label: "Única vez" },
  { value: "SEGUN_NECESIDAD", label: "Según necesidad" },
]

export type TrainingSessionStatus = "PROGRAMADA" | "REALIZADA" | "NO_REALIZADA"

export const TRAINING_SESSION_STATUS_LABELS: Record<TrainingSessionStatus, string> = {
  PROGRAMADA: "Programada",
  REALIZADA: "Realizada",
  NO_REALIZADA: "No realizada",
}

export interface TrainingFolder {
  id: string
  organization_entity_id: string
  area_id: string
  area_name_snapshot: string
  description: string | null
  created_at: string
}

export interface TrainingTopic {
  id: string
  organization_entity_id: string
  folder_id: string
  area_id: string
  title: string
  description: string | null
  frequency: TrainingFrequency
  created_at: string
  updated_at: string
}

export interface TrainingTopicDocument {
  id: string
  organization_entity_id: string
  topic_id: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size: number
  /** Respaldo local en base64 si el bucket privado no está disponible en el entorno actual */
  data_url?: string | null
  uploaded_by: string | null
  created_at: string
}

export interface TrainingSession {
  id: string
  organization_entity_id: string
  folder_id: string
  area_id: string
  topic_id: string
  scheduled_date: string
  status: TrainingSessionStatus
  notes: string | null
  participant_worker_ids: string[]
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type WorkerTrainingRecordKind = "SESION" | "CAPACITACION_INICIAL"

export interface WorkerTrainingRecord {
  id: string
  organization_entity_id: string
  worker_id: string
  session_id: string | null
  topic_id: string | null
  topic_title_snapshot: string
  area_id_snapshot: string | null
  area_name_snapshot: string | null
  received_date: string
  status: "RECIBIDA"
  kind: WorkerTrainingRecordKind
  notes: string | null
  created_at: string
}

export type InitialTrainingNotificationStatus = "PENDIENTE" | "COMPLETADA"

export interface InitialTrainingNotification {
  id: string
  organization_entity_id: string
  worker_id: string
  candidate_id: string | null
  /** Clave única por evento de contratación para evitar notificaciones duplicadas */
  hire_key: string
  worker_name: string
  worker_code: string | null
  worker_identification: string | null
  area_id: string | null
  area_name: string | null
  position_name: string | null
  hire_date: string
  status: InitialTrainingNotificationStatus
  completed_at: string | null
  completed_record_id: string | null
  created_at: string
}

export interface EntityAreaOption {
  id: string
  name: string
  code: string | null
  is_active: boolean
}

export interface EntityWorkerOption {
  id: string
  code: string
  fullName: string
  identification: string
  areaId: string | null
  areaName: string | null
  positionName: string | null
  employmentStatus: string
}

export interface EntityTrainingState {
  folders: TrainingFolder[]
  topics: TrainingTopic[]
  documents: TrainingTopicDocument[]
  sessions: TrainingSession[]
  workerRecords: WorkerTrainingRecord[]
  notifications: InitialTrainingNotification[]
}

/** Extensiones válidas para documentos de capacitación (Word y PDF). */
export const ALLOWED_TRAINING_DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx"] as const

export function isAllowedTrainingDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase().trim()
  return ALLOWED_TRAINING_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}
