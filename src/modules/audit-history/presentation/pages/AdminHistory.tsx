import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
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
  formatAuditDateTime,
  loadAuditEntityOptions,
  loadAuditHistory,
  recordAuditEvent,
  exportAuditEventsToCsv,
  type AuditEntityOption,
  type AuditEvent,
  type AuditHistoryFilters,
  type AuditHistoryPage,
  type AuditModule,
  type AuditResult,
  type AuditScope,
} from "@/modules/audit-history"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpTable } from "@/shared/components/ui/sitecorp-table"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { ChevronLeft, ChevronRight, Check, Copy, Database, Download, Eye, Filter, History, PlusCircle, Search, X } from "lucide-react"

/**
 * Historial (SiteCorp global) — EXCLUSIVO del Super Admin.
 *
 * Consulta la fuente centralizada de auditoría con paginación y filtros de SERVIDOR: la
 * pantalla nunca descarga el histórico completo. No hay edición ni borrado: los eventos son
 * inmutables también para el SuperAdmin.
 *
 * La autorización real la aplica RLS en `audit_events`; aquí sólo se evita montar una
 * pantalla inútil.
 */

/** Valor de «sin filtro» para los selectores (Radix no admite `""` como valor). */
const ANY = "__any__"

const AUDIT_SQL_SCRIPT = `-- ============================================================================
-- SCRIPT DE CREACIÓN DE LA TABLA AUDIT_EVENTS EN SUPABASE
-- Pega este script en el SQL Editor de Supabase (https://supabase.com) y pulsa Run
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_full_name TEXT,
  actor_username TEXT,
  scope TEXT NOT NULL DEFAULT 'SITECORP',
  organization_entity_id UUID,
  entity_name TEXT,
  company_client_id UUID,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  record_id TEXT,
  description TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  result TEXT NOT NULL DEFAULT 'SUCCESS'
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx ON public.audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_scope_occurred_at_idx ON public.audit_events (scope, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_occurred_at_idx ON public.audit_events (organization_entity_id, occurred_at DESC);

ALTER TABLE IF EXISTS public.candidates ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES public.organization_areas(id);

GRANT SELECT, INSERT ON TABLE public.audit_events TO authenticated, service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_events_select_superadmin" ON public.audit_events;
CREATE POLICY "audit_events_select_superadmin" ON public.audit_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "audit_events_insert_authenticated" ON public.audit_events;
CREATE POLICY "audit_events_insert_authenticated" ON public.audit_events
  FOR INSERT TO authenticated WITH CHECK (true);
`

const AdminHistory = () => {
  const { isPlatformSuperAdmin } = useAuth()

  const [draftFilters, setDraftFilters] = React.useState<AuditHistoryFilters>(emptyAuditFilters)
  const [appliedFilters, setAppliedFilters] = React.useState<AuditHistoryFilters>(emptyAuditFilters)
  const [page, setPage] = React.useState(1)

  const [result, setResult] = React.useState<AuditHistoryPage>({
    events: [],
    total: 0,
    page: 1,
    pageSize: AUDIT_PAGE_SIZE,
  })
  const [entities, setEntities] = React.useState<AuditEntityOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEvent | null>(null)
  const [sqlModalOpen, setSqlModalOpen] = React.useState(false)
  const [copiedSql, setCopiedSql] = React.useState(false)

  const years = React.useMemo(() => availableAuditYears(), [])

  React.useEffect(() => {
    if (!isPlatformSuperAdmin) {
      setLoading(false)
      return
    }

    let cancelled = false
    loadAuditEntityOptions()
      .then((options) => {
        if (!cancelled) setEntities(options)
      })
      .catch((err) => {
        console.error("Error loading audit entities:", err)
      })

    return () => {
      cancelled = true
    }
  }, [isPlatformSuperAdmin])

  React.useEffect(() => {
    if (!isPlatformSuperAdmin) return

    let cancelled = false
    setLoading(true)
    setError(null)

    loadAuditHistory({ filters: appliedFilters, page })
      .then((data) => {
        if (cancelled) return
        setResult(data)
        setPage(data.page)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("Error loading audit history:", err)
        setError("No se pudo cargar el Historial. Inténtalo de nuevo.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isPlatformSuperAdmin, appliedFilters, page])

  React.useEffect(() => {
    const handleRecorded = () => {
      loadAuditHistory({ filters: appliedFilters, page }).then(setResult)
    }
    if (typeof window !== "undefined") {
      window.addEventListener("sitecorp:audit_event_recorded", handleRecorded)
      return () => window.removeEventListener("sitecorp:audit_event_recorded", handleRecorded)
    }
  }, [appliedFilters, page])

  const handleExport = async () => {
    try {
      const csv = await exportAuditEventsToCsv()
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `historial-auditoria-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Error exporting audit history:", err)
    }
  }

  const handleTestEvent = async () => {
    try {
      await recordAuditEvent({
        module: "system",
        action: "manual_audit_check",
        description: "Verificación manual de auditoría ejecutada por el Administrador",
        scope: "SITECORP",
        recordId: `AUDIT-TEST-${Date.now().toString().slice(-4)}`,
        newValues: { test_mode: true, timestamp: new Date().toISOString() },
      })
      const data = await loadAuditHistory({ filters: appliedFilters, page: 1 })
      setResult(data)
      setPage(1)
    } catch (err) {
      console.error("Error recording test event:", err)
    }
  }

  const handleCopySql = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(AUDIT_SQL_SCRIPT)
      setCopiedSql(true)
      setTimeout(() => setCopiedSql(false), 2500)
    }
  }

  const updateDraft = <K extends keyof AuditHistoryFilters>(
    key: K,
    value: AuditHistoryFilters[K]
  ) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const applyFilters = () => {
    setPage(1)
    setAppliedFilters(draftFilters)
  }

  const clearFilters = () => {
    setPage(1)
    setDraftFilters(emptyAuditFilters())
    setAppliedFilters(emptyAuditFilters())
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Historial"
          description="Registro de auditoría de SiteCorp"
        />
        <SiteCorpAlert type="warning" title="Acceso restringido">
          El Historial está reservado a los usuarios autorizados del Super Admin global de
          SiteCorp.
        </SiteCorpAlert>
      </div>
    )
  }

  const totalPages = auditTotalPages(result.total, result.pageSize)
  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const lastRow = Math.min(result.page * result.pageSize, result.total)
  const activeFilters = countActiveAuditFilters(appliedFilters)

  const resultBadge = (value: AuditResult) => {
    const styles: Record<AuditResult, string> = {
      SUCCESS: "bg-sitecorp-success/10 text-sitecorp-success",
      FAILURE: "bg-sitecorp-danger/10 text-sitecorp-danger",
      DENIED: "bg-sitecorp-warning/10 text-sitecorp-warning",
    }
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[value]}`}>
        {AUDIT_RESULT_LABELS[value]}
      </span>
    )
  }

  const rows = result.events.map((event) => ({
    occurred_at: (
      <span className="whitespace-nowrap text-sm text-ink">
        {formatAuditDateTime(event.occurred_at)}
      </span>
    ),
    event: (
      <div className="min-w-0 max-w-md">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">
            {auditModuleLabel(event.module)}
          </p>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {event.action}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {event.description}
        </p>
      </div>
    ),
    actor: (
      <span className="text-sm text-ink">{auditActorLabel(event)}</span>
    ),
    scope: (
      <div className="min-w-0">
        <p className="text-sm text-ink">{AUDIT_SCOPE_LABELS[event.scope]}</p>
        {event.entity_name && (
          <p className="truncate text-xs text-muted-foreground">{event.entity_name}</p>
        )}
      </div>
    ),
    record: (
      <span className="break-all font-mono text-xs text-muted-foreground">
        {event.record_id || "—"}
      </span>
    ),
    result: resultBadge(event.result),
    actions: (
      <SiteCorpButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setSelectedEvent(event)}
        aria-label="Ver detalle del evento"
      >
        <Eye className="h-4 w-4" />
      </SiteCorpButton>
    ),
  }))

  const entityOptions = entities.map((entity) => (
    <option key={entity.id} value={entity.id}>
      {entity.name}
    </option>
  ))

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SiteCorpPageHeader
          title="Historial"
          description="Registro de auditoría de las operaciones de SiteCorp"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SiteCorpButton
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            title="Descargar registro en CSV"
          >
            <Download className="mr-1.5 h-4 w-4" /> Exportar CSV
          </SiteCorpButton>
          <SiteCorpButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSqlModalOpen(true)}
            title="Ver o copiar el script SQL para la base de datos de Supabase"
          >
            <Database className="mr-1.5 h-4 w-4" /> Script SQL para Nube
          </SiteCorpButton>
          <SiteCorpButton
            type="button"
            size="sm"
            onClick={handleTestEvent}
            title="Generar evento de auditoría de comprobación"
          >
            <PlusCircle className="mr-1.5 h-4 w-4" /> Registrar evento de prueba
          </SiteCorpButton>
        </div>
      </div>

      {/* Filtros combinables */}
      <SiteCorpCard title="Filtros">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SiteCorpSelect
              label="Ámbito"
              value={draftFilters.scope || ANY}
              onValueChange={(value) =>
                updateDraft("scope", (value === ANY ? "" : value) as AuditScope | "")
              }
            >
              <option value={ANY}>Todos</option>
              <option value="SITECORP">SiteCorp global</option>
              <option value="ENTITY">Entidad</option>
            </SiteCorpSelect>

            <SiteCorpSelect
              label="Entidad"
              value={draftFilters.entityId || ANY}
              onValueChange={(value) => updateDraft("entityId", value === ANY ? "" : value)}
            >
              <option value={ANY}>Todas</option>
              {entityOptions}
            </SiteCorpSelect>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink" htmlFor="audit-actor">
                Usuario ejecutor
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <SiteCorpInput
                  id="audit-actor"
                  className="pl-9"
                  value={draftFilters.actor}
                  onChange={(event) => updateDraft("actor", event.target.value)}
                  placeholder="Nombre o usuario"
                />
              </div>
            </div>

            <SiteCorpSelect
              label="Módulo"
              value={draftFilters.module || ANY}
              onValueChange={(value) => updateDraft("module", value === ANY ? "" : value)}
            >
              <option value={ANY}>Todos</option>
              {AUDIT_MODULES.map((module) => (
                <option key={module} value={module}>
                  {AUDIT_MODULE_LABELS[module as AuditModule]}
                </option>
              ))}
            </SiteCorpSelect>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink" htmlFor="audit-action">
                Tipo de acción
              </label>
              <SiteCorpInput
                id="audit-action"
                value={draftFilters.action}
                onChange={(event) => updateDraft("action", event.target.value)}
                placeholder="Ej.: role_assigned"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink" htmlFor="audit-record">
                Elemento afectado
              </label>
              <SiteCorpInput
                id="audit-record"
                value={draftFilters.recordId}
                onChange={(event) => updateDraft("recordId", event.target.value)}
                placeholder="ID o tipo de registro"
              />
            </div>

            <SiteCorpSelect
              label="Año"
              value={draftFilters.year || ANY}
              onValueChange={(value) => updateDraft("year", value === ANY ? "" : value)}
            >
              <option value={ANY}>Todos</option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </SiteCorpSelect>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink" htmlFor="audit-from">
                Desde
              </label>
              <SiteCorpInput
                id="audit-from"
                type="date"
                value={draftFilters.dateFrom}
                onChange={(event) => updateDraft("dateFrom", event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink" htmlFor="audit-to">
                Hasta
              </label>
              <SiteCorpInput
                id="audit-to"
                type="date"
                value={draftFilters.dateTo}
                onChange={(event) => updateDraft("dateTo", event.target.value)}
              />
            </div>

            <SiteCorpSelect
              label="Resultado"
              value={draftFilters.result || ANY}
              onValueChange={(value) =>
                updateDraft("result", (value === ANY ? "" : value) as AuditResult | "")
              }
            >
              <option value={ANY}>Todos</option>
              <option value="SUCCESS">Correcto</option>
              <option value="FAILURE">Fallido</option>
              <option value="DENIED">Denegado</option>
            </SiteCorpSelect>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {activeFilters === 0
                ? "Sin filtros aplicados."
                : `${activeFilters} filtro(s) aplicado(s).`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SiteCorpButton type="button" variant="outline" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" /> Limpiar
              </SiteCorpButton>
              <SiteCorpButton type="button" onClick={applyFilters}>
                <Filter className="mr-2 h-4 w-4" /> Aplicar filtros
              </SiteCorpButton>
            </div>
          </div>
        </div>
      </SiteCorpCard>

      {/* Resultados */}
      <SiteCorpCard title="Eventos">
        {error ? (
          <SiteCorpAlert type="danger" title="Error">
            {error}
          </SiteCorpAlert>
        ) : loading ? (
          <SiteCorpLoading rows={6} />
        ) : result.events.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
            <History className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-ink">No hay eventos que coincidan</p>
            <p className="mt-1 max-w-md text-center text-xs text-muted-foreground">
              {activeFilters > 0
                ? "Prueba a ampliar el rango de fechas o a quitar algún filtro."
                : "Todavía no se ha registrado actividad auditable."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <SiteCorpTable
              columns={[
                { header: "Fecha y hora", accessor: "occurred_at" },
                { header: "Módulo · acción", accessor: "event" },
                { header: "Ejecutor", accessor: "actor" },
                { header: "Ámbito", accessor: "scope" },
                { header: "Elemento", accessor: "record" },
                { header: "Resultado", accessor: "result" },
                { header: "", accessor: "actions" },
              ]}
              data={rows}
            />

            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {firstRow}–{lastRow} de {result.total} evento(s) · Página {result.page}{" "}
                de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={result.page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
                </SiteCorpButton>
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={result.page >= totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente <ChevronRight className="ml-1 h-4 w-4" />
                </SiteCorpButton>
              </div>
            </div>
          </div>
        )}
      </SiteCorpCard>

      {/* Detalle del evento */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del evento</DialogTitle>
            <DialogDescription>
              Registro inmutable de auditoría. No se puede editar ni eliminar.
            </DialogDescription>
          </DialogHeader>

          {selectedEvent && (
            <div className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Fecha y hora", formatAuditDateTime(selectedEvent.occurred_at)],
                  ["Ámbito", AUDIT_SCOPE_LABELS[selectedEvent.scope]],
                  ["Entidad", selectedEvent.entity_name || "—"],
                  ["Módulo", auditModuleLabel(selectedEvent.module)],
                  ["Acción", selectedEvent.action],
                  ["Resultado", AUDIT_RESULT_LABELS[selectedEvent.result]],
                  ["Ejecutor", auditActorLabel(selectedEvent)],
                  ["ID del ejecutor", selectedEvent.actor_user_id || "—"],
                  ["Tipo de registro", selectedEvent.entity_type || "—"],
                  ["Registro afectado", selectedEvent.record_id || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="break-words text-sm text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Descripción
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {selectedEvent.description}
                </p>
              </div>

              {selectedEvent.old_values && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Valores anteriores
                  </p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs text-ink">
                    {JSON.stringify(selectedEvent.old_values, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.new_values && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Valores nuevos
                  </p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs text-ink">
                    {JSON.stringify(selectedEvent.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <SiteCorpButton type="button" variant="outline" onClick={() => setSelectedEvent(null)}>
              Cerrar
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal para ver y copiar el script SQL de Supabase */}
      <Dialog open={sqlModalOpen} onOpenChange={setSqlModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Script SQL para la Base de Datos en Supabase</DialogTitle>
            <DialogDescription>
              Para que la tabla se cree físicamente en tu nube de Supabase, copia este script y ejecútalo en la consola de tu proyecto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900 border border-blue-200">
              <p className="font-semibold mb-1">Instrucciones simples (1 minuto):</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Haz clic en el botón <strong>«Copiar al portapapeles»</strong> a continuación.</li>
                <li>Abre tu proyecto en <strong>supabase.com</strong> y pulsa en la sección <strong>SQL Editor</strong> del menú izquierdo.</li>
                <li>Pega el contenido y pulsa el botón verde <strong>Run</strong>.</li>
              </ol>
            </div>

            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-4 text-xs font-mono text-emerald-400">
              {AUDIT_SQL_SCRIPT}
            </pre>

            <div className="flex items-center justify-between pt-2">
              <SiteCorpButton
                type="button"
                variant={copiedSql ? "default" : "secondary"}
                onClick={handleCopySql}
                className="flex items-center gap-2"
              >
                {copiedSql ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-500" /> ¡Copiado con éxito!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> Copiar al portapapeles
                  </>
                )}
              </SiteCorpButton>
              <SiteCorpButton type="button" variant="outline" onClick={() => setSqlModalOpen(false)}>
                Cerrar
              </SiteCorpButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AdminHistory
