/**
 * Historial — Entidades de dominio.
 *
 * Fuente CENTRALIZADA de eventos de auditoría de SiteCorp. No es un registro de navegación
 * ni un log técnico: es la traza de las operaciones administrativas y de negocio que deben
 * poder reconstruirse después.
 *
 * Los eventos son INMUTABLES: se crean y se leen, nunca se editan ni se eliminan. Por eso
 * guardan el nombre del ejecutor y de la entidad COPIADOS en el momento del hecho: si luego
 * se elimina el usuario o la entidad, el histórico sigue siendo legible.
 */

/** Ámbito del hecho auditado. */
export type AuditScope = "SITECORP" | "ENTITY"

/** Resultado de la operación auditada. */
export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED"

/** Una entrada del Historial. */
export interface AuditEvent {
  id: string
  occurred_at: string
  /** Ejecutor: identificador y nombre CONSERVADO (aunque la cuenta se elimine). */
  actor_user_id: string | null
  actor_full_name: string | null
  actor_username: string | null
  scope: AuditScope
  organization_entity_id: string | null
  entity_name: string | null
  company_client_id: string | null
  module: string
  action: string
  /** Tipo de registro afectado (`worker`, `organization_entity`, `platform_user`…). */
  entity_type: string | null
  /** Identificador del registro afectado (uuid, código o clave textual). */
  record_id: string | null
  description: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  result: AuditResult
}

/** Filtros combinables de la consulta. Todos opcionales. */
export interface AuditHistoryFilters {
  scope: AuditScope | ""
  entityId: string
  actor: string
  module: string
  action: string
  recordId: string
  year: string
  dateFrom: string
  dateTo: string
  result: AuditResult | ""
}

/** Página de resultados: la paginación la resuelve el SERVIDOR. */
export interface AuditHistoryPage {
  events: AuditEvent[]
  total: number
  page: number
  pageSize: number
}

/** Opción de filtro de entidad. */
export interface AuditEntityOption {
  id: string
  name: string
}
