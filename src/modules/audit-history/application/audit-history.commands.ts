import type {
  AuditEvent,
  AuditModule,
  AuditResult,
  AuditScope,
} from "../domain/entities"
import {
  insertAuditEvent,
  exportStoredAuditEvents,
  clearStoredAuditEvents,
} from "../infrastructure/audit-history.repository"

/**
 * Caso de uso: Registrar un evento en el Historial de Auditoría.
 *
 * Registra la operación realizada (ejecutor, fecha, entidad, módulo y datos cambiados)
 * tanto en la base de datos como en el almacenamiento persistente local.
 */
export async function recordAuditEvent(input: {
  module: AuditModule
  action: string
  description: string
  scope?: AuditScope
  organizationEntityId?: string | null
  entityName?: string | null
  companyClientId?: string | null
  entityType?: string | null
  recordId?: string | null
  oldValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  result?: AuditResult
  actorUserId?: string | null
  actorFullName?: string | null
  actorUsername?: string | null
}): Promise<AuditEvent> {
  const event: Omit<AuditEvent, "id" | "occurred_at"> = {
    scope: input.scope ?? (input.organizationEntityId ? "ENTITY" : "SITECORP"),
    organization_entity_id: input.organizationEntityId ?? null,
    entity_name: input.entityName ?? null,
    company_client_id: input.companyClientId ?? null,
    module: input.module,
    action: input.action,
    entity_type: input.entityType ?? null,
    record_id: input.recordId ?? null,
    description: input.description,
    old_values: input.oldValues ?? null,
    new_values: input.newValues ?? null,
    result: input.result ?? "SUCCESS",
    actor_user_id: input.actorUserId ?? null,
    actor_full_name: input.actorFullName ?? "Administrador",
    actor_username: input.actorUsername ?? "admin",
  }

  return insertAuditEvent(event)
}

/** Exporta los eventos filtrados en formato CSV para auditoría. */
export async function exportAuditEventsToCsv(): Promise<string> {
  const events = await exportStoredAuditEvents()
  const headers = [
    "ID",
    "Fecha y hora",
    "Ámbito",
    "Entidad",
    "Módulo",
    "Acción",
    "Ejecutor",
    "Usuario ejecutor",
    "Tipo registro",
    "ID registro",
    "Resultado",
    "Descripción",
  ]

  const rows = events.map((e) => [
    `"${e.id}"`,
    `"${e.occurred_at}"`,
    `"${e.scope}"`,
    `"${(e.entity_name || "").replace(/"/g, '""')}"`,
    `"${e.module}"`,
    `"${e.action}"`,
    `"${(e.actor_full_name || "").replace(/"/g, '""')}"`,
    `"${e.actor_username || ""}"`,
    `"${e.entity_type || ""}"`,
    `"${e.record_id || ""}"`,
    `"${e.result}"`,
    `"${(e.description || "").replace(/"/g, '""')}"`,
  ])

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
}

/** Reinicia los eventos de prueba almacenados. */
export async function resetAuditHistoryStore(): Promise<void> {
  await clearStoredAuditEvents()
}
