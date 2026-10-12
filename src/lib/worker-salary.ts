/**
 * Histórico salarial del trabajador (Fase 11A): etiquetas de presentación.
 *
 * Histórico SALARIAL  → evolución económica del trabajador
 * Anexo contractual   → formalización documental (ver `@/lib/addendums`)
 *
 * Son registros históricos: nunca se recalculan ni se sobrescriben. La consulta del
 * histórico y su modelo viven en el contexto de contratos (`@/domains/contracts`).
 */

export type { WorkerSalaryHistoryEntry } from "@/domains/contracts"

export const SALARY_CHANGE_TYPE_LABELS: Record<string, string> = {
  INITIAL_CONTRACT: "Contrato inicial",
  SALARY_SCALE_CHANGE: "Cambio de escala salarial",
  POSITION_CHANGE: "Cambio de puesto",
  CONTRACT_CHANGE: "Cambio de contrato",
  REINCORPORATION: "Reincorporación",
}
