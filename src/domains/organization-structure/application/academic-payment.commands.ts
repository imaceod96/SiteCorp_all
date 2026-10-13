import { rpcSaveAcademicCategoryPayment } from "../infrastructure/academic-payment.repository"
import type { AcademicCategory } from "../domain/entities"

/**
 * Pago por categoría académica — Comandos (aplicación).
 *
 * Guarda los DOS importes de la configuración vigente. Se conserva el orden de la
 * pantalla (Máster y después Doctor) para no alterar el comportamiento observable: si
 * el segundo falla, el primero ya está guardado y el error se propaga igual que antes.
 *
 * Un importe `null` deja la categoría explícitamente NO CONFIGURADA; `0` es un valor
 * válido (configurado sin pago). El permiso de escritura lo impone la RPC
 * (`save_academic_category_payment`), no la interfaz.
 */
export async function saveAcademicCategoryPaymentAmounts(input: {
  entityId: string
  masterAmount: number | null
  doctorAmount: number | null
}): Promise<void> {
  await saveAcademicCategoryPayment(input.entityId, "MASTER", input.masterAmount)
  await saveAcademicCategoryPayment(input.entityId, "DOCTOR", input.doctorAmount)
}

/** Guarda el importe de UNA categoría (grano fino, misma RPC). */
export async function saveAcademicCategoryPayment(
  entityId: string,
  category: AcademicCategory,
  amount: number | null
): Promise<void> {
  await rpcSaveAcademicCategoryPayment(entityId, category, amount)
}
