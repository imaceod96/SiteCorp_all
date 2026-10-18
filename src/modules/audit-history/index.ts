/**
 * Historial — API pública del módulo.
 *
 *   domain/          → entidades, filtros y reglas puras (etiquetas, fechas, paginación)
 *   infrastructure/  → única lectura de `audit_events` (paginación y filtros de servidor)
 *   application/     → casos de uso de consulta
 *   presentation/    → pantalla del Super Admin global
 *
 * La tabla es INMUTABLE: este módulo no ofrece escritura, edición ni borrado. Los eventos
 * los registra el servidor mediante `public.record_audit_event(...)` y sus disparadores.
 */

export type {
  AuditEntityOption,
  AuditEvent,
  AuditHistoryFilters,
  AuditHistoryPage,
  AuditResult,
  AuditScope,
} from "./domain/entities"

export type { AuditModule } from "./domain/rules"
export {
  AUDIT_MODULES,
  AUDIT_MODULE_LABELS,
  AUDIT_PAGE_SIZE,
  AUDIT_RESULT_LABELS,
  AUDIT_SCOPE_LABELS,
  auditActorLabel,
  auditModuleLabel,
  auditTotalPages,
  availableAuditYears,
  countActiveAuditFilters,
  emptyAuditFilters,
  formatAuditDate,
  formatAuditDateTime,
} from "./domain/rules"

export {
  loadAuditEntityOptions,
  loadAuditHistory,
} from "./application/audit-history.queries"
