import type {
  AuditHistoryFilters,
  AuditHistoryPage,
  AuditResult,
  AuditScope,
} from "./entities"

/**
 * Historial — Reglas puras (dominio).
 *
 * Normalización de filtros, etiquetas legibles y formatos. Nada de esto consulta Supabase.
 */

/** Tamaño de página del Historial (paginación de servidor). */
export const AUDIT_PAGE_SIZE = 20

/**
 * Módulos auditables. Es la lista CANÓNICA que comparten la interfaz de filtros y la
 * instrumentación del servidor: un evento sólo puede pertenecer a uno de ellos.
 */
export const AUDIT_MODULES = [
  "users",
  "roles",
  "entities",
  "entity_settings",
  "candidates",
  "workers",
  "contracts",
  "positions",
  "salary",
  "pluriempleo",
  "documents",
  "payroll",
  "vacations",
  "system",
] as const

export type AuditModule = (typeof AUDIT_MODULES)[number]

export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {
  users: "Usuarios",
  roles: "Roles y permisos",
  entities: "Entidades",
  entity_settings: "Configuración de empresa",
  candidates: "Candidatos",
  workers: "Trabajadores",
  contracts: "Contratación y contratos",
  positions: "Puestos",
  salary: "Salario",
  pluriempleo: "Pluriempleo",
  documents: "Documentos",
  payroll: "Nómina y movimientos",
  vacations: "Vacaciones",
  system: "Sistema",
}

export const AUDIT_SCOPE_LABELS: Record<AuditScope, string> = {
  SITECORP: "SiteCorp global",
  ENTITY: "Entidad",
}

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = {
  SUCCESS: "Correcto",
  FAILURE: "Fallido",
  DENIED: "Denegado",
}

/** Etiqueta de un módulo, tolerante a módulos no listados (histórico antiguo). */
export function auditModuleLabel(module: string | null | undefined): string {
  if (!module) return "—"
  return AUDIT_MODULE_LABELS[module as AuditModule] ?? module
}

/** Filtros vacíos (estado inicial de la pantalla). */
export function emptyAuditFilters(): AuditHistoryFilters {
  return {
    scope: "",
    entityId: "",
    actor: "",
    module: "",
    action: "",
    recordId: "",
    year: "",
    dateFrom: "",
    dateTo: "",
    result: "",
  }
}

/** Número de filtros activos (para indicar que la vista está acotada). */
export function countActiveAuditFilters(filters: AuditHistoryFilters): number {
  return Object.values(filters).filter((value) => value !== "").length
}

/** Años disponibles para el filtro (año actual y los cinco anteriores). */
export function availableAuditYears(now: Date = new Date()): number[] {
  const current = now.getFullYear()
  return Array.from({ length: 6 }, (_, index) => current - index)
}

/* --------------------------- Formato de fechas --------------------------- */

function twoDigits(value: number): string {
  return String(value).padStart(2, "0")
}

/** Fecha y hora exactas en formato local `dd/mm/aaaa hh:mm`. */
export function formatAuditDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return `${twoDigits(date.getDate())}/${twoDigits(
    date.getMonth() + 1
  )}/${date.getFullYear()} ${twoDigits(date.getHours())}:${twoDigits(
    date.getMinutes()
  )}`
}

/** Fecha `dd/mm/aaaa`. */
export function formatAuditDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return `${twoDigits(date.getDate())}/${twoDigits(
    date.getMonth() + 1
  )}/${date.getFullYear()}`
}

/** Resumen legible del ejecutor: nombre y usuario, o «Sistema» si no hay actor. */
export function auditActorLabel(event: {
  actor_full_name: string | null
  actor_username: string | null
}): string {
  const name = event.actor_full_name?.trim()
  const username = event.actor_username?.trim()
  if (name && username) return `${name} · ${username}`
  return name || username || "Sistema"
}

/** Número total de páginas de un resultado paginado. */
export function auditTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Página válida dentro del rango disponible (evita páginas vacías tras filtrar). */
export function clampAuditPage(page: number, totalPages: number): number {
  if (page < 1) return 1
  if (page > totalPages) return totalPages
  return page
}

/** Página vacía: estado inicial mientras carga la primera consulta. */
export function emptyAuditPage(pageSize = AUDIT_PAGE_SIZE): AuditHistoryPage {
  return { events: [], total: 0, page: 1, pageSize }
}
