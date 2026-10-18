import { supabase } from "@/lib/supabase"
import type {
  AuditEntityOption,
  AuditEvent,
  AuditHistoryFilters,
  AuditHistoryPage,
} from "../domain/entities"

/**
 * Historial — Repositorio (infraestructura).
 *
 * Único punto que lee `audit_events`. La tabla es INMUTABLE: aquí no hay insert, update ni
 * delete; los eventos los escribe el servidor (función `record_audit_event` y disparadores).
 *
 * La paginación y el filtrado se resuelven en el SERVIDOR (`range` + `count: exact`): la
 * pantalla nunca descarga el histórico completo.
 *
 * La autorización real la aplica RLS (sólo SuperAdmin puede leer). Este archivo no decide
 * quién ve qué.
 */

const AUDIT_EVENT_COLUMNS = [
  "id",
  "occurred_at",
  "actor_user_id",
  "actor_full_name",
  "actor_username",
  "scope",
  "organization_entity_id",
  "entity_name",
  "company_client_id",
  "module",
  "action",
  "entity_type",
  "record_id",
  "description",
  "old_values",
  "new_values",
  "result",
].join(", ")

/**
 * Limpia el texto de búsqueda antes de enviarlo al filtro `ilike`.
 *
 * Los caracteres con significado en la sintaxis de filtros de PostgREST (`%`, `,`, `(`,
 * `)`, `\`, `*`) se eliminan: el valor del usuario nunca puede alterar la estructura de la
 * consulta.
 */
function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%,()\\*]/g, " ").trim()
}

/** `yyyy-mm-dd` + 1 día, para usar un límite superior EXCLUSIVO y no perder el último día. */
function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Página de eventos, del más reciente al más antiguo, con los filtros combinados.
 */
export async function selectAuditEvents(params: {
  filters: AuditHistoryFilters
  page: number
  pageSize: number
}): Promise<AuditHistoryPage> {
  const { filters, page, pageSize } = params
  const safePage = Math.max(1, page)
  const from = (safePage - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from("audit_events")
    .select(AUDIT_EVENT_COLUMNS, { count: "exact" })

  if (filters.scope) query = query.eq("scope", filters.scope)
  if (filters.entityId) query = query.eq("organization_entity_id", filters.entityId)
  if (filters.module) query = query.eq("module", filters.module)
  if (filters.result) query = query.eq("result", filters.result)

  const actor = sanitizeSearchTerm(filters.actor)
  if (actor) {
    query = query.or(
      `actor_full_name.ilike.%${actor}%,actor_username.ilike.%${actor}%`
    )
  }

  const action = sanitizeSearchTerm(filters.action)
  if (action) query = query.ilike("action", `%${action}%`)

  const recordId = sanitizeSearchTerm(filters.recordId)
  if (recordId) {
    // El elemento afectado se puede buscar por su identificador o por su tipo.
    query = query.or(`record_id.ilike.%${recordId}%,entity_type.ilike.%${recordId}%`)
  }

  if (filters.year) {
    const year = Number(filters.year)
    if (Number.isFinite(year)) {
      query = query
        .gte("occurred_at", `${filters.year}-01-01T00:00:00.000Z`)
        .lt("occurred_at", `${year + 1}-01-01T00:00:00.000Z`)
    }
  }

  if (filters.dateFrom) {
    query = query.gte("occurred_at", `${filters.dateFrom}T00:00:00.000Z`)
  }

  if (filters.dateTo) {
    // Límite superior EXCLUSIVO del día siguiente: incluye el día completo elegido.
    query = query.lt("occurred_at", `${nextDay(filters.dateTo)}T00:00:00.000Z`)
  }

  const { data, error, count } = await query
    .order("occurred_at", { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    events: (data as unknown as AuditEvent[] | null) || [],
    total: count ?? 0,
    page: safePage,
    pageSize,
  }
}

/**
 * Entidades para el filtro por entidad concreta.
 *
 * Sólo devuelve lo que RLS permita ver al usuario: el Historial es de SuperAdmin, que ve
 * todas. Los eventos de una entidad eliminada conservan su nombre en el propio evento.
 */
export async function selectAuditEntityOptions(): Promise<AuditEntityOption[]> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select("id, name")
    .order("name")

  if (error) throw error
  return (data as AuditEntityOption[] | null) || []
}
