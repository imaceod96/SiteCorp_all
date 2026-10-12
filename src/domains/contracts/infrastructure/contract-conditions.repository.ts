import { supabase } from "@/lib/supabase"
import type {
  ContractCompensationComponent,
  ContractConditionsSnapshot,
  ContractFormalizationPending,
  PaymentMethodOption,
} from "../domain/entities"

/**
 * Contratos y documentos — Repositorio de condiciones contractuales (infraestructura).
 *
 * Único punto que habla con Supabase para el snapshot contractual: catálogo de formas de
 * pago, checklist de formalización (backend), conceptos retributivos persistidos y las
 * condiciones formalizadas de un contrato. Consultas, `select` y orden idénticos a los que
 * ya usaba la aplicación.
 */

/**
 * Fila de `employment_contracts` + `payment_methods` tal como la devuelve la consulta del
 * snapshot. La relación to-one con `payment_methods` llega como objeto; se admite también
 * array porque el mapeo normaliza ambos casos.
 */
interface ContractConditionsRow {
  id: string
  signature_date: string | null
  signature_place: string | null
  payment_method_id: string | null
  payment_schedule_text: string | null
  salary_amount: number | null
  salary_currency_code: string | null
  salary_snapshot_status: string
  total_compensation_snapshot: number | null
  payment_method: { name: string; code: string } | { name: string; code: string }[] | null
}

/** Concepto persistido con el contrato al que pertenece (historial por contrato). */
interface CompensationComponentWithContract extends ContractCompensationComponent {
  employment_contract_id: string
}

/** Catálogo global de formas de pago (A tiempo / A rendimiento). */
export async function selectActivePaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, name, code")
    .eq("is_active", true)
    .order("display_order")

  if (error) throw error
  return (data as PaymentMethodOption[]) || []
}

/**
 * Checklist de formalización calculado por el backend: `blocking` impide formalizar;
 * `warnings` sólo advierte.
 */
export async function rpcPendingContractFormalization(input: {
  entityId: string
  positionId: string | null
  signatureDate: string | null
  signaturePlace: string | null
  paymentMethodId: string | null
  representativeAssignmentId: string | null
}): Promise<ContractFormalizationPending> {
  const { data, error } = await supabase.rpc("pending_contract_formalization", {
    p_entity_id: input.entityId,
    p_position_id: input.positionId,
    p_signature_date: input.signatureDate || null,
    p_signature_place: input.signaturePlace || null,
    p_payment_method_id: input.paymentMethodId || null,
    p_representative_assignment_id: input.representativeAssignmentId || null,
  })

  if (error) throw error
  const result = (data as ContractFormalizationPending | null) || { blocking: [], warnings: [] }
  return {
    blocking: result.blocking || [],
    warnings: result.warnings || [],
  }
}

/** Conceptos retributivos persistidos de un contrato (histórico). */
export async function selectContractCompensationComponents(
  contractId: string
): Promise<ContractCompensationComponent[]> {
  const { data, error } = await supabase
    .from("employment_contract_compensation_components")
    .select("id, component_type, description, amount, display_order")
    .eq("employment_contract_id", contractId)
    .order("display_order")

  if (error) throw error
  return ((data as ContractCompensationComponent[]) || []).map((row) => ({
    ...row,
    amount: Number(row.amount),
  })) as ContractCompensationComponent[]
}

/**
 * Conceptos retributivos de VARIOS contratos, agrupados por contrato.
 * Se usa para mostrar el historial contractual con sus propios snapshots.
 */
export async function selectCompensationComponentsByContract(
  contractIds: string[]
): Promise<Record<string, ContractCompensationComponent[]>> {
  const map: Record<string, ContractCompensationComponent[]> = {}
  const ids = Array.from(new Set(contractIds.filter((id): id is string => !!id)))
  if (ids.length === 0) return map

  const { data, error } = await supabase
    .from("employment_contract_compensation_components")
    .select("id, employment_contract_id, component_type, description, amount, display_order")
    .in("employment_contract_id", ids)
    .order("display_order")

  if (error) throw error
  ;((data as CompensationComponentWithContract[]) || []).forEach((row) => {
    const list =
      map[row.employment_contract_id] || (map[row.employment_contract_id] = [])
    list.push({
      id: row.id,
      component_type: row.component_type,
      description: row.description,
      amount: Number(row.amount),
      display_order: row.display_order,
    })
  })

  return map
}

/** Condiciones formalizadas de un contrato (snapshot histórico, con sus conceptos). */
export async function selectContractConditions(
  contractId: string
): Promise<ContractConditionsSnapshot | null> {
  const { data, error } = await supabase
    .from("employment_contracts")
    .select(
      `id, signature_date, signature_place, payment_method_id, payment_schedule_text,
       salary_amount, salary_currency_code,
       salary_snapshot_status, total_compensation_snapshot,
       payment_method:payment_methods(name, code)`
    )
    .eq("id", contractId)
    .single()

  if (error) throw error
  if (!data) return null

  const row = data as ContractConditionsRow
  const payment = Array.isArray(row.payment_method) ? row.payment_method[0] : row.payment_method

  return {
    id: row.id,
    signature_date: row.signature_date ?? null,
    signature_place: row.signature_place ?? null,
    payment_method_id: row.payment_method_id ?? null,
    payment_method_name: payment?.name ?? null,
    payment_method_code: payment?.code ?? null,
    payment_schedule_text: row.payment_schedule_text ?? null,
    salary_amount: row.salary_amount === null ? null : Number(row.salary_amount),
    salary_currency_code: row.salary_currency_code ?? null,
    salary_snapshot_status: row.salary_snapshot_status,
    total_compensation_snapshot:
      row.total_compensation_snapshot === null ? null : Number(row.total_compensation_snapshot),
    components: await selectContractCompensationComponents(contractId),
  }
}
