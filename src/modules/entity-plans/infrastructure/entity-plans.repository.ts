import { supabase } from "@/lib/supabase"
import type {
  EntityPlan,
  EntityPlanHistoryRecord,
  PlanCombination,
  PlanOperationType,
  SiteCorpAccountEntityOption,
} from "../domain/entities"
import {
  calculatePlanCombination,
  diffPlanPackages,
  validateEntityForPlanAssignment,
} from "../domain/plan.rules"

export const SITECORP_PLAN_CHANGED_EVENT = "sitecorp:entity-plan-changed"

const LOCAL_STORAGE_PLANS_KEY = "sitecorp_entity_plans_v1"
const LOCAL_STORAGE_HISTORY_KEY = "sitecorp_entity_plan_history_v1"

// Fallback en memoria / localStorage para operar de manera resiliente
function getLocalPlans(): Record<string, EntityPlan> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PLANS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setLocalPlans(plans: Record<string, EntityPlan>) {
  try {
    localStorage.setItem(LOCAL_STORAGE_PLANS_KEY, JSON.stringify(plans))
  } catch {
    // Ignore storage quota errors
  }
}

function getLocalHistory(): EntityPlanHistoryRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function setLocalHistory(history: EntityPlanHistoryRecord[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // Ignore storage quota errors
  }
}

export function notifyPlanChanged(entityId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SITECORP_PLAN_CHANGED_EVENT, { detail: { entityId } })
    )
  }
}

/**
 * Mapea una fila de Supabase (snake_case) al tipo de dominio EntityPlan.
 */
function mapPlanFromDb(row: any): EntityPlan {
  return {
    id: row.id,
    entityId: row.entity_id,
    companyClientId: row.company_client_id,
    packageBasic: row.package_basic !== false,
    packagePrenomina: row.package_prenomina === true,
    packageTrainingSst: row.package_training_sst === true,
    planCombination: row.plan_combination as PlanCombination,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  }
}

/**
 * Mapea una fila de Supabase (snake_case) al tipo EntityPlanHistoryRecord.
 */
function mapHistoryFromDb(row: any): EntityPlanHistoryRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    entityId: row.entity_id,
    operationType: row.operation_type as PlanOperationType,
    previousCombination: row.previous_combination as PlanCombination | null,
    newCombination: row.new_combination as PlanCombination,
    previousPackages: row.previous_packages,
    newPackages: row.new_packages,
    addedPackages: row.added_packages ?? [],
    removedPackages: row.removed_packages ?? [],
    reason: row.reason ?? null,
    changedBy: row.changed_by ?? null,
    changedByEmail: row.changed_by_email ?? null,
    createdAt: row.created_at,
  }
}

/**
 * Obtiene el plan activo actual de una entidad.
 */
export async function getEntityPlanFromDb(
  entityId: string
): Promise<EntityPlan | null> {
  if (!entityId) return null

  try {
    const { data, error } = await supabase
      .from("entity_plans")
      .select("*")
      .eq("entity_id", entityId)
      .maybeSingle()

    if (error) {
      console.warn(
        `[entity-plans] Consulta a Supabase no disponible (${error.message}), usando caché local.`
      )
      const local = getLocalPlans()[entityId]
      return local ?? null
    }

    if (data) {
      const plan = mapPlanFromDb(data)
      // Sincronizar caché local
      const localPlans = getLocalPlans()
      localPlans[entityId] = plan
      setLocalPlans(localPlans)
      return plan
    }

    // Verificar si existe en fallback local
    const fallback = getLocalPlans()[entityId]
    return fallback ?? null
  } catch (err) {
    console.warn("[entity-plans] Fallo de red consultando plan, usando fallback local:", err)
    return getLocalPlans()[entityId] ?? null
  }
}

/**
 * Obtiene el historial de modificaciones del plan de una entidad.
 */
export async function getEntityPlanHistoryFromDb(
  entityId: string
): Promise<EntityPlanHistoryRecord[]> {
  if (!entityId) return []

  try {
    const { data, error } = await supabase
      .from("entity_plan_history")
      .select("*")
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })

    if (error) {
      console.warn(
        `[entity-plans] Historial en Supabase no disponible (${error.message}), usando local.`
      )
      return getLocalHistory().filter((h) => h.entityId === entityId)
    }

    if (data && data.length > 0) {
      return data.map(mapHistoryFromDb)
    }

    return getLocalHistory().filter((h) => h.entityId === entityId)
  } catch (err) {
    console.warn("[entity-plans] Error cargando historial de planes:", err)
    return getLocalHistory().filter((h) => h.entityId === entityId)
  }
}

/**
 * Guarda o actualiza el plan de una entidad invocando el RPC transaccional save_entity_plan.
 */
export async function saveEntityPlanToDb(params: {
  entityId: string
  packagePrenomina: boolean
  packageTrainingSst: boolean
  reason?: string
  actingUserId?: string
  actingUserEmail?: string
}): Promise<EntityPlan> {
  const {
    entityId,
    packagePrenomina,
    packageTrainingSst,
    reason,
    actingUserId,
    actingUserEmail,
  } = params

  try {
    // 1. Intentar ejecutar el procedimiento almacenado transaccional en Supabase
    const { data, error } = await supabase.rpc("save_entity_plan", {
      p_entity_id: entityId,
      p_package_prenomina: packagePrenomina,
      p_package_training_sst: packageTrainingSst,
      p_reason: reason || null,
      p_user_id: actingUserId || null,
    })

    if (!error && data) {
      const plan = mapPlanFromDb(data)
      const local = getLocalPlans()
      local[entityId] = plan
      setLocalPlans(local)
      notifyPlanChanged(entityId)
      return plan
    }

    if (error) {
      // Si el error es de validación de negocio (§3.3), propagarlo de inmediato
      if (
        error.message?.includes("cuenta SiteCorp") ||
        error.message?.includes("no existe")
      ) {
        throw new Error(error.message)
      }
      console.warn(
        `[entity-plans] Fallback al guardado resiliente local debido a: ${error.message}`
      )
    }
  } catch (rpcErr) {
    if (
      rpcErr instanceof Error &&
      (rpcErr.message.includes("cuenta SiteCorp") || rpcErr.message.includes("no existe"))
    ) {
      throw rpcErr
    }
    console.warn("[entity-plans] RPC no disponible en backend, aplicando fallback local:", rpcErr)
  }

  // 2. Fallback de negocio local garantizado
  // Verificar entidad
  const { data: entityData } = await supabase
    .from("organization_entities")
    .select("id, name, company_client_id, is_sitecorp_account")
    .eq("id", entityId)
    .maybeSingle()

  if (entityData) {
    const val = validateEntityForPlanAssignment(entityData)
    if (!val.valid) {
      throw new Error(val.error)
    }
  }

  const existingLocal = getLocalPlans()[entityId] ?? null
  const diff = diffPlanPackages(
    existingLocal
      ? {
          prenomina: existingLocal.packagePrenomina,
          trainingSst: existingLocal.packageTrainingSst,
        }
      : null,
    { prenomina: packagePrenomina, trainingSst: packageTrainingSst }
  )

  const newCombination = calculatePlanCombination(packagePrenomina, packageTrainingSst)
  const now = new Date().toISOString()
  const planId = existingLocal ? existingLocal.id : crypto.randomUUID()

  const updatedPlan: EntityPlan = {
    id: planId,
    entityId,
    companyClientId: entityData?.company_client_id || existingLocal?.companyClientId || "",
    packageBasic: true,
    packagePrenomina,
    packageTrainingSst,
    planCombination: newCombination,
    createdAt: existingLocal ? existingLocal.createdAt : now,
    updatedAt: now,
    createdBy: existingLocal?.createdBy || actingUserId || null,
    updatedBy: actingUserId || null,
  }

  // Guardar plan local
  const plans = getLocalPlans()
  plans[entityId] = updatedPlan
  setLocalPlans(plans)

  // Guardar en historial solo si hubo cambios reales (§10.4)
  if (diff.isChanged) {
    const historyEntry: EntityPlanHistoryRecord = {
      id: crypto.randomUUID(),
      planId,
      entityId,
      operationType: diff.operationType,
      previousCombination: existingLocal ? existingLocal.planCombination : null,
      newCombination,
      previousPackages: existingLocal
        ? {
            basic: true,
            prenomina: existingLocal.packagePrenomina,
            training_sst: existingLocal.packageTrainingSst,
          }
        : null,
      newPackages: {
        basic: true,
        prenomina: packagePrenomina,
        training_sst: packageTrainingSst,
      },
      addedPackages: diff.addedPackages,
      removedPackages: diff.removedPackages,
      reason: reason || null,
      changedBy: actingUserId || null,
      changedByEmail: actingUserEmail || null,
      createdAt: now,
    }

    const history = getLocalHistory()
    history.unshift(historyEntry)
    setLocalHistory(history)
  }

  notifyPlanChanged(entityId)
  return updatedPlan
}

/**
 * Consulta todas las entidades que son Cuentas SiteCorp (§3.2 Selector de entidades).
 */
export async function getSiteCorpAccountsList(): Promise<SiteCorpAccountEntityOption[]> {
  try {
    const { data, error } = await supabase
      .from("organization_entities")
      .select(`
        id,
        name,
        code,
        entity_type,
        is_sitecorp_account,
        company_client_id,
        company_clients (
          name
        )
      `)
      .eq("is_sitecorp_account", true)
      .order("name", { ascending: true })

    if (error) {
      console.warn("[entity-plans] Fallo al consultar cuentas SiteCorp:", error.message)
      return []
    }

    if (!data) return []

    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      code: row.code || "",
      companyClientId: row.company_client_id,
      companyClientName: row.company_clients?.name || "Cliente principal",
      entityType: row.entity_type,
      isSiteCorpAccount: row.is_sitecorp_account === true,
      accountCode: row.code ? `CUENTA-${row.code.toUpperCase()}` : null,
    }))
  } catch (err) {
    console.error("[entity-plans] Error inesperado consultando cuentas SiteCorp:", err)
    return []
  }
}
