/**
 * Contratos — Etiquetas del historial salarial (dominio, puro).
 *
 * Histórico SALARIAL → evolución económica del trabajador
 * Anexo contractual  → formalización documental (ver `./addendum-labels`)
 *
 * Son registros históricos: nunca se recalculan ni se sobrescriben. El modelo
 * (`WorkerSalaryHistoryEntry`) y la consulta del histórico viven en este mismo contexto; aquí
 * sólo está el vocabulario del campo `change_type` que ya devuelve el backend.
 */

export const SALARY_CHANGE_TYPE_LABELS: Record<string, string> = {
  INITIAL_CONTRACT: "Contrato inicial",
  SALARY_SCALE_CHANGE: "Cambio de escala salarial",
  POSITION_CHANGE: "Cambio de puesto",
  CONTRACT_CHANGE: "Cambio de contrato",
  REINCORPORATION: "Reincorporación",
}
