import type { AddendumStatus } from "./entities"

/**
 * Contratos y documentos — Reglas puras de estados del anexo (dominio).
 *
 * Sólo el criterio de negocio: qué anexos todavía NO forman parte de las condiciones
 * contractuales formalizadas. El vocabulario que usa la interfaz (etiquetas, colores, motivos
 * y campos) vive en `./addendum-labels`, dentro de este mismo dominio.
 */

/** Estados que todavía NO forman parte de las condiciones contractuales formalizadas. */
export const PENDING_ADDENDUM_STATUSES: AddendumStatus[] = [
  "PENDING_TEMPLATE",
  "READY_TO_GENERATE",
  "GENERATION_ERROR",
]

export const isAddendumPending = (status: string): boolean =>
  PENDING_ADDENDUM_STATUSES.includes(status as AddendumStatus)
