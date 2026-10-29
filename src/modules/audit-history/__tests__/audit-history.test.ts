import { describe, expect, it, beforeEach } from "vitest"
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
})

