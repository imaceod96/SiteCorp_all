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
const STORAGE_KEY_PREFIX = "sitecorp_entity_training_v1_"
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
  return `training/entity_${entityId}/state_v1.json`
}

function readLocalState(entityId: string): EntityTrainingState {
  if (typeof window === "undefined") return emptyTrainingState()
  try {
    const raw = window.localStorage.getItem(localKey(entityId))
    if (!raw) return emptyTrainingState()
    const parsed = JSON.parse(raw) as Partial<EntityTrainingState>
    return normalizeState(entityId, parsed)
  } catch {
    return emptyTrainingState()
  }
}

function writeLocalState(entityId: string, state: EntityTrainingState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(localKey(entityId), JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
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

function mergeById<T extends { id: string; updated_at?: string; created_at?: string }>(
  localArr: T[],
  remoteArr: T[]
): T[] {
  const map = new Map<string, T>()
  for (const item of remoteArr) {
    map.set(item.id, item)
  }
  for (const item of localArr) {
    const existing = map.get(item.id)
    if (!existing) {
      map.set(item.id, item)
    } else {
      const localTime = item.updated_at || item.created_at || ""
      const remoteTime = existing.updated_at || existing.created_at || ""
      if (localTime >= remoteTime) {
        map.set(item.id, item)
      }
    }
  }
  return Array.from(map.values())
}

/**
 * Intenta consultar las tablas relacionales de Supabase para la entidad.
 * Devuelve `null` si las tablas aún no han sido creadas en el proyecto Supabase.
 */
async function tryFetchDatabaseTrainingState(
  entityId: string
): Promise<EntityTrainingState | null> {
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
    if (isMissingTableError(firstError)) {
      return null
    }
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
  writeLocalState(entityId, clean)
  notifyTrainingChanged(entityId)
}

/**
 * Carga el estado de capacitación de la entidad desde las tablas relacionales de Supabase
 * (`training_folders`, `training_topics`, `training_topic_documents`, `training_sessions`,
 * `worker_training_records`, `training_initial_notifications`), con respaldo automático en
 * Storage/local si la migración SQL aún no ha sido ejecutada.
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
      const dbState = await tryFetchDatabaseTrainingState(entityId)
      if (dbState !== null) {
        memoryCache.set(entityId, { fetchedAt: Date.now(), state: dbState })
        writeLocalState(entityId, dbState)
        inflightLoads.delete(entityId)
        return dbState
      }
    } catch {
      // Si hay un error de red puntual, continúa con el respaldo
    }

    const localState = readLocalState(entityId)
    let merged = localState

    try {
      const { data, error } = await supabase.storage
        .from(EXPEDIENTE_BUCKET)
        .download(remoteStatePath(entityId))

      if (!error && data) {
        const text = await data.text()
        const remoteParsed = JSON.parse(text) as Partial<EntityTrainingState>
        const remoteState = normalizeState(entityId, remoteParsed)

        merged = {
          folders: mergeById(localState.folders, remoteState.folders),
          topics: mergeById(localState.topics, remoteState.topics),
          documents: mergeById(localState.documents, remoteState.documents),
          sessions: mergeById(localState.sessions, remoteState.sessions),
          workerRecords: mergeById(localState.workerRecords, remoteState.workerRecords),
          notifications: mergeById(localState.notifications, remoteState.notifications),
        }
        writeLocalState(entityId, merged)
      }
    } catch {
      // Si el archivo aún no existe en el bucket o no hay red, se usa el estado local
    }

    memoryCache.set(entityId, { fetchedAt: Date.now(), state: merged })
    inflightLoads.delete(entityId)
    return merged
  })()

  inflightLoads.set(entityId, promise)
  return promise
}

async function persistFallbackTrainingState(
  entityId: string,
  state: EntityTrainingState
): Promise<void> {
  const cleanState = normalizeState(entityId, state)
  updateCachedState(entityId, cleanState)

  try {
    const remotePayload: EntityTrainingState = {
      ...cleanState,
      documents: cleanState.documents.map((doc) => ({
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
    // El respaldo local ya quedó guardado y notificado
  }
}

/**
 * Obtiene exclusivamente las áreas organizativas (`organization_areas`) ya creadas dentro
 * de la entidad seleccionada. No crea ni duplica áreas.
 */
export async function fetchEntityOrganizationAreas(entityId: string): Promise<EntityAreaOption[]> {
  if (!entityId) return []
  const { data, error } = await supabase
    .from("organization_areas")
    .select("id, name, code, is_active")
    .eq("organization_entity_id", entityId)
    .order("name", { ascending: true })

  if (error) throw error
  return ((data as EntityAreaOption[] | null) || []).map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    is_active: row.is_active ?? true,
  }))
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

  if (!error && data) {
    const saved = data as TrainingFolder
    updateCachedState(input.entityId, {
      ...state,
      folders: [...state.folders.filter((f) => f.id !== saved.id), saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    folders: [...state.folders, folder],
  }
  await persistFallbackTrainingState(input.entityId, nextState)
  return folder
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

  const nextState: EntityTrainingState = {
    ...state,
    folders: state.folders.filter((f) => f.id !== folderId),
    topics: state.topics.filter((t) => t.folder_id !== folderId),
    documents: state.documents.filter((d) => !topicIds.has(d.topic_id)),
    sessions: state.sessions.filter((s) => s.folder_id !== folderId),
    // `workerRecords` y `notifications` se conservan siempre
  }

  if (!error) {
    updateCachedState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(entityId, nextState)
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

  if (!error && data) {
    const saved = data as TrainingTopic
    updateCachedState(input.entityId, {
      ...state,
      topics: [...state.topics, saved],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) {
    throw error
  }

  const nextState: EntityTrainingState = {
    ...state,
    topics: [...state.topics, topic],
  }
  await persistFallbackTrainingState(input.entityId, nextState)
  return topic
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

  const nextTopics = [...state.topics]
  nextTopics[index] = (!error && data ? (data as TrainingTopic) : updated)

  if (!error) {
    updateCachedState(input.entityId, {
      ...state,
      topics: nextTopics,
    })
    return nextTopics[index]
  }

  if (!isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(input.entityId, {
    ...state,
    topics: nextTopics,
  })
  return updated
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

  const nextState: EntityTrainingState = {
    ...state,
    topics: state.topics.filter((t) => t.id !== topicId),
    documents: state.documents.filter((d) => d.topic_id !== topicId),
    sessions: state.sessions.filter((s) => s.topic_id !== topicId),
    // El historial individual de los trabajadores (`workerRecords`) nunca se borra
  }

  if (!error) {
    updateCachedState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(entityId, nextState)
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

  if (!error && data) {
    const saved = data as TrainingTopicDocument
    updateCachedState(input.entityId, {
      ...state,
      documents: [saved, ...state.documents],
    })
    return saved
  }

  if (error && !isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(input.entityId, {
    ...state,
    documents: [docRecord, ...state.documents],
  })

  return docRecord
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

  const nextState: EntityTrainingState = {
    ...state,
    documents: state.documents.filter((d) => d.id !== documentId),
  }

  if (!error) {
    updateCachedState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(entityId, nextState)
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

  if (!error && data) {
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

  if (error && !isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(input.entityId, {
    ...state,
    sessions: [...state.sessions, session],
  })

  return session
}

/**
 * Actualiza el estado de una sesión («Programada», «Realizada», «No realizada») y,
 * cuando se marca como «Realizada», registra automáticamente a los trabajadores
 * participantes con una capacitación «Recibida» independiente en su Información adicional.
 *
 * El mismo trabajador puede recibir el mismo tema varias veces en distintas sesiones:
 * cada sesión genera su propio registro por `session_id + worker_id`, sin sobrescribir
 * las sesiones anteriores.
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

  if (!sessionDbError) {
    // Sincronizar registros de esta sesión en `worker_training_records` sin alterar otras sesiones
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
      if (recErr && !isMissingTableError(recErr)) {
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

  if (!isMissingTableError(sessionDbError)) {
    throw sessionDbError
  }

  await persistFallbackTrainingState(input.entityId, {
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

  const nextState: EntityTrainingState = {
    ...state,
    sessions: state.sessions.filter((s) => s.id !== sessionId),
    // Conservamos `workerRecords` históricos de sesiones ya recibidas
  }

  if (!error) {
    updateCachedState(entityId, nextState)
    return
  }

  if (!isMissingTableError(error)) {
    throw error
  }

  await persistFallbackTrainingState(entityId, nextState)
}

/**
 * Registra una capacitación en la pestaña «Información adicional» de la ficha del trabajador
 * (como capacitación inicial del nuevo ingreso o capacitación recibida) y, si tenía una
 * notificación pendiente de capacitación inicial, la marca como completada.
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

  const now = new Date().toISOString()
  const record: WorkerTrainingRecord = {
    id: makeUuid(),
    organization_entity_id: input.entityId,
    worker_id: input.workerId,
    session_id: null,
    topic_id: topic?.id ?? null,
    topic_title_snapshot: resolvedTitle,
    area_id_snapshot: topic?.area_id ?? input.areaId ?? null,
    area_name_snapshot: folder?.area_name_snapshot ?? input.areaName ?? null,
    received_date: input.receivedDate || now.slice(0, 10),
    status: "RECIBIDA",
    kind: "CAPACITACION_INICIAL",
    notes: input.notes?.trim() || null,
    created_at: now,
  }

  const nextNotifications = state.notifications.map((n) => {
    const matchesTarget =
      n.organization_entity_id === input.entityId &&
      n.worker_id === input.workerId &&
      n.status === "PENDIENTE" &&
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

  if (!recError && insertedRec) {
    let notifUpdateQuery = supabase
      .from("training_initial_notifications")
      .update({
        status: "COMPLETADA",
        completed_at: now,
        completed_record_id: record.id,
      })
      .eq("organization_entity_id", input.entityId)
      .eq("worker_id", input.workerId)
      .eq("status", "PENDIENTE")

    if (input.notificationId) {
      notifUpdateQuery = notifUpdateQuery.eq("id", input.notificationId)
    }
    await notifUpdateQuery

    const savedRecord = insertedRec as WorkerTrainingRecord
    updateCachedState(input.entityId, {
      ...state,
      workerRecords: [savedRecord, ...state.workerRecords],
      notifications: nextNotifications,
    })
    return savedRecord
  }

  if (recError && !isMissingTableError(recError)) {
    throw recError
  }

  await persistFallbackTrainingState(input.entityId, {
    ...state,
    workerRecords: [record, ...state.workerRecords],
    notifications: nextNotifications,
  })

  return record
}

/**
 * Genera una notificación de capacitación inicial pendiente cuando se completa la
 * contratación de un candidato o alta de un nuevo trabajador dentro de una entidad.
 *
 * Evita notificaciones duplicadas por una misma contratación mediante `hire_key`.
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

    const effectiveHireDate =
      input.hireDate || workerRow.hire_date || new Date().toISOString().slice(0, 10)
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

    if (!error) {
      const saved = (data as InitialTrainingNotification | null) || notification
      updateCachedState(entityId, {
        ...state,
        notifications: [saved, ...state.notifications.filter((n) => n.id !== saved.id)],
      })
      return
    }

    if (!isMissingTableError(error)) {
      throw error
    }

    await persistFallbackTrainingState(entityId, {
      ...state,
      notifications: [notification, ...state.notifications],
    })
  } catch (err) {
    console.warn("[training] no se pudo generar la notificación de capacitación inicial", err)
  }
}
