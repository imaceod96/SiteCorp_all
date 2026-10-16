import { supabase } from "@/lib/supabase"
import { type PositionScheduleSegment } from "../domain/entities"

/** Segmentos de horario de todos los puestos de la entidad (RLS aplica). */
export async function fetchEntityScheduleSegments(
  entityId: string
): Promise<Record<string, PositionScheduleSegment[]>> {
  const { data, error } = await supabase
    .from("position_schedule_segments")
    .select("id, position_id, day_of_week, start_time, end_time, crosses_midnight, display_order")
    .eq("organization_entity_id", entityId)
    .order("day_of_week")
    .order("display_order")

  if (error) throw error

  const grouped: Record<string, PositionScheduleSegment[]> = {}
  ;((data as PositionScheduleSegment[]) || []).forEach((segment) => {
    const key = segment.position_id || ""
    grouped[key] = grouped[key] || []
    grouped[key].push(segment)
  })
  return grouped
}

/** Segmentos de un puesto concreto. */
export async function fetchPositionScheduleSegments(
  positionId: string
): Promise<PositionScheduleSegment[]> {
  const { data, error } = await supabase
    .from("position_schedule_segments")
    .select("id, position_id, day_of_week, start_time, end_time, crosses_midnight, display_order")
    .eq("position_id", positionId)
    .order("day_of_week")
    .order("display_order")

  if (error) throw error
  return (data as PositionScheduleSegment[]) || []
}
