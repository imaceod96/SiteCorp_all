/**
 * Seguridad y Salud en el Trabajo (SST) — Entidades y reglas puras del dominio por entidad.
 *
 * Alcance estricto por entidad (`organization_entity_id`):
 *   SiteCorp → Entidades → Seleccionar entidad → SST
 *   Nunca aparece en el menú general de la plataforma ni mezcla registros entre entidades.
 */

export type SstTrainingFrequency =
  | "UNICA"
  | "MENSUAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL"
  | "PERSONALIZADA"

export const SST_FREQUENCY_LABELS: Record<SstTrainingFrequency, string> = {
  UNICA: "Única vez",
  MENSUAL: "Mensual",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
  PERSONALIZADA: "Personalizada",
}

export const SST_FREQUENCY_OPTIONS: { value: SstTrainingFrequency; label: string }[] = [
  { value: "UNICA", label: "Única vez" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "TRIMESTRAL", label: "Trimestral" },
  { value: "SEMESTRAL", label: "Semestral" },
  { value: "ANUAL", label: "Anual" },
  { value: "PERSONALIZADA", label: "Personalizada" },
]

export type SstSessionStatus =
  | "PROGRAMADA"
  | "REALIZADA"
  | "NO_REALIZADA"
  | "CANCELADA"
  | "REPROGRAMADA"

export const SST_SESSION_STATUS_LABELS: Record<SstSessionStatus, string> = {
  PROGRAMADA: "Programada",
  REALIZADA: "Realizada",
  NO_REALIZADA: "No realizada",
  CANCELADA: "Cancelada",
  REPROGRAMADA: "Reprogramada",
}

export interface SstJobFolder {
  id: string
  organization_entity_id: string
  job_id: string
  job_name_snapshot: string
  area_id_snapshot: string | null
  area_name_snapshot: string | null
  created_at: string
  updated_at?: string
}

export interface SstTrainingTopic {
  id: string
  organization_entity_id: string
  folder_id: string
  job_id: string
  title: string
  description: string | null
  frequency: SstTrainingFrequency
  custom_frequency_label: string | null
  created_at: string
  updated_at: string
}

export interface SstTopicDocument {
  id: string
  organization_entity_id: string
  topic_id: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size: number
  data_url?: string | null
  uploaded_by: string | null
  created_at: string
}

export interface SstTrainingSession {
  id: string
  organization_entity_id: string
  folder_id: string
  job_id: string
  topic_id: string
  scheduled_date: string
  status: SstSessionStatus
  notes: string | null
  participant_worker_ids: string[]
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type SstWorkerTrainingRecordKind =
  | "SESION_SST"
  | "INICIAL_CONTRATACION_SST"
  | "CAMBIO_CARGO_SST"

export interface SstWorkerTrainingRecord {
  id: string
  organization_entity_id: string
  worker_id: string
  session_id: string | null
  topic_id: string | null
  topic_title_snapshot: string
  job_id_snapshot: string | null
  job_name_snapshot: string | null
  area_id_snapshot: string | null
  area_name_snapshot: string | null
  received_date: string
  status: "RECIBIDA"
  kind: SstWorkerTrainingRecordKind
  notes: string | null
  created_at: string
}

export type SstNotificationTriggerType = "NUEVA_CONTRATACION" | "CAMBIO_CARGO"
export type SstNotificationStatus = "PENDIENTE" | "EN_PROCESO" | "COMPLETADA"

export interface SstOnboardingNotification {
  id: string
  organization_entity_id: string
  worker_id: string
  event_key: string
  trigger_type: SstNotificationTriggerType
  worker_name: string
  worker_code: string | null
  worker_identification: string | null
  job_id: string | null
  job_name: string | null
  area_id: string | null
  area_name: string | null
  position_name: string | null
  effective_date: string
  status: SstNotificationStatus
  completed_at: string | null
  completed_record_id: string | null
  created_at: string
}

// --- SECCIÓN 2: Identificación y evaluación de riesgos laborales ------------

export type SstRiskType =
  | "FISICO"
  | "QUIMICO"
  | "BIOLOGICO"
  | "ERGONOMICO"
  | "PSICOSOCIAL"
  | "MECANICO"
  | "ELECTRICO"
  | "LOCATIVO"
  | "INCENDIO_EXPLOSION"

export const SST_RISK_TYPE_LABELS: Record<SstRiskType, string> = {
  FISICO: "Físico (ruido, iluminación, temperatura, vibración)",
  QUIMICO: "Químico (vapores, polvos, sustancias)",
  BIOLOGICO: "Biológico",
  ERGONOMICO: "Ergonómico (posturas, cargas)",
  PSICOSOCIAL: "Psicosocial / Organizacional",
  MECANICO: "Mecánico (atrapamientos, cortes, caídas)",
  ELECTRICO: "Eléctrico",
  LOCATIVO: "Locativo / Instalaciones",
  INCENDIO_EXPLOSION: "Incendio / Explosión",
}

export type SstProbabilityLevel = "BAJA" | "MEDIA" | "ALTA"
export type SstSeverityLevel = "LEVE" | "MODERADA" | "GRAVE" | "EXTREMA"
export type SstRiskLevel = "BAJO" | "MODERADO" | "IMPORTANTE" | "CRITICO"
export type SstRiskStatus = "ACTIVO" | "CONTROLADO" | "CERRADO"

export const SST_PROBABILITY_LABELS: Record<SstProbabilityLevel, string> = {
  BAJA: "Baja",
  MEDIA: "Media",
  ALTA: "Alta",
}

export const SST_SEVERITY_LABELS: Record<SstSeverityLevel, string> = {
  LEVE: "Leve",
  MODERADA: "Moderada",
  GRAVE: "Grave",
  EXTREMA: "Extrema",
}

export const SST_RISK_LEVEL_LABELS: Record<SstRiskLevel, string> = {
  BAJO: "Bajo / Trivial",
  MODERADO: "Moderado / Tolerable",
  IMPORTANTE: "Importante / Alto",
  CRITICO: "Crítico / Intolerable",
}

/**
 * Calcula automáticamente el nivel de riesgo en la matriz (Probabilidad × Severidad).
 */
export function computeSstRiskLevel(
  probability: SstProbabilityLevel,
  severity: SstSeverityLevel
): SstRiskLevel {
  if (probability === "BAJA") {
    if (severity === "LEVE") return "BAJO"
    if (severity === "MODERADA") return "BAJO"
    if (severity === "GRAVE") return "MODERADO"
    return "IMPORTANTE"
  }
  if (probability === "MEDIA") {
    if (severity === "LEVE") return "BAJO"
    if (severity === "MODERADA") return "MODERADO"
    if (severity === "GRAVE") return "IMPORTANTE"
    return "CRITICO"
  }
  // ALTA
  if (severity === "LEVE") return "MODERADO"
  if (severity === "MODERADA") return "IMPORTANTE"
  return "CRITICO"
}

export interface SstRiskAssessment {
  id: string
  organization_entity_id: string
  area_id: string | null
  area_name_snapshot: string | null
  job_id: string | null
  job_name_snapshot: string | null
  position_id: string | null
  position_name_snapshot: string | null
  facility_name: string | null
  risk_type: SstRiskType
  hazard_description: string
  cause_description: string | null
  consequences: string | null
  probability_level: SstProbabilityLevel
  severity_level: SstSeverityLevel
  risk_level: SstRiskLevel
  existing_controls: string | null
  status: SstRiskStatus
  evaluated_at: string
  review_date: string | null
  created_at: string
  updated_at: string
}

// --- SECCIÓN 6: Plan de prevención y medidas correctivas --------------------

export type SstPreventiveActionOrigin =
  | "RIESGO"
  | "INSPECCION"
  | "ACCIDENTE"
  | "INCIDENTE"
  | "COMITE"
  | "SIMULACRO"
  | "REVISION_INTERNA"

export const SST_ACTION_ORIGIN_LABELS: Record<SstPreventiveActionOrigin, string> = {
  RIESGO: "Evaluación de riesgo",
  INSPECCION: "Inspección de seguridad",
  ACCIDENTE: "Accidente laboral",
  INCIDENTE: "Incidente sin lesión",
  COMITE: "Acuerdo del Comité SST",
  SIMULACRO: "Simulacro de emergencia",
  REVISION_INTERNA: "Revisión interna",
}

export type SstActionPriority = "BAJA" | "MEDIA" | "ALTA" | "INMEDIATA"
export type SstPreventiveActionStatus =
  | "PENDIENTE"
  | "EN_EJECUCION"
  | "COMPLETADA"
  | "VENCIDA"
  | "CANCELADA"

export const SST_ACTION_STATUS_LABELS: Record<SstPreventiveActionStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_EJECUCION: "En ejecución",
  COMPLETADA: "Completada",
  VENCIDA: "Vencida",
  CANCELADA: "Cancelada",
}

export interface SstPreventiveAction {
  id: string
  organization_entity_id: string
  origin_type: SstPreventiveActionOrigin
  origin_id: string | null
  origin_label: string | null
  description: string
  area_id: string | null
  area_name_snapshot: string | null
  job_id: string | null
  job_name_snapshot: string | null
  responsible_worker_id: string | null
  responsible_name_snapshot: string | null
  priority: SstActionPriority
  due_date: string
  completed_date: string | null
  status: SstPreventiveActionStatus
  cancellation_justification: string | null
  verification_notes: string | null
  created_at: string
  updated_at: string
}

// --- SECCIÓN 3: Equipos de Protección Personal (EPP) ------------------------

export interface SstEppCatalogItem {
  id: string
  organization_entity_id: string
  name: string
  category: string
  description: string | null
  default_lifespan_days: number
  stock_quantity: number
  min_stock_alert: number
  created_at: string
  updated_at: string
}

export interface SstJobEppRequirement {
  id: string
  organization_entity_id: string
  job_id: string
  job_name_snapshot: string | null
  epp_id: string
  epp_name_snapshot: string
  is_mandatory: boolean
  renewal_months: number
  notes: string | null
  created_at: string
}

export type SstEppDeliveryStatus =
  | "ENTREGADO"
  | "PENDIENTE_REPOSICION"
  | "REPUESTO"
  | "DEVUELTO"

export const SST_EPP_DELIVERY_STATUS_LABELS: Record<SstEppDeliveryStatus, string> = {
  ENTREGADO: "Entregado y vigente",
  PENDIENTE_REPOSICION: "Pendiente de reposición",
  REPUESTO: "Repuesto / Renovado",
  DEVUELTO: "Devuelto",
}

export interface SstWorkerEppDelivery {
  id: string
  organization_entity_id: string
  worker_id: string
  worker_name_snapshot: string
  job_id: string | null
  job_name_snapshot: string | null
  epp_id: string | null
  epp_name_snapshot: string
  quantity: number
  delivery_date: string
  renewal_due_date: string | null
  status: SstEppDeliveryStatus
  signed_receipt: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

// --- SECCIÓN 4: Inspecciones de Seguridad -----------------------------------

export type SstInspectionStatus = "PROGRAMADA" | "ABIERTA" | "EN_SEGUIMIENTO" | "CERRADA"

export const SST_INSPECTION_STATUS_LABELS: Record<SstInspectionStatus, string> = {
  PROGRAMADA: "Programada",
  ABIERTA: "Abierta",
  EN_SEGUIMIENTO: "En seguimiento",
  CERRADA: "Cerrada",
}

export interface SstInspection {
  id: string
  organization_entity_id: string
  area_id: string | null
  area_name_snapshot: string | null
  facility_name: string | null
  inspection_type: string
  inspector_name: string
  scheduled_date: string
  executed_date: string | null
  status: SstInspectionStatus
  summary_notes: string | null
  created_at: string
  updated_at: string
}

export interface SstInspectionFinding {
  id: string
  organization_entity_id: string
  inspection_id: string
  item_checked: string
  conforms: boolean
  finding_description: string | null
  severity: "LEVE" | "MODERADO" | "GRAVE" | "CRITICO"
  preventive_action_id: string | null
  created_at: string
}

// --- SECCIÓN 5, 7, 8, 9 y 10: Salud Ocupacional Administrativa y Registros ---

export type SstHealthAptitudeStatus =
  | "APTO"
  | "APTO_CON_RESTRICCIONES"
  | "NO_APTO_TEMPORAL"
  | "PENDIENTE"

export const SST_HEALTH_APTITUDE_LABELS: Record<SstHealthAptitudeStatus, string> = {
  APTO: "Apto",
  APTO_CON_RESTRICCIONES: "Apto con restricciones",
  NO_APTO_TEMPORAL: "No apto temporal",
  PENDIENTE: "Pendiente de evaluación",
}

export interface SstWorkerHealthAptitude {
  id: string
  organization_entity_id: string
  worker_id: string
  worker_name_snapshot: string
  job_id: string | null
  job_name_snapshot: string | null
  evaluation_type: "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO"
  evaluation_date: string
  next_review_date: string | null
  aptitude_status: SstHealthAptitudeStatus
  administrative_restrictions: string | null
  administrative_notes: string | null
  created_at: string
  updated_at: string
}

export interface SstAccidentIncident {
  id: string
  organization_entity_id: string
  event_type: "ACCIDENTE_CON_LESION" | "INCIDENTE_SIN_LESION" | "OTRO"
  occurred_at: string
  area_id: string | null
  area_name_snapshot: string | null
  job_id: string | null
  job_name_snapshot: string | null
  affected_worker_id: string | null
  affected_worker_name: string | null
  witness_names: string | null
  description: string
  immediate_causes: string | null
  basic_causes: string | null
  severity: string
  days_lost: number
  immediate_actions: string | null
  investigation_conclusions: string | null
  status: "REPORTADO" | "EN_INVESTIGACION" | "CERRADO"
  created_at: string
  updated_at: string
}

export interface SstEmergencyPlan {
  id: string
  organization_entity_id: string
  area_id: string | null
  area_name_snapshot: string | null
  title: string
  plan_type: string
  version: string
  valid_until: string | null
  brigade_members_notes: string | null
  equipment_notes: string | null
  last_drill_date: string | null
  drill_result_notes: string | null
  created_at: string
  updated_at: string
}

export interface SstCommitteeRecord {
  id: string
  organization_entity_id: string
  record_type: string
  title: string
  record_date: string
  member_worker_id: string | null
  member_name: string | null
  member_role: string | null
  agreements_or_notes: string | null
  status: string
  created_at: string
}

export interface SstSafeWorkProcedure {
  id: string
  organization_entity_id: string
  code: string
  title: string
  area_id: string | null
  area_name_snapshot: string | null
  job_id: string | null
  job_name_snapshot: string | null
  version: string
  status: string
  requires_special_permit: boolean
  summary: string | null
  created_at: string
  updated_at: string
}

// --- Catálogos organizativos reutilizados de la entidad ---------------------

export interface EntityJobOption {
  id: string
  name: string
  code: string | null
  areaId: string | null
  areaName: string | null
  isActive: boolean
}

export interface EntityAreaOption {
  id: string
  name: string
  code: string | null
  isActive: boolean
}

export interface EntityWorkerSstOption {
  id: string
  code: string
  fullName: string
  identification: string
  jobId: string | null
  jobName: string | null
  areaId: string | null
  areaName: string | null
  positionId: string | null
  positionName: string | null
  employmentStatus: string
  hireDate: string | null
}

export interface EntitySstState {
  jobFolders: SstJobFolder[]
  topics: SstTrainingTopic[]
  documents: SstTopicDocument[]
  sessions: SstTrainingSession[]
  workerTrainingRecords: SstWorkerTrainingRecord[]
  notifications: SstOnboardingNotification[]
  risks: SstRiskAssessment[]
  preventiveActions: SstPreventiveAction[]
  eppCatalog: SstEppCatalogItem[]
  jobEppRequirements: SstJobEppRequirement[]
  workerEppDeliveries: SstWorkerEppDelivery[]
  inspections: SstInspection[]
  inspectionFindings: SstInspectionFinding[]
  healthAptitudes: SstWorkerHealthAptitude[]
  accidentsIncidents: SstAccidentIncident[]
  emergencyPlans: SstEmergencyPlan[]
  committeeRecords: SstCommitteeRecord[]
  safeWorkProcedures: SstSafeWorkProcedure[]
}

export const ALLOWED_SST_DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx"] as const

export function isAllowedSstDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase().trim()
  return ALLOWED_SST_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function formatSstFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}
