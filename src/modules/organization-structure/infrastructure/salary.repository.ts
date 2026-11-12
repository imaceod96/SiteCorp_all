import { supabase } from "@/lib/supabase"
import { type SalaryValue } from "../domain/entities"

/**
 * Resuelve la escala salarial aplicable a una entidad.
 * PRESUPUESTADA → escala presupuestada global.
 * EMPRESARIAL → escala empresarial de ESA organization_entity.
 * Devuelve null si no hay escala configurada (no hay fallback entre regímenes).
 */
export async function resolveApplicableScaleId(entityId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("resolve_salary_scale_for_entity", {
    entity_id: entityId,
  })
  if (!error && data) {
    return data as string
  }

  // Respaldo coherente con el régimen de la entidad si la RPC remota aún conserva
  // el filtro antiguo `is_sitecorp_account = false` antes de aplicar la migración SQL.
  const { data: entityRow, error: entityError } = await supabase
    .from("organization_entities")
    .select("regime_id, is_active")
    .eq("id", entityId)
    .maybeSingle()

  if (entityError || !entityRow || !entityRow.is_active) {
    if (error) throw error
    return null
  }

  const regime = String(entityRow.regime_id || "").trim().toUpperCase()
  if (regime === "PRESUPUESTADA") {
    const { data: globalScale } = await supabase
      .from("salary_scales")
      .select("id")
      .in("scope_type", ["PRESUPUESTADA_GLOBAL", "GLOBAL"])
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return (globalScale as { id: string } | null)?.id ?? null
  }

  if (regime === "EMPRESARIAL") {
    const { data: entityScale } = await supabase
      .from("salary_scales")
      .select("id")
      .eq("scope_type", "EMPRESARIAL_ENTITY")
      .eq("organization_entity_id", entityId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return (entityScale as { id: string } | null)?.id ?? null
  }

  return null
}

/**
 * Resuelve el valor salarial vigente para una fecha (por defecto, hoy).
 * El valor vigente se determina por la vigencia temporal (effective_from / effective_to)
 * del histórico de valores del grupo, nunca por un flag mutable.
 */
export async function fetchSalaryValuesForGroups(
  groupIds: string[],
  effectiveDate?: string
): Promise<Record<string, SalaryValue | null>> {
  const map: Record<string, SalaryValue | null> = {}
  const uniqueIds = Array.from(new Set(groupIds.filter((id): id is string => !!id)))
  if (uniqueIds.length === 0) return map

  const { data, error } = await supabase.rpc("resolve_salary_group_values", {
    p_group_ids: uniqueIds,
    p_effective_date: effectiveDate || null,
  })
  if (error) throw error

  ;(
    data as
      | { salary_group_id: string; amount: number; currency_code: string; effective_from: string }[]
      | null
  )?.forEach((v) => {
    map[v.salary_group_id] = {
      amount: v.amount,
      currency_code: v.currency_code,
      effective_from: v.effective_from,
    }
  })

  uniqueIds.forEach((id) => {
    if (map[id] === undefined) map[id] = null
  })

  return map
}
