import { supabase } from "@/lib/supabase"
import { columnName } from "@/integrations/supabase/schema-target"
import {
  buildEmploymentIndex,
  emptyEmploymentIndex,
  type EmploymentIndex,
} from "@/lib/people-classification"

/**
 * Relaciones laborales de un cliente para un conjunto de identificaciones.
 *
 * Se consulta SOLO por las identificaciones necesarias y SIEMPRE dentro del cliente,
 * de modo que nunca se mezclan personas de clientes distintos. El nombre físico de la
 * columna lo resuelve la frontera de nomenclatura.
 *
 * Los errores se propagan a propósito: devolver un índice vacío en silencio volvería a
 * mostrar como candidatas a personas que ya son trabajadores.
 */
export async function fetchClientEmploymentIndex(
  companyClientId: string | null | undefined,
  identifications: string[]
): Promise<EmploymentIndex> {
  const wanted = Array.from(new Set(identifications.map((ci) => (ci ?? "").trim()).filter(Boolean)))
  if (!companyClientId || wanted.length === 0) return emptyEmploymentIndex

  const { data, error } = await supabase
    .from("workers")
    .select("identification, employment_status")
    .eq(columnName("clientId"), companyClientId)
    .in("identification", wanted)

  if (error) throw error

  return buildEmploymentIndex(
    (data as { identification: string; employment_status: string }[]) || []
  )
}
