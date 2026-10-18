import type {
  AuditEntityOption,
  AuditHistoryFilters,
  AuditHistoryPage,
} from "../domain/entities"
import { AUDIT_PAGE_SIZE, clampAuditPage, auditTotalPages } from "../domain/rules"
import {
  selectAuditEntityOptions,
  selectAuditEvents,
} from "../infrastructure/audit-history.repository"

/**
 * Historial — Casos de uso de lectura (aplicación).
 *
 * La pantalla pide «esta página con estos filtros» y recibe los datos ya compuestos y
 * acotados. Ninguna consulta se compone en el componente.
 */

/** Una página del Historial con los filtros combinados. */
export async function loadAuditHistory(input: {
  filters: AuditHistoryFilters
  page?: number
  pageSize?: number
}): Promise<AuditHistoryPage> {
  const pageSize = input.pageSize ?? AUDIT_PAGE_SIZE
  const page = await selectAuditEvents({
    filters: input.filters,
    page: Math.max(1, input.page ?? 1),
    pageSize,
  })

  // Si al filtrar la página solicitada queda fuera de rango, se devuelve la última válida.
  const totalPages = auditTotalPages(page.total, pageSize)
  const safePage = clampAuditPage(page.page, totalPages)

  if (safePage === page.page) return page

  return selectAuditEvents({
    filters: input.filters,
    page: safePage,
    pageSize,
  })
}

/** Entidades disponibles para el filtro por entidad. */
export async function loadAuditEntityOptions(): Promise<AuditEntityOption[]> {
  return selectAuditEntityOptions()
}
