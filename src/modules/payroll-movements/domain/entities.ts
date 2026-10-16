import type { DocumentGenerationResult } from "@/domains/document-generation"

/**
 * Movimientos de Nómina — Entidades y contratos de dominio.
 *
 * Un Movimiento de Nómina es el registro HISTÓRICO de un evento laboral (Alta, Reubicación o
 * Baja) que se documenta en el expediente del trabajador con la plantilla Excel oficial.
 *
 * Límites DELIBERADOS del contexto:
 *  - El movimiento lo CREA el backend dentro de la operación que lo origina (contratación,
 *    cambio de puesto, baja, cambio salarial masivo): este dominio NO crea ni modifica
 *    movimientos, ni decide sus importes, fechas o condiciones.
 *  - Sus ESTADOS y TRANSICIONES son del backend (`worker_document_id` / `status`); aquí no se
 *    reimplementa ninguna transición ni se inventa un estado nuevo.
 *  - Lo que sí es de este dominio: LOCALIZAR el movimiento de un evento, no duplicar jamás su
 *    documento y encargar su generación al dominio documental.
 *
 * La generación documental NO se reimplementa aquí: se consume
 * `@/domains/document-generation` (una sola dirección: movimientos → generación).
 */

/** Evento laboral que documenta un Movimiento de Nómina (vocabulario del backend). */
export type PayrollMovementEventType = "ALTA" | "REUBICACION" | "BAJA"

/** Resultado de garantizar el documento de un movimiento del expediente. */
export interface PayrollMovementAutomationResult {
  generated: boolean
  /** Ya estaba documentado (o el movimiento no existe): no se generó nada. */
  skipped: boolean
  result: DocumentGenerationResult | null
}
