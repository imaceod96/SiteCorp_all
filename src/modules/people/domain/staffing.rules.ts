import { todayIsoInCuba } from "@/utils/cuba-date"
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
 * Asignación vigente: la que está vigente hoy (`is_current`, `start_date <= hoy` y sin fecha
 * de fin vencida) sobre un puesto ACTIVO.
 */
export const isCurrentStaffingAssignment = (assignment: {
  is_current: boolean | null
  start_date?: string | null
  end_date: string | null
  position: { is_active: boolean } | null
}): boolean => {
  const today = todayIsoInCuba()
  return (
    !!assignment.is_current &&
    (!assignment.start_date || assignment.start_date <= today) &&
    (!assignment.end_date || assignment.end_date >= today) &&
    !!assignment.position?.is_active
  )
}

/** Asignación vigente del trabajador (`null` si está pendiente de vinculación). */
export function currentStaffingAssignment(
  worker: Pick<StaffingWorkerRow, "assignments">
): StaffingWorkerAssignment | null {
  return (worker.assignments || []).find(isCurrentStaffingAssignment) ?? null
}

/** Trabajador con relación laboral vigente e incorporado a la fecha actual. */
export const isActiveStaffingWorker = (
  worker: Pick<StaffingWorkerRow, "employment_status"> & { hire_date?: string | null }
): boolean =>
  worker.employment_status === EMPLOYMENT_STATUS.active &&
  (!worker.hire_date || worker.hire_date <= todayIsoInCuba())

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
