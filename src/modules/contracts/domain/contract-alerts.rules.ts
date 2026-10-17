/**
 * Contratos — Alertas de vencimiento contractual: reglas puras (dominio).
 *
 * Las alertas NO se persisten: se derivan del contrato vigente del trabajador
 * (end_date vs. CURRENT_DATE). El cálculo de días y la categoría se resuelven en
 * la base de datos (`contract_expiry_alerts`) para que exista una única fuente de
 * verdad temporal entre la vista de alertas y WorkerDetail. Aquí sólo vive el
 * criterio (categorías, horizontes, prioridades, filtros y textos) sin acceso a datos.
 */

export type ContractAlertState =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_IN_7"
  | "DUE_IN_15"
  | "DUE_IN_30"
  | "DUE_AFTER_30"
  | "NO_END_DATE"

/** Horizonte de ATENCIÓN: los contratos que requieren seguimiento (≤ 30 días). */
export const CONTRACT_ALERT_HORIZON_DAYS = 30

/** Horizonte amplio usado en WorkerDetail: permite conocer el vencimiento aunque
 *  quede lejos, y la UI decide si corresponde mostrar alerta (≤ 30 días). */
export const CONTRACT_ALERT_LOOKAHEAD_DAYS = 3650

/** Horizonte completo usado por el módulo de Vencimientos: incluye «Más de 30 días»
 *  (que no genera alerta ni cuenta en el badge). */
export const CONTRACT_ALERT_FULL_HORIZON_DAYS = CONTRACT_ALERT_LOOKAHEAD_DAYS

export interface ContractAlertRow {
  worker_id: string
  worker_code: string
  worker_name: string
  identification: string
  area_name: string | null
  job_name: string | null
  position_name: string | null
  position_code: string | null
  contract_id: string
  contract_type_name: string
  contract_type_code: string
  contract_start_date: string
  contract_end_date: string | null
  salary_group_id: string | null
  salary_scale_id: string | null
  salary_group_sequence_number: number | null
  days_remaining: number | null
  alert_state: ContractAlertState
  /**
   * Asignación (puesto vigente) DEL CONTRATO de la fila. En pluriempleo identifica la
   * operación sobre el contrato correcto: una baja se registra sobre esta asignación y
   * nunca finaliza los dos contratos. `null` en contratos sin asignación.
   */
  assignment_id: string | null
}

interface ContractAlertMeta {
  label: string
  badge: "success" | "warning" | "danger" | "info" | "neutral"
}

export const CONTRACT_ALERT_META: Record<ContractAlertState, ContractAlertMeta> = {
  OVERDUE: { label: "Vencido", badge: "danger" },
  DUE_TODAY: { label: "Vence hoy", badge: "danger" },
  DUE_IN_7: { label: "Vence en 7 días", badge: "warning" },
  DUE_IN_15: { label: "Vence en 15 días", badge: "warning" },
  DUE_IN_30: { label: "Vence en 30 días", badge: "info" },
  DUE_AFTER_30: { label: "Más de 30 días", badge: "neutral" },
  NO_END_DATE: { label: "Sin fecha de finalización", badge: "neutral" },
}

/** Rangos excluyentes: un contrato sólo pertenece a una categoría. */
export const CONTRACT_ALERT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "ATTENTION", label: "Todos los que requieren atención" },
  { value: "OVERDUE", label: "Vencidos" },
  { value: "DUE_TODAY", label: "Vence hoy" },
  { value: "DUE_IN_7", label: "Próximos 7 días" },
  { value: "DUE_IN_15", label: "8–15 días" },
  { value: "DUE_IN_30", label: "16–30 días" },
  { value: "DUE_AFTER_30", label: "Más de 30 días" },
  { value: "NO_END_DATE", label: "Sin fecha de finalización" },
]

/** Un contrato determinado vigente sin fecha de fin es una inconsistencia administrativa. */
export const needsCorrection = (row: ContractAlertRow) => row.alert_state === "NO_END_DATE"

/**
 * Regla ÚNICA de «requiere atención» (usada por el badge del sidebar, el KPI del
 * módulo y el bloque del Dashboard): vencido + hoy + 1–7 + 8–15 + 16–30.
 * Excluye «Más de 30 días» (no genera alerta) y «Sin fecha de finalización»
 * (inconsistencia administrativa, no un vencimiento).
 */
export const ATTENTION_STATES: ContractAlertState[] = [
  "OVERDUE",
  "DUE_TODAY",
  "DUE_IN_7",
  "DUE_IN_15",
  "DUE_IN_30",
]
export const requiresAttention = (row: ContractAlertRow) =>
  ATTENTION_STATES.includes(row.alert_state)

/**
 * Vocabulario de FILTRO del módulo de Vencimientos.
 *
 * Es un valor de filtro, NO un estado contractual: `"ATTENTION"` es el agrupador de los
 * estados de `requiresAttention` y `"ALL"` no restringe nada. Este tipo es el que viaja entre
 * la presentación y la regla de filtrado, de modo que un agrupador no pueda compararse nunca
 * contra `alert_state` (esa comparación es imposible: `alert_state` sólo toma los siete
 * estados reales).
 */
export type ContractAlertFilter = "ALL" | "ATTENTION" | ContractAlertState

/**
 * Regla ÚNICA de filtrado por estado de vencimiento (la usan la tabla, el desplegable y las
 * tarjetas del módulo de Vencimientos):
 *
 *   · "ALL"       → cualquier estado;
 *   · "ATTENTION" → los estados de `requiresAttention` (AGRUPADOR, no un estado);
 *   · estado      → coincidencia EXACTA con ese estado.
 *
 * Existe para que la presentación no interprete el vocabulario de filtros por su cuenta: la
 * comparación directa `alert_state === "ATTENTION"` nunca coincide con ningún estado y dejaba
 * el listado vacío aunque el contador mostrara contratos que requieren atención.
 */
export function matchesContractAlertFilter(
  row: ContractAlertRow,
  filter: ContractAlertFilter
): boolean {
  if (filter === "ALL") return true
  if (filter === "ATTENTION") return requiresAttention(row)
  return row.alert_state === filter
}

/**
 * ¿Este texto es un valor de filtro válido del módulo?
 *
 * Estrecha el valor que devuelve el control de selección (siempre `string`) al vocabulario del
 * dominio, sin conversiones ciegas: si el control devolviera algo que no pertenece al
 * vocabulario, el filtro NO cambia en lugar de aplicarse mal.
 */
export function isContractAlertFilter(value: string): value is ContractAlertFilter {
  if (value === "ALL" || value === "ATTENTION") return true
  // `CONTRACT_ALERT_META` es un Record exhaustivo de los estados reales: es el vocabulario
  // canónico, con independencia de qué opciones muestre el control de selección.
  return Object.keys(CONTRACT_ALERT_META).includes(value)
}

export interface ContractAlertSummary {
  overdue: number
  dueToday: number
  dueIn7: number
  dueIn15: number
  dueIn30: number
  after30: number
  attention: number
  correction: number
}

export function summarizeContractAlerts(rows: ContractAlertRow[]): ContractAlertSummary {
  const summary: ContractAlertSummary = {
    overdue: 0,
    dueToday: 0,
    dueIn7: 0,
    dueIn15: 0,
    dueIn30: 0,
    after30: 0,
    attention: 0,
    correction: 0,
  }

  rows.forEach((row) => {
    switch (row.alert_state) {
      case "OVERDUE":
        summary.overdue += 1
        break
      case "DUE_TODAY":
        summary.dueToday += 1
        break
      case "DUE_IN_7":
        summary.dueIn7 += 1
        break
      case "DUE_IN_15":
        summary.dueIn15 += 1
        break
      case "DUE_IN_30":
        summary.dueIn30 += 1
        break
      case "DUE_AFTER_30":
        summary.after30 += 1
        break
      default:
        // NO_END_DATE: contrato determinado sin fecha de finalización (inconsistencia).
        summary.correction += 1
    }
  })

  summary.attention =
    summary.overdue + summary.dueToday + summary.dueIn7 + summary.dueIn15 + summary.dueIn30

  return summary
}

/** Texto de tiempo restante a partir de los días calculados por la base de datos. */
export function deadlineLabel(
  daysRemaining: number | null,
  endDate: string | null
): string {
  if (endDate === null || daysRemaining === null) return "Sin fecha de finalización"
  if (daysRemaining > 1) return `Vence en ${daysRemaining} días`
  if (daysRemaining === 1) return "Vence mañana"
  if (daysRemaining === 0) return "Vence hoy"
  if (daysRemaining === -1) return "Vencido hace 1 día"
  return `Vencido hace ${Math.abs(daysRemaining)} días`
}

/**
 * Fecha laboral en formato dd/mm/aaaa. La implementación vive en `./formats` —UNA sola copia
 * del formato de fecha del contexto— y se reexporta aquí para que el contrato público de las
 * alertas de vencimiento siga siendo el mismo.
 */
export { formatContractDate } from "./formats"
