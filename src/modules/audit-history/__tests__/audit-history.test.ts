import { describe, expect, it, vi, beforeEach } from "vitest"
import type { AuditEventRecord } from "../domain/types"

const mockAuditDb: AuditEventRecord[] = [
  {
    id: "evt-db-1",
    occurred_at: "2026-11-14T10:00:00.000Z",
    actor_user_id: "usr-admin-1",
    actor_username: "admin",
    actor_full_name: "Administrador SiteCorp",
    scope: "PLATFORM",
    company_client_id: null,
    organization_entity_id: null,
    entity_name: null,
    module: "settings",
    action: "platform_initialized",
    record_id: "SYS-001",
    description: "Inicialización del sistema",
    previous_values: null,
    new_values: null,
    result: "SUCCESS",
  },
]

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: {
                id: "usr-admin-1",
                email: "admin@sitecorp.cu",
                user_metadata: { full_name: "Administrador SiteCorp" },
              },
            },
          },
        }),
      },
      from: (table: string) => {
        if (table === "organization_entities") {
          return {
            select: () => ({
              order: async () => ({
                data: [
                  { id: "6926ce6d-bd88-438e-91d7-291601e1c827", name: "Empresa QA Ficticia" },
                ],
                error: null,
              }),
              eq: (_col: string, val: string) => ({
                maybeSingle: async () => ({
                  data: {
                    id: val,
                    name: "Empresa QA Ficticia",
                    company_client_id: "22e0f552-b767-446a-ae56-9ad82bdacd7c",
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === "audit_events") {
          const filters: Array<(row: AuditEventRecord) => boolean> = []
          let rangeFrom = 0
          let rangeTo = 999
          const builder = {
            select: () => builder,
            eq: (col: keyof AuditEventRecord, val: unknown) => {
              filters.push((row) => row[col] === val)
              return builder
            },
            gte: (col: keyof AuditEventRecord, val: string) => {
              filters.push((row) => String(row[col] ?? "") >= val)
              return builder
            },
            lte: (col: keyof AuditEventRecord, val: string) => {
              filters.push((row) => String(row[col] ?? "") <= val)
              return builder
            },
            or: () => builder,
            order: () => builder,
            limit: (n: number) => {
              rangeFrom = 0
              rangeTo = n - 1
              return builder
            },
            range: async (from: number, to: number) => {
              rangeFrom = from
              rangeTo = to
              const filtered = mockAuditDb.filter((r) => filters.every((fn) => fn(r)))
              return {
                data: filtered.slice(rangeFrom, rangeTo + 1),
                count: filtered.length,
                error: null,
              }
            },
            then: (resolve: (val: unknown) => void) => {
              const filtered = mockAuditDb.filter((r) => filters.every((fn) => fn(r)))
              resolve({
                data: filtered.slice(rangeFrom, rangeTo + 1),
                count: filtered.length,
                error: null,
              })
            },
            insert: (payload: Partial<AuditEventRecord> | Array<Partial<AuditEventRecord>>) => {
              const items = Array.isArray(payload) ? payload : [payload]
              const insertedRows: AuditEventRecord[] = items.map((item) => {
                const row: AuditEventRecord = {
                  id: item.id || `evt-${Date.now()}`,
                  occurred_at: item.occurred_at || new Date().toISOString(),
                  actor_user_id: item.actor_user_id ?? null,
                  actor_username: item.actor_username ?? null,
                  actor_full_name: item.actor_full_name ?? null,
                  scope: item.scope || "PLATFORM",
                  company_client_id: item.company_client_id ?? null,
                  organization_entity_id: item.organization_entity_id ?? null,
                  entity_name: item.entity_name ?? null,
                  module: item.module || "settings",
                  action: item.action || "unknown",
                  record_id: item.record_id ?? null,
                  description: item.description || "",
                  previous_values: item.previous_values ?? null,
                  new_values: item.new_values ?? null,
                  result: item.result || "SUCCESS",
                }
                mockAuditDb.unshift(row)
                return row
              })
              return {
                data: insertedRows,
                error: null,
                select: () => ({
                  single: async () => ({ data: insertedRows[0], error: null }),
                }),
              }
            },
          }
          return builder
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      },
    },
  }
})

import {
  AUDIT_MODULES,
  AUDIT_MODULE_LABELS,
  AUDIT_PAGE_SIZE,
  auditActorLabel,
  auditModuleLabel,
  auditTotalPages,
  clampAuditPage,
  countActiveAuditFilters,
  emptyAuditFilters,
  formatAuditDate,
  formatAuditDateTime,
} from "../domain/rules"
import {
  selectAuditEvents,
  insertAuditEvent,
  selectAuditEntityOptions,
  extractEntityIdFromSearch,
  extractEntityIdFromPathname,
  extractMutationErrorSummary,
} from "../infrastructure/audit-history.repository"
import { loadAuditHistory } from "../application/audit-history.queries"
import { recordAuditEvent, exportAuditEventsToCsv } from "../application/audit-history.commands"

describe("audit-history · Reglas de dominio", () => {
  it("contiene los módulos auditables canónicos con sus etiquetas", () => {
    expect(AUDIT_MODULES).toContain("users")
    expect(AUDIT_MODULES).toContain("entities")
    expect(AUDIT_MODULES).toContain("workers")
    expect(AUDIT_MODULES).toContain("salary")
    expect(auditModuleLabel("workers")).toBe("Trabajadores")
    expect(auditModuleLabel("entities")).toBe("Entidades")
    expect(auditModuleLabel(null)).toBe("—")
  })

  it("calcula las páginas totales y acota la página segura", () => {
    expect(auditTotalPages(0, 20)).toBe(1)
    expect(auditTotalPages(45, 20)).toBe(3)
    expect(clampAuditPage(0, 3)).toBe(1)
    expect(clampAuditPage(5, 3)).toBe(3)
    expect(clampAuditPage(2, 3)).toBe(2)
  })

  it("cuenta los filtros activos correctamente", () => {
    const filters = emptyAuditFilters()
    expect(countActiveAuditFilters(filters)).toBe(0)
    filters.scope = "ENTITY"
    filters.module = "workers"
    expect(countActiveAuditFilters(filters)).toBe(2)
  })

  it("formatea fechas con precisión y tolera valores nulos", () => {
    expect(formatAuditDateTime(null)).toBe("—")
    expect(formatAuditDate(null)).toBe("—")
    const iso = "2026-10-28T14:30:00.000Z"
    expect(formatAuditDate(iso)).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(formatAuditDateTime(iso)).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
  })

  it("resuelve la etiqueta del actor de forma legible", () => {
    expect(auditActorLabel({ actor_full_name: "Juan Pérez", actor_username: "jperez" })).toBe(
      "Juan Pérez · jperez"
    )
    expect(auditActorLabel({ actor_full_name: null, actor_username: "admin" })).toBe("admin")
    expect(auditActorLabel({ actor_full_name: null, actor_username: null })).toBe("Sistema")
  })
})

describe("audit-history · Repositorio y Casos de Uso", () => {
  it("carga eventos con paginación y estructura de página válida", async () => {
    const filters = emptyAuditFilters()
    const result = await loadAuditHistory({ filters, page: 1, pageSize: 10 })

    expect(result).toBeDefined()
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(10)
    expect(Array.isArray(result.events)).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
  })

  it("registra un nuevo evento y lo recupera filtrado por módulo", async () => {
    const actionId = `ACT-${Date.now()}`
    const created = await recordAuditEvent({
      module: "workers",
      action: "test_verification_action",
      description: "Acción de prueba de auditoría",
      recordId: actionId,
      entityName: "Empresa Demo Auditoría",
    })

    expect(created.id).toBeDefined()
    expect(created.record_id).toBe(actionId)

    const result = await selectAuditEvents({
      filters: { ...emptyAuditFilters(), action: "test_verification_action" },
      page: 1,
      pageSize: 10,
    })

    expect(result.events.some((e) => e.record_id === actionId)).toBe(true)
  })

  it("ofrece opciones de entidades para filtrar", async () => {
    const entities = await selectAuditEntityOptions()
    expect(Array.isArray(entities)).toBe(true)
    expect(entities.length).toBeGreaterThan(0)
    expect(entities[0].id).toBeDefined()
    expect(entities[0].name).toBeDefined()
  })

  it("exporta el registro a formato CSV con cabeceras", async () => {
    const csv = await exportAuditEventsToCsv()
    expect(typeof csv).toBe("string")
    expect(csv).toContain("Fecha y hora")
    expect(csv).toContain("Módulo")
    expect(csv).toContain("Acción")
  })

  it("intercepta automáticamente asignaciones a la plantilla (link_worker_to_position) y otros cambios", async () => {
    expect(typeof globalThis.__sitecorpSupabaseMutationHook).toBe("function")

    const testPosId = `POS-${Date.now()}`
    globalThis.__sitecorpSupabaseMutationHook?.({
      url: "https://xvswjkpoeccgpiewptur.supabase.co/rest/v1/rpc/link_worker_to_position",
      method: "POST",
      requestBody: {
        p_worker_id: "wrk-test-101",
        p_position_id: testPosId,
        p_start_date: "2026-10-28",
      },
      responseBody: { id: "asg-101" },
      status: 200,
      ok: true,
    })

    // Esperar brevemente a que la promesa asíncrona del interceptor persista el evento
    await new Promise((r) => setTimeout(r, 400))

    const result = await selectAuditEvents({
      filters: { ...emptyAuditFilters(), action: "worker_assigned_to_position" },
      page: 1,
      pageSize: 20,
    })

    expect(result.events.some((e) => e.action === "worker_assigned_to_position")).toBe(true)
  })

  it("extrae entityId de parámetros PostgREST y rutas /entity/:id, y guarda el detalle de errores fallidos", async () => {
    const entityUuid = "6926ce6d-bd88-438e-91d7-291601e1c827"
    expect(extractEntityIdFromSearch(`?organization_entity_id=eq.${entityUuid}`)).toBe(entityUuid)
    expect(extractEntityIdFromSearch(`?entity_id=${entityUuid}`)).toBe(entityUuid)
    expect(extractEntityIdFromPathname(`/entity/${entityUuid}/settings/staffing`)).toBe(entityUuid)
    expect(extractEntityIdFromPathname("/admin/history")).toBeNull()

    const summary = extractMutationErrorSummary(
      {
        code: "42703",
        message: 'column "company_client_id" does not exist',
        details: "Fallo en RPC",
        hint: "Actualiza la función",
      },
      400
    )
    expect(summary.summary).toContain('column "company_client_id" does not exist')
    expect(summary.detail).toMatchObject({
      http_status: 400,
      code: "42703",
      message: 'column "company_client_id" does not exist',
    })

    const uniqueName = `Puesto Fallido QA ${Date.now()}`
    globalThis.__sitecorpSupabaseMutationHook?.({
      url: `https://xvswjkpoeccgpiewptur.supabase.co/rest/v1/rpc/save_position_with_schedule?organization_entity_id=eq.${entityUuid}`,
      method: "POST",
      requestBody: {
        p_entity_id: entityUuid,
        p_name: uniqueName,
      },
      responseBody: {
        code: "42703",
        message: "Error de prueba en puesto",
      },
      status: 400,
      ok: false,
    })

    await new Promise((r) => setTimeout(r, 400))

    const result = await selectAuditEvents({
      filters: { ...emptyAuditFilters(), result: "FAILURE" },
      page: 1,
      pageSize: 20,
    })

    const recorded = result.events.find((e) => e.record_id === uniqueName)
    expect(recorded).toBeDefined()
    expect(recorded?.result).toBe("FAILURE")
    expect(recorded?.scope).toBe("ENTITY")
    expect(recorded?.organization_entity_id).toBe(entityUuid)
    expect(recorded?.description).toContain("Error de prueba en puesto")
    expect((recorded?.new_values as Record<string, unknown> | null)?.error).toBeDefined()
  })
})

