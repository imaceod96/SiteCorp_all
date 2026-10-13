import { hasLinkedWorker } from "@/domains/people"
import type {
  CandidatesSummary,
  ContractDataReadiness,
  ContractsSummary,
  DocumentTemplatesStatus,
  MovementsSummary,
  RepresentativeStatus,
} from "./entities"

/**
 * Resumen de entidad — Reglas de agregación (dominio, sin acceso a datos).
 *
 * Los contadores NO se inventan aquí: cada regla recibe las filas reales de los
 * módulos operativos (o el resultado ya resuelto por una RPC) y aplica exactamente
 * el mismo criterio de siempre. No se guardan estadísticas ni se deducen estados
 * históricos a partir del estado actual.
 */

/** Período mostrado para los movimientos de personal (días). */
export const MOVEMENTS_WINDOW_DAYS = 30

/** Candidatos del ámbito: activos, archivados y contratados (vínculo fiable). */
export function summarizeCandidates(
  rows: { status: string | null; worker_id: string | null }[]
): CandidatesSummary {
  const summary: CandidatesSummary = { total: rows.length, active: 0, archived: 0, hired: 0 }
  rows.forEach((row) => {
    if (row.status === "archived") summary.archived += 1
    else summary.active += 1
    // Criterio compartido: la fila de candidato quedó vinculada al contratar.
    if (hasLinkedWorker(row)) summary.hired += 1
  })
  return summary
}

/**
 * Contratos vigentes por tipo contractual real (`employment_contract_types.code`).
 * El código de cada tipo se resuelve con el índice `id → code` del catálogo.
 */
export function summarizeContracts(
  rows: { contract_type_id: string | null }[],
  codeById: Record<string, string>
): ContractsSummary {
  const summary: ContractsSummary = { current: 0, determined: 0, undetermined: 0 }
  rows.forEach((row) => {
    summary.current += 1
    const code = row.contract_type_id ? codeById[row.contract_type_id] : null
    if (code === "DETERMINADO") summary.determined += 1
    else if (code === "INDETERMINADO") summary.undetermined += 1
  })
  return summary
}

/**
 * Movimientos fiables de un período indicado:
 *   - Altas: `workers.hire_date` en el período (histórico real, no estado actual).
 *   - Bajas / Reincorporaciones / Cambios de puesto / de contrato:
 *     `worker_employment_movements.movement_type` + `effective_date`.
 */
export function summarizeMovements(
  period: { from: string; to: string },
  hires: number,
  rows: { movement_type: string }[]
): MovementsSummary {
  const summary: MovementsSummary = {
    from: period.from,
    to: period.to,
    days: MOVEMENTS_WINDOW_DAYS,
    hires,
    separations: 0,
    reincorporations: 0,
    positionChanges: 0,
    contractChanges: 0,
  }

  rows.forEach((row) => {
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

/** Ready/missing tal y como los devuelve `validate_entity_contract_readiness`. */
export function summarizeContractDataReadiness(
  result: { ready?: boolean; missing?: unknown[] } | null
): ContractDataReadiness {
  return {
    ready: !!result?.ready,
    missing: Array.isArray(result?.missing) ? result.missing.length : 0,
  }
}

/**
 * Representante autorizado vigente a la fecha: está listo sólo si hay
 * representantes resueltos y todos tienen nombre de persona.
 */
export function summarizeRepresentativeStatus(rows: { person_name: string | null }[]): RepresentativeStatus {
  const assigned = rows.filter((row) => !!row.person_name && row.person_name.trim() !== "").length
  return { ready: rows.length > 0 && assigned === rows.length, assigned }
}

/**
 * Plantillas documentales configuradas: tipos documentales activos con al menos una
 * versión ACTIVE en la entidad (sólo versiones válidas/activas).
 */
export function summarizeDocumentTemplatesStatus(
  types: { code: string }[],
  versions: { document_type_code: string }[]
): DocumentTemplatesStatus {
  const total = types.length
  const configuredCodes = new Set(versions.map((v) => v.document_type_code))
  return { total, configured: configuredCodes.size }
}
