import { supabase } from "@/lib/supabase"
import { sanitizeFileName } from "@/lib/documents"
import { todayIsoInCuba, formatIsoDateToDisplay } from "@/utils/cuba-date"
import {
  currentUserId,
  downloadExpedienteFile,
  removeExpedienteFiles,
  uploadExpedienteFile,
} from "@/modules/people/infrastructure/expediente-storage"
import {
  isAllowedTrainingDocumentFile,
  type EntityAreaOption,
  type EntityTrainingState,
  type EntityWorkerOption,
  type InitialTrainingNotification,
  type TrainingFolder,
  type TrainingFrequency,
  type TrainingSession,
  type TrainingSessionStatus,
  type TrainingTopic,
  type TrainingTopicDocument,
  type WorkerTrainingRecord,
} from "../domain/entities"

export const TRAINING_CHANGED_EVENT = "sitecorp:training-changed"
const CACHE_TTL_MS = 15_000

interface CachedEntityState {
  fetchedAt: number
  state: EntityTrainingState
}

const memoryCache = new Map<string, CachedEntityState>()
const inflightLoads = new Map<string, Promise<EntityTrainingState>>()

export function notifyTrainingChanged(entityId?: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRAINING_CHANGED_EVENT, { detail: { entityId } }))
  }
}

function emptyTrainingState(): EntityTrainingState {
  return {
    folders: [],
    topics: [],
    documents: [],
    sessions: [],
    workerRecords: [],
    notifications: [],
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

function normalizeState(
  entityId: string,
  raw: Partial<EntityTrainingState> | null | undefined
): EntityTrainingState {
  if (!raw || typeof raw !== "object") return emptyTrainingState()
  const filterByEntity = <T extends { organization_entity_id: string }>(arr: unknown): T[] => {
    if (!Array.isArray(arr)) return []
    return (arr as T[]).filter(
      (item) => item && typeof item === "object" && item.organization_entity_id === entityId
    )
  }

  return {
    folders: filterByEntity<TrainingFolder>(raw.folders),
    topics: filterByEntity<TrainingTopic>(raw.topics),
    documents: filterByEntity<TrainingTopicDocument>(raw.documents),
    sessions: filterByEntity<TrainingSession>(raw.sessions).map((s) => ({
      ...s,
      participant_worker_ids: Array.isArray(s.participant_worker_ids)
        ? s.participant_worker_ids
        : [],
    })),
    workerRecords: filterByEntity<WorkerTrainingRecord>(raw.workerRecords),
    notifications: filterByEntity<InitialTrainingNotification>(raw.notifications),
  }
}

/**
 * Consulta las tablas relacionales de Supabase para la entidad.
 */
async function fetchDatabaseTrainingState(entityId: string): Promise<EntityTrainingState> {
  const [
    foldersRes,
    topicsRes,
    docsRes,
    sessionsRes,
    recordsRes,
    notificationsRes,
  ] = await Promise.all([
    supabase
      .from("training_folders")
      .select("id, organization_entity_id, area_id, area_name_snapshot, description, created_at")
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("training_topics")
      .select(
        "id, organization_entity_id, folder_id, area_id, title, description, frequency, created_at, updated_at"
      )
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: true }),
    supabase
      .from("training_topic_documents")
      .select(
        "id, organization_entity_id, topic_id, file_name, storage_path, mime_type, file_size, data_url, uploaded_by, created_at"
      )
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
    supabase
      .from("training_sessions")
      .select(
        "id, organization_entity_id, folder_id, area_id, topic_id, scheduled_date, status, notes, participant_worker_ids, completed_at, created_at, updated_at"
      )
      .eq("organization_entity_id", entityId)
      .order("scheduled_date", { ascending: true }),
    supabase
      .from("worker_training_records")
      .select(
        "id, organization_entity_id, worker_id, session_id, topic_id, topic_title_snapshot, area_id_snapshot, area_name_snapshot, received_date, status, kind, notes, created_at"
      )
      .eq("organization_entity_id", entityId)
      .order("received_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("training_initial_notifications")
      .select(
        "id, organization_entity_id, worker_id, candidate_id, hire_key, worker_name, worker_code, worker_identification, area_id, area_name, position_name, hire_date, status, completed_at, completed_record_id, created_at"
      )
      .eq("organization_entity_id", entityId)
      .order("created_at", { ascending: false }),
  ])

  const firstError =
    foldersRes.error ||
    topicsRes.error ||
    docsRes.error ||
    sessionsRes.error ||
    recordsRes.error ||
    notificationsRes.error

  if (firstError) {
    throw firstError
  }

  return normalizeState(entityId, {
    folders: (foldersRes.data || []) as TrainingFolder[],
    topics: (topicsRes.data || []) as TrainingTopic[],
    documents: (docsRes.data || []) as TrainingTopicDocument[],
    sessions: ((sessionsRes.data || []) as TrainingSession[]).map((s) => ({
      ...s,
      participant_worker_ids: Array.isArray(s.participant_worker_ids)
        ? s.participant_worker_ids
        : [],
    })),
    workerRecords: (recordsRes.data || []) as WorkerTrainingRecord[],
    notifications: (notificationsRes.data || []) as InitialTrainingNotification[],
  })
}

function updateCachedState(entityId: string, state: EntityTrainingState): void {
  const clean = normalizeState(entityId, state)
  memoryCache.set(entityId, { fetchedAt: Date.now(), state: clean })
  notifyTrainingChanged(entityId)
}

/**
 * Carga el estado de capacitación de la entidad exclusivamente desde las tablas relacionales de Supabase
 * (`training_folders`, `training_topics`, `training_topic_documents`, `training_sessions`,
 * `worker_training_records`, `training_initial_notifications`).
 */
export async function loadEntityTrainingState(
  entityId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<EntityTrainingState> {
  if (!entityId) return emptyTrainingState()

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
      const dbState = await fetchDatabaseTrainingState(entityId)
      memoryCache.set(entityId, { fetchedAt: Date.now(), state: dbState })
      inflightLoads.delete(entityId)
      return dbState
    } catch (err) {
      inflightLoads.delete(entityId)
      throw err
    }
  })()

  inflightLoads.set(entityId, promise)
  return promise
}

/**
 * Obtiene exclusivamente las áreas organizativas (`organization_areas`) ya creadas dentro
 * de la entidad seleccionada. No crea ni duplica áreas.
 */
export async function fetchEntityOrganizationAreas(entityId: string): Promise<EntityAreaOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("organization_areas")
    .select("id, name, is_active")
    .eq("organization_entity_id", entityId)
    .order("name", { ascending: true })

  if (error) throw error
  return ((data as { id: string; name: string; is_active: boolean | null }[] | null) || []).map(
    (row) => ({
      id: row.id,
      name: row.name,
      code: null,
      is_active: row.is_active ?? true,
    })
  )
}

interface RawWorkerWithAreaRow {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  employment_status: string
  assignments:
    | {
        is_current: boolean
        end_date: string | null
        position:
          | {
              name: string
              job:
                | {
                    area: { id: string; name: string } | { id: string; name: string }[] | null
                  }
                | {
                    area: { id: string; name: string } | { id: string; name: string }[] | null
                  }[]
                | null
            }
          | {
              name: string
              job:
                | {
                    area: { id: string; name: string } | { id: string; name: string }[] | null
                  }
                | {
                    area: { id: string; name: string } | { id: string; name: string }[] | null
                  }[]
                | null
            }[]
          | null
      }[]
    | null
}

const firstItem = <T,>(val: T | T[] | null | undefined): T | null =>
  Array.isArray(val) ? val[0] ?? null : val ?? null

/**
 * Obtiene los trabajadores de la entidad con su puesto y área actual para la selección de
 * participantes en sesiones de capacitación.
 */
export async function fetchEntityWorkersForTraining(
  entityId: string
): Promise<EntityWorkerOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("workers")
    .select(
      `id, code, first_name, first_surname, second_surname, identification, employment_status,
       assignments:worker_position_assignments(
         is_current, end_date,
         position:organization_positions(
           name,
           job:organization_jobs(
             area:organization_areas(id, name)
           )
         )
       )`
    )
    .eq("organization_entity_id", entityId)
    .order("first_surname", { ascending: true })
    .order("first_name", { ascending: true })

  if (error) throw error

  return ((data as unknown as RawWorkerWithAreaRow[] | null) || []).map((row) => {
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
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      positionName: pos?.name ?? null,
      employmentStatus: row.employment_status,
    }
  })
}

/**
 * Incorpora un área existente de la entidad como carpeta de capacitación.
 * Si ya existe carpeta para esa área dentro de la entidad, devuelve la existente.
 */
export async function incorporateEntityAreaFolder(input: {
  entityId: string
  areaId: string
  areaName: string
  description?: string | null
}): Promise<TrainingFolder> {
  const state = await loadEntityTrainingState(input.entityId)
  const existing = state.folders.find(
    (f) => f.organization_entity_id === input.entityId && f.area_id === input.areaId
  )
  if (existing) return existing

  const folder: TrainingFolder = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    area_id: input.areaId,
    area_name_snapshot: input.areaName.trim(),
    description: input.description?.trim() || null,
    created_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("training_folders")
    .upsert(
      {
        id: folder.id,
        organization_entity_id: folder.organization_entity_id,
        area_id: folder.area_id,
        area_name_snapshot: folder.area_name_snapshot,
        description: folder.description,
      },
      { onConflict: "organization_entity_id,area_id" }
    )
    .select("id, organization_entity_id, area_id, area_name_snapshot, description, created_at")
    .single()

  if (error) {
    throw error
  }

  const saved = data as TrainingFolder
  updateCachedState(input.entityId, {
    ...state,
    folders: [...state.folders.filter((f) => f.id !== saved.id), saved],
  })
  return saved
}

/**
 * Elimina una carpeta de capacitación junto con sus temas y sesiones programadas,
 * conservando intacto el historial individual de capacitaciones recibidas por los trabajadores.
 */
export async function removeEntityAreaFolder(entityId: string, folderId: string): Promise<void> {
  const state = await loadEntityTrainingState(entityId)
  const topicIds = new Set(
    state.topics.filter((t) => t.folder_id === folderId).map((t) => t.id)
  )
  const docsToRemove = state.documents.filter((d) => topicIds.has(d.topic_id))
  const storagePaths = docsToRemove.map((d) => d.storage_path).filter(Boolean)

  if (storagePaths.length > 0) {
    try {
      await removeExpedienteFiles(storagePaths)
    } catch {
      // Ignore storage cleanup errors
    }
  }

  const { error } = await supabase
    .from("training_folders")
    .delete()
    .eq("id", folderId)
    .eq("organization_entity_id", entityId)

  if (error) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    folders: state.folders.filter((f) => f.id !== folderId),
    topics: state.topics.filter((t) => t.folder_id !== folderId),
    documents: state.documents.filter((d) => !topicIds.has(d.topic_id)),
    sessions: state.sessions.filter((s) => s.folder_id !== folderId),
  }

  updateCachedState(entityId, nextState)
}

export async function createTrainingTopic(input: {
  entityId: string
  folderId: string
  title: string
  description?: string | null
  frequency: TrainingFrequency
}): Promise<TrainingTopic> {
  const state = await loadEntityTrainingState(input.entityId)
  const folder = state.folders.find((f) => f.id === input.folderId)
  if (!folder) {
    throw new Error("La carpeta de área seleccionada no existe en esta entidad.")
  }

  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    throw new Error("El nombre del tema de capacitación es obligatorio.")
  }

  const now = new Date().toISOString()
  const topic: TrainingTopic = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    folder_id: folder.id,
    area_id: folder.area_id,
    title: trimmedTitle,
    description: input.description?.trim() || null,
    frequency: input.frequency,
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("training_topics")
    .insert({
      id: topic.id,
      organization_entity_id: topic.organization_entity_id,
      folder_id: topic.folder_id,
      area_id: topic.area_id,
      title: topic.title,
      description: topic.description,
      frequency: topic.frequency,
    })
    .select(
      "id, organization_entity_id, folder_id, area_id, title, description, frequency, created_at, updated_at"
    )
    .single()

  if (error) {
    throw error
  }

  const saved = data as TrainingTopic
  updateCachedState(input.entityId, {
    ...state,
    topics: [...state.topics, saved],
  })
  return saved
}

export async function updateTrainingTopic(input: {
  entityId: string
  topicId: string
  title: string
  description?: string | null
  frequency: TrainingFrequency
}): Promise<TrainingTopic> {
  const state = await loadEntityTrainingState(input.entityId)
  const index = state.topics.findIndex(
    (t) => t.id === input.topicId && t.organization_entity_id === input.entityId
  )
  if (index === -1) {
    throw new Error("No se encontró el tema de capacitación.")
  }

  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    throw new Error("El nombre del tema de capacitación es obligatorio.")
  }

  const now = new Date().toISOString()
  const updated: TrainingTopic = {
    ...state.topics[index],
    title: trimmedTitle,
    description: input.description?.trim() || null,
    frequency: input.frequency,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from("training_topics")
    .update({
      title: updated.title,
      description: updated.description,
      frequency: updated.frequency,
      updated_at: now,
    })
    .eq("id", input.topicId)
    .eq("organization_entity_id", input.entityId)
    .select(
      "id, organization_entity_id, folder_id, area_id, title, description, frequency, created_at, updated_at"
    )
    .single()

  if (error) {
    throw error
  }

  const nextTopics = [...state.topics]
  nextTopics[index] = (data as TrainingTopic) || updated

  updateCachedState(input.entityId, {
    ...state,
    topics: nextTopics,
  })
  return nextTopics[index]
}

export async function deleteTrainingTopic(entityId: string, topicId: string): Promise<void> {
  const state = await loadEntityTrainingState(entityId)
  const docsToRemove = state.documents.filter((d) => d.topic_id === topicId)
  const storagePaths = docsToRemove.map((d) => d.storage_path).filter(Boolean)

  if (storagePaths.length > 0) {
    try {
      await removeExpedienteFiles(storagePaths)
    } catch {
      // Ignore storage cleanup error
    }
  }

  const { error } = await supabase
    .from("training_topics")
    .delete()
    .eq("id", topicId)
    .eq("organization_entity_id", entityId)

  if (error) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    topics: state.topics.filter((t) => t.id !== topicId),
    documents: state.documents.filter((d) => d.topic_id !== topicId),
    sessions: state.sessions.filter((s) => s.topic_id !== topicId),
  }

  updateCachedState(entityId, nextState)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    reader.readAsDataURL(file)
  })
}

/**
 * Sube un documento Word (.doc, .docx) o PDF (.pdf) asociado a un tema de capacitación.
 */
export async function uploadTrainingTopicDocument(input: {
  entityId: string
  topicId: string
  file: File
}): Promise<TrainingTopicDocument> {
  if (!isAllowedTrainingDocumentFile(input.file)) {
    throw new Error("Solo se permiten documentos en formato Word (.doc, .docx) o PDF (.pdf).")
  }

  const state = await loadEntityTrainingState(input.entityId)
  const topic = state.topics.find(
    (t) => t.id === input.topicId && t.organization_entity_id === input.entityId
  )
  if (!topic) {
    throw new Error("El tema seleccionado no pertenece a esta entidad.")
  }

  const docId = makeUuid()
  const safeName = sanitizeFileName(input.file.name)
  const storagePath = `training/entity_${input.entityId}/topics/${input.topicId}/${docId}_${safeName}`
  const uploadedBy = await currentUserId()
  let dataUrlFallback: string | null = null

  try {
    await uploadExpedienteFile(storagePath, input.file)
  } catch {
    dataUrlFallback = await fileToDataUrl(input.file)
  }

  const docRecord: TrainingTopicDocument = {
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
    .from("training_topic_documents")
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
    .select(
      "id, organization_entity_id, topic_id, file_name, storage_path, mime_type, file_size, data_url, uploaded_by, created_at"
    )
    .single()

  if (error) {
    throw error
  }

  const saved = data as TrainingTopicDocument
  updateCachedState(input.entityId, {
    ...state,
    documents: [saved, ...state.documents],
  })
  return saved
}

export async function downloadTrainingTopicDocument(doc: TrainingTopicDocument): Promise<Blob> {
  if (doc.storage_path) {
    try {
      return await downloadExpedienteFile(doc.storage_path)
    } catch {
      // Fallback to data_url if present
    }
  }
  if (doc.data_url) {
    const res = await fetch(doc.data_url)
    return await res.blob()
  }
  throw new Error("No se pudo descargar el documento desde el almacenamiento.")
}

export async function deleteTrainingTopicDocument(
  entityId: string,
  documentId: string
): Promise<void> {
  const state = await loadEntityTrainingState(entityId)
  const doc = state.documents.find(
    (d) => d.id === documentId && d.organization_entity_id === entityId
  )
  if (!doc) return

  if (doc.storage_path) {
    try {
      await removeExpedienteFiles([doc.storage_path])
    } catch {
      // Ignore storage removal warning
    }
  }

  const { error } = await supabase
    .from("training_topic_documents")
    .delete()
    .eq("id", documentId)
    .eq("organization_entity_id", entityId)

  if (error) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    documents: state.documents.filter((d) => d.id !== documentId),
  }

  updateCachedState(entityId, nextState)
}

/**
 * Programa manualmente una fecha de sesión en el calendario anual para un tema.
 */
export async function scheduleTrainingSession(input: {
  entityId: string
  topicId: string
  scheduledDate: string
  notes?: string | null
}): Promise<TrainingSession> {
  const state = await loadEntityTrainingState(input.entityId)
  const topic = state.topics.find(
    (t) => t.id === input.topicId && t.organization_entity_id === input.entityId
  )
  if (!topic) {
    throw new Error("El tema seleccionado no existe en esta entidad.")
  }
  if (!input.scheduledDate) {
    throw new Error("Selecciona una fecha para programar la sesión.")
  }

  const now = new Date().toISOString()
  const session: TrainingSession = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    folder_id: topic.folder_id,
    area_id: topic.area_id,
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
    .from("training_sessions")
    .insert({
      id: session.id,
      organization_entity_id: session.organization_entity_id,
      folder_id: session.folder_id,
      area_id: session.area_id,
      topic_id: session.topic_id,
      scheduled_date: session.scheduled_date,
      status: session.status,
      notes: session.notes,
      participant_worker_ids: [],
      completed_at: null,
    })
    .select(
      "id, organization_entity_id, folder_id, area_id, topic_id, scheduled_date, status, notes, participant_worker_ids, completed_at, created_at, updated_at"
    )
    .single()

  if (error) {
    throw error
  }

  const saved = {
    ...(data as TrainingSession),
    participant_worker_ids: Array.isArray((data as TrainingSession).participant_worker_ids)
      ? (data as TrainingSession).participant_worker_ids
      : [],
  }
  updateCachedState(input.entityId, {
    ...state,
    sessions: [...state.sessions, saved],
  })
  return saved
}

/**
 * Actualiza el estado de una sesión («Programada», «Realizada», «No realizada») y,
 * cuando se marca como «Realizada», registra automáticamente a los trabajadores
 * participantes con una capacitación «Recibida» independiente en su Información adicional.
 */
export async function saveTrainingSessionOutcome(input: {
  entityId: string
  sessionId: string
  scheduledDate?: string
  status: TrainingSessionStatus
  notes?: string | null
  participantWorkerIds?: string[]
  areaNameByAreaId?: Map<string, string>
}): Promise<TrainingSession> {
  const state = await loadEntityTrainingState(input.entityId)
  const sessionIndex = state.sessions.findIndex(
    (s) => s.id === input.sessionId && s.organization_entity_id === input.entityId
  )
  if (sessionIndex === -1) {
    throw new Error("La sesión de capacitación no fue encontrada.")
  }

  const currentSession = state.sessions[sessionIndex]
  const topic = state.topics.find((t) => t.id === currentSession.topic_id)
  const folder = state.folders.find((f) => f.id === currentSession.folder_id)

  const uniqueWorkerIds =
    input.status === "REALIZADA"
      ? Array.from(new Set((input.participantWorkerIds || []).filter(Boolean)))
      : []

  const now = new Date().toISOString()
  const effectiveDate = input.scheduledDate || currentSession.scheduled_date
  const todayIso = todayIsoInCuba()

  if ((input.status === "REALIZADA" || input.status === "NO_REALIZADA") && effectiveDate > todayIso) {
    throw new Error(
      `No se puede marcar como ${input.status === "REALIZADA" ? "realizada" : "no realizada"} una sesión con fecha programada futura (${formatIsoDateToDisplay(effectiveDate)}). Actualice primero la fecha de la sesión a hoy o una fecha pasada.`
    )
  }

  if (input.status === "REALIZADA" && uniqueWorkerIds.length > 0) {
    const { data: workerRows } = await supabase
      .from("workers")
      .select("id, first_name, first_surname, second_surname, hire_date")
      .in("id", uniqueWorkerIds)

    for (const w of (workerRows || []) as {
      id: string
      first_name: string
      first_surname: string
      second_surname: string | null
      hire_date: string | null
    }[]) {
      if (w.hire_date && effectiveDate < w.hire_date) {
        const wName = [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")
        throw new Error(
          `La fecha de la sesión (${formatIsoDateToDisplay(effectiveDate)}) no puede ser anterior a la fecha de alta del trabajador ${wName} (${formatIsoDateToDisplay(w.hire_date)}).`
        )
      }
    }
  }

  const updatedSession: TrainingSession = {
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

  const otherRecords = state.workerRecords.filter((r) => r.session_id !== currentSession.id)
  const currentSessionRecordsByWorker = new Map(
    state.workerRecords
      .filter((r) => r.session_id === currentSession.id)
      .map((r) => [r.worker_id, r])
  )

  const areaNameSnapshot =
    input.areaNameByAreaId?.get(currentSession.area_id) ||
    folder?.area_name_snapshot ||
    null
  const topicTitleSnapshot = topic?.title || "Tema de capacitación"

  const updatedSessionRecords: WorkerTrainingRecord[] =
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
            area_id_snapshot: currentSession.area_id,
            area_name_snapshot: areaNameSnapshot,
            received_date: effectiveDate,
            status: "RECIBIDA",
            kind: "SESION",
            notes: updatedSession.notes,
            created_at: prev?.created_at || now,
          }
        })
      : []

  const { error: sessionDbError } = await supabase
    .from("training_sessions")
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

  if (sessionDbError) {
    throw sessionDbError
  }

  await supabase
    .from("worker_training_records")
    .delete()
    .eq("organization_entity_id", input.entityId)
    .eq("session_id", currentSession.id)

  if (updatedSessionRecords.length > 0) {
    const { error: recErr } = await supabase.from("worker_training_records").insert(
      updatedSessionRecords.map((r) => ({
        id: r.id,
        organization_entity_id: r.organization_entity_id,
        worker_id: r.worker_id,
        session_id: r.session_id,
        topic_id: r.topic_id,
        topic_title_snapshot: r.topic_title_snapshot,
        area_id_snapshot: r.area_id_snapshot,
        area_name_snapshot: r.area_name_snapshot,
        received_date: r.received_date,
        status: r.status,
        kind: r.kind,
        notes: r.notes,
      }))
    )
    if (recErr) {
      throw recErr
    }
  }

  updateCachedState(input.entityId, {
    ...state,
    sessions: nextSessions,
    workerRecords: [...otherRecords, ...updatedSessionRecords],
  })
  return updatedSession
}

export async function deleteTrainingSession(entityId: string, sessionId: string): Promise<void> {
  const state = await loadEntityTrainingState(entityId)

  const { error } = await supabase
    .from("training_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("organization_entity_id", entityId)

  if (error) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    sessions: state.sessions.filter((s) => s.id !== sessionId),
  }

  updateCachedState(entityId, nextState)
}

/**
 * Registra una capacitación en la pestaña «Información adicional» de la ficha del trabajador.
 */
export async function registerWorkerInitialTraining(input: {
  entityId: string
  workerId: string
  topicId?: string | null
  customTopicTitle?: string | null
  areaId?: string | null
  areaName?: string | null
  receivedDate: string
  notes?: string | null
  notificationId?: string | null
}): Promise<WorkerTrainingRecord> {
  const now = new Date().toISOString()
  const todayIso = todayIsoInCuba()
  const resolvedDate = input.receivedDate || todayIso

  if (resolvedDate > todayIso) {
    throw new Error(
      `No se puede registrar como recibida una capacitación con fecha futura (${formatIsoDateToDisplay(resolvedDate)}).`
    )
  }

  const { data: workerHireRow } = await supabase
    .from("workers")
    .select("hire_date")
    .eq("id", input.workerId)
    .maybeSingle()

  const workerHireDate = (workerHireRow as { hire_date?: string | null } | null)?.hire_date ?? null
  if (workerHireDate && resolvedDate < workerHireDate) {
    throw new Error(
      `La fecha de recepción (${formatIsoDateToDisplay(resolvedDate)}) no puede ser anterior a la fecha de alta del trabajador (${workerHireDate}) — ${formatIsoDateToDisplay(workerHireDate)}.`
    )
  }

  const state = await loadEntityTrainingState(input.entityId)
  const topic = input.topicId ? state.topics.find((t) => t.id === input.topicId) : null
  const folder = topic ? state.folders.find((f) => f.id === topic.folder_id) : null

  const resolvedTitle = (
    topic?.title ||
    input.customTopicTitle ||
    "Capacitación inicial de puesto"
  ).trim()
  if (!resolvedTitle) {
    throw new Error("Indica el tema de la capacitación recibida.")
  }

  const record: WorkerTrainingRecord = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    worker_id: input.workerId,
    session_id: null,
    topic_id: topic?.id ?? null,
    topic_title_snapshot: resolvedTitle,
    area_id_snapshot: topic?.area_id ?? input.areaId ?? null,
    area_name_snapshot: folder?.area_name_snapshot ?? input.areaName ?? null,
    received_date: resolvedDate,
    status: "RECIBIDA",
    kind: "CAPACITACION_INICIAL",
    notes: input.notes?.trim() || null,
    created_at: now,
  }

  const nextNotifications = state.notifications.map((n) => {
    const matchesTarget =
      n.organization_entity_id === input.entityId &&
      n.worker_id === input.workerId &&
      n.status === "PENDIENTE"

    if (!matchesTarget) return n
    return {
      ...n,
      status: "COMPLETADA" as const,
      completed_at: now,
      completed_record_id: record.id,
    }
  })

  const { data: insertedRec, error: recError } = await supabase
    .from("worker_training_records")
    .insert({
      id: record.id,
      organization_entity_id: record.organization_entity_id,
      worker_id: record.worker_id,
      session_id: null,
      topic_id: record.topic_id,
      topic_title_snapshot: record.topic_title_snapshot,
      area_id_snapshot: record.area_id_snapshot,
      area_name_snapshot: record.area_name_snapshot,
      received_date: record.received_date,
      status: record.status,
      kind: record.kind,
      notes: record.notes,
    })
    .select(
      "id, organization_entity_id, worker_id, session_id, topic_id, topic_title_snapshot, area_id_snapshot, area_name_snapshot, received_date, status, kind, notes, created_at"
    )
    .single()

  if (recError) {
    throw recError
  }

  await supabase
    .from("training_initial_notifications")
    .update({
      status: "COMPLETADA",
      completed_at: now,
      completed_record_id: record.id,
    })
    .eq("organization_entity_id", input.entityId)
    .eq("worker_id", input.workerId)
    .eq("status", "PENDIENTE")

  const savedRecord = (insertedRec as WorkerTrainingRecord) || record
  updateCachedState(input.entityId, {
    ...state,
    workerRecords: [savedRecord, ...state.workerRecords],
    notifications: nextNotifications,
  })
  return savedRecord
}

/**
 * Genera una notificación de capacitación inicial pendiente cuando se completa la
 * contratación de un candidato o alta de un nuevo trabajador dentro de una entidad.
 */
export async function ensureHiringTrainingNotification(input: {
  workerId: string | null | undefined
  candidateId?: string | null
  positionId?: string | null
  hireDate?: string | null
  contractOrResolutionId?: string | null
}): Promise<void> {
  if (!input.workerId) return

  try {
    const { data: workerData } = await supabase
      .from("workers")
      .select(
        `id, code, first_name, first_surname, second_surname, identification, hire_date, organization_entity_id`
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

    let areaId: string | null = null
    let areaName: string | null = null
    let positionName: string | null = null

    if (input.positionId) {
      const { data: posData } = await supabase
        .from("organization_positions")
        .select(
          `id, name,
           job:organization_jobs(
             id, name, area_id,
             area:organization_areas(id, name)
           )`
        )
        .eq("id", input.positionId)
        .maybeSingle()

      if (posData) {
        const rawPos = posData as {
          name?: string
          job?:
            | { area?: { id: string; name: string } | { id: string; name: string }[] | null }
            | { area?: { id: string; name: string } | { id: string; name: string }[] | null }[]
            | null
        }
        positionName = rawPos.name ?? null
        const job = firstItem(rawPos.job)
        const area = job ? firstItem(job.area) : null
        areaId = area?.id ?? null
        areaName = area?.name ?? null
      }
    }

    const effectiveHireDate = input.hireDate || workerRow.hire_date || todayIsoInCuba()
    const hireKey = `${entityId}:${workerRow.id}:${effectiveHireDate}:hire`

    const state = await loadEntityTrainingState(entityId, { forceRefresh: true })
    const alreadyExists = state.notifications.some(
      (n) =>
        n.hire_key === hireKey ||
        (n.worker_id === workerRow.id &&
          n.hire_date === effectiveHireDate &&
          n.status === "PENDIENTE")
    )
    if (alreadyExists) return

    const workerFullName = [
      workerRow.first_name,
      workerRow.first_surname,
      workerRow.second_surname,
    ]
      .filter(Boolean)
      .join(" ")

    const notification: InitialTrainingNotification = {
      id: makeUuid(),
      organization_entity_id: entityId,
      worker_id: workerRow.id,
      candidate_id: input.candidateId ?? null,
      hire_key: hireKey,
      worker_name: workerFullName || "Nuevo trabajador",
      worker_code: workerRow.code ?? null,
      worker_identification: workerRow.identification ?? null,
      area_id: areaId,
      area_name: areaName,
      position_name: positionName,
      hire_date: effectiveHireDate,
      status: "PENDIENTE",
      completed_at: null,
      completed_record_id: null,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from("training_initial_notifications")
      .upsert(
        {
          id: notification.id,
          organization_entity_id: notification.organization_entity_id,
          worker_id: notification.worker_id,
          candidate_id: notification.candidate_id,
          hire_key: notification.hire_key,
          worker_name: notification.worker_name,
          worker_code: notification.worker_code,
          worker_identification: notification.worker_identification,
          area_id: notification.area_id,
          area_name: notification.area_name,
          position_name: notification.position_name,
          hire_date: notification.hire_date,
          status: "PENDIENTE",
        },
        { onConflict: "organization_entity_id,hire_key", ignoreDuplicates: true }
      )
      .select(
        "id, organization_entity_id, worker_id, candidate_id, hire_key, worker_name, worker_code, worker_identification, area_id, area_name, position_name, hire_date, status, completed_at, completed_record_id, created_at"
      )
      .maybeSingle()

    if (error) {
      throw error
    }

    const saved = (data as InitialTrainingNotification | null) || notification
    updateCachedState(entityId, {
      ...state,
      notifications: [saved, ...state.notifications.filter((n) => n.id !== saved.id)],
    })
  } catch (err) {
    console.warn("[training] no se pudo generar la notificación de capacitación inicial", err)
  }
}

