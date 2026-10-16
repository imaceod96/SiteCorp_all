import type { StaffingExportRow } from "./entities"

/**
 * Estructura organizativa — Reglas de plantilla (plazas y vacantes).
 *
 * Las plazas de un puesto son CAPACIDADES: cada fila de la plantilla (Anexo14B) es una
 * capacidad autorizada; las que tienen trabajador están OCUPADAS y las que no, VACANTES.
 * Un puesto puede tener varias plazas (`authorized_quantity`), de modo que los recuentos
 * se hacen sobre las capacidades y nunca sobre el número de puestos.
 *
 * La regla vive aquí una sola vez: la pantalla de Plantilla operativa y la exportación
 * cuentan exactamente lo mismo.
 */

/** Capacidad de un puesto: plazas autorizadas, ocupadas y vacantes. */
export interface PositionCapacity {
  authorized: number
  occupied: number
  vacant: number
}

/**
 * Plazas autorizadas de la entidad: suma la cantidad autorizada de cada puesto.
 * Solo se cuentan los puestos ACTIVOS (la pantalla decide cuáles le pasa).
 */
export const sumAuthorizedPlazas = (
  positions: { authorized_quantity: number | null }[]
): number => positions.reduce((total, position) => total + (position.authorized_quantity || 0), 0)

/** Plazas vacantes: capacidad autorizada que aún no está ocupada (nunca negativa). */
export const vacantPlazas = (authorized: number, occupied: number): number =>
  Math.max(0, authorized - occupied)

/** Capacidad de un puesto calculada sobre las capacidades de la plantilla. */
export function capacityFromRows(rows: StaffingExportRow[]): PositionCapacity {
  const authorized = rows.length
  const occupied = rows.filter((row) => !!row.worker_id).length
  return { authorized, occupied, vacant: vacantPlazas(authorized, occupied) }
}

/**
 * Recuentos estructurales por puesto a partir de TODAS las capacidades de la plantilla
 * (no de las filas filtradas): así los contadores del puesto no cambian al filtrar.
 */
export function buildPositionCapacity(
  rows: StaffingExportRow[]
): Record<string, PositionCapacity> {
  const capacity: Record<string, PositionCapacity> = {}
  rows.forEach((row) => {
    if (!row.position_id) return
    const entry = capacity[row.position_id] ?? { authorized: 0, occupied: 0, vacant: 0 }
    entry.authorized += 1
    if (row.worker_id) entry.occupied += 1
    entry.vacant = vacantPlazas(entry.authorized, entry.occupied)
    capacity[row.position_id] = entry
  })
  return capacity
}
