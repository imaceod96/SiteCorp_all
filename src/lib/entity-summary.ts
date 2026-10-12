import { subDays, format } from "date-fns"
import { supabase } from "@/lib/supabase"
import {
  CONTRACT_ALERT_HORIZON_DAYS,
  fetchContractAlerts,
  summarizeContractAlerts,
  type ContractAlertSummary,
} from "@/lib/contract-alerts"
import { hasLinkedWorker } from "@/lib/people-classification"

/**
 * Dashboard REAL de una entidad (pantalla Resumen).
 *
 * Principios (nunca se rompen):
 *   - La fuente de verdad son los MÓDULOS OPERATIVOS. Aquí no se inventan estados,
 *     no se guardan estadísticas y no se comparan estados actuales para deducir
 *     movimientos históricos.
 *   - Cada bloque se consulta SOLO cuando el usuario tiene el permiso real que ya
 *     gobierna los módulos correspondientes (permiso → enabled query). El backend
 *     (RLS) sigue siendo la autoridad final.
 *   - Se usan consultas agregadas / filas de referencia pequeñas; nunca se descarga
 *     una tabla completa sólo para hacer `array.length`.
 */

/** Período mostrado para los movimientos de personal (días). */
export const MOVEMENTS_WINDOW_DAYS = 30

const today = () => format(new Date(), "yyyy-MM-dd")

// ---------------------------------------------------------------------------
// ÁMBITO (Esta entidad / Entidad + descendientes) — migrado a `@/domains/entity-summary`
// ---------------------------------------------------------------------------

export type { SummaryScope, EntityScopeInfo } from "@/domains/entity-summary"
export { fetchEntityScope } from "@/domains/entity-summary"

// ---------------------------------------------------------------------------
// BLOQUE PRINCIPAL — PLANTILLA (migrado a `@/domains/entity-summary`)
// ---------------------------------------------------------------------------

export type { PositionRef, PlantillaSummary } from "@/domains/entity-summary"
export { fetchPlantillaSummary } from "@/domains/entity-summary"

// ---------------------------------------------------------------------------
// BLOQUE PRINCIPAL — OCUPACIÓN Y TRABAJADORES ACTIVOS (migrado a `@/domains/entity-summary`)
// ---------------------------------------------------------------------------

export type { OccupancySummary } from "@/domains/entity-summary"
export { fetchOccupancySummary } from "@/domains/entity-summary"

// ---------------------------------------------------------------------------
// DISTRIBUCIÓN (Área / Categoría ocupacional) (migrado a `@/domains/entity-summary`)
// ---------------------------------------------------------------------------

export type { DistributionSlice, DistributionSummary } from "@/domains/entity-summary"
export { buildDistribution } from "@/domains/entity-summary"

// ---------------------------------------------------------------------------
// CANDIDATOS
// ---------------------------------------------------------------------------

export interface CandidatesSummary {
  total: number
  active: number
  archived: number
  /** Candidatos con vínculo fiable a un trabajador (contratados). */
  hired: number
}

/** Requiere `candidates.view` o `candidates.manage`. */
export async function fetchCandidatesSummary(entityIds: string[]): Promise<CandidatesSummary> {
  const { data, error } = await supabase
    .from("candidates")
    .select("status, worker_id")
    .in("organization_entity_id", entityIds)
  if (error) throw error

  const rows = (data as { status: string | null; worker_id: string | null }[]) || []
  const summary: CandidatesSummary = { total: rows.length, active: 0, archived: 0, hired: 0 }
  rows.forEach((row) => {
    if (row.status === "archived") summary.archived += 1
    else summary.active += 1
    // Criterio compartido: la fila de candidato quedó vinculada al contratar.
    if (hasLinkedWorker(row)) summary.hired += 1
  })
  return summary
}

// ---------------------------------------------------------------------------
// VACACIONES (migrado a `@/domains/entity-summary`)
// ---------------------------------------------------------------------------

export type { VacationsSummary } from "@/domains/entity-summary"
export { fetchVacationsSummary } from "@/domains/entity-summary"

// ---------------------------------------------------------------------------
// CONTRATOS
// ---------------------------------------------------------------------------

export interface ContractsSummary {
  current: number
  determined: number
  undetermined: number
}

/**
 * Contratos vigentes por tipo contractual real (`employment_contract_types.code`).
 * Requiere `contracts.view`, `contracts.manage`, `workers.view` o `workers.manage`.
 */
export async function fetchContractsSummary(entityIds: string[]): Promise<ContractsSummary> {
  const [contractsResult, typesResult] = await Promise.all([
    supabase
      .from("employment_contracts")
      .select("contract_type_id")
      .in("organization_entity_id", entityIds)
      .eq("is_current", true),
    supabase.from("employment_contract_types").select("id, code"),
  ])
  if (contractsResult.error) throw contractsResult.error
  if (typesResult.error) throw typesResult.error

  const codeById: Record<string, string> = {}
  ;(typesResult.data as { id: string; code: string }[] | null)?.forEach((t) => {
    codeById[t.id] = t.code
  })

  const summary: ContractsSummary = { current: 0, determined: 0, undetermined: 0 }
  ;((contractsResult.data as { contract_type_id: string | null }[]) || []).forEach((row) => {
    summary.current += 1
    const code = row.contract_type_id ? codeById[row.contract_type_id] : null
    if (code === "DETERMINADO") summary.determined += 1
    else if (code === "INDETERMINADO") summary.undetermined += 1
  })
  return summary
}

// ---------------------------------------------------------------------------
// PRÓXIMOS VENCIMIENTOS (reutiliza la lógica del módulo de alertas)
// ---------------------------------------------------------------------------

/**
 * Reutiliza EXACTAMENTE el cálculo del módulo de alertas (`contract_expiry_alerts`
 * + `summarizeContractAlerts`): no existe una segunda clasificación.
 * Requiere `contract_alerts.view`, `workers.view` o `workers.manage`.
 */
export async function fetchExpirationsSummary(
  entityIds: string[]
): Promise<ContractAlertSummary> {
  const perEntity = await Promise.all(
    entityIds.map((id) =>
      fetchContractAlerts(id, { horizonDays: CONTRACT_ALERT_HORIZON_DAYS })
    )
  )

  const seen = new Set<string>()
  const rows = perEntity.flat().filter((row) => {
    if (seen.has(row.contract_id)) return false
    seen.add(row.contract_id)
    return true
  })

  return summarizeContractAlerts(rows)
}

// ---------------------------------------------------------------------------
// MOVIMIENTOS (últimos N días)
// ---------------------------------------------------------------------------

export interface MovementsSummary {
  from: string
  to: string
  days: number
  hires: number
  separations: number
  reincorporations: number
  positionChanges: number
  contractChanges: number
}

/**
 * Movimientos fiables de un período indicado:
 *   - Altas: `workers.hire_date` en el período (histórico real, no estado actual).
 *   - Bajas / Reincorporaciones / Cambios de puesto / de contrato:
 *     `worker_employment_movements.movement_type` + `effective_date`.
 * Requiere `workers.view` o `workers.manage`.
 */
export async function fetchMovementsSummary(
  entityIds: string[]
): Promise<MovementsSummary> {
  const from = format(subDays(new Date(), MOVEMENTS_WINDOW_DAYS), "yyyy-MM-dd")
  const to = today()

  const [hiresResult, movementsResult] = await Promise.all([
    supabase
      .from("workers")
      .select("id")
      .in("organization_entity_id", entityIds)
      .gte("hire_date", from)
      .lte("hire_date", to),
    supabase
      .from("worker_employment_movements")
      .select("movement_type, workers!inner(organization_entity_id)")
      .in("workers.organization_entity_id", entityIds)
      .gte("effective_date", from)
      .lte("effective_date", to),
  ])
  if (hiresResult.error) throw hiresResult.error
  if (movementsResult.error) throw movementsResult.error

  const summary: MovementsSummary = {
    from,
    to,
    days: MOVEMENTS_WINDOW_DAYS,
    hires: ((hiresResult.data as { id: string }[]) || []).length,
    separations: 0,
    reincorporations: 0,
    positionChanges: 0,
    contractChanges: 0,
  }

  ;((movementsResult.data as { movement_type: string }[]) || []).forEach((row) => {
    switch (row.movement_type) {
      case "BAJA":
        summary.separations += 1
        break
      case "REINCORPORACION":
        summary.reincorporations += 1
        break
      case "CAMBIO_PUESTO":
        summary.positionChanges += 1
        break
      case "CAMBIO_CONTRATO":
        summary.contractChanges += 1
        break
      default:
        break
    }
  })

  return summary
}

// ---------------------------------------------------------------------------
// CONFIGURACIÓN / READINESS (reutiliza la validación contractual central)
// ---------------------------------------------------------------------------

export interface ContractDataReadiness {
  ready: boolean
  missing: number
}

/**
 * Reutiliza la validación central de integridad contractual (`validate_entity_contract_readiness`).
 * Requiere `contract_data.view`, `contract_data.manage`, `workers.view` o `workers.manage`.
 */
export async function fetchContractDataReadiness(
  entityId: string
): Promise<ContractDataReadiness> {
  const { data, error } = await supabase.rpc("validate_entity_contract_readiness", {
    p_entity_id: entityId,
  })
  if (error) throw error
  const result = data as { ready?: boolean; missing?: unknown[] } | null
  return {
    ready: !!result?.ready,
    missing: Array.isArray(result?.missing) ? result?.missing.length : 0,
  }
}

export interface RepresentativeStatus {
  ready: boolean
  assigned: number
}

/**
 * Representante autorizado vigente a la fecha (datos contractuales de la entidad).
 * Requiere `representatives.view/manage`, `contract_data.view/manage`, `organization.view/manage`.
 */
export async function fetchRepresentativeStatus(
  entityId: string
): Promise<RepresentativeStatus> {
  const { data, error } = await supabase.rpc("resolve_entity_representatives", {
    p_entity_id: entityId,
    p_on_date: today(),
  })
  if (error) throw error

  const rows = (data as { person_name: string | null }[]) || []
  const assigned = rows.filter((row) => !!row.person_name && row.person_name.trim() !== "").length
  return { ready: rows.length > 0 && assigned === rows.length, assigned }
}

export interface SalaryScaleStatus {
  ready: boolean
}

/**
 * Escala salarial aplicable según el régimen (PRESUPUESTADA → escala global;
 * EMPRESARIAL → escala propia). Sin fallback entre regímenes.
 * Requiere `salary.view/manage`, `contract_data.view/manage`, `workers.view/manage`.
 */
export async function fetchSalaryScaleStatus(entityId: string): Promise<SalaryScaleStatus> {
  const { data, error } = await supabase.rpc("resolve_salary_scale_for_entity", {
    entity_id: entityId,
  })
  if (error) throw error
  return { ready: !!data }
}

export interface DocumentTemplatesStatus {
  configured: number
  total: number
}

/**
 * Plantillas documentales configuradas: tipos documentales activos con al menos una
 * versión ACTIVE en la entidad (sólo versiones válidas/activas).
 * Requiere `document_templates.view/manage` u `organization.view/manage`.
 */
export async function fetchDocumentTemplatesStatus(
  entityId: string
): Promise<DocumentTemplatesStatus> {
  const [typesResult, versionsResult] = await Promise.all([
    supabase.from("document_template_types").select("code").eq("is_active", true),
    supabase
      .from("document_template_versions")
      .select("document_type_code")
      .eq("organization_entity_id", entityId)
      .eq("status", "ACTIVE"),
  ])
  if (typesResult.error) throw typesResult.error
  if (versionsResult.error) throw versionsResult.error

  const total = ((typesResult.data as { code: string }[]) || []).length
  const configuredCodes = new Set(
    ((versionsResult.data as { document_type_code: string }[]) || []).map(
      (v) => v.document_type_code
    )
  )
  return { total, configured: configuredCodes.size }
}
