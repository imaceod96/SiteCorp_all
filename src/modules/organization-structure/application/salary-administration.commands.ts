import { applySalaryChange } from "@/modules/contracts"
import {
  deactivateSalaryGroupRecord,
  insertEntityEmpresarialScale,
  insertGlobalPresupuestadaScale,
  insertSalaryGroup,
  selectNextSalaryGroupSequence,
  selectSalaryGroupValueById,
  updateSalaryGroupRecord,
} from "../infrastructure/salary-administration.repository"
import type { SalaryGroup, SalaryGroupValue, SalaryScale } from "../domain/entities"

/**
 * Estructura organizativa — Casos de uso de escritura de escalas salariales (aplicación).
 *
 * Un importe NUNCA se sobrescribe: cada cambio de importe crea una nueva vigencia a través
 * de la función atómica del backend que ya expone el dominio de Contratos, que además
 * registra el histórico salarial de cada trabajador afectado y deja su anexo pendiente. Un
 * grupo no se elimina: se desactiva.
 */

/** Escala presupuestada global de SiteCorp (la fecha efectiva la gobiernan sus grupos). */
export async function createGlobalPresupuestadaScale(
  name: string,
  currencyCode: string
): Promise<SalaryScale> {
  return insertGlobalPresupuestadaScale(name, currencyCode)
}

/** Escala empresarial de una entidad concreta. */
export async function createEntityEmpresarialScale(
  entityId: string,
  name: string,
  currencyCode: string
): Promise<SalaryScale> {
  return insertEntityEmpresarialScale(entityId, name, currencyCode)
}

/** Añade un grupo salarial al final de la escala (número de secuencia correlativo). */
export async function addSalaryGroup(
  scaleId: string,
  description?: string
): Promise<SalaryGroup> {
  const nextSequence = await selectNextSalaryGroupSequence(scaleId)
  return insertSalaryGroup(scaleId, nextSequence, description)
}

/** Edición de los datos de un grupo (la secuencia no se reordena desde aquí). */
export async function updateSalaryGroup(
  groupId: string,
  updates: Partial<SalaryGroup>
): Promise<SalaryGroup> {
  return updateSalaryGroupRecord(groupId, updates)
}

/** Desactiva un grupo salarial conservando su histórico de importes. */
export async function deactivateSalaryGroup(groupId: string): Promise<void> {
  await deactivateSalaryGroupRecord(groupId)
}

/**
 * Registra una nueva vigencia del importe del grupo de forma atómica: histórico salarial de
 * cada trabajador afectado y anexo contractual pendiente de generar. Es idempotente.
 */
export async function addSalaryGroupValue(
  groupId: string,
  amount: number,
  currencyCode: string,
  effectiveFrom: string
): Promise<SalaryGroupValue | null> {
  const result = await applySalaryChange(groupId, amount, currencyCode, effectiveFrom, null)
  const valueId = result?.salary_group_value_id
  if (!valueId) return null
  return selectSalaryGroupValueById(valueId)
}
