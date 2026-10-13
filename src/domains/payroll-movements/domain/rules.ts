import type { GeneratedDocumentRow } from "@/domains/document-generation"

/**
 * Movimientos de Nómina — Reglas PURAS del dominio.
 *
 * Sólo el criterio que decide si hay algo que generar. Ninguna consulta, ninguna RPC y ningún
 * acceso a Storage: eso vive en la infraestructura.
 */

/**
 * §73 Idempotencia: un movimiento YA documentado nunca se vuelve a generar.
 *
 * El documento emitido es un HECHO histórico del expediente: un evento laboral (alta,
 * reubicación o baja) se documenta una sola vez, aunque la operación se reintente o el
 * trabajador pase por la pantalla varias veces.
 */
export const movementAlreadyDocumented = (documents: GeneratedDocumentRow[]): boolean =>
  documents.length > 0
