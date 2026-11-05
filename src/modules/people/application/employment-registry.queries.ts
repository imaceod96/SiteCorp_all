import { fetchEntityEmploymentPeriods } from "../infrastructure/employment-registry.repository"
import { fetchSeparationReasons } from "../infrastructure/staffing.repository"
import {
  computeEmploymentRegistryIncompleteSummary,
  type EmploymentPeriodIncompleteSummary,
  type EmploymentPeriodRow,
} from "../domain/employment-registry.rules"
import type { SeparationReason } from "../domain/entities"

export interface EntityEmploymentRegistryView {
  periods: EmploymentPeriodRow[]
  separationReasons: SeparationReason[]
}

/**
 * Carga el registro histórico de períodos laborales (Altas y Bajas) de la entidad
 * junto con el catálogo de motivos de baja para filtrado.
 */
export async function loadEntityEmploymentRegistryView(
  entityId: string
): Promise<EntityEmploymentRegistryView> {
  const [periods, separationReasons] = await Promise.all([
    fetchEntityEmploymentPeriods(entityId),
    fetchSeparationReasons(),
  ])

  return {
    periods,
    separationReasons,
  }
}

/**
 * Calcula el resumen de registros de Altas y Bajas con información incompleta
 * para la entidad actual (sin duplicar períodos que tengan varios campos pendientes).
 */
export async function loadEntityEmploymentRegistryIncompleteSummary(
  entityId: string
): Promise<EmploymentPeriodIncompleteSummary> {
  const periods = await fetchEntityEmploymentPeriods(entityId)
  return computeEmploymentRegistryIncompleteSummary(periods)
}
