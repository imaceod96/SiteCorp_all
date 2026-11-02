import {
  createTrainingTopic,
  deleteTrainingSession,
  deleteTrainingTopic,
  deleteTrainingTopicDocument,
  downloadTrainingTopicDocument,
  ensureHiringTrainingNotification,
  fetchEntityOrganizationAreas,
  fetchEntityWorkersForTraining,
  incorporateEntityAreaFolder,
  loadEntityTrainingState,
  registerWorkerInitialTraining,
  removeEntityAreaFolder,
  saveTrainingSessionOutcome,
  scheduleTrainingSession,
   updateTrainingTopic,
  uploadTrainingTopicDocument,
} from "../infrastructure/training.repository"
import type {
  EntityAreaOption,
  EntityTrainingState,
  EntityWorkerOption,
  InitialTrainingNotification,
  WorkerTrainingRecord,
} from "../domain/entities"

export interface EntityTrainingOverviewData {
  state: EntityTrainingState
  areas: EntityAreaOption[]
  workers: EntityWorkerOption[]
}

/**
 * Carga en paralelo el estado de capacitación de la entidad junto con sus áreas organizativas
 * reales (`organization_areas`) y sus trabajadores actuales (`workers`).
 */
export async function loadEntityTrainingOverview(
  entityId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<EntityTrainingOverviewData> {
  const [state, areas, workers] = await Promise.all([
    loadEntityTrainingState(entityId, options),
    fetchEntityOrganizationAreas(entityId),
    fetchEntityWorkersForTraining(entityId),
  ])

  return {
    state,
    areas,
    workers,
  }
}

/**
 * Carga las notificaciones de capacitación inicial pendientes de una entidad (usado en
 * Resumen de la entidad y en Capacitación).
 */
export async function loadEntityPendingTrainingNotifications(
  entityId: string
): Promise<InitialTrainingNotification[]> {
  if (!entityId) return []
  const state = await loadEntityTrainingState(entityId)
  return state.notifications
    .filter((n) => n.organization_entity_id === entityId && n.status === "PENDIENTE")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export interface WorkerTrainingProfileData {
  records: WorkerTrainingRecord[]
  pendingNotifications: InitialTrainingNotification[]
  completedNotifications: InitialTrainingNotification[]
  availableTopics: {
    id: string
    title: string
    areaId: string
    areaName: string
  }[]
}

/**
 * Carga el historial individual de capacitaciones «Recibida» de un trabajador y sus
 * notificaciones de capacitación inicial dentro de la entidad.
 *
 * El historial se consulta siempre por `worker_id` + `organization_entity_id`, por lo que
 * se conserva íntegro aunque el trabajador cambie de área o de cargo.
 */
export async function loadWorkerTrainingProfile(
  entityId: string,
  workerId: string
): Promise<WorkerTrainingProfileData> {
  if (!entityId || !workerId) {
    return {
      records: [],
      pendingNotifications: [],
      completedNotifications: [],
      availableTopics: [],
    }
  }

  const [state, areas] = await Promise.all([
    loadEntityTrainingState(entityId),
    fetchEntityOrganizationAreas(entityId).catch(() => [] as EntityAreaOption[]),
  ])

  const areaMap = new Map(areas.map((a) => [a.id, a.name]))
  const folderMap = new Map(state.folders.map((f) => [f.id, f.area_name_snapshot]))

  const records = state.workerRecords
    .filter((r) => r.organization_entity_id === entityId && r.worker_id === workerId)
    .sort((a, b) => {
      if (a.received_date !== b.received_date) {
        return a.received_date < b.received_date ? 1 : -1
      }
      return a.created_at < b.created_at ? 1 : -1
    })

  const workerNotifications = state.notifications.filter(
    (n) => n.organization_entity_id === entityId && n.worker_id === workerId
  )

  const availableTopics = state.topics
    .filter((t) => t.organization_entity_id === entityId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      areaId: t.area_id,
      areaName: areaMap.get(t.area_id) || folderMap.get(t.folder_id) || "Área",
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"))

  return {
    records,
    pendingNotifications: workerNotifications.filter((n) => n.status === "PENDIENTE"),
    completedNotifications: workerNotifications.filter((n) => n.status === "COMPLETADA"),
    availableTopics,
  }
}

export {
  createTrainingTopic,
  deleteTrainingSession,
  deleteTrainingTopic,
  deleteTrainingTopicDocument,
  downloadTrainingTopicDocument,
  ensureHiringTrainingNotification,
  incorporateEntityAreaFolder,
  registerWorkerInitialTraining,
  removeEntityAreaFolder,
  saveTrainingSessionOutcome,
  scheduleTrainingSession,
  updateTrainingTopic,
  uploadTrainingTopicDocument,
}
