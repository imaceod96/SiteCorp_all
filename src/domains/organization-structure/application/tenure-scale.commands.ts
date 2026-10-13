import {
  deactivateTenureScaleRange,
  insertTenureScaleRange,
  updateTenureScaleRange,
} from "../infrastructure/tenure-scale.repository"
import { tenureFormToValues } from "../domain/tenure-scale.rules"
import type { TenureScaleFormValues } from "../domain/entities"

/**
 * Escala de pago por antigüedad — Comandos (aplicación).
 *
 * El formulario trabaja en meses o años; la persistencia es SIEMPRE en meses, así que
 * la conversión y la validación viven en las reglas del dominio y los comandos sólo
 * reciben el formulario y escriben.
 *
 * Ninguna de estas operaciones añade comprobaciones de permisos: la pantalla no tenía
 * ninguna y la autorización efectiva es de RLS.
 */

/** Alta de un tramo. Lanza con el mensaje de validación si el formulario no es válido. */
export async function createTenureScaleRange(
  entityId: string,
  form: TenureScaleFormValues
): Promise<void> {
  const { values, error } = tenureFormToValues(form)
  if (error) throw new Error(error)
  await insertTenureScaleRange(entityId, values)
}

/** Edición de un tramo existente. */
export async function updateTenureScaleRangeById(
  rangeId: string,
  form: TenureScaleFormValues
): Promise<void> {
  const { values, error } = tenureFormToValues(form)
  if (error) throw new Error(error)
  await updateTenureScaleRange(rangeId, values)
}

/** Baja lógica de un tramo: deja de estar vigente sin perder el histórico. */
export async function deleteTenureScaleRange(rangeId: string): Promise<void> {
  await deactivateTenureScaleRange(rangeId)
}
