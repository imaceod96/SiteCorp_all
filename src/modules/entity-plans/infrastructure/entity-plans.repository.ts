import { supabase } from "@/lib/supabase"
import type {
  EntityPlan,
  EntityPlanHistoryRecord,
  PlanCombination,
  PlanOperationType,
  SiteCorpAccountEntityOption,
} from "../domain/entities"

export const SITECORP_PLAN_CHANGED_EVENT = "sitecorp:entity-plan-changed"

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
 * Obtiene el plan activo actual de una entidad directamente desde Supabase.
 */
export async function getEntityPlanFromDb(
  entityId: string
): Promise<EntityPlan | null> {
  if (!entityId) return null

  const { data, error } = await supabase
    .from("entity_plans")
    .select("*")
    .eq("entity_id", entityId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || "No se pudo consultar el plan de la entidad.")
  }

  return data ? mapPlanFromDb(data) : null
}

/**
 * Obtiene el historial de modificaciones del plan de una entidad desde Supabase.
 */
export async function getEntityPlanHistoryFromDb(
  entityId: string
): Promise<EntityPlanHistoryRecord[]> {
  if (!entityId) return []

  const { data, error } = await supabase
    .from("entity_plan_history")
    .select("*")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message || "No se pudo cargar el historial del plan.")
  }

  return (data || []).map(mapHistoryFromDb)
}

/**
 * Guarda o actualiza el plan de una entidad invocando exclusivamente el RPC transaccional save_entity_plan.
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
  } = params

  const { data, error } = await supabase.rpc("save_entity_plan", {
    p_entity_id: entityId,
    p_package_prenomina: packagePrenomina,
    p_package_training_sst: packageTrainingSst,
    p_reason: reason || null,
    p_user_id: actingUserId || null,
  })

  if (error) {
    throw new Error(error.message || "No se pudo guardar el plan de la entidad.")
  }

  if (!data) {
    throw new Error("El servidor no devolvió el plan actualizado.")
  }

  const plan = mapPlanFromDb(data)
  notifyPlanChanged(entityId)
  return plan
}

/**
 * Consulta todas las entidades que son Cuentas SiteCorp (§3.2 Selector de entidades).
 */
export async function getSiteCorpAccountsList(): Promise<SiteCorpAccountEntityOption[]> {
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
    throw new Error(error.message || "No se pudieron cargar las cuentas SiteCorp.")
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
  }))
}
