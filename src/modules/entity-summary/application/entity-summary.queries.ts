import { format, subDays } from "date-fns"
import {
  CONTRACT_ALERT_HORIZON_DAYS,
  fetchContractAlerts,
  summarizeContractAlerts,
  type ContractAlertSummary,
} from "@/modules/contracts"
import {
  MOVEMENTS_WINDOW_DAYS,
  summarizeCandidates,
  summarizeContractDataReadiness,
  summarizeContracts,
  summarizeDocumentTemplatesStatus,
  summarizeMovements,
  summarizeRepresentativeStatus,
} from "../domain/summary.rules"
import type {
  CandidatesSummary,
  ContractDataReadiness,
  ContractsSummary,
  DocumentTemplatesStatus,
  MovementsSummary,
  RepresentativeStatus,
  SalaryScaleStatus,
} from "../domain/entities"
import {
  fetchActiveDocumentTemplateTypes,
  fetchActiveDocumentTemplateVersions,
  fetchCandidateSummaryRows,
  fetchCurrentContractRows,
  fetchEmploymentContractTypeCodes,
  fetchHiresInPeriod,
  fetchMovementRowsInPeriod,
  rpcResolveEntityRepresentatives,
  rpcResolveSalaryScaleForEntity,
  rpcValidateEntityContractReadiness,
} from "../infrastructure/summary.repository"

/**
 * Resumen de entidad — Casos de uso de los bloques del Resumen (aplicación).
 *
 * Regla de oro (la misma de siempre): cada bloque se consulta SOLO cuando el usuario
 * tiene el permiso real que ya gobierna el módulo correspondiente (permiso → enabled
 * query, decidido por el hook). El backend (RLS) sigue siendo la autoridad final.
 *
 * Los casos de uso conservan el nombre y la firma que ya consumía la aplicación, de
 * modo que los contadores, los filtros y los resultados no cambian.
 */

const today = () => format(new Date(), "yyyy-MM-dd")

/** Requiere `candidates.view` o `candidates.manage`. */
export async function fetchCandidatesSummary(entityIds: string[]): Promise<CandidatesSummary> {
  return summarizeCandidates(await fetchCandidateSummaryRows(entityIds))
}

/**
 * Contratos vigentes por tipo contractual real (`employment_contract_types.code`).
 * Requiere `contracts.view`, `contracts.manage`, `workers.view` o `workers.manage`.
 */
export async function fetchContractsSummary(entityIds: string[]): Promise<ContractsSummary> {
  const [contractRows, contractTypes] = await Promise.all([
    fetchCurrentContractRows(entityIds),
    fetchEmploymentContractTypeCodes(),
  ])

  const codeById: Record<string, string> = {}
  contractTypes.forEach((type) => {
    codeById[type.id] = type.code
  })

  return summarizeContracts(contractRows, codeById)
}

/**
 * Reutiliza EXACTAMENTE el cálculo del módulo de alertas (`contract_expiry_alerts`
 * + `summarizeContractAlerts`): no existe una segunda clasificación.
 * Requiere `contract_alerts.view`, `workers.view` o `workers.manage`.
 */
export async function fetchExpirationsSummary(
  entityIds: string[]
): Promise<ContractAlertSummary> {
  const perEntity = await Promise.all(
    entityIds.map((id) => fetchContractAlerts(id, { horizonDays: CONTRACT_ALERT_HORIZON_DAYS }))
  )

  const seen = new Set<string>()
  const rows = perEntity.flat().filter((row) => {
    if (seen.has(row.contract_id)) return false
    seen.add(row.contract_id)
    return true
  })

  return summarizeContractAlerts(rows)
}

/**
 * Movimientos fiables de un período indicado:
 *   - Altas: `workers.hire_date` en el período (histórico real, no estado actual).
 *   - Bajas / Reincorporaciones / Cambios de puesto / de contrato:
 *     `worker_employment_movements.movement_type` + `effective_date`.
 * Requiere `workers.view` o `workers.manage`.
 */
export async function fetchMovementsSummary(entityIds: string[]): Promise<MovementsSummary> {
  const from = format(subDays(new Date(), MOVEMENTS_WINDOW_DAYS), "yyyy-MM-dd")
  const to = today()

  const [hires, movementRows] = await Promise.all([
    fetchHiresInPeriod(entityIds, from, to),
    fetchMovementRowsInPeriod(entityIds, from, to),
  ])

  return summarizeMovements({ from, to }, hires, movementRows)
}

/**
 * Reutiliza la validación central de integridad contractual (`validate_entity_contract_readiness`).
 * Requiere `contract_data.view`, `contract_data.manage`, `workers.view` o `workers.manage`.
 */
export async function fetchContractDataReadiness(
  entityId: string
): Promise<ContractDataReadiness> {
  return summarizeContractDataReadiness(await rpcValidateEntityContractReadiness(entityId))
}

/**
 * Representante autorizado vigente a la fecha (datos contractuales de la entidad).
 * Requiere `representatives.view/manage`, `contract_data.view/manage`, `organization.view/manage`.
 */
export async function fetchRepresentativeStatus(
  entityId: string
): Promise<RepresentativeStatus> {
  const rows = await rpcResolveEntityRepresentatives(entityId, today())
  return summarizeRepresentativeStatus(rows)
}

/**
 * Escala salarial aplicable según el régimen (PRESUPUESTADA → escala global;
 * EMPRESARIAL → escala propia). Sin fallback entre regímenes.
 * Requiere `salary.view/manage`, `contract_data.view/manage`, `workers.view/manage`.
 */
export async function fetchSalaryScaleStatus(entityId: string): Promise<SalaryScaleStatus> {
  return { ready: !!(await rpcResolveSalaryScaleForEntity(entityId)) }
}

/**
 * Plantillas documentales configuradas: tipos documentales activos con al menos una
 * versión ACTIVE en la entidad (sólo versiones válidas/activas).
 * Requiere `document_templates.view/manage` u `organization.view/manage`.
 */
export async function fetchDocumentTemplatesStatus(
  entityId: string
): Promise<DocumentTemplatesStatus> {
  const [types, versions] = await Promise.all([
    fetchActiveDocumentTemplateTypes(),
    fetchActiveDocumentTemplateVersions(entityId),
  ])

  return summarizeDocumentTemplatesStatus(types, versions)
}
