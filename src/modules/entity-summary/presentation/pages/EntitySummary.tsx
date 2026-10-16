import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useCurrentEntity, type OrganizationEntityRow } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useEntitySummaryDashboard } from "@/modules/entity-summary/presentation/hooks/use-entity-summary"
import type {
  AgeReport,
  DistributionSlice,
  EducationLevelReport,
  ReportSlice,
  SexReport,
  SkinColorReport,
} from "@/modules/entity-summary"
import {
  Building2,
  Layers,
  Factory,
  Users,
  Briefcase,
  FileText,
  UserCheck,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

const entityTypeLabels: Record<string, string> = {
  business_group: "Grupo empresarial",
  company: "Empresa",
  ueb: "UEB / Unidad Empresarial de Base",
}

const typeIcon = (type: string) => {
  if (type === "business_group") return <Layers className="h-5 w-5" />
  if (type === "company") return <Building2 className="h-5 w-5" />
  return <Factory className="h-5 w-5" />
}

const formatInt = (value: number): string => (value || 0).toLocaleString("es-ES")

// --- Estado de pestañas internas del Resumen -----------------------------

type SummaryTab = "overview" | "reports"

const TABS: { key: SummaryTab; label: string }[] = [
  { key: "overview", label: "Vista general" },
  { key: "reports", label: "Reportes" },
]

// --- Tarjeta KPI -----------------------------------------------------------

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  tone?: "primary" | "orange" | "success" | "danger" | "warning"
}

const toneStyles: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  primary: "bg-sitecorp-primary/10 text-sitecorp-primary",
  orange: "bg-sitecorp-secondary-orange/10 text-sitecorp-secondary-orange",
  success: "bg-sitecorp-success/10 text-sitecorp-success",
  danger: "bg-sitecorp-danger/10 text-sitecorp-danger",
  warning: "bg-sitecorp-warning/10 text-sitecorp-warning",
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, subtitle, icon, tone = "primary" }) => (
  <SiteCorpCard className="rounded-2xl">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <p className="text-3xl font-bold leading-none text-ink">{value}</p>
        {subtitle && <p className="pt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className={cn("rounded-xl p-2.5", toneStyles[tone])}>{icon}</div>
    </div>
  </SiteCorpCard>
)

// --- Fila de barra de distribución -----------------------------------------

const BarRow: React.FC<{ slice: DistributionSlice; max: number; tone: "primary" | "orange" }> = ({
  slice,
  max,
  tone,
}) => {
  const pct = max > 0 ? Math.round((slice.value / max) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate pr-3 text-ink" title={slice.label}>
          {slice.label}
        </span>
        <span className="font-semibold text-ink">{formatInt(slice.value)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "primary" ? "bg-sitecorp-primary" : "bg-sitecorp-secondary-orange"
          )}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  )
}

const DistributionList: React.FC<{ slices: DistributionSlice[]; tone: "primary" | "orange" }> = ({
  slices,
  tone,
}) => {
  if (slices.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">Sin trabajadores ocupados que distribuir.</p>
  }
  const max = slices.reduce((m, s) => Math.max(m, s.value), 0)
  return (
    <div className="space-y-3">
      {slices.map((slice) => (
        <BarRow key={slice.key} slice={slice} max={max} tone={tone} />
      ))}
    </div>
  )
}

// --- Tarjeta de informe demográfico ----------------------------------------

interface DemographicReportCardProps {
  title: string
  description?: string
  total?: number
  slices?: { key: string; label: string; value: number }[]
  tone: "primary" | "orange" | "success" | "warning" | "danger" | "blue"
  loading?: boolean
}

const reportToneStyles: Record<
  NonNullable<DemographicReportCardProps["tone"]>,
  string
> = {
  primary: "bg-sitecorp-primary",
  orange: "bg-sitecorp-secondary-orange",
  success: "bg-sitecorp-success",
  danger: "bg-sitecorp-danger",
  warning: "bg-sitecorp-warning",
  blue: "bg-sitecorp-primary",
}

const DemographicReportCard: React.FC<DemographicReportCardProps> = ({
  title,
  description,
  total,
  slices,
  tone,
  loading,
}) => {
  if (loading) {
    return (
      <SiteCorpCard className="rounded-2xl">
        <div className="p-4">
          <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </SiteCorpCard>
    )
  }

  const max = slices ? slices.reduce((m, s) => Math.max(m, s.value), 0) : 0

  return (
    <SiteCorpCard className="rounded-2xl">
      {title && (
        <div className="border-b border-border px-4 pb-3">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          {typeof total === "number" && total >= 0 && (
            <p className="mt-1.5 text-sm font-medium text-muted-foreground">
              {formatInt(total)} trabajador(es) activo(s) en el ámbito
            </p>
          )}
        </div>
      )}
      <div className="p-4">
        {slices && slices.length > 0 ? (
          <div className="space-y-3">
            {slices.map((slice) => {
              const pct = max > 0 ? Math.round((slice.value / max) * 100) : 0
              return (
                <div key={slice.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate pr-3 text-ink" title={slice.label}>
                      {slice.label}
                    </span>
                    <span className="font-semibold text-ink">{formatInt(slice.value)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        reportToneStyles[tone]
                      )}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            No hay datos disponibles para este informe.
          </p>
        )}
      </div>
    </SiteCorpCard>
  )
}

// --- Contenido: PESTAÑA VISTA GENERAL --------------------------------------

interface VistaGeneralProps {
  summary: ReturnType<typeof useEntitySummaryDashboard>
  entityId: string
  currentEntity: OrganizationEntityRow | null
  entityType: string
}

const VistaGeneral: React.FC<VistaGeneralProps> = ({
  summary,
  entityId,
  currentEntity,
  entityType,
}) => {
  const showMainBlock = summary.permissions.staffing || summary.permissions.workers
  const showDistribution = !!summary.distribution
  const hasAnyBlock = showMainBlock || showDistribution || summary.permissions.candidates || summary.permissions.contracts

  // «Próximos a vencer» (§41): contratos de Tiempo Determinado que vencen en los
  // próximos 30 días (hoy incluido). Se EXCLUYEN los ya vencidos. Reutiliza el mismo
  // cálculo del módulo de Vencimientos (attention − overdue).
  const upcomingExpirations =
    summary.expirations == null
      ? null
      : Math.max(0, summary.expirations.attention - summary.expirations.overdue)

  return (
    <>
      {summary.scopeLoading && <SiteCorpLoading rows={2} />}

      {/* BLOQUE PRINCIPAL — PLANTILLA */}
      {showMainBlock && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Plantilla
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.permissions.staffing && (
              <KpiCard
                title="Plantilla autorizada"
                value={formatInt(summary.staffing.authorized)}
                subtitle="Suma de capacidades de puestos activos"
                icon={<FileText className="h-5 w-5" />}
                tone="primary"
              />
            )}
            {summary.permissions.workers && (
              <>
                <KpiCard
                  title="Trabajadores activos"
                  value={formatInt(summary.occupancy?.activeWorkers ?? 0)}
                  subtitle="Estado laboral activo"
                  icon={<Users className="h-5 w-5" />}
                  tone="success"
                />
                <KpiCard
                  title="Puestos ocupados"
                  value={formatInt(summary.staffing.occupied)}
                  subtitle="Asignaciones actuales"
                  icon={<UserCheck className="h-5 w-5" />}
                  tone="orange"
                />
              </>
            )}
            {summary.permissions.staffing && summary.permissions.workers && (
              <>
                <KpiCard
                  title="Vacantes"
                  value={formatInt(summary.staffing.vacancies)}
                  subtitle="Autorizada − ocupación"
                  icon={<Briefcase className="h-5 w-5" />}
                  tone={summary.staffing.vacancies > 0 ? "warning" : "success"}
                />
                <KpiCard
                  title="Ocupación"
                  value={`${summary.staffing.occupancyPct.toFixed(1)} %`}
                  subtitle={
                    summary.staffing.authorized > 0
                      ? `${formatInt(summary.staffing.occupied)} / ${formatInt(summary.staffing.authorized)}`
                      : "Sin plantilla autorizada"
                  }
                  icon={<Briefcase className="h-5 w-5" />}
                  tone="primary"
                />
              </>
            )}
          </div>

          {summary.staffing.inconsistent && (
            <SiteCorpAlert type="warning" title="Inconsistencia de datos detectada">
              La ocupación activa supera la plantilla autorizada del ámbito seleccionado. Revise los
              puestos y las asignaciones actuales.
            </SiteCorpAlert>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* CANDIDATOS */}
        {summary.permissions.candidates && (
          <SiteCorpCard title="Candidatos" className="rounded-2xl">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Totales</p>
                <p className="text-2xl font-bold text-ink">
                  {formatInt(summary.candidates?.total ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Activos</p>
                <p className="text-2xl font-bold text-sitecorp-success">
                  {formatInt(summary.candidates?.active ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Archivados</p>
                <p className="text-2xl font-bold text-ink">
                  {formatInt(summary.candidates?.archived ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Contratados</p>
                <p className="text-2xl font-bold text-sitecorp-primary">
                  {formatInt(summary.candidates?.hired ?? 0)}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Link
                to={`/entity/${entityId}/candidates`}
                className="inline-flex items-center gap-1 text-sm font-medium text-sitecorp-primary hover:underline"
              >
                Ver candidatos <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </SiteCorpCard>
        )}

        {/* CONTRATOS — Total vigentes · Tiempo determinado · Tiempo indeterminado · Próximos a vencer */}
        {summary.permissions.contracts && (
          <SiteCorpCard title="Contratos vigentes" className="rounded-2xl">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Total vigentes</p>
                <p className="text-2xl font-bold text-ink">
                  {formatInt(summary.contracts?.current ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Tiempo determinado</p>
                <p className="text-2xl font-bold text-sitecorp-secondary-orange">
                  {formatInt(summary.contracts?.determined ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Tiempo indeterminado</p>
                <p className="text-2xl font-bold text-sitecorp-primary">
                  {formatInt(summary.contracts?.undetermined ?? 0)}
                </p>
              </div>
              {/* §42: tarjeta cliqueable → abre la página existente de Vencimientos */}
              {summary.permissions.alerts ? (
                <Link
                  to={`/entity/${entityId}/contracts/alerts`}
                  className="group flex flex-col rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-3 transition-colors hover:bg-sitecorp-primary/10"
                >
                  <p className="text-xs text-muted-foreground">Próximos a vencer</p>
                  <p className="text-2xl font-bold text-sitecorp-primary">
                    {upcomingExpirations == null ? "—" : formatInt(upcomingExpirations)}
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sitecorp-primary">
                    Ver vencimientos <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ) : (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground">Próximos a vencer</p>
                  <p className="text-2xl font-bold text-ink">—</p>
                </div>
              )}
            </div>
          </SiteCorpCard>
        )}
      </div>


      {/* DISTRIBUCIÓN */}
      {showDistribution && summary.distribution && (
        <div className="grid gap-6 lg:grid-cols-2">
          <SiteCorpCard title="Trabajadores por área" className="rounded-2xl">
            <DistributionList slices={summary.distribution.byArea} tone="primary" />
          </SiteCorpCard>
          <SiteCorpCard title="Trabajadores por categoría ocupacional" className="rounded-2xl">
            <DistributionList slices={summary.distribution.byCategory} tone="orange" />
          </SiteCorpCard>
        </div>
      )}

      {/* ESTADO VACÍO / SIN BLOQUES */}
      {!hasAnyBlock && !summary.permissionsLoading && (
        <SiteCorpCard title="Sin datos disponibles" className="rounded-2xl">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertTriangle className="h-8 w-8 text-sitecorp-warning" />
            <p className="max-w-lg text-sm text-muted-foreground">
              No tiene permisos para consultar los indicadores operativos de esta entidad.
            </p>
          </div>
        </SiteCorpCard>
      )}


      {/* INFORMACIÓN GENERAL */}
      {currentEntity && (
        <SiteCorpCard title="Información general" className="rounded-2xl">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Tipo de entidad</p>
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                {typeIcon(currentEntity.entity_type)}
                {entityType}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Estado</p>
              <SiteCorpStatusBadge status={currentEntity.is_active ? "success" : "danger"}>
                {currentEntity.is_active ? "Activa" : "Inactiva"}
              </SiteCorpStatusBadge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Código interno</p>
              <p className="text-sm font-mono text-ink">{currentEntity.code}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Régimen</p>
              <p className="text-sm font-medium text-ink">{currentEntity.regime_id || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Cuenta SiteCorp</p>
              <p className="text-sm font-mono text-ink">{currentEntity.account_code || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Módulos internos</p>
              <p className="text-sm font-medium text-ink">
                {4} módulos disponibles
              </p>
            </div>
          </div>
        </SiteCorpCard>
      )}
    </>
  )
}

// --- Contenido: PESTAÑA REPORTES -------------------------------------------

interface ReportsProps {
  summary: ReturnType<typeof useEntitySummaryDashboard>
}

const Reports: React.FC<ReportsProps> = ({ summary }) => {
  const { age, ageLoading } = summary.reports
  const { sex, sexLoading } = summary.reports
  const { skinColor, skinColorLoading } = summary.reports
  const { education, educationLoading } = summary.reports

  const reports: Array<{
    key: string
    title: string
    description: string
    data: AgeReport | SexReport | SkinColorReport | EducationLevelReport | null
    total?: number
    slices?: ReportSlice[]
    loading: boolean
    tone: "primary" | "orange" | "success" | "warning" | "danger" | "blue"
  }> = [
    {
      key: "age",
      title: "Trabajadores según edad",
      description: "Distribución de trabajadores activos por tramos de edad",
      data: age,
      total: age?.total,
      slices: age?.byAgeGroup,
      loading: ageLoading,
      tone: "primary",
    },
    {
      key: "sex",
      title: "Trabajadores según sexo",
      description: "Distribución de trabajadores activos por género",
      data: sex,
      total: sex?.total,
      slices: sex?.bySex,
      loading: sexLoading,
      tone: "success",
    },
    {
      key: "skinColor",
      title: "Trabajadores según color de piel",
      description: "Distribución de trabajadores activos por color de piel",
      data: skinColor,
      total: skinColor?.total,
      slices: skinColor?.bySkinColor,
      loading: skinColorLoading,
      tone: "warning",
    },
    {
      key: "education",
      title: "Trabajadores según nivel académico",
      description: "Distribución de trabajadores activos por nivel académico",
      data: education,
      total: education?.total,
      slices: education?.byEducation,
      loading: educationLoading,
      tone: "orange",
    },
  ]

  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
      {reports.map((report) => (
        <DemographicReportCard
          key={report.key}
          title={report.title}
          description={report.description}
          total={report.total}
          slices={report.slices}
          tone={report.tone}
          loading={report.loading}
        />
      ))}
    </div>
  )
}

// --- Página ----------------------------------------------------------------

const EntitySummary = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const { currentEntity } = useCurrentEntity()
  const summary = useEntitySummaryDashboard(entityId)

  const [activeTab, setActiveTab] = React.useState<SummaryTab>("overview")

  if (!entityId) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Resumen" description="No se indicó una entidad" />
        <SiteCorpAlert type="danger" title="Entidad no encontrada">
          La ruta no incluye una entidad válida.
        </SiteCorpAlert>
      </div>
    )
  }

  const entityType = currentEntity
    ? entityTypeLabels[currentEntity.entity_type] || "Entidad"
    : "Entidad"
  const scopeLabel =
    summary.scope === "descendants" ? "Entidad + descendientes" : "Esta entidad"

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title={`Resumen — ${currentEntity?.name ?? "Entidad"}`}
        description={`${entityType}${currentEntity?.code ? ` • ${currentEntity.code}` : ""}`}
      />

      {/* Selector de ámbito (fuera de las pestañas: afecta a toda la vista) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
          <button
            type="button"
            onClick={() => summary.setScope("self")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              summary.scope === "self"
                ? "bg-sitecorp-primary text-white"
                : "text-ink hover:bg-muted"
            )}
          >
            Esta entidad
          </button>
          {summary.descendantsAvailable && (
            <button
              type="button"
              onClick={() => summary.setScope("descendants")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                summary.scope === "descendants"
                  ? "bg-sitecorp-primary text-white"
                  : "text-ink hover:bg-muted"
              )}
            >
              Entidad + descendientes
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Ámbito mostrado: <strong className="text-ink">{scopeLabel}</strong>
          {summary.scope === "descendants" && summary.descendantCount > 0
            ? ` (${formatInt(summary.descendantCount)} entidad(es) descendiente(s))`
            : ""}
        </span>
      </div>

      {/* Pestañas internas del módulo Resumen */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SummaryTab)}>
        <TabsList className="inline-flex w-full justify-start rounded-xl border border-border bg-card p-1">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className={cn(
                "flex-1 rounded-lg text-sm data-[state=active]:bg-sitecorp-primary data-[state=active]:text-white"
              )}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <VistaGeneral
            summary={summary}
            entityId={entityId}
            currentEntity={currentEntity}
            entityType={entityType}
          />
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <Reports summary={summary} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EntitySummary
