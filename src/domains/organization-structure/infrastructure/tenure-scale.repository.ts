import { supabase } from "@/lib/supabase"
import type { TenureScaleRange, TenureScaleValues } from "../domain/entities"

/**
 * Escala de pago por antigüedad — Repositorio (infraestructura).
 *
 * Único punto que lee y escribe `tenure_payment_scales`, con la misma proyección,
 * filtro, ordenación y escritura que usaba la pantalla.
 *
 * Los tramos NO se borran: se DESACTIVAN (`is_active = false`), de modo que el
 * histórico salarial no pierde la escala que estuvo vigente.
 *
 * No se añade ninguna comprobación de permisos: esta pantalla no tenía ninguna y la
 * autorización efectiva es de RLS. Añadir aquí una regla nueva sería ampliar el
 * control de acceso, justo lo contrario de lo que exige esta migración.
 */

/** Tramos ACTIVOS de la entidad, ordenados por mes de inicio. */
export async function selectTenureScaleRanges(entityId: string): Promise<TenureScaleRange[]> {
  const { data, error } = await supabase
    .from("tenure_payment_scales")
    .select("*")
    .eq("organization_entity_id", entityId)
    .eq("is_active", true)
    .order("from_months")

  if (error) throw error
  return (data as TenureScaleRange[]) || []
}

/** Alta de un tramo activo. */
export async function insertTenureScaleRange(
  entityId: string,
  values: TenureScaleValues
): Promise<void> {
  const { error } = await supabase.from("tenure_payment_scales").insert({
    organization_entity_id: entityId,
    from_months: values.from_months,
    to_months: values.to_months,
    amount: values.amount,
    is_active: true,
  })

  if (error) throw error
}

/** Edición de un tramo (se conserva activo). */
export async function updateTenureScaleRange(
  rangeId: string,
  values: TenureScaleValues
): Promise<void> {
  const { error } = await supabase
    .from("tenure_payment_scales")
    .update({
      from_months: values.from_months,
      to_months: values.to_months,
      amount: values.amount,
      is_active: true,
    })
    .eq("id", rangeId)

  if (error) throw error
}

/** Baja lógica de un tramo: deja de estar vigente sin perder el histórico. */
export async function deactivateTenureScaleRange(rangeId: string): Promise<void> {
  const { error } = await supabase
    .from("tenure_payment_scales")
    .update({ is_active: false })
    .eq("id", rangeId)

  if (error) throw error
}
