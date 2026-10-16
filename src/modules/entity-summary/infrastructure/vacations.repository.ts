import { supabase } from "@/lib/supabase"
import type { VacationOverviewRow } from "@/domains/vacations-licenses/vacations"
import type { VacationsSummary } from "../domain/entities"

/**
 * KPIs de vacaciones reutilizando EXACTAMENTE el motor backend (`entity_vacation_overview`,
 * que a su vez ejecuta el catch-up idempotente). No se duplica ninguna fórmula.
 * Requiere `vacations.view` o `vacations.manage`.
 */
export async function fetchVacationsSummary(entityIds: string[]): Promise<VacationsSummary> {
  const results = await Promise.all(
    entityIds.map((id) => supabase.rpc("entity_vacation_overview", { p_entity_id: id }))
  )

  const rows: VacationOverviewRow[] = []
  for (const result of results) {
    if (result.error) throw result.error
    rows.push(...((result.data as VacationOverviewRow[]) || []))
  }

  const summary: VacationsSummary = {
    active: rows.length,
    onVacation: 0,
    nearLimit: 0,
    atLimit: 0,
    averageBalance: 0,
  }

  let total = 0
  rows.forEach((row) => {
    total += Number(row.balance) || 0
    if (row.active_vacation) summary.onVacation += 1
    if (row.status === "NEAR_LIMIT") summary.nearLimit += 1
    if (row.status === "LIMIT_REACHED") summary.atLimit += 1
  })
  summary.averageBalance = rows.length > 0 ? total / rows.length : 0

  return summary
}
