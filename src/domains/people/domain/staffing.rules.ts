import { EMPLOYMENT_STATUS } from "./entities"
import type { StaffingWorkerAssignment, StaffingWorkerRow } from "./entities"

/**
 * Personas — Reglas puras de la Plantilla operativa (aplicación de puestos).
 *
 * La plantilla operativa muestra CAPACIDADES del Puesto: cada capacidad con trabajador
 * está OCUPADA y cada capacidad sin trabajador es una VACANTE. Estas reglas deciden qué
 * trabajador ocupa plaza (asignación vigente sobre un puesto activo), qué trabajador está
 * pendiente de vinculación y cuántas plazas ocupa cada puesto.
 *
 * Este módulo no importa React, Supabase ni `@/lib/*`: puede verificarse de forma aislada.
 */

/**
 * Asignación vigente: la que está abierta (`is_current` sin fecha de fin) sobre un puesto
 * ACTIVO. Es el mismo criterio que usaba la plantilla operativa.
 */
export const isCurrentStaffingAssignment = (assignment: {
  is_current: boolean | null
  end_date: string | null
  position: { is_active: boolean } | null
}): boolean => !!assignment.is_current && !assignment.end_date && !!assignment.position?.is_active

/** Asignación vigente del trabajador (`null` si está pendiente de vinculación). */
export function currentStaffingAssignment(
  worker: Pick<StaffingWorkerRow, "assignments">
): StaffingWorkerAssignment | null {
  return (worker.assignments || []).find(isCurrentStaffingAssignment) ?? null
}

/** Trabajador con relación laboral vigente. */
export const isActiveStaffingWorker = (
  worker: Pick<StaffingWorkerRow, "employment_status">
): boolean => worker.employment_status === EMPLOYMENT_STATUS.active

/** Trabajadores activos de la plantilla. */
export const activeStaffingWorkers = (workers: StaffingWorkerRow[]): StaffingWorkerRow[] =>
  workers.filter(isActiveStaffingWorker)

/** Trabajadores SIN puesto actual: quedan pendientes de vinculación a la plantilla. */
export const pendingStaffingWorkers = (workers: StaffingWorkerRow[]): StaffingWorkerRow[] =>
  workers.filter((worker) => currentStaffingAssignment(worker) === null)

/** Trabajadores CON puesto actual: cada uno ocupa una plaza. */
export const occupiedStaffingWorkers = (workers: StaffingWorkerRow[]): StaffingWorkerRow[] =>
  workers.filter((worker) => currentStaffingAssignment(worker) !== null)

/**
 * Plazas ocupadas por puesto: cuántos trabajadores de la lista ocupan cada puesto.
 * Se le pasa la lista de trabajadores ACTIVOS (la pantalla decide qué listado usa).
 */
export function countAssignmentsByPosition(
  workers: StaffingWorkerRow[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  workers.forEach((worker) => {
    const assignment = currentStaffingAssignment(worker)
    if (!assignment) return
    counts[assignment.position_id] = (counts[assignment.position_id] || 0) + 1
  })
  return counts
}
