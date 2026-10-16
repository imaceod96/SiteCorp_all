import { supabase } from "@/lib/supabase"
import type { OccupancySummary } from "../domain/entities"

/** Requiere `workers.view` o `workers.manage`. */
export async function fetchOccupancySummary(entityIds: string[]): Promise<OccupancySummary> {
  const { data: workersData, error: workersError } = await supabase
    .from("workers")
    .select("id")
    .in("organization_entity_id", entityIds)
    .eq("employment_status", "active")
  if (workersError) throw workersError

  const activeWorkerIds = new Set(
    ((workersData as { id: string }[]) || []).map((w) => w.id)
  )

  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from("worker_position_assignments")
    .select("position_id, worker_id, workers!inner(organization_entity_id, employment_status)")
    .eq("is_current", true)
    .is("end_date", null)
    .in("workers.organization_entity_id", entityIds)
    .eq("workers.employment_status", "active")
  if (assignmentsError) throw assignmentsError

  const occupiedByPosition: Record<string, number> = {}
  let occupied = 0
  ;((assignmentsData as { position_id: string; worker_id: string }[]) || []).forEach((row) => {
    // Defensa extra: sólo cuenta asignaciones de trabajadores activos del ámbito.
    if (!activeWorkerIds.has(row.worker_id)) return
    occupied += 1
    occupiedByPosition[row.position_id] = (occupiedByPosition[row.position_id] || 0) + 1
  })

  return { activeWorkers: activeWorkerIds.size, occupied, occupiedByPosition }
}
