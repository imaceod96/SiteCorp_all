import {
  addSstInspectionFinding,
  assignSstJobEppRequirement,
  createSstAccidentIncident,
  createSstCommitteeRecord,
  createSstEmergencyPlan,
  createSstEppCatalogItem,
  createSstInspection,
  createSstPreventiveAction,
  createSstRiskAssessment,
  createSstSafeWorkProcedure,
  createSstTrainingTopic,
  deleteSstTopicDocument,
  deleteSstTrainingSession,
  deleteSstTrainingTopic,
  downloadSstTopicDocument,
  ensureSstAssignmentNotification,
  fetchEntityOrganizationAreasForSst,
  fetchEntityOrganizationJobs,
  fetchEntityWorkersForSst,
  incorporateEntityJobSstFolder,
  loadEntitySstState,
  registerWorkerDirectSstTraining,
  registerWorkerEppDelivery,
  registerWorkerHealthAptitude,
  removeEntityJobSstFolder,
  saveSstTrainingSessionOutcome,
  scheduleSstTrainingSession,
  updateSstPreventiveActionStatus,
  updateSstRiskStatus,
  uploadSstTopicDocument,
} from "../infrastructure/sst.repository"
import type {
  EntityAreaOption,
  EntityJobOption,
  EntitySstState,
  EntityWorkerSstOption,
  SstEppCatalogItem,
  SstJobEppRequirement,
  SstOnboardingNotification,
  SstWorkerEppDelivery,
  SstWorkerHealthAptitude,
  SstWorkerTrainingRecord,
} from "../domain/entities"

export interface EntitySstOverviewData {
  state: EntitySstState
  jobs: EntityJobOption[]
  areas: EntityAreaOption[]
  workers: EntityWorkerSstOption[]
}

/**
 * Carga en paralelo el estado de SST de la entidad junto con sus cargos reales
 * (`organization_jobs`), áreas (`organization_areas`) y trabajadores (`workers`).
 *
 * Sincroniza dinámicamente el nombre del cargo en las carpetas de SST si el cargo
 * cambió de denominación en la estructura organizativa de la entidad.
 */
export async function loadEntitySstOverview(
  entityId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<EntitySstOverviewData> {
  const [state, jobs, areas, workers] = await Promise.all([
    loadEntitySstState(entityId, options),
    fetchEntityOrganizationJobs(entityId).catch(() => [] as EntityJobOption[]),
    fetchEntityOrganizationAreasForSst(entityId).catch(() => [] as EntityAreaOption[]),
    fetchEntityWorkersForSst(entityId).catch(() => [] as EntityWorkerSstOption[]),
  ])

  const jobMap = new Map(jobs.map((j) => [j.id, j]))

  // El nombre de cada carpeta de SST refleja siempre el nombre vigente del cargo
  const dynamicFolders = state.jobFolders.map((folder) => {
    const liveJob = jobMap.get(folder.job_id)
    if (!liveJob) return folder
    return {
      ...folder,
      job_name_snapshot: liveJob.name,
      area_id_snapshot: liveJob.areaId ?? folder.area_id_snapshot,
      area_name_snapshot: liveJob.areaName ?? folder.area_name_snapshot,
    }
  })

  return {
    state: {
      ...state,
      jobFolders: dynamicFolders,
    },
    jobs,
    areas,
    workers,
  }
}

export async function loadEntityPendingSstNotifications(
  entityId: string
): Promise<SstOnboardingNotification[]> {
  if (!entityId) return []
  const state = await loadEntitySstState(entityId)
  return state.notifications
    .filter((n) => n.organization_entity_id === entityId && n.status !== "COMPLETADA")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export interface WorkerSstProfileData {
  sstTrainingRecords: SstWorkerTrainingRecord[]
  pendingNotifications: SstOnboardingNotification[]
  availableSstTopics: {
    id: string
    title: string
    jobId: string
    jobName: string
  }[]
  eppCatalog: SstEppCatalogItem[]
  jobEppRequirements: SstJobEppRequirement[]
  eppDeliveries: SstWorkerEppDelivery[]
  healthAptitudes: SstWorkerHealthAptitude[]
}

/**
 * Carga toda la información de SST vinculada a la ficha individual de un trabajador
 * dentro de la entidad:
 *   - Capacitaciones de SST recibidas (`sst_worker_training_records`)
 *   - Notificaciones pendientes por contratación o cambio de cargo
 *   - Requisitos de EPP de su cargo actual y entregas individuales de EPP
 *   - Aptitud ocupacional administrativa
 */
export async function loadWorkerSstProfile(
  entityId: string,
  workerId: string,
  currentJobId?: string | null
): Promise<WorkerSstProfileData> {
  if (!entityId || !workerId) {
    return {
      sstTrainingRecords: [],
      pendingNotifications: [],
      availableSstTopics: [],
      eppCatalog: [],
      jobEppRequirements: [],
      eppDeliveries: [],
      healthAptitudes: [],
    }
  }

  const [state, jobs] = await Promise.all([
    loadEntitySstState(entityId),
    fetchEntityOrganizationJobs(entityId).catch(() => [] as EntityJobOption[]),
  ])

  const jobMap = new Map(jobs.map((j) => [j.id, j.name]))
  const folderMap = new Map(state.jobFolders.map((f) => [f.id, f.job_name_snapshot]))

  const sstTrainingRecords = state.workerTrainingRecords
    .filter((r) => r.organization_entity_id === entityId && r.worker_id === workerId)
    .sort((a, b) => {
      if (a.received_date !== b.received_date) {
        return a.received_date < b.received_date ? 1 : -1
      }
      return a.created_at < b.created_at ? 1 : -1
    })

  const pendingNotifications = state.notifications.filter(
    (n) =>
      n.organization_entity_id === entityId &&
      n.worker_id === workerId &&
      n.status !== "COMPLETADA"
  )

  const availableSstTopics = state.topics
    .filter((t) => t.organization_entity_id === entityId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      jobId: t.job_id,
      jobName: jobMap.get(t.job_id) || folderMap.get(t.folder_id) || "Cargo",
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"))

  const jobEppRequirements = currentJobId
    ? state.jobEppRequirements.filter(
        (r) => r.organization_entity_id === entityId && r.job_id === currentJobId
      )
    : []

  const eppDeliveries = state.workerEppDeliveries
    .filter((d) => d.organization_entity_id === entityId && d.worker_id === workerId)
    .sort((a, b) => (a.delivery_date < b.delivery_date ? 1 : -1))

  const healthAptitudes = state.healthAptitudes
    .filter((h) => h.organization_entity_id === entityId && h.worker_id === workerId)
    .sort((a, b) => (a.evaluation_date < b.evaluation_date ? 1 : -1))

  return {
    sstTrainingRecords,
    pendingNotifications,
    availableSstTopics,
    eppCatalog: state.eppCatalog,
    jobEppRequirements,
    eppDeliveries,
    healthAptitudes,
  }
}

export {
  addSstInspectionFinding,
  assignSstJobEppRequirement,
  createSstAccidentIncident,
  createSstCommitteeRecord,
  createSstEmergencyPlan,
  createSstEppCatalogItem,
  createSstInspection,
  createSstPreventiveAction,
  createSstRiskAssessment,
  createSstSafeWorkProcedure,
  createSstTrainingTopic,
  deleteSstTopicDocument,
  deleteSstTrainingSession,
  deleteSstTrainingTopic,
  downloadSstTopicDocument,
  ensureSstAssignmentNotification,
  incorporateEntityJobSstFolder,
  registerWorkerDirectSstTraining,
  registerWorkerEppDelivery,
  registerWorkerHealthAptitude,
  removeEntityJobSstFolder,
  saveSstTrainingSessionOutcome,
  scheduleSstTrainingSession,
  updateSstPreventiveActionStatus,
  updateSstRiskStatus,
  uploadSstTopicDocument,
}
