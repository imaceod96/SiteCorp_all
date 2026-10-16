import { supabase } from "@/lib/supabase"
import type {
  AcademicCategory,
  AcademicCategoryPaymentConfig,
  AcademicCategoryPaymentResolution,
  AcademicPaymentScope,
} from "../domain/entities"

/**
 * Pago por categoría académica — Repositorio (infraestructura).
 *
 * Único punto que habla con las funciones SQL del pago académico. Son RPC
 * SECURITY DEFINER: la configuración sólo se puede LEER y GUARDAR si el backend lo
 * autoriza (`can_view` / `can_manage` viajan en la propia respuesta), y la resolución
 * salarial se calcula siempre en el servidor.
 *
 *   public.get_academic_category_payment_config(p_entity_id)
 *   public.save_academic_category_payment(p_entity_id, p_category, p_amount)
 *   public.resolve_academic_category_payment(p_entity_id, p_worker_id)
 *   public.resolve_academic_category_payment_for_flags(p_entity_id, p_has_masters, p_has_doctorate)
 *
 * Nombres, parámetros, normalización y firmas son EXACTAMENTE los que ya usaba
 * `src/lib/academic-payment.ts`: ningún contrato de RPC cambia.
 */

interface AcademicCategoryPaymentConfigRow {
  entity_id?: string
  scope?: string
  regime?: string | null
  currency_code?: string
  master_amount?: number | null
  doctor_amount?: number | null
  master_configured?: boolean
  doctor_configured?: boolean
  configured?: boolean
  can_view?: boolean
  can_manage?: boolean
}

/** Configuración vigente de pago por categoría académica para una entidad. */
export async function rpcAcademicCategoryPaymentConfig(
  entityId: string
): Promise<AcademicCategoryPaymentConfig> {
  const { data, error } = await supabase.rpc("get_academic_category_payment_config", {
    p_entity_id: entityId,
  })
  if (error) throw error

  const row = (data || {}) as AcademicCategoryPaymentConfigRow

  return {
    entityId,
    scope:
      row.scope === "PRESUPUESTADA_GLOBAL" ? "PRESUPUESTADA_GLOBAL" : "EMPRESARIAL_ENTITY",
    regime: (row.regime as string | null) ?? null,
    currencyCode: (row.currency_code as string) || "CUP",
    masterAmount: row.master_amount === null ? null : Number(row.master_amount),
    doctorAmount: row.doctor_amount === null ? null : Number(row.doctor_amount),
    masterConfigured: !!row.master_configured,
    doctorConfigured: !!row.doctor_configured,
    configured: !!row.configured,
    canView: !!row.can_view,
    canManage: !!row.can_manage,
  }
}

/**
 * Guarda el importe de una categoría académica.
 * `null` deja la categoría explícitamente NO CONFIGURADA; `0` es un valor válido
 * (configurado sin pago) y nunca se convierte en NULL.
 */
export async function rpcSaveAcademicCategoryPayment(
  entityId: string,
  category: AcademicCategory,
  amount: number | null
): Promise<void> {
  const { error } = await supabase.rpc("save_academic_category_payment", {
    p_entity_id: entityId,
    p_category: category,
    p_amount: amount,
  })
  if (error) throw error
}

/** Resolución central del pago académico de un trabajador (RPC del servidor). */
export async function rpcResolveAcademicCategoryPayment(
  entityId: string,
  workerId: string
): Promise<AcademicCategoryPaymentResolution> {
  const { data, error } = await supabase.rpc("resolve_academic_category_payment", {
    p_entity_id: entityId,
    p_worker_id: workerId,
  })
  if (error) throw error
  return mapResolution(data)
}

/** Resolución a partir de los indicadores (sin trabajador persistido). */
export async function rpcResolveAcademicCategoryPaymentForFlags(
  entityId: string,
  hasMastersDegree: boolean | null | undefined,
  hasDoctorateDegree: boolean | null | undefined
): Promise<AcademicCategoryPaymentResolution> {
  const { data, error } = await supabase.rpc("resolve_academic_category_payment_for_flags", {
    p_entity_id: entityId,
    p_has_masters: hasMastersDegree ?? false,
    p_has_doctorate: hasDoctorateDegree ?? false,
  })
  if (error) throw error
  return mapResolution(data)
}

function mapResolution(data: unknown): AcademicCategoryPaymentResolution {
  const row = (data || {}) as Record<string, unknown>
  const rawCategory = row.category
  const rawAmount = row.amount
  const rawScope = row.scope

  return {
    category:
      rawCategory === "DOCTOR" || rawCategory === "MASTER"
        ? (rawCategory as AcademicCategory)
        : null,
    amount: rawAmount === null || rawAmount === undefined ? null : Number(rawAmount),
    configured: !!row.configured,
    regime: (row.regime as string | null) ?? null,
    scope:
      rawScope === "PRESUPUESTADA_GLOBAL" || rawScope === "EMPRESARIAL_ENTITY"
        ? (rawScope as AcademicPaymentScope)
        : null,
  }
}
