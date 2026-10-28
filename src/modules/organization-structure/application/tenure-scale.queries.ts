import { selectTenureScaleRanges } from "../infrastructure/tenure-scale.repository"
import type { TenureScaleRange } from "../domain/entities"

/**
 * Escala de pago por antigüedad — Consultas (aplicación).
 *
 * Devuelve los tramos ACTIVOS de UNA entidad. La escala es propia de cada entidad: no
 * se comparte ni se hereda entre entidades.
 */
export async function loadTenureScaleRanges(entityId: string): Promise<TenureScaleRange[]> {
  if (!entityId) return []
  return selectTenureScaleRanges(entityId)
}
