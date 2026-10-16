import { supabase } from "@/lib/supabase"
import type { Anexo14Row, Anexo14Filters } from "../domain/entities"

/**
 * ANEXO 14 — Exportación de la VISTA DE PUESTOS.
 *
 * Contiene EXCLUSIVAMENTE estructura de Puestos (Área → Puesto): no es la
 * exportación de trabajadores y no incluye ningún dato personal (no hay nombres
 * de trabajadores, CI, sexo, antigüedad, vacaciones ni contratos).
 *
 * La consulta se resuelve en el backend (`entity_positions_anexo14`), que aplica
 * la misma autorización que la vista (`can_access_entity` → staffing.view/manage)
 * y devuelve el orden organizativo ya resuelto (Área → Cargo → Puesto).
 */

export async function fetchAnexo14Rows(
  entityId: string,
  filters: Anexo14Filters = {}
): Promise<Anexo14Row[]> {
  const { data, error } = await supabase.rpc("entity_positions_anexo14", {
    p_entity_id: entityId,
    p_include_inactive: !!filters.includeInactive,
    p_area_id: filters.areaId || null,
    p_job_id: filters.jobId || null,
  })
  if (error) throw error

  return ((data as Anexo14Row[]) || []).map((row) => ({
    ...row,
    authorized_quantity: Number(row.authorized_quantity || 0),
    salary_group_sequence:
      row.salary_group_sequence === null || row.salary_group_sequence === undefined
        ? null
        : Number(row.salary_group_sequence),
  }))
}
