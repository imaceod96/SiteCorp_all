import { saveOrganizationArea, setOrganizationAreaActive } from "../infrastructure/areas.repository"
import {
  insertOrganizationJob,
  replaceJobClaNightSegments,
  replaceJobPreparationLevels,
  setOrganizationJobActive,
  updateOrganizationJob,
} from "../infrastructure/jobs.repository"
import {
  savePositionWithSchedule,
  setOrganizationPositionActive,
} from "../infrastructure/positions.repository"
import type { SaveAreaInput, SaveJobInput, SavePositionInput } from "../domain/entities"

/**
 * Estructura organizativa — Casos de uso de escritura de la configuración (aplicación).
 *
 * Alta, edición y activación de áreas, cargos y puestos. Nada de esto elimina registros:
 * desactivar es la única baja, y el backend impide las incoherencias (área con subáreas
 * activas, cargo sobre un área inactiva, puesto sobre un cargo incompleto).
 *
 * El cargo se guarda con sus dos tramos de CLA y sus niveles de preparación como un único
 * caso de uso: nunca queda un cargo a medias. El puesto, con su horario, se guarda en la
 * RPC atómica `save_position_with_schedule`.
 */

/** Alta o edición de un área. */
export async function saveArea(input: SaveAreaInput): Promise<void> {
  await saveOrganizationArea(input)
}

/** Desactiva o reactiva un área (nunca se elimina). */
export async function setAreaActive(areaId: string, isActive: boolean): Promise<void> {
  await setOrganizationAreaActive(areaId, isActive)
}

/** Alta o edición de un cargo con su clasificación, su retribución, sus niveles y su CLA. */
export async function saveJob(input: SaveJobInput): Promise<void> {
  const cla = input.cla
  const payload = {
    name: input.name,
    area_id: input.areaId,
    description: input.description,
    salary_group_id: input.salaryGroupId,
    hierarchy_order: input.hierarchyOrder,
    required_profession_or_trade: input.requiredProfessionOrTrade,
    work_content: input.workContent,
    has_abnormal_conditions: cla.has_abnormal_conditions,
    cla_day_enabled: cla.cla_day_enabled,
    cla_day_hourly_rate: cla.cla_day_hourly_rate,
    cla_night_enabled: cla.cla_night_enabled,
    is_cuadro: input.isCuadro,
    is_principal_specialist: input.isPrincipalSpecialist,
  }

  if (input.jobId) {
    await updateOrganizationJob(input.jobId, {
      ...payload,
      occupational_category_id: input.occupationalCategoryId || null,
    })
    await replaceJobClaNightSegments(input.jobId, input.entityId, cla.night_segments)
    await replaceJobPreparationLevels(input.jobId, input.preparationLevelIds)
    return
  }

  const jobId = await insertOrganizationJob({
    ...payload,
    organization_entity_id: input.entityId,
    occupational_category_id: input.occupationalCategoryId as string,
  })
  if (!jobId) return

  await replaceJobClaNightSegments(jobId, input.entityId, cla.night_segments)
  await replaceJobPreparationLevels(jobId, input.preparationLevelIds)
}

/** Desactiva o reactiva un cargo (nunca se elimina). */
export async function setJobActive(jobId: string, isActive: boolean): Promise<void> {
  await setOrganizationJobActive(jobId, isActive)
}

/** Desactiva o reactiva un puesto (nunca se elimina). */
export async function setPositionActive(
  positionId: string,
  isActive: boolean
): Promise<void> {
  await setOrganizationPositionActive(positionId, isActive)
}

/** Alta o edición de un puesto con su ubicación, jornada y horario habitual (atómico). */
export async function savePosition(input: SavePositionInput): Promise<void> {
  await savePositionWithSchedule({
    entityId: input.entityId,
    positionId: input.positionId,
    jobId: input.jobId,
    code: input.code,
    name: input.name,
    description: input.description,
    authorizedQuantity: input.authorizedQuantity,
    workLocation: input.workLocation,
    dailyHours: input.dailyHours,
    weeklyHours: input.weeklyHours,
    monthlyHours: input.monthlyHours,
    breakMinutes: input.breakMinutes,
    scheduleNotes: input.scheduleNotes,
    segments: input.segments,
  })
}
