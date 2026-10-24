import { supabase } from "@/lib/supabase"
import { toRomanNumeral } from "@/utils/roman-numerals"
import type {
  ResolvedSalaryGroupValue,
  SalaryGroup,
  SalaryGroupCurrentValue,
  SalaryGroupValue,
  SalaryGroupWithCurrent,
  SalaryScale,
  SalaryScaleWithGroups,
} from "../domain/entities"

/**
 * Estructura organizativa — Repositorio de escalas, grupos y valores salariales
 * (infraestructura).
 *
 * Único punto que habla con Supabase para administrar la escala salarial: la escala
 * presupuestada global de SiteCorp y la empresarial de cada entidad, sus grupos (con número
 * de secuencia) y el HISTÓRICO de importes de cada grupo.
 *
 * El importe vigente NUNCA se decide en la interfaz: lo resuelve la base de datos por
 * vigencia temporal (`resolve_salary_group_values`, `resolve_salary_value`). Tampoco se
 * sobrescribe un importe antiguo: las nuevas vigencias las aplica la función atómica del
 * backend con su histórico y sus anexos.
 */

/** Escala salarial por identificador. */
export async function selectSalaryScaleById(scaleId: string): Promise<SalaryScale> {
  const { data, error } = await supabase
    .from("salary_scales")
    .select("*")
    .eq("id", scaleId)
    .single()

  if (error) throw error
  return data as SalaryScale
}

/** Escala presupuestada global de SiteCorp. */
export async function selectGlobalPresupuestadaScale(): Promise<SalaryScale> {
  const { data, error } = await supabase
    .from("salary_scales")
    .select("*")
    .eq("scope_type", "PRESUPUESTADA_GLOBAL")
    .eq("is_active", true)
    .single()

  if (error) throw error
  return data as SalaryScale
}

/** Escala empresarial de la entidad (sin fallback a la presupuestada). */
export async function selectEntityEmpresarialScale(entityId: string): Promise<SalaryScale> {
  const { data, error } = await supabase
    .from("salary_scales")
    .select("*")
    .eq("scope_type", "EMPRESARIAL_ENTITY")
    .eq("organization_entity_id", entityId)
    .eq("is_active", true)
    .single()

  if (error) throw error
  return data as SalaryScale
}

/** Escala presupuestada global: no pertenece a ninguna entidad ni workspace. */
export async function insertGlobalPresupuestadaScale(
  name: string,
  currencyCode: string
): Promise<SalaryScale> {
  const { data, error } = await supabase
    .from("salary_scales")
    .insert({
      scope_type: "PRESUPUESTADA_GLOBAL",
      organization_entity_id: null,
      regime_id: "PRESUPUESTADA",
      name,
      description: "Escala salarial presupuestada general de SiteCorp",
      currency_code: currencyCode,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return data as SalaryScale
}

/** Escala empresarial de una entidad concreta. */
export async function insertEntityEmpresarialScale(
  entityId: string,
  name: string,
  currencyCode: string
): Promise<SalaryScale> {
  const { data: newCheck, error: newError } =
    await supabase.rpc("is_salary_superadmin")

  console.log("[SalaryRepository] is_salary_superadmin:", {
    result: newCheck,
    error: newError,
  })

  const { data, error } = await supabase
    .from("salary_scales")
      .insert({
        scope_type: "EMPRESARIAL_ENTITY",
        organization_entity_id: entityId,
        regime_id: "EMPRESARIAL",
        name,
        description: "Escala salarial empresarial de la entidad",
        currency_code: currencyCode,
        is_active: true,
      })
      .select()
      .single()

  if (error) throw error
  return data as SalaryScale
}

/** Grupos ACTIVOS de una escala, en el orden de su número de secuencia. */
export async function selectActiveScaleGroups(scaleId: string): Promise<SalaryGroup[]> {
  const { data, error } = await supabase
    .from("salary_groups")
    .select("*")
    .eq("salary_scale_id", scaleId)
    .eq("is_active", true)
    .order("sequence_number")

  if (error) throw error
  return (data as SalaryGroup[]) || []
}

/**
 * Importe VIGENTE por grupo resuelto por vigencia temporal en el backend
 * (`resolve_salary_group_values`): nunca por un flag mutable del cliente.
 */
async function resolveGroupValues(
  groupIds: string[]
): Promise<Record<string, SalaryGroupCurrentValue>> {
  const valuesByGroup: Record<string, SalaryGroupCurrentValue> = {}
  if (groupIds.length === 0) return valuesByGroup

  const { data, error } = await supabase.rpc("resolve_salary_group_values", {
    p_group_ids: groupIds,
    p_effective_date: null,
  })
  if (error) throw error

  ;((data as ResolvedSalaryGroupValue[]) || []).forEach((v) => {
    valuesByGroup[v.salary_group_id] = {
      amount: v.amount,
      currency_code: v.currency_code,
      effective_from: v.effective_from,
      effective_to: v.effective_to,
    }
  })

  return valuesByGroup
}

/** Grupos activos de la escala con su importe vigente y su número romano. */
export async function selectGroupsWithValues(
  scaleId: string
): Promise<SalaryGroupWithCurrent[]> {
  const groups = await selectActiveScaleGroups(scaleId)
  const valuesByGroup = await resolveGroupValues(groups.map((g) => g.id))

  return groups.map((group) => ({
    group,
    current_value: valuesByGroup[group.id] || null,
    roman_numeral: toRomanNumeral(group.sequence_number),
  }))
}

/** Escala con sus grupos activos y el importe VIGENTE de cada uno (resuelto por fecha). */
export async function selectScaleGroupsWithValues(
  scaleId: string
): Promise<SalaryScaleWithGroups> {
  const scale = await selectSalaryScaleById(scaleId)
  const groups = await selectGroupsWithValues(scaleId)

  return { scale, groups }
}

/** Siguiente número de secuencia del grupo dentro de su escala. */
export async function selectNextSalaryGroupSequence(scaleId: string): Promise<number> {
  const { data, error } = await supabase
    .from("salary_groups")
    .select("sequence_number")
    .eq("salary_scale_id", scaleId)
    .order("sequence_number", { ascending: false })
    .limit(1)

  if (error) throw error

  const rows = (data as { sequence_number: number }[] | null) || []
  return rows.length > 0 ? Math.max(...rows.map((g) => g.sequence_number)) + 1 : 1
}

/** Alta de un grupo salarial en la escala. */
export async function insertSalaryGroup(
  scaleId: string,
  sequenceNumber: number,
  description?: string
): Promise<SalaryGroup> {
  const { data, error } = await supabase
    .from("salary_groups")
    .insert({
      salary_scale_id: scaleId,
      sequence_number: sequenceNumber,
      description: description || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return data as SalaryGroup
}

/** Edición de un grupo salarial. */
export async function updateSalaryGroupRecord(
  groupId: string,
  updates: Partial<SalaryGroup>
): Promise<SalaryGroup> {
  const { data, error } = await supabase
    .from("salary_groups")
    .update(updates)
    .eq("id", groupId)
    .select()
    .single()

  if (error) throw error
  return data as SalaryGroup
}

/** Desactivación de un grupo salarial (nunca se elimina: conserva su histórico). */
export async function deactivateSalaryGroupRecord(groupId: string): Promise<void> {
  const { error } = await supabase
    .from("salary_groups")
    .update({ is_active: false })
    .eq("id", groupId)

  if (error) throw error
}

/** Versión del importe salarial por identificador. */
export async function selectSalaryGroupValueById(valueId: string): Promise<SalaryGroupValue> {
  const { data, error } = await supabase
    .from("salary_group_values")
    .select("*")
    .eq("id", valueId)
    .single()

  if (error) throw error
  return data as SalaryGroupValue
}

/** Histórico completo de importes del grupo, del más reciente al más antiguo. */
export async function selectSalaryGroupValueHistory(
  groupId: string
): Promise<SalaryGroupValue[]> {
  const { data, error } = await supabase
    .from("salary_group_values")
    .select("*")
    .eq("salary_group_id", groupId)
    .order("effective_from", { ascending: false })

  if (error) throw error
  return (data as SalaryGroupValue[]) || []
}

/** Importe marcado como vigente del grupo (la resolución por fecha es la autoridad). */
export async function selectCurrentSalaryGroupValue(
  groupId: string
): Promise<SalaryGroupValue | null> {
  const { data, error } = await supabase
    .from("salary_group_values")
    .select("*")
    .eq("salary_group_id", groupId)
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== "PGRST116") throw error
  return (data as SalaryGroupValue | null) || null
}

/** Importe del grupo aplicable a la entidad en una fecha (RPC de vigencia temporal). */
export async function rpcResolveSalaryValue(
  entityId: string,
  groupId: string,
  effectiveDate: string
): Promise<SalaryGroupValue | null> {
  const { data, error } = await supabase.rpc("resolve_salary_value", {
    entity_id: entityId,
    salary_group_id: groupId,
    effective_date: effectiveDate,
  })

  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0] as SalaryGroupValue
}
