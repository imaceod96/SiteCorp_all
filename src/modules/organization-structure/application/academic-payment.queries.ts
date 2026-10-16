import {
  rpcAcademicCategoryPaymentConfig,
  rpcResolveAcademicCategoryPayment,
  rpcResolveAcademicCategoryPaymentForFlags,
} from "../infrastructure/academic-payment.repository"
import type {
  AcademicCategoryPaymentConfig,
  AcademicCategoryPaymentResolution,
} from "../domain/entities"

/**
 * Pago por categoría académica — Consultas (aplicación).
 *
 * La resolución del importe se delega SIEMPRE al servidor: es la única fuente de
 * verdad y aplica el aislamiento entre regímenes.
 *   PRESUPUESTADA → configuración GLOBAL (`PRESUPUESTADA_GLOBAL`)
 *   EMPRESARIAL   → configuración propia de la entidad (`EMPRESARIAL_ENTITY`)
 * Sin fallback EMPRESARIAL → PRESUPUESTADA: si la entidad no tiene importe configurado,
 * el resultado es NO CONFIGURADO.
 */

/** Configuración vigente para una entidad (incluye `canView` / `canManage`). */
export async function loadAcademicCategoryPaymentConfig(
  entityId: string
): Promise<AcademicCategoryPaymentConfig> {
  return rpcAcademicCategoryPaymentConfig(entityId)
}

/** Importe aplicable a un trabajador concreto, resuelto por el servidor. */
export async function loadAcademicCategoryPayment(
  entityId: string,
  workerId: string
): Promise<AcademicCategoryPaymentResolution> {
  return rpcResolveAcademicCategoryPayment(entityId, workerId)
}

/** Importe aplicable a partir de los indicadores académicos (Máster / Doctor). */
export async function loadAcademicCategoryPaymentForFlags(
  entityId: string,
  hasMastersDegree: boolean | null | undefined,
  hasDoctorateDegree: boolean | null | undefined
): Promise<AcademicCategoryPaymentResolution> {
  return rpcResolveAcademicCategoryPaymentForFlags(
    entityId,
    hasMastersDegree,
    hasDoctorateDegree
  )
}
