import type {
  EntityPlan,
  EntityPlanHistoryRecord,
  SiteCorpAccountEntityOption,
} from "../domain/entities"
import { isModuleEnabledInPlan } from "../domain/plan.rules"
import {
  getEntityPlanFromDb,
  getEntityPlanHistoryFromDb,
  getSiteCorpAccountsList,
  saveEntityPlanToDb,
} from "../infrastructure/entity-plans.repository"

/**
 * Servicio de Aplicación: Planes por Entidad
 */

export async function loadEntityPlan(entityId: string): Promise<EntityPlan | null> {
  if (!entityId) return null
  return await getEntityPlanFromDb(entityId)
}

export async function loadEntityPlanHistory(
  entityId: string
): Promise<EntityPlanHistoryRecord[]> {
  if (!entityId) return []
  return await getEntityPlanHistoryFromDb(entityId)
}

export async function updateEntityPlan(params: {
  entityId: string
  packagePrenomina: boolean
  packageTrainingSst: boolean
  reason?: string
  actingUserId?: string
  actingUserEmail?: string
}): Promise<EntityPlan> {
  return await saveEntityPlanToDb(params)
}

export async function loadSiteCorpAccounts(): Promise<SiteCorpAccountEntityOption[]> {
  return await getSiteCorpAccountsList()
}

/**
 * Consulta de autorización funcional: Determina si un módulo está permitido por el plan de la entidad.
 */
export async function checkModulePlanAccess(
  entityId: string,
  moduleKey: string
): Promise<boolean> {
  if (!entityId) return false
  const plan = await loadEntityPlan(entityId)
  return isModuleEnabledInPlan(moduleKey, plan)
}
