import { supabase } from "@/lib/supabase"
import { sanitizeFileName } from "@/lib/documents"
import {
  EXPEDIENTE_BUCKET,
  currentUserId,
  downloadExpedienteFile,
  removeExpedienteFiles,
  uploadExpedienteFile,
} from "@/modules/people/infrastructure/expediente-storage"
import {
  computeSstRiskLevel,
  isAllowedSstDocumentFile,
  type EntityAreaOption,
  type EntityJobOption,
  type EntitySstState,
  type EntityWorkerSstOption,
  type SstAccidentIncident,
  type SstActionPriority,
  type SstCommitteeRecord,
  type SstEmergencyPlan,
  type SstEppCatalogItem,
  type SstEppDeliveryStatus,
  type SstHealthAptitudeStatus,
  type SstInspection,
  type SstInspectionFinding,
  type SstInspectionStatus,
  type SstJobEppRequirement,
  type SstJobFolder,
  type SstNotificationTriggerType,
  type SstOnboardingNotification,
  type SstPreventiveAction,
  type SstPreventiveActionOrigin,
  type SstPreventiveActionStatus,
  type SstProbabilityLevel,
  type SstRiskAssessment,
  type SstRiskStatus,
  type SstRiskType,
  type SstSafeWorkProcedure,
  type SstSessionStatus,
  type SstSeverityLevel,
  type SstTopicDocument,
  type SstTrainingFrequency,
  type SstTrainingSession,
  type SstTrainingTopic,
  type SstWorkerEppDelivery,
  type SstWorkerHealthAptitude,
  type SstWorkerTrainingRecord,
} from "../domain/entities"

export const SST_CHANGED_EVENT = "sitecorp:sst-changed"
const STORAGE_KEY_PREFIX = "sitecorp_entity_sst_v1_"
const CACHE_TTL_MS = 12_000

interface CachedEntitySstState {
  fetchedAt: number
  state: EntitySstState
}

const memoryCache = new Map<string, CachedEntitySstState>()
const inflightLoads = new Map<string, Promise<EntitySstState>>()

export function notifySstChanged(entityId?: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SST_CHANGED_EVENT, { detail: { entityId } }))
  }
}

function emptySstState(): EntitySstState {
  return {
    jobFolders: [],
    topics: [],
    documents: [],
    sessions: [],
    workerTrainingRecords: [],
    notifications: [],
    risks: [],
    preventiveActions: [],
    eppCatalog: [],
    jobEppRequirements: [],
    workerEppDeliveries: [],
    inspections: [],
    inspectionFindings: [],
    healthAptitudes: [],
    accidentsIncidents: [],
    emergencyPlans: [],
    committeeRecords: [],
    safeWorkProcedures: [],
  }
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { code?: string; message?: string; details?: string }
  const code = String(err.code || "")
  const msg = `${err.message || ""} ${err.details || ""}`.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  )
}

function localKey(entityId: string): string {
  return `${STORAGE_KEY_PREFIX}${entityId}`
}

function remoteStatePath(entityId: string): string {
  return `sst/entity_${entityId}/state_v1.json`
}

function normalizeSstState(
  entityId: string,
  raw: Partial<EntitySstState> | null | undefined
): EntitySstState {
  if (!raw || typeof raw !== "object") return emptySstState()
  const filterByEntity = <T extends { organization_entity_id: string }>(arr: unknown): T[] => {
    if (!Array.isArray(arr)) return []
    return (arr as T[]).filter(
      (item) => item && typeof item === "object" && item.organization_entity_id === entityId
    )
  }

  return {
    jobFolders: filterByEntity<SstJobFolder>(raw.jobFolders),
    topics: filterByEntity<SstTrainingTopic>(raw.topics),
    documents: filterByEntity<SstTopicDocument>(raw.documents),
    sessions: filterByEntity<SstTrainingSession>(raw.sessions).map((s) => ({
      ...s,
      participant_worker_ids: Array.isArray(s.participant_worker_ids)
        ? s.participant_worker_ids
        : [],
    })),
    workerTrainingRecords: filterByEntity<SstWorkerTrainingRecord>(raw.workerTrainingRecords),
    notifications: filterByEntity<SstOnboardingNotification>(raw.notifications),
    risks: filterByEntity<SstRiskAssessment>(raw.risks),
    preventiveActions: filterByEntity<SstPreventiveAction>(raw.preventiveActions),
    eppCatalog: filterByEntity<SstEppCatalogItem>(raw.eppCatalog),
    jobEppRequirements: filterByEntity<SstJobEppRequirement>(raw.jobEppRequirements),
    workerEppDeliveries: filterByEntity<SstWorkerEppDelivery>(raw.workerEppDeliveries),
    inspections: filterByEntity<SstInspection>(raw.inspections),
    inspectionFindings: filterByEntity<SstInspectionFinding>(raw.inspectionFindings),
    healthAptitudes: filterByEntity<SstWorkerHealthAptitude>(raw.healthAptitudes),
    accidentsIncidents: filterByEntity<SstAccidentIncident>(raw.accidentsIncidents),
    emergencyPlans: filterByEntity<SstEmergencyPlan>(raw.emergencyPlans),
    committeeRecords: filterByEntity<SstCommitteeRecord>(raw.committeeRecords),
    safeWorkProcedures: filterByEntity<SstSafeWorkProcedure>(raw.safeWorkProcedures),
  }
}

function readLocalState(entityId: string): EntitySstState {
  if (typeof window === "undefined") return emptySstState()
  try {
    const raw = window.localStorage.getItem(localKey(entityId))
    if (!raw) return emptySstState()
    return normalizeSstState(entityId, JSON.parse(raw) as Partial<EntitySstState>)
  } catch {
    return emptySstState()
  }
}

function writeLocalState(entityId: string, state: EntitySstState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(localKey(entityId), JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
}

function updateCachedSstState(entityId: string, state: EntitySstState): void {
  const clean = normalizeSstState(entityId, state)
  memoryCache.set(entityId, { fetchedAt: Date.now(), state: clean })
  writeLocalState(entityId, clean)
  notifySstChanged(entityId)
}

async function persistFallbackSstState(entityId: string, state: EntitySstState): Promise<void> {
  const clean = normalizeSstState(entityId, state)
  updateCachedSstState(entityId, clean)

  try {
    const remotePayload: EntitySstState = {
      ...clean,
      documents: clean.documents.map((doc) => ({
        ...doc,
        data_url: doc.storage_path ? null : doc.data_url,
      })),
    }
    const blob = new Blob([JSON.stringify(remotePayload)], { type: "application/json" })
    await supabase.storage.from(EXPEDIENTE_BUCKET).upload(remoteStatePath(entityId), blob, {
      cacheControl: "0",
      upsert: true,
      contentType: "application/json",
    })
  } catch {
    // Local fallback already persisted
  }
}

async function tryFetchDatabaseSstState(entityId: string): Promise<EntitySstState | null> {
  const [
    foldersRes,
    topicsRes,
    docsRes,
    sessionsRes,
    recordsRes,
    notifsRes,
    risksRes,
    actionsRes,
    eppCatalogRes,
    jobEppRes,
    workerEppRes,
    inspectionsRes,
    findingsRes,
    aptitudeRes,
    accidentsRes,
    plansRes,
    committeeRes,
    proceduresRes,
  ] = await Promise.all([
    supabase
      .from("sst_job_folders")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("sst_training_topics")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("sst_topic_documents")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sst_training_sessions")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("scheduled_date", { ascending: true }),
    supabase
      .from("sst_worker_training_records")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("received_date", { ascending: false }),
    supabase
      .from("sst_onboarding_notifications")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sst_risk_assessments")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sst_preventive_actions")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("due_date", { ascending: true }),
    supabase
      .from("sst_epp_catalog")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("name", { ascending: true }),
    supabase
      .from("sst_job_epp_requirements")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("sst_worker_epp_deliveries")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("delivery_date", { ascending: false }),
    supabase
      .from("sst_inspections")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("scheduled_date", { ascending: false }),
    supabase
      .from("sst_inspection_findings")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("sst_worker_health_aptitude")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("evaluation_date", { ascending: false }),
    supabase
      .from("sst_accidents_incidents")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("sst_emergency_plans")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sst_committee_records")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("record_date", { ascending: false }),
    supabase
      .from("sst_safe_work_procedures")
      .select("*")
      .eq("organization_entity_id", entityId)
      .order("code", { ascending: true }),
  ])

  const firstError =
    foldersRes.error ||
    topicsRes.error ||
    docsRes.error ||
    sessionsRes.error ||
    recordsRes.error ||
    notifsRes.error ||
    risksRes.error ||
    actionsRes.error ||
    eppCatalogRes.error ||
    jobEppRes.error ||
    workerEppRes.error ||
    inspectionsRes.error ||
    findingsRes.error ||
    aptitudeRes.error ||
    accidentsRes.error ||
    plansRes.error ||
    committeeRes.error ||
    proceduresRes.error

  if (firstError) {
    if (isMissingTableError(firstError)) {
      return null
    }
    throw firstError
  }

  return normalizeSstState(entityId, {
    jobFolders: (foldersRes.data || []) as SstJobFolder[],
    topics: (topicsRes.data || []) as SstTrainingTopic[],
    documents: (docsRes.data || []) as SstTopicDocument[],
    sessions: (sessionsRes.data || []) as SstTrainingSession[],
    workerTrainingRecords: (recordsRes.data || []) as SstWorkerTrainingRecord[],
    notifications: (notifsRes.data || []) as SstOnboardingNotification[],
    risks: (risksRes.data || []) as SstRiskAssessment[],
    preventiveActions: (actionsRes.data || []) as SstPreventiveAction[],
    eppCatalog: (eppCatalogRes.data || []) as SstEppCatalogItem[],
    jobEppRequirements: (jobEppRes.data || []) as SstJobEppRequirement[],
    workerEppDeliveries: (workerEppRes.data || []) as SstWorkerEppDelivery[],
    inspections: (inspectionsRes.data || []) as SstInspection[],
    inspectionFindings: (findingsRes.data || []) as SstInspectionFinding[],
    healthAptitudes: (aptitudeRes.data || []) as SstWorkerHealthAptitude[],
    accidentsIncidents: (accidentsRes.data || []) as SstAccidentIncident[],
    emergencyPlans: (plansRes.data || []) as SstEmergencyPlan[],
    committeeRecords: (committeeRes.data || []) as SstCommitteeRecord[],
    safeWorkProcedures: (proceduresRes.data || []) as SstSafeWorkProcedure[],
  })
}

export async function loadEntitySstState(
  entityId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<EntitySstState> {
  if (!entityId) return emptySstState()

  const cached = memoryCache.get(entityId)
  if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.state
  }

  const inflight = inflightLoads.get(entityId)
  if (!options.forceRefresh && inflight) {
    return inflight
  }

  const promise = (async () => {
    try {
      const dbState = await tryFetchDatabaseSstState(entityId)
      if (dbState !== null) {
        memoryCache.set(entityId, { fetchedAt: Date.now(), state: dbState })
        writeLocalState(entityId, dbState)
        inflightLoads.delete(entityId)
        return dbState
      }
    } catch {
      // Fallback to storage/local state
    }

    let state = readLocalState(entityId)
    try {
      const { data, error } = await supabase.storage
        .from(EXPEDIENTE_BUCKET)
        .download(remoteStatePath(entityId))
      if (!error && data) {
        const text = await data.text()
        const remoteState = normalizeSstState(entityId, JSON.parse(text) as Partial<EntitySstState>)
        if (remoteState.jobFolders.length > 0 || remoteState.risks.length > 0 || state.jobFolders.length === 0) {
          state = remoteState
          writeLocalState(entityId, state)
        }
      }
    } catch {
      // Ignore storage read failure
    }

    memoryCache.set(entityId, { fetchedAt: Date.now(), state })
    inflightLoads.delete(entityId)
    return state
  })()

  inflightLoads.set(entityId, promise)
  return promise
}

const firstItem = <T,>(val: T | T[] | null | undefined): T | null =>
  Array.isArray(val) ? val[0] ?? null : val ?? null

/**
 * Obtiene exclusivamente los cargos (`organization_jobs`) existentes en la estructura
 * organizativa de la entidad seleccionada. No crea ni duplica cargos.
 */
export async function fetchEntityOrganizationJobs(entityId: string): Promise<EntityJobOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("organization_jobs")
    .select("id, name, code, is_active, area_id, area:organization_areas(id, name)")
    .eq("organization_entity_id", entityId)
    .order("name", { ascending: true })

  if (error) throw error

  return (
    (data as unknown as
      | {
          id: string
          name: string
          code: string | null
          is_active: boolean | null
          area_id: string | null
          area: { id: string; name: string } | { id: string; name: string }[] | null
        }[]
      | null) || []
  ).map((row) => {
    const area = firstItem(row.area)
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      areaId: area?.id ?? row.area_id ?? null,
      areaName: area?.name ?? null,
      isActive: row.is_active ?? true,
    }
  })
}

export async function fetchEntityOrganizationAreasForSst(
  entityId: string
): Promise<EntityAreaOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("organization_areas")
    .select("id, name, code, is_active")
    .eq("organization_entity_id", entityId)
    .order("name", { ascending: true })

  if (error) throw error
  return ((data as { id: string; name: string; code: string | null; is_active: boolean }[]) || []).map(
    (row) => ({
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      isActive: row.is_active ?? true,
    })
  )
}

export async function fetchEntityWorkersForSst(
  entityId: string
): Promise<EntityWorkerSstOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("workers")
    .select(
      `id, code, first_name, first_surname, second_surname, identification, employment_status, hire_date,
       assignments:worker_position_assignments(
         is_current, end_date,
         position:organization_positions(
           id, name,
           job:organization_jobs(
             id, name,
             area:organization_areas(id, name)
           )
         )
       )`
    )
    .eq("organization_entity_id", entityId)
    .order("first_surname", { ascending: true })
    .order("first_name", { ascending: true })

  if (error) throw error

  return (
    (data as unknown as
      | {
          id: string
          code: string
          first_name: string
          first_surname: string
          second_surname: string | null
          identification: string
          employment_status: string
          hire_date: string | null
          assignments:
            | {
                is_current: boolean
                end_date: string | null
                position:
                  | {
                      id: string
                      name: string
                      job:
                        | {
                            id: string
                            name: string
                            area: { id: string; name: string } | { id: string; name: string }[] | null
                          }
                        | {
                            id: string
                            name: string
                            area: { id: string; name: string } | { id: string; name: string }[] | null
                          }[]
                        | null
                    }
                  | {
                      id: string
                      name: string
                      job:
                        | {
                            id: string
                            name: string
                            area: { id: string; name: string } | { id: string; name: string }[] | null
                          }
                        | {
                            id: string
                            name: string
                            area: { id: string; name: string } | { id: string; name: string }[] | null
                          }[]
                        | null
                    }[]
                  | null
              }[]
            | null
        }[]
      | null) || []
  ).map((row) => {
    const activeAssignment =
      (row.assignments || []).find((a) => a.is_current && !a.end_date) ||
      (row.assignments || [])[0] ||
      null
    const pos = activeAssignment ? firstItem(activeAssignment.position) : null
    const job = pos ? firstItem(pos.job) : null
    const area = job ? firstItem(job.area) : null

    return {
      id: row.id,
      code: row.code,
      fullName: [row.first_name, row.first_surname, row.second_surname].filter(Boolean).join(" "),
      identification: row.identification,
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      positionId: pos?.id ?? null,
      positionName: pos?.name ?? null,
      employmentStatus: row.employment_status,
      hireDate: row.hire_date ?? null,
    }
  })
}

// ============================================================================
// 1. CAPACITACIONES DE SST POR CARGO (`organization_jobs`)
// ============================================================================

export async function incorporateEntityJobSstFolder(input: {
  entityId: string
  jobId: string
  jobName: string
  areaId?: string | null
  areaName?: string | null
}): Promise<SstJobFolder> {
  const state = await loadEntitySstState(input.entityId)
  const existing = state.jobFolders.find(
    (f) => f.organization_entity_id === input.entityId && f.job_id === input.jobId
  )
  if (existing) return existing

  const now = new Date().toISOString()
  const folder: SstJobFolder = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    job_id: input.jobId,
    job_name_snapshot: input.jobName.trim(),
    area_id_snapshot: input.areaId ?? null,
    area_name_snapshot: input.areaName ?? null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_job_folders")
    .upsert(
      {
        id: folder.id,
        organization_entity_id: folder.organization_entity_id,
        job_id: folder.job_id,
        job_name_snapshot: folder.job_name_snapshot,
        area_id_snapshot: folder.area_id_snapshot,
        area_name_snapshot: folder.area_name_snapshot,
      },
      { onConflict: "organization_entity_id,job_id" }
    )
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstJobFolder
    updateCachedSstState(input.entityId, {
      ...state,
      jobFolders: [...state.jobFolders.filter((f) => f.id !== saved.id), saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    jobFolders: [...state.jobFolders, folder],
  })
  return folder
}

export async function removeEntityJobSstFolder(entityId: string, folderId: string): Promise<void> {
  const state = await loadEntitySstState(entityId)
  const topicIds = new Set(state.topics.filter((t) => t.folder_id === folderId).map((t) => t.id))
  const docsToRemove = state.documents.filter((d) => topicIds.has(d.topic_id))
  const storagePaths = docsToRemove.map((d) => d.storage_path).filter(Boolean)

  if (storagePaths.length > 0) {
    try {
      await removeExpedienteFiles(storagePaths)
    } catch {
      // Ignore cleanup warning
    }
  }

  const { error } = await supabase
    .from("sst_job_folders")
    .delete()
    .eq("id", folderId)
    .eq("organization_entity_id", entityId)

  const nextState: EntitySstState = {
    ...state,
    jobFolders: state.jobFolders.filter((f) => f.id !== folderId),
    topics: state.topics.filter((t) => t.folder_id !== folderId),
    documents: state.documents.filter((d) => !topicIds.has(d.topic_id)),
    sessions: state.sessions.filter((s) => s.folder_id !== folderId),
    // `workerTrainingRecords` y `notifications` se conservan siempre
  }

  if (!error) {
    updateCachedSstState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(entityId, nextState)
}

export async function createSstTrainingTopic(input: {
  entityId: string
  folderId: string
  title: string
  description?: string | null
  frequency: SstTrainingFrequency
  customFrequencyLabel?: string | null
}): Promise<SstTrainingTopic> {
  const state = await loadEntitySstState(input.entityId)
  const folder = state.jobFolders.find((f) => f.id === input.folderId)
  if (!folder) {
    throw new Error("La carpeta de cargo seleccionada no existe en esta entidad.")
  }

  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    throw new Error("El nombre del tema de capacitación de SST es obligatorio.")
  }

  const now = new Date().toISOString()
  const topic: SstTrainingTopic = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    folder_id: folder.id,
    job_id: folder.job_id,
    title: trimmedTitle,
    description: input.description?.trim() || null,
    frequency: input.frequency,
    custom_frequency_label:
      input.frequency === "PERSONALIZADA" ? input.customFrequencyLabel?.trim() || null : null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_training_topics")
    .insert({
      id: topic.id,
      organization_entity_id: topic.organization_entity_id,
      folder_id: topic.folder_id,
      job_id: topic.job_id,
      title: topic.title,
      description: topic.description,
      frequency: topic.frequency,
      custom_frequency_label: topic.custom_frequency_label,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstTrainingTopic
    updateCachedSstState(input.entityId, {
      ...state,
      topics: [...state.topics, saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    topics: [...state.topics, topic],
  })
  return topic
}

export async function deleteSstTrainingTopic(entityId: string, topicId: string): Promise<void> {
  const state = await loadEntitySstState(entityId)
  const docsToRemove = state.documents.filter((d) => d.topic_id === topicId)
  const storagePaths = docsToRemove.map((d) => d.storage_path).filter(Boolean)

  if (storagePaths.length > 0) {
    try {
      await removeExpedienteFiles(storagePaths)
    } catch {
      // Ignore cleanup warning
    }
  }

  const { error } = await supabase
    .from("sst_training_topics")
    .delete()
    .eq("id", topicId)
    .eq("organization_entity_id", entityId)

  const nextState: EntitySstState = {
    ...state,
    topics: state.topics.filter((t) => t.id !== topicId),
    documents: state.documents.filter((d) => d.topic_id !== topicId),
    sessions: state.sessions.filter((s) => s.topic_id !== topicId),
  }

  if (!error) {
    updateCachedSstState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(entityId, nextState)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    reader.readAsDataURL(file)
  })
}

export async function uploadSstTopicDocument(input: {
  entityId: string
  topicId: string
  file: File
}): Promise<SstTopicDocument> {
  if (!isAllowedSstDocumentFile(input.file)) {
    throw new Error("Solo se permiten documentos en formato PDF (.pdf) o Word (.doc, .docx).")
  }

  const state = await loadEntitySstState(input.entityId)
  const topic = state.topics.find(
    (t) => t.id === input.topicId && t.organization_entity_id === input.entityId
  )
  if (!topic) {
    throw new Error("El tema de SST seleccionado no pertenece a esta entidad.")
  }

  const docId = makeUuid()
  const safeName = sanitizeFileName(input.file.name)
  const storagePath = `sst/entity_${input.entityId}/topics/${input.topicId}/${docId}_${safeName}`
  const uploadedBy = await currentUserId()
  let dataUrlFallback: string | null = null

  try {
    await uploadExpedienteFile(storagePath, input.file)
  } catch {
    dataUrlFallback = await fileToDataUrl(input.file)
  }

  const docRecord: SstTopicDocument = {
    id: docId,
    organization_entity_id: input.entityId,
    topic_id: input.topicId,
    file_name: input.file.name,
    storage_path: storagePath,
    mime_type: input.file.type || "application/octet-stream",
    file_size: input.file.size,
    data_url: dataUrlFallback,
    uploaded_by: uploadedBy,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("sst_topic_documents")
    .insert({
      id: docRecord.id,
      organization_entity_id: docRecord.organization_entity_id,
      topic_id: docRecord.topic_id,
      file_name: docRecord.file_name,
      storage_path: docRecord.storage_path,
      mime_type: docRecord.mime_type,
      file_size: docRecord.file_size,
      data_url: docRecord.data_url,
      uploaded_by: docRecord.uploaded_by,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstTopicDocument
    updateCachedSstState(input.entityId, {
      ...state,
      documents: [saved, ...state.documents],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    documents: [docRecord, ...state.documents],
  })
  return docRecord
}

export async function downloadSstTopicDocument(doc: SstTopicDocument): Promise<Blob> {
  if (doc.storage_path) {
    try {
      return await downloadExpedienteFile(doc.storage_path)
    } catch {
      // Fallback to data_url
    }
  }
  if (doc.data_url) {
    const res = await fetch(doc.data_url)
    return await res.blob()
  }
  throw new Error("No se pudo descargar el documento desde el almacenamiento.")
}

export async function deleteSstTopicDocument(entityId: string, documentId: string): Promise<void> {
  const state = await loadEntitySstState(entityId)
  const doc = state.documents.find(
    (d) => d.id === documentId && d.organization_entity_id === entityId
  )
  if (!doc) return

  if (doc.storage_path) {
    try {
      await removeExpedienteFiles([doc.storage_path])
    } catch {
      // Ignore storage error
    }
  }

  const { error } = await supabase
    .from("sst_topic_documents")
    .delete()
    .eq("id", documentId)
    .eq("organization_entity_id", entityId)

  const nextState: EntitySstState = {
    ...state,
    documents: state.documents.filter((d) => d.id !== documentId),
  }

  if (!error) {
    updateCachedSstState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(entityId, nextState)
}

export async function scheduleSstTrainingSession(input: {
  entityId: string
  topicId: string
  scheduledDate: string
  notes?: string | null
}): Promise<SstTrainingSession> {
  const state = await loadEntitySstState(input.entityId)
  const topic = state.topics.find(
    (t) => t.id === input.topicId && t.organization_entity_id === input.entityId
  )
  if (!topic) {
    throw new Error("El tema de SST seleccionado no existe en esta entidad.")
  }
  if (!input.scheduledDate) {
    throw new Error("Selecciona una fecha para programar la sesión de SST.")
  }

  const now = new Date().toISOString()
  const session: SstTrainingSession = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    folder_id: topic.folder_id,
    job_id: topic.job_id,
    topic_id: topic.id,
    scheduled_date: input.scheduledDate,
    status: "PROGRAMADA",
    notes: input.notes?.trim() || null,
    participant_worker_ids: [],
    completed_at: null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_training_sessions")
    .insert({
      id: session.id,
      organization_entity_id: session.organization_entity_id,
      folder_id: session.folder_id,
      job_id: session.job_id,
      topic_id: session.topic_id,
      scheduled_date: session.scheduled_date,
      status: session.status,
      notes: session.notes,
      participant_worker_ids: [],
      completed_at: null,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = {
      ...(data as SstTrainingSession),
      participant_worker_ids: Array.isArray((data as SstTrainingSession).participant_worker_ids)
        ? (data as SstTrainingSession).participant_worker_ids
        : [],
    }
    updateCachedSstState(input.entityId, {
      ...state,
      sessions: [...state.sessions, saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    sessions: [...state.sessions, session],
  })
  return session
}

export async function saveSstTrainingSessionOutcome(input: {
  entityId: string
  sessionId: string
  scheduledDate?: string
  status: SstSessionStatus
  notes?: string | null
  participantWorkerIds?: string[]
  jobById?: Map<string, EntityJobOption>
}): Promise<SstTrainingSession> {
  const state = await loadEntitySstState(input.entityId)
  const sessionIndex = state.sessions.findIndex(
    (s) => s.id === input.sessionId && s.organization_entity_id === input.entityId
  )
  if (sessionIndex === -1) {
    throw new Error("La sesión de capacitación de SST no fue encontrada.")
  }

  const currentSession = state.sessions[sessionIndex]
  const topic = state.topics.find((t) => t.id === currentSession.topic_id)
  const folder = state.jobFolders.find((f) => f.id === currentSession.folder_id)
  const liveJob = input.jobById?.get(currentSession.job_id)

  const uniqueWorkerIds =
    input.status === "REALIZADA"
      ? Array.from(new Set((input.participantWorkerIds || []).filter(Boolean)))
      : []

  const now = new Date().toISOString()
  const effectiveDate = input.scheduledDate || currentSession.scheduled_date

  const updatedSession: SstTrainingSession = {
    ...currentSession,
    scheduled_date: effectiveDate,
    status: input.status,
    notes: input.notes !== undefined ? input.notes?.trim() || null : currentSession.notes,
    participant_worker_ids: uniqueWorkerIds,
    completed_at: input.status === "REALIZADA" ? currentSession.completed_at || now : null,
    updated_at: now,
  }

  const nextSessions = [...state.sessions]
  nextSessions[sessionIndex] = updatedSession

  const otherRecords = state.workerTrainingRecords.filter(
    (r) => r.session_id !== currentSession.id
  )
  const currentSessionRecordsByWorker = new Map(
    state.workerTrainingRecords
      .filter((r) => r.session_id === currentSession.id)
      .map((r) => [r.worker_id, r])
  )

  const jobNameSnapshot = liveJob?.name || folder?.job_name_snapshot || "Cargo"
  const areaIdSnapshot = liveJob?.areaId ?? folder?.area_id_snapshot ?? null
  const areaNameSnapshot = liveJob?.areaName ?? folder?.area_name_snapshot ?? null
  const topicTitleSnapshot = topic?.title || "Tema de SST"

  const updatedSessionRecords: SstWorkerTrainingRecord[] =
    input.status === "REALIZADA"
      ? uniqueWorkerIds.map((workerId) => {
          const prev = currentSessionRecordsByWorker.get(workerId)
          return {
            id: prev?.id || makeUuid(),
            organization_entity_id: input.entityId,
            worker_id: workerId,
            session_id: currentSession.id,
            topic_id: currentSession.topic_id,
            topic_title_snapshot: topicTitleSnapshot,
            job_id_snapshot: currentSession.job_id,
            job_name_snapshot: jobNameSnapshot,
            area_id_snapshot: areaIdSnapshot,
            area_name_snapshot: areaNameSnapshot,
            received_date: effectiveDate,
            status: "RECIBIDA",
            kind: "SESION_SST",
            notes: updatedSession.notes,
            created_at: prev?.created_at || now,
          }
        })
      : []

  const { error: sessionDbError } = await supabase
    .from("sst_training_sessions")
    .update({
      scheduled_date: updatedSession.scheduled_date,
      status: updatedSession.status,
      notes: updatedSession.notes,
      participant_worker_ids: updatedSession.participant_worker_ids,
      completed_at: updatedSession.completed_at,
      updated_at: now,
    })
    .eq("id", currentSession.id)
    .eq("organization_entity_id", input.entityId)

  if (!sessionDbError) {
    await supabase
      .from("sst_worker_training_records")
      .delete()
      .eq("organization_entity_id", input.entityId)
      .eq("session_id", currentSession.id)

    if (updatedSessionRecords.length > 0) {
      const { error: recErr } = await supabase.from("sst_worker_training_records").insert(
        updatedSessionRecords.map((r) => ({
          id: r.id,
          organization_entity_id: r.organization_entity_id,
          worker_id: r.worker_id,
          session_id: r.session_id,
          topic_id: r.topic_id,
          topic_title_snapshot: r.topic_title_snapshot,
          job_id_snapshot: r.job_id_snapshot,
          job_name_snapshot: r.job_name_snapshot,
          area_id_snapshot: r.area_id_snapshot,
          area_name_snapshot: r.area_name_snapshot,
          received_date: r.received_date,
          status: r.status,
          kind: r.kind,
          notes: r.notes,
        }))
      )
      if (recErr && !isMissingTableError(recErr)) throw recErr
    }

    updateCachedSstState(input.entityId, {
      ...state,
      sessions: nextSessions,
      workerTrainingRecords: [...otherRecords, ...updatedSessionRecords],
    })
    return updatedSession
  }

  if (!isMissingTableError(sessionDbError)) throw sessionDbError

  await persistFallbackSstState(input.entityId, {
    ...state,
    sessions: nextSessions,
    workerTrainingRecords: [...otherRecords, ...updatedSessionRecords],
  })
  return updatedSession
}

export async function deleteSstTrainingSession(
  entityId: string,
  sessionId: string
): Promise<void> {
  const state = await loadEntitySstState(entityId)
  const { error } = await supabase
    .from("sst_training_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("organization_entity_id", entityId)

  const nextState: EntitySstState = {
    ...state,
    sessions: state.sessions.filter((s) => s.id !== sessionId),
  }

  if (!error) {
    updateCachedSstState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(entityId, nextState)
}

export async function registerWorkerDirectSstTraining(input: {
  entityId: string
  workerId: string
  topicId?: string | null
  customTopicTitle?: string | null
  jobId?: string | null
  jobName?: string | null
  areaId?: string | null
  areaName?: string | null
  receivedDate: string
  kind?: "INICIAL_CONTRATACION_SST" | "CAMBIO_CARGO_SST" | "SESION_SST"
  notes?: string | null
  notificationId?: string | null
}): Promise<SstWorkerTrainingRecord> {
  const state = await loadEntitySstState(input.entityId)
  const topic = input.topicId ? state.topics.find((t) => t.id === input.topicId) : null
  const folder = topic ? state.jobFolders.find((f) => f.id === topic.folder_id) : null

  const resolvedTitle = (
    topic?.title ||
    input.customTopicTitle ||
    "Instrucción inicial de Seguridad y Salud en el Trabajo (SST)"
  ).trim()
  if (!resolvedTitle) {
    throw new Error("Indica el tema de la capacitación de SST recibida.")
  }

  const now = new Date().toISOString()
  const record: SstWorkerTrainingRecord = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    worker_id: input.workerId,
    session_id: null,
    topic_id: topic?.id ?? null,
    topic_title_snapshot: resolvedTitle,
    job_id_snapshot: topic?.job_id ?? input.jobId ?? null,
    job_name_snapshot: folder?.job_name_snapshot ?? input.jobName ?? null,
    area_id_snapshot: folder?.area_id_snapshot ?? input.areaId ?? null,
    area_name_snapshot: folder?.area_name_snapshot ?? input.areaName ?? null,
    received_date: input.receivedDate || now.slice(0, 10),
    status: "RECIBIDA",
    kind: input.kind || "INICIAL_CONTRATACION_SST",
    notes: input.notes?.trim() || null,
    created_at: now,
  }

  const nextNotifications = state.notifications.map((n) => {
    const matchesTarget =
      n.organization_entity_id === input.entityId &&
      n.worker_id === input.workerId &&
      n.status !== "COMPLETADA" &&
      (!input.notificationId || n.id === input.notificationId)

    if (!matchesTarget) return n
    return {
      ...n,
      status: "COMPLETADA" as const,
      completed_at: now,
      completed_record_id: record.id,
    }
  })

  const { data: insertedRec, error: recError } = await supabase
    .from("sst_worker_training_records")
    .insert({
      id: record.id,
      organization_entity_id: record.organization_entity_id,
      worker_id: record.worker_id,
      session_id: null,
      topic_id: record.topic_id,
      topic_title_snapshot: record.topic_title_snapshot,
      job_id_snapshot: record.job_id_snapshot,
      job_name_snapshot: record.job_name_snapshot,
      area_id_snapshot: record.area_id_snapshot,
      area_name_snapshot: record.area_name_snapshot,
      received_date: record.received_date,
      status: record.status,
      kind: record.kind,
      notes: record.notes,
    })
    .select("*")
    .single()

  if (!recError && insertedRec) {
    let notifUpdateQuery = supabase
      .from("sst_onboarding_notifications")
      .update({
        status: "COMPLETADA",
        completed_at: now,
        completed_record_id: record.id,
      })
      .eq("organization_entity_id", input.entityId)
      .eq("worker_id", input.workerId)
      .neq("status", "COMPLETADA")

    if (input.notificationId) {
      notifUpdateQuery = notifUpdateQuery.eq("id", input.notificationId)
    }
    await notifUpdateQuery

    const saved = insertedRec as SstWorkerTrainingRecord
    updateCachedSstState(input.entityId, {
      ...state,
      workerTrainingRecords: [saved, ...state.workerTrainingRecords],
      notifications: nextNotifications,
    })
    return saved
  }

  if (recError && !isMissingTableError(recError)) throw recError

  await persistFallbackSstState(input.entityId, {
    ...state,
    workerTrainingRecords: [record, ...state.workerTrainingRecords],
    notifications: nextNotifications,
  })
  return record
}

/**
 * Genera automáticamente una notificación de SST en la entidad cuando un candidato es
 * contratado (`NUEVA_CONTRATACION`) o cuando un trabajador cambia de cargo (`CAMBIO_CARGO`).
 * Evita duplicados mediante `event_key`.
 */
export async function ensureSstAssignmentNotification(input: {
  workerId: string | null | undefined
  positionId?: string | null
  effectiveDate?: string | null
  triggerType: SstNotificationTriggerType
}): Promise<void> {
  if (!input.workerId) return

  try {
    const { data: workerData } = await supabase
      .from("workers")
      .select(
        "id, code, first_name, first_surname, second_surname, identification, hire_date, organization_entity_id"
      )
      .eq("id", input.workerId)
      .maybeSingle()

    if (!workerData) return

    const workerRow = workerData as {
      id: string
      code: string | null
      first_name: string
      first_surname: string
      second_surname: string | null
      identification: string | null
      hire_date: string | null
      organization_entity_id: string
    }

    const entityId = workerRow.organization_entity_id
    if (!entityId) return

    let jobId: string | null = null
    let jobName: string | null = null
    let areaId: string | null = null
    let areaName: string | null = null
    let positionName: string | null = null

    if (input.positionId) {
      const { data: posData } = await supabase
        .from("organization_positions")
        .select(
          `id, name,
           job:organization_jobs(
             id, name,
             area:organization_areas(id, name)
           )`
        )
        .eq("id", input.positionId)
        .maybeSingle()

      if (posData) {
        const rawPos = posData as {
          name?: string
          job?:
            | {
                id?: string
                name?: string
                area?: { id: string; name: string } | { id: string; name: string }[] | null
              }
            | {
                id?: string
                name?: string
                area?: { id: string; name: string } | { id: string; name: string }[] | null
              }[]
            | null
        }
        positionName = rawPos.name ?? null
        const job = firstItem(rawPos.job)
        jobId = job?.id ?? null
        jobName = job?.name ?? null
        const area = job ? firstItem(job.area) : null
        areaId = area?.id ?? null
        areaName = area?.name ?? null
      }
    }

    const effectiveDate =
      input.effectiveDate || workerRow.hire_date || new Date().toISOString().slice(0, 10)
    const eventKey = `${entityId}:${workerRow.id}:${jobId || "no-job"}:${input.triggerType}:${effectiveDate}`

    const state = await loadEntitySstState(entityId, { forceRefresh: true })
    const alreadyExists = state.notifications.some(
      (n) =>
        n.event_key === eventKey ||
        (n.worker_id === workerRow.id &&
          n.job_id === jobId &&
          n.trigger_type === input.triggerType &&
          n.status !== "COMPLETADA")
    )
    if (alreadyExists) return

    const workerFullName = [
      workerRow.first_name,
      workerRow.first_surname,
      workerRow.second_surname,
    ]
      .filter(Boolean)
      .join(" ")

    const notification: SstOnboardingNotification = {
      id: makeUuid(),
      organization_entity_id: entityId,
      worker_id: workerRow.id,
      event_key: eventKey,
      trigger_type: input.triggerType,
      worker_name: workerFullName || "Trabajador",
      worker_code: workerRow.code ?? null,
      worker_identification: workerRow.identification ?? null,
      job_id: jobId,
      job_name: jobName,
      area_id: areaId,
      area_name: areaName,
      position_name: positionName,
      effective_date: effectiveDate,
      status: "PENDIENTE",
      completed_at: null,
      completed_record_id: null,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from("sst_onboarding_notifications")
      .upsert(
        {
          id: notification.id,
          organization_entity_id: notification.organization_entity_id,
          worker_id: notification.worker_id,
          event_key: notification.event_key,
          trigger_type: notification.trigger_type,
          worker_name: notification.worker_name,
          worker_code: notification.worker_code,
          worker_identification: notification.worker_identification,
          job_id: notification.job_id,
          job_name: notification.job_name,
          area_id: notification.area_id,
          area_name: notification.area_name,
          position_name: notification.position_name,
          effective_date: notification.effective_date,
          status: "PENDIENTE",
        },
        { onConflict: "organization_entity_id,event_key", ignoreDuplicates: true }
      )
      .select("*")
      .maybeSingle()

    if (!error) {
      const saved = (data as SstOnboardingNotification | null) || notification
      updateCachedSstState(entityId, {
        ...state,
        notifications: [saved, ...state.notifications.filter((n) => n.id !== saved.id)],
      })
      return
    }

    if (!isMissingTableError(error)) throw error

    await persistFallbackSstState(entityId, {
      ...state,
      notifications: [notification, ...state.notifications],
    })
  } catch (err) {
    console.warn("[sst] no se pudo generar la notificación automática de SST", err)
  }
}

// ============================================================================
// 2. EVALUACIÓN DE RIESGOS LABORALES Y PLAN DE PREVENCIÓN
// ============================================================================

export async function createSstRiskAssessment(input: {
  entityId: string
  areaId?: string | null
  areaName?: string | null
  jobId?: string | null
  jobName?: string | null
  positionId?: string | null
  positionName?: string | null
  facilityName?: string | null
  riskType: SstRiskType
  hazardDescription: string
  causeDescription?: string | null
  consequences?: string | null
  probabilityLevel: SstProbabilityLevel
  severityLevel: SstSeverityLevel
  existingControls?: string | null
  evaluatedAt?: string
  reviewDate?: string | null
}): Promise<SstRiskAssessment> {
  const state = await loadEntitySstState(input.entityId)
  const hazard = input.hazardDescription.trim()
  if (!hazard) {
    throw new Error("Describe el peligro o factor de riesgo identificado.")
  }

  const now = new Date().toISOString()
  const riskLevel = computeSstRiskLevel(input.probabilityLevel, input.severityLevel)
  const risk: SstRiskAssessment = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    position_id: input.positionId || null,
    position_name_snapshot: input.positionName || null,
    facility_name: input.facilityName?.trim() || null,
    risk_type: input.riskType,
    hazard_description: hazard,
    cause_description: input.causeDescription?.trim() || null,
    consequences: input.consequences?.trim() || null,
    probability_level: input.probabilityLevel,
    severity_level: input.severityLevel,
    risk_level: riskLevel,
    existing_controls: input.existingControls?.trim() || null,
    status: "ACTIVO",
    evaluated_at: input.evaluatedAt || now.slice(0, 10),
    review_date: input.reviewDate || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_risk_assessments")
    .insert({
      id: risk.id,
      organization_entity_id: risk.organization_entity_id,
      area_id: risk.area_id,
      area_name_snapshot: risk.area_name_snapshot,
      job_id: risk.job_id,
      job_name_snapshot: risk.job_name_snapshot,
      position_id: risk.position_id,
      position_name_snapshot: risk.position_name_snapshot,
      facility_name: risk.facility_name,
      risk_type: risk.risk_type,
      hazard_description: risk.hazard_description,
      cause_description: risk.cause_description,
      consequences: risk.consequences,
      probability_level: risk.probability_level,
      severity_level: risk.severity_level,
      risk_level: risk.risk_level,
      existing_controls: risk.existing_controls,
      status: risk.status,
      evaluated_at: risk.evaluated_at,
      review_date: risk.review_date,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstRiskAssessment
    updateCachedSstState(input.entityId, {
      ...state,
      risks: [saved, ...state.risks],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    risks: [risk, ...state.risks],
  })
  return risk
}

export async function updateSstRiskStatus(input: {
  entityId: string
  riskId: string
  status: SstRiskStatus
}): Promise<void> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const { error } = await supabase
    .from("sst_risk_assessments")
    .update({ status: input.status, updated_at: now })
    .eq("id", input.riskId)
    .eq("organization_entity_id", input.entityId)

  const nextState: EntitySstState = {
    ...state,
    risks: state.risks.map((r) =>
      r.id === input.riskId ? { ...r, status: input.status, updated_at: now } : r
    ),
  }

  if (!error) {
    updateCachedSstState(input.entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(input.entityId, nextState)
}

export async function createSstPreventiveAction(input: {
  entityId: string
  originType: SstPreventiveActionOrigin
  originId?: string | null
  originLabel?: string | null
  description: string
  areaId?: string | null
  areaName?: string | null
  jobId?: string | null
  jobName?: string | null
  responsibleWorkerId?: string | null
  responsibleName?: string | null
  priority: SstActionPriority
  dueDate: string
}): Promise<SstPreventiveAction> {
  const state = await loadEntitySstState(input.entityId)
  const desc = input.description.trim()
  if (!desc) {
    throw new Error("Describe la medida preventiva o correctiva a ejecutar.")
  }
  if (!input.dueDate) {
    throw new Error("Indica la fecha límite de cumplimiento de la medida.")
  }

  const now = new Date().toISOString()
  const action: SstPreventiveAction = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    origin_type: input.originType,
    origin_id: input.originId || null,
    origin_label: input.originLabel?.trim() || null,
    description: desc,
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    responsible_worker_id: input.responsibleWorkerId || null,
    responsible_name_snapshot: input.responsibleName || null,
    priority: input.priority,
    due_date: input.dueDate,
    completed_date: null,
    status: "PENDIENTE",
    cancellation_justification: null,
    verification_notes: null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_preventive_actions")
    .insert({
      id: action.id,
      organization_entity_id: action.organization_entity_id,
      origin_type: action.origin_type,
      origin_id: action.origin_id,
      origin_label: action.origin_label,
      description: action.description,
      area_id: action.area_id,
      area_name_snapshot: action.area_name_snapshot,
      job_id: action.job_id,
      job_name_snapshot: action.job_name_snapshot,
      responsible_worker_id: action.responsible_worker_id,
      responsible_name_snapshot: action.responsible_name_snapshot,
      priority: action.priority,
      due_date: action.due_date,
      status: action.status,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstPreventiveAction
    updateCachedSstState(input.entityId, {
      ...state,
      preventiveActions: [saved, ...state.preventiveActions],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    preventiveActions: [action, ...state.preventiveActions],
  })
  return action
}

export async function updateSstPreventiveActionStatus(input: {
  entityId: string
  actionId: string
  status: SstPreventiveActionStatus
  cancellationJustification?: string | null
  verificationNotes?: string | null
}): Promise<void> {
  if (input.status === "CANCELADA" && !input.cancellationJustification?.trim()) {
    throw new Error("Para cancelar una medida preventiva o correctiva es obligatorio indicar la justificación.")
  }

  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()
  const completedDate = input.status === "COMPLETADA" ? now.slice(0, 10) : null

  const { error } = await supabase
    .from("sst_preventive_actions")
    .update({
      status: input.status,
      completed_date: completedDate,
      cancellation_justification:
        input.status === "CANCELADA" ? input.cancellationJustification?.trim() || null : null,
      verification_notes: input.verificationNotes?.trim() || null,
      updated_at: now,
    })
    .eq("id", input.actionId)
    .eq("organization_entity_id", input.entityId)

  const nextState: EntitySstState = {
    ...state,
    preventiveActions: state.preventiveActions.map((a) =>
      a.id === input.actionId
        ? {
            ...a,
            status: input.status,
            completed_date: completedDate,
            cancellation_justification:
              input.status === "CANCELADA" ? input.cancellationJustification?.trim() || null : null,
            verification_notes: input.verificationNotes?.trim() || a.verification_notes,
            updated_at: now,
          }
        : a
    ),
  }

  if (!error) {
    updateCachedSstState(input.entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) throw error
  await persistFallbackSstState(input.entityId, nextState)
}

// ============================================================================
// 3. EQUIPOS DE PROTECCIÓN PERSONAL (EPP) E INSPECCIONES DE SEGURIDAD
// ============================================================================

export async function createSstEppCatalogItem(input: {
  entityId: string
  name: string
  category: string
  description?: string | null
  defaultLifespanDays: number
  stockQuantity: number
  minStockAlert: number
}): Promise<SstEppCatalogItem> {
  const state = await loadEntitySstState(input.entityId)
  const trimmedName = input.name.trim()
  if (!trimmedName) {
    throw new Error("El nombre del equipo de protección personal (EPP) es obligatorio.")
  }

  const now = new Date().toISOString()
  const item: SstEppCatalogItem = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    name: trimmedName,
    category: input.category || "PROTECCION_GENERAL",
    description: input.description?.trim() || null,
    default_lifespan_days: Math.max(1, Number(input.defaultLifespanDays) || 180),
    stock_quantity: Math.max(0, Number(input.stockQuantity) || 0),
    min_stock_alert: Math.max(0, Number(input.minStockAlert) || 5),
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_epp_catalog")
    .insert({
      id: item.id,
      organization_entity_id: item.organization_entity_id,
      name: item.name,
      category: item.category,
      description: item.description,
      default_lifespan_days: item.default_lifespan_days,
      stock_quantity: item.stock_quantity,
      min_stock_alert: item.min_stock_alert,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstEppCatalogItem
    updateCachedSstState(input.entityId, {
      ...state,
      eppCatalog: [...state.eppCatalog, saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    eppCatalog: [...state.eppCatalog, item],
  })
  return item
}

export async function assignSstJobEppRequirement(input: {
  entityId: string
  jobId: string
  jobName?: string | null
  eppId: string
  eppName: string
  isMandatory: boolean
  renewalMonths: number
  notes?: string | null
}): Promise<SstJobEppRequirement> {
  const state = await loadEntitySstState(input.entityId)
  const req: SstJobEppRequirement = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    job_id: input.jobId,
    job_name_snapshot: input.jobName || null,
    epp_id: input.eppId,
    epp_name_snapshot: input.eppName,
    is_mandatory: input.isMandatory,
    renewal_months: Math.max(1, Number(input.renewalMonths) || 6),
    notes: input.notes?.trim() || null,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("sst_job_epp_requirements")
    .upsert(
      {
        id: req.id,
        organization_entity_id: req.organization_entity_id,
        job_id: req.job_id,
        job_name_snapshot: req.job_name_snapshot,
        epp_id: req.epp_id,
        epp_name_snapshot: req.epp_name_snapshot,
        is_mandatory: req.is_mandatory,
        renewal_months: req.renewal_months,
        notes: req.notes,
      },
      { onConflict: "organization_entity_id,job_id,epp_id" }
    )
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstJobEppRequirement
    updateCachedSstState(input.entityId, {
      ...state,
      jobEppRequirements: [
        ...state.jobEppRequirements.filter(
          (r) => !(r.job_id === saved.job_id && r.epp_id === saved.epp_id)
        ),
        saved,
      ],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    jobEppRequirements: [
      ...state.jobEppRequirements.filter(
        (r) => !(r.job_id === req.job_id && r.epp_id === req.epp_id)
      ),
      req,
    ],
  })
  return req
}

export async function registerWorkerEppDelivery(input: {
  entityId: string
  workerId: string
  workerName: string
  jobId?: string | null
  jobName?: string | null
  eppId?: string | null
  eppName: string
  quantity: number
  deliveryDate: string
  renewalDueDate?: string | null
  status?: SstEppDeliveryStatus
  signedReceipt: boolean
  notes?: string | null
}): Promise<SstWorkerEppDelivery> {
  const state = await loadEntitySstState(input.entityId)
  const trimmedEppName = input.eppName.trim()
  if (!trimmedEppName) {
    throw new Error("Selecciona o indica el equipo de protección personal (EPP) entregado.")
  }

  const now = new Date().toISOString()
  const delivery: SstWorkerEppDelivery = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    worker_id: input.workerId,
    worker_name_snapshot: input.workerName,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    epp_id: input.eppId || null,
    epp_name_snapshot: trimmedEppName,
    quantity: Math.max(1, Number(input.quantity) || 1),
    delivery_date: input.deliveryDate || now.slice(0, 10),
    renewal_due_date: input.renewalDueDate || null,
    status: input.status || "ENTREGADO",
    signed_receipt: input.signedReceipt,
    notes: input.notes?.trim() || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_worker_epp_deliveries")
    .insert({
      id: delivery.id,
      organization_entity_id: delivery.organization_entity_id,
      worker_id: delivery.worker_id,
      worker_name_snapshot: delivery.worker_name_snapshot,
      job_id: delivery.job_id,
      job_name_snapshot: delivery.job_name_snapshot,
      epp_id: delivery.epp_id,
      epp_name_snapshot: delivery.epp_name_snapshot,
      quantity: delivery.quantity,
      delivery_date: delivery.delivery_date,
      renewal_due_date: delivery.renewal_due_date,
      status: delivery.status,
      signed_receipt: delivery.signed_receipt,
      notes: delivery.notes,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstWorkerEppDelivery
    updateCachedSstState(input.entityId, {
      ...state,
      workerEppDeliveries: [saved, ...state.workerEppDeliveries],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    workerEppDeliveries: [delivery, ...state.workerEppDeliveries],
  })
  return delivery
}

export async function createSstInspection(input: {
  entityId: string
  areaId?: string | null
  areaName?: string | null
  facilityName?: string | null
  inspectionType: string
  inspectorName: string
  scheduledDate: string
  executedDate?: string | null
  status: SstInspectionStatus
  summaryNotes?: string | null
}): Promise<SstInspection> {
  const state = await loadEntitySstState(input.entityId)
  if (!input.inspectorName.trim()) {
    throw new Error("Indica el responsable o inspector de seguridad.")
  }

  const now = new Date().toISOString()
  const inspection: SstInspection = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    facility_name: input.facilityName?.trim() || null,
    inspection_type: input.inspectionType || "ORDINARIA",
    inspector_name: input.inspectorName.trim(),
    scheduled_date: input.scheduledDate || now.slice(0, 10),
    executed_date: input.executedDate || null,
    status: input.status,
    summary_notes: input.summaryNotes?.trim() || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_inspections")
    .insert({
      id: inspection.id,
      organization_entity_id: inspection.organization_entity_id,
      area_id: inspection.area_id,
      area_name_snapshot: inspection.area_name_snapshot,
      facility_name: inspection.facility_name,
      inspection_type: inspection.inspection_type,
      inspector_name: inspection.inspector_name,
      scheduled_date: inspection.scheduled_date,
      executed_date: inspection.executed_date,
      status: inspection.status,
      summary_notes: inspection.summary_notes,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstInspection
    updateCachedSstState(input.entityId, {
      ...state,
      inspections: [saved, ...state.inspections],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    inspections: [inspection, ...state.inspections],
  })
  return inspection
}

export async function addSstInspectionFinding(input: {
  entityId: string
  inspectionId: string
  itemChecked: string
  conforms: boolean
  findingDescription?: string | null
  severity: "LEVE" | "MODERADO" | "GRAVE" | "CRITICO"
  createCorrectiveAction?: boolean
  correctiveActionDueDate?: string | null
  areaId?: string | null
  areaName?: string | null
}): Promise<SstInspectionFinding> {
  const state = await loadEntitySstState(input.entityId)
  let linkedActionId: string | null = null

  if (!input.conforms && input.createCorrectiveAction && input.correctiveActionDueDate) {
    const createdAction = await createSstPreventiveAction({
      entityId: input.entityId,
      originType: "INSPECCION",
      originId: input.inspectionId,
      originLabel: `Hallazgo: ${input.itemChecked.trim()}`,
      description:
        input.findingDescription?.trim() ||
        `Corregir no conformidad detectada en inspección: ${input.itemChecked.trim()}`,
      areaId: input.areaId,
      areaName: input.areaName,
      priority:
        input.severity === "CRITICO"
          ? "INMEDIATA"
          : input.severity === "GRAVE"
            ? "ALTA"
            : "MEDIA",
      dueDate: input.correctiveActionDueDate,
    })
    linkedActionId = createdAction.id
  }

  const latestState = await loadEntitySstState(input.entityId)
  const finding: SstInspectionFinding = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    inspection_id: input.inspectionId,
    item_checked: input.itemChecked.trim(),
    conforms: input.conforms,
    finding_description: input.findingDescription?.trim() || null,
    severity: input.severity,
    preventive_action_id: linkedActionId,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("sst_inspection_findings")
    .insert({
      id: finding.id,
      organization_entity_id: finding.organization_entity_id,
      inspection_id: finding.inspection_id,
      item_checked: finding.item_checked,
      conforms: finding.conforms,
      finding_description: finding.finding_description,
      severity: finding.severity,
      preventive_action_id: finding.preventive_action_id,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstInspectionFinding
    updateCachedSstState(input.entityId, {
      ...latestState,
      inspectionFindings: [...latestState.inspectionFindings, saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...latestState,
    inspectionFindings: [...latestState.inspectionFindings, finding],
  })
  return finding
}

// ============================================================================
// 4. SALUD OCUPACIONAL ADMINISTRATIVA, ACCIDENTES, EMERGENCIAS Y PROCEDIMIENTOS
// ============================================================================

export async function registerWorkerHealthAptitude(input: {
  entityId: string
  workerId: string
  workerName: string
  jobId?: string | null
  jobName?: string | null
  evaluationType: "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO"
  evaluationDate: string
  nextReviewDate?: string | null
  aptitudeStatus: SstHealthAptitudeStatus
  administrativeRestrictions?: string | null
  administrativeNotes?: string | null
}): Promise<SstWorkerHealthAptitude> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const record: SstWorkerHealthAptitude = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    worker_id: input.workerId,
    worker_name_snapshot: input.workerName,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    evaluation_type: input.evaluationType,
    evaluation_date: input.evaluationDate || now.slice(0, 10),
    next_review_date: input.nextReviewDate || null,
    aptitude_status: input.aptitudeStatus,
    administrative_restrictions: input.administrativeRestrictions?.trim() || null,
    administrative_notes: input.administrativeNotes?.trim() || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_worker_health_aptitude")
    .insert({
      id: record.id,
      organization_entity_id: record.organization_entity_id,
      worker_id: record.worker_id,
      worker_name_snapshot: record.worker_name_snapshot,
      job_id: record.job_id,
      job_name_snapshot: record.job_name_snapshot,
      evaluation_type: record.evaluation_type,
      evaluation_date: record.evaluation_date,
      next_review_date: record.next_review_date,
      aptitude_status: record.aptitude_status,
      administrative_restrictions: record.administrative_restrictions,
      administrative_notes: record.administrative_notes,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstWorkerHealthAptitude
    updateCachedSstState(input.entityId, {
      ...state,
      healthAptitudes: [saved, ...state.healthAptitudes],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    healthAptitudes: [record, ...state.healthAptitudes],
  })
  return record
}

export async function createSstAccidentIncident(input: {
  entityId: string
  eventType: "ACCIDENTE_CON_LESION" | "INCIDENTE_SIN_LESION" | "OTRO"
  occurredAt: string
  areaId?: string | null
  areaName?: string | null
  jobId?: string | null
  jobName?: string | null
  affectedWorkerId?: string | null
  affectedWorkerName?: string | null
  witnessNames?: string | null
  description: string
  immediateCauses?: string | null
  basicCauses?: string | null
  severity: string
  daysLost: number
  immediateActions?: string | null
  investigationConclusions?: string | null
  status?: "REPORTADO" | "EN_INVESTIGACION" | "CERRADO"
}): Promise<SstAccidentIncident> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const item: SstAccidentIncident = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    event_type: input.eventType,
    occurred_at: input.occurredAt || now.slice(0, 10),
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    affected_worker_id: input.affectedWorkerId || null,
    affected_worker_name: input.affectedWorkerName || null,
    witness_names: input.witnessNames?.trim() || null,
    description: input.description.trim(),
    immediate_causes: input.immediateCauses?.trim() || null,
    basic_causes: input.basicCauses?.trim() || null,
    severity: input.severity || "LEVE",
    days_lost: Math.max(0, Number(input.daysLost) || 0),
    immediate_actions: input.immediateActions?.trim() || null,
    investigation_conclusions: input.investigationConclusions?.trim() || null,
    status: input.status || "REPORTADO",
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_accidents_incidents")
    .insert({
      id: item.id,
      organization_entity_id: item.organization_entity_id,
      event_type: item.event_type,
      occurred_at: item.occurred_at,
      area_id: item.area_id,
      area_name_snapshot: item.area_name_snapshot,
      job_id: item.job_id,
      job_name_snapshot: item.job_name_snapshot,
      affected_worker_id: item.affected_worker_id,
      affected_worker_name: item.affected_worker_name,
      witness_names: item.witness_names,
      description: item.description,
      immediate_causes: item.immediate_causes,
      basic_causes: item.basic_causes,
      severity: item.severity,
      days_lost: item.days_lost,
      immediate_actions: item.immediate_actions,
      investigation_conclusions: item.investigation_conclusions,
      status: item.status,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstAccidentIncident
    updateCachedSstState(input.entityId, {
      ...state,
      accidentsIncidents: [saved, ...state.accidentsIncidents],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    accidentsIncidents: [item, ...state.accidentsIncidents],
  })
  return item
}

export async function createSstEmergencyPlan(input: {
  entityId: string
  areaId?: string | null
  areaName?: string | null
  title: string
  planType: string
  version: string
  validUntil?: string | null
  brigadeMembersNotes?: string | null
  equipmentNotes?: string | null
  lastDrillDate?: string | null
  drillResultNotes?: string | null
}): Promise<SstEmergencyPlan> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const plan: SstEmergencyPlan = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    title: input.title.trim(),
    plan_type: input.planType || "EMERGENCIA_GENERAL",
    version: input.version.trim() || "1.0",
    valid_until: input.validUntil || null,
    brigade_members_notes: input.brigadeMembersNotes?.trim() || null,
    equipment_notes: input.equipmentNotes?.trim() || null,
    last_drill_date: input.lastDrillDate || null,
    drill_result_notes: input.drillResultNotes?.trim() || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_emergency_plans")
    .insert({
      id: plan.id,
      organization_entity_id: plan.organization_entity_id,
      area_id: plan.area_id,
      area_name_snapshot: plan.area_name_snapshot,
      title: plan.title,
      plan_type: plan.plan_type,
      version: plan.version,
      valid_until: plan.valid_until,
      brigade_members_notes: plan.brigade_members_notes,
      equipment_notes: plan.equipment_notes,
      last_drill_date: plan.last_drill_date,
      drill_result_notes: plan.drill_result_notes,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstEmergencyPlan
    updateCachedSstState(input.entityId, {
      ...state,
      emergencyPlans: [saved, ...state.emergencyPlans],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    emergencyPlans: [plan, ...state.emergencyPlans],
  })
  return plan
}

export async function createSstCommitteeRecord(input: {
  entityId: string
  recordType: string
  title: string
  recordDate: string
  memberWorkerId?: string | null
  memberName?: string | null
  memberRole?: string | null
  agreementsOrNotes?: string | null
}): Promise<SstCommitteeRecord> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const record: SstCommitteeRecord = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    record_type: input.recordType || "REUNION",
    title: input.title.trim(),
    record_date: input.recordDate || now.slice(0, 10),
    member_worker_id: input.memberWorkerId || null,
    member_name: input.memberName || null,
    member_role: input.memberRole?.trim() || null,
    agreements_or_notes: input.agreementsOrNotes?.trim() || null,
    status: "VIGENTE",
    created_at: now,
  }

  const { data, error } = await supabase
    .from("sst_committee_records")
    .insert({
      id: record.id,
      organization_entity_id: record.organization_entity_id,
      record_type: record.record_type,
      title: record.title,
      record_date: record.record_date,
      member_worker_id: record.member_worker_id,
      member_name: record.member_name,
      member_role: record.member_role,
      agreements_or_notes: record.agreements_or_notes,
      status: record.status,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstCommitteeRecord
    updateCachedSstState(input.entityId, {
      ...state,
      committeeRecords: [saved, ...state.committeeRecords],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    committeeRecords: [record, ...state.committeeRecords],
  })
  return record
}

export async function createSstSafeWorkProcedure(input: {
  entityId: string
  code: string
  title: string
  areaId?: string | null
  areaName?: string | null
  jobId?: string | null
  jobName?: string | null
  version: string
  requiresSpecialPermit: boolean
  summary?: string | null
}): Promise<SstSafeWorkProcedure> {
  const state = await loadEntitySstState(input.entityId)
  const now = new Date().toISOString()

  const proc: SstSafeWorkProcedure = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    code: input.code.trim() || "PTS-01",
    title: input.title.trim(),
    area_id: input.areaId || null,
    area_name_snapshot: input.areaName || null,
    job_id: input.jobId || null,
    job_name_snapshot: input.jobName || null,
    version: input.version.trim() || "1.0",
    status: "VIGENTE",
    requires_special_permit: input.requiresSpecialPermit,
    summary: input.summary?.trim() || null,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("sst_safe_work_procedures")
    .insert({
      id: proc.id,
      organization_entity_id: proc.organization_entity_id,
      code: proc.code,
      title: proc.title,
      area_id: proc.area_id,
      area_name_snapshot: proc.area_name_snapshot,
      job_id: proc.job_id,
      job_name_snapshot: proc.job_name_snapshot,
      version: proc.version,
      status: proc.status,
      requires_special_permit: proc.requires_special_permit,
      summary: proc.summary,
    })
    .select("*")
    .single()

  if (!error && data) {
    const saved = data as SstSafeWorkProcedure
    updateCachedSstState(input.entityId, {
      ...state,
      safeWorkProcedures: [saved, ...state.safeWorkProcedures],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) throw error

  await persistFallbackSstState(input.entityId, {
    ...state,
    safeWorkProcedures: [proc, ...state.safeWorkProcedures],
  })
  return proc
}
