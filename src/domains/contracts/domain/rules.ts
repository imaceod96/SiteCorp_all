import type { AddendumStatus } from "./entities"

/**
 * Contratos y documentos — Reglas puras (dominio).
 *
 * Sólo el criterio de negocio sobre los estados de un anexo: qué anexos todavía NO forman
 * parte de las condiciones contractuales formalizadas. Las etiquetas y los colores que usa
 * la interfaz siguen en `@/lib/addendums` (son copy de presentación, no reglas).
 */

/** Estados que todavía NO forman parte de las condiciones contractuales formalizadas. */
export const PENDING_ADDENDUM_STATUSES: AddendumStatus[] = [
  "PENDING_TEMPLATE",
  "READY_TO_GENERATE",
  "GENERATION_ERROR",
]

export const isAddendumPending = (status: string): boolean =>
  PENDING_ADDENDUM_STATUSES.includes(status as AddendumStatus)
