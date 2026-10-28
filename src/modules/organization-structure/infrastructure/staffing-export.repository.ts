import { supabase } from "@/lib/supabase"
import type { StaffingExportRow } from "../domain/entities"

/**
 * ANEXO14B — «REGISTRO DE TRABAJADORES / a) Registro de principales datos».
 *
 * Exportación de la PLANTILLA ORGANIZATIVA de la entidad (la descarga
 * «Plantilla → Exportar Anexo14B»). Se construye desde
 * Área → Cargo → Puesto/capacidad autorizada → Trabajador que ocupa la
 * capacidad, si existe, de modo que el documento muestra la plantilla
 * autorizada Y su ocupación real: las capacidades vacantes NO desaparecen.
 *
 * Toda la información se obtiene del backend (`entity_staffing_export`), que
 * aplica la autorización (`can_access_entity` → workers.view/manage), expande
 * cada Puesto en `authorized_quantity` capacidades, coloca primero los
 * trabajadores con Assignment ACTUAL válido y deja el resto vacías, con el
 * orden organizativo ya resuelto.
 *
 * No depende de ningún período de Prenómina: no usa noches trabajadas,
 * snapshots ni totales mensuales.
 */

/** Consulta las capacidades de plantilla ya expandidas y ordenadas (RPC backend). */
export async function fetchStaffingExportRows(entityId: string): Promise<StaffingExportRow[]> {
  const { data, error } = await supabase.rpc("entity_staffing_export", { p_entity_id: entityId })
  if (error) throw error

  const toNumberOrNull = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value)

  return ((data as StaffingExportRow[]) || []).map((row) => ({
    ...row,
    salary_group_sequence: toNumberOrNull(row.salary_group_sequence),
    salary: toNumberOrNull(row.salary),
    cla_amount: toNumberOrNull(row.cla_amount),
    academic_amount: toNumberOrNull(row.academic_amount),
    service_start: row.service_start ? String(row.service_start).slice(0, 10) : null,
  }))
}
