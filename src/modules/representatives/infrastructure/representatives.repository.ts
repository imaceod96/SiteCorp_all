import { supabase } from "@/lib/supabase"
import type {
  EntityContractData,
  EntityContractDataInput,
  RepresentativeHistoryRow,
  RepresentativePositionConfigRow,
  RepresentativePositionRow,
} from "../domain/entities"

/**
 * Representantes y datos contractuales de entidad — Repositorio (infraestructura).
 *
 * Único punto del dominio que conoce Supabase. Cinco RPC SECURITY DEFINER
 * (la resolución por fecha y la escritura exigen permisos en el backend) y dos
 * consultas directas sujetas a RLS.
 *
 * Nombres de RPC, parámetros, consultas, columnas, ordenación, normalización,
 * tratamiento de errores y firmas son EXACTAMENTE los que ya usaba
 * `src/lib/representatives.ts`.
 */

/**
 * Datos contractuales de la entidad (organismo, rama, código laboral y domicilio).
 * La lectura directa de `organization_entities` está sujeta a RLS; la escritura
 * pasa siempre por `save_entity_contract_data`.
 */
export async function fetchEntityContractData(
  entityId: string
): Promise<EntityContractData | null> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select(
      "id, name, code, organism, branch, labor_identification_code, address, province, municipality, revolution_year"
    )
    .eq("id", entityId)
    .single()

  if (error) throw error
  return (data as EntityContractData) || null
}

/**
 * Guardado de los datos contractuales de la entidad mediante la función SQL
 * `save_entity_contract_data`, que exige el permiso interno `contract_data.manage`
 * en esa entidad (el permiso no se comprueba sólo en el frontend).
 */
export async function saveEntityContractData(
  entityId: string,
  input: EntityContractDataInput
): Promise<void> {
  const { error } = await supabase.rpc("save_entity_contract_data", {
    p_entity_id: entityId,
    p_organism: input.organism,
    p_branch: input.branch,
    p_labor_identification_code: input.labor_identification_code,
    p_address: input.address,
    p_province: input.province,
    p_municipality: input.municipality,
    p_revolution_year: input.revolution_year,
  })

  if (error) throw error
}

/**
 * Cargos de representación de la entidad con la persona vigente en una fecha.
 * La resolución por fecha se centraliza en la función SQL
 * `resolve_entity_representatives` (nunca se consulta `effective_to IS NULL`).
 */
export async function fetchRepresentativePositions(
  entityId: string,
  onDate?: string
): Promise<RepresentativePositionRow[]> {
  const { data, error } = await supabase.rpc("resolve_entity_representatives", {
    p_entity_id: entityId,
    p_on_date: onDate ?? null,
  })

  if (error) throw error
  return ((data as Array<{
    representative_position_id: string
    position_title: string
    display_order: number
    assignment_id: string | null
    person_name: string | null
    effective_from: string | null
  }>) || []).map((row) => ({
    position_id: row.representative_position_id,
    title: row.position_title,
    display_order: row.display_order,
    assignment_id: row.assignment_id ?? null,
    person_name: row.person_name ?? null,
    effective_from: row.effective_from ?? null,
  }))
}

/** Representantes válidos (con ocupante) para la fecha indicada. */
export async function fetchValidRepresentatives(
  entityId: string,
  onDate: string
): Promise<RepresentativePositionRow[]> {
  const rows = await fetchRepresentativePositions(entityId, onDate)
  return rows.filter((row) => !!row.assignment_id && !!row.person_name)
}

/**
 * Listado ADMINISTRATIVO de los cargos de representación de la entidad: incluye los
 * cargos inactivos (a diferencia de `resolve_entity_representatives`, que sólo
 * devuelve los vigentes para una fecha).
 *
 * Consulta directa sujeta a RLS, con la misma proyección y la misma ordenación que
 * usaba la pantalla de datos contractuales. La lectura no exige ningún permiso
 * adicional: la propia política de la tabla decide qué entidades son visibles.
 */
export async function fetchRepresentativePositionList(
  entityId: string
): Promise<RepresentativePositionConfigRow[]> {
  const { data, error } = await supabase
    .from("organization_representative_positions")
    .select("id, title, display_order, is_active")
    .eq("organization_entity_id", entityId)
    .order("display_order")
    .order("title")

  if (error) throw error
  return (data as RepresentativePositionConfigRow[]) || []
}

export async function fetchRepresentativeHistory(
  positionId: string
): Promise<RepresentativeHistoryRow[]> {
  const { data, error } = await supabase
    .from("organization_representative_assignments")
    .select("id, person_name, effective_from, effective_to")
    .eq("representative_position_id", positionId)
    .order("effective_from", { ascending: false })

  if (error) throw error
  return (data as RepresentativeHistoryRow[]) || []
}

export async function createRepresentativePosition(input: {
  entityId: string
  title: string
  personName: string
  effectiveFrom: string
  displayOrder: number
}): Promise<void> {
  const { error } = await supabase.rpc("create_representative_position", {
    p_entity_id: input.entityId,
    p_title: input.title,
    p_person_name: input.personName,
    p_effective_from: input.effectiveFrom,
    p_display_order: input.displayOrder,
  })

  if (error) throw error
}

/** Cambio de representante: cierra el período anterior y abre el nuevo. */
export async function changeRepresentative(input: {
  positionId: string
  personName: string
  effectiveFrom: string
}): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc("set_entity_representative", {
    p_position_id: input.positionId,
    p_person_name: input.personName,
    p_effective_from: input.effectiveFrom,
  })

  if (error) throw error
  return data as { status: string }
}

export async function updateRepresentativePosition(input: {
  positionId: string
  title?: string | null
  isActive?: boolean | null
}): Promise<void> {
  const { error } = await supabase.rpc("update_representative_position", {
    p_position_id: input.positionId,
    p_title: input.title ?? null,
    p_is_active: input.isActive ?? null,
  })

  if (error) throw error
}
