/**
 * Pago por categoría académica (Máster / Doctor).
 *
 * Compatibilidad: este módulo se conserva como FACHADA del dominio de estructura
 * organizativa (`@/domains/organization-structure`), que es ahora el único lugar donde
 * viven las reglas, la resolución y las RPC del pago académico.
 *
 * No se ha cambiado ninguna regla, ningún nombre de RPC, ningún parámetro ni ningún
 * texto. Los consumidores existentes siguen funcionando sin tocar sus importaciones:
 *
 *   import { resolveAcademicCategoryPayment } from "@/domains/organization-structure"
 *
 * FUENTE ÚNICA DE VERDAD (servidor):
 *   public.resolve_academic_category_payment(p_entity_id, p_worker_id)
 *   public.resolve_academic_category_payment_for_flags(p_entity_id, masters, doctorate)
 *
 * Regla salarial (Doctor tiene prioridad; NUNCA se suman ambos):
 *   1. Doctor = true                        → categoría DOCTOR (importe Doctor)
 *   2. Doctor = false y Máster = true       → categoría MASTER (importe Máster)
 *   3. Doctor = false y Máster = false      → sin categoría (importe 0)
 *
 * Aislamiento entre regímenes (igual que la escala salarial):
 *   PRESUPUESTADA → configuración GLOBAL (scope_type = 'PRESUPUESTADA_GLOBAL')
 *   EMPRESARIAL   → configuración propia de la entidad (scope_type = 'EMPRESARIAL_ENTITY')
 *   Sin fallback EMPRESARIAL → PRESUPUESTADA: si la entidad no tiene configurado su
 *   importe, el resultado es NO CONFIGURADO (amount = null, configured = false).
 *
 * Este módulo NO interviene todavía en Prenómina ni en el Anexo 14: sólo modela y
 * resuelve los datos para fases posteriores.
 */

export {
  academicCategoryLabel,
  formatAcademicAmount,
  loadAcademicCategoryPayment as resolveAcademicCategoryPayment,
  loadAcademicCategoryPaymentConfig as fetchAcademicCategoryPaymentConfig,
  loadAcademicCategoryPaymentForFlags as resolveAcademicCategoryPaymentForFlags,
  resolveAcademicCategory,
  saveAcademicCategoryPayment,
} from "@/domains/organization-structure"

export type {
  AcademicCategory,
  AcademicCategoryPaymentConfig,
  AcademicCategoryPaymentResolution,
} from "@/domains/organization-structure"
