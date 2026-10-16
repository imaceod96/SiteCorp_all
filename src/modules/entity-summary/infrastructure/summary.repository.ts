import { supabase } from "@/lib/supabase"

/**
 * Resumen de entidad — Repositorio de fuentes del Resumen (infraestructura).
 *
 * Único punto del dominio que conoce Supabase para los bloques del Resumen que NO son
 * informes demográficos: candidatos, contratos vigentes, movimientos, configuración
 * contractual, representante vigente, escala salarial y tipos documentales.
 *
 * Se usan consultas agregadas / filas de referencia pequeñas; nunca se descarga una
 * tabla completa sólo para hacer `array.length`. Las RPC, sus parámetros y las tablas
 * consultadas son exactamente las mismas que antes: el esquema físico no cambia.
 */

/** Filas mínimas de candidatos del ámbito (estado + vínculo al trabajador). */
export async function fetchCandidateSummaryRows(
  entityIds: string[]
): Promise<{ status: string | null; worker_id: string | null }[]> {
  const { data, error } = await supabase
    .from("candidates")
    .select("status, worker_id")
    .in("organization_entity_id", entityIds)
  if (error) throw error
  return (data as { status: string | null; worker_id: string | null }[]) || []
}

/** Contratos vigentes del ámbito (sólo el tipo contractual de cada uno). */
export async function fetchCurrentContractRows(
  entityIds: string[]
): Promise<{ contract_type_id: string | null }[]> {
  const { data, error } = await supabase
    .from("employment_contracts")
    .select("contract_type_id")
    .in("organization_entity_id", entityIds)
    .eq("is_current", true)
  if (error) throw error
  return (data as { contract_type_id: string | null }[]) || []
}

/** Catálogo de tipos contractuales (id → code), sin filtrar por entidad. */
export async function fetchEmploymentContractTypeCodes(): Promise<
  { id: string; code: string }[]
> {
  const { data, error } = await supabase.from("employment_contract_types").select("id, code")
  if (error) throw error
  return (data as { id: string; code: string }[]) || []
}

/** Altas reales del período (`workers.hire_date`), no el estado actual. */
export async function fetchHiresInPeriod(
  entityIds: string[],
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase
    .from("workers")
    .select("id")
    .in("organization_entity_id", entityIds)
    .gte("hire_date", from)
    .lte("hire_date", to)
  if (error) throw error
  return ((data as { id: string }[]) || []).length
}

/** Bitácora de movimientos del período (tipo de movimiento por fila). */
export async function fetchMovementRowsInPeriod(
  entityIds: string[],
  from: string,
  to: string
): Promise<{ movement_type: string }[]> {
  const { data, error } = await supabase
    .from("worker_employment_movements")
    .select("movement_type, workers!inner(organization_entity_id)")
    .in("workers.organization_entity_id", entityIds)
    .gte("effective_date", from)
    .lte("effective_date", to)
  if (error) throw error
  return (data as { movement_type: string }[]) || []
}

/** Validación central de integridad contractual de la entidad. */
export async function rpcValidateEntityContractReadiness(
  entityId: string
): Promise<{ ready?: boolean; missing?: unknown[] } | null> {
  const { data, error } = await supabase.rpc("validate_entity_contract_readiness", {
    p_entity_id: entityId,
  })
  if (error) throw error
  return data as { ready?: boolean; missing?: unknown[] } | null
}

/** Representantes autorizados vigentes a una fecha (datos contractuales de la entidad). */
export async function rpcResolveEntityRepresentatives(
  entityId: string,
  onDate: string
): Promise<{ person_name: string | null }[]> {
  const { data, error } = await supabase.rpc("resolve_entity_representatives", {
    p_entity_id: entityId,
    p_on_date: onDate,
  })
  if (error) throw error
  return (data as { person_name: string | null }[]) || []
}

/**
 * Escala salarial aplicable según el régimen (PRESUPUESTADA → escala global;
 * EMPRESARIAL → escala propia). Sin fallback entre regímenes.
 */
export async function rpcResolveSalaryScaleForEntity(entityId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("resolve_salary_scale_for_entity", {
    entity_id: entityId,
  })
  if (error) throw error
  return data
}

/** Tipos documentales activos (catálogo global). */
export async function fetchActiveDocumentTemplateTypes(): Promise<{ code: string }[]> {
  const { data, error } = await supabase
    .from("document_template_types")
    .select("code")
    .eq("is_active", true)
  if (error) throw error
  return (data as { code: string }[]) || []
}

/** Versiones ACTIVE de la entidad (sólo el tipo documental de cada una). */
export async function fetchActiveDocumentTemplateVersions(
  entityId: string
): Promise<{ document_type_code: string }[]> {
  const { data, error } = await supabase
    .from("document_template_versions")
    .select("document_type_code")
    .eq("organization_entity_id", entityId)
    .eq("status", "ACTIVE")
  if (error) throw error
  return (data as { document_type_code: string }[]) || []
}
