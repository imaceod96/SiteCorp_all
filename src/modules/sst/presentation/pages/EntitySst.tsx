import * as React from "react"
import { useParams } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs"
import {
  loadEntitySstOverview,
  type EntitySstOverviewData,
} from "../../application/sst.service"
import { SST_CHANGED_EVENT } from "../../infrastructure/sst.repository"
import { PendingSstNotificationsBanner } from "../components/PendingSstNotificationsBanner"
import { SstTrainingByJobSection } from "../components/SstTrainingByJobSection"
import { SstRiskAndPreventionSection } from "../components/SstRiskAndPreventionSection"
import { SstEppAndInspectionsSection } from "../components/SstEppAndInspectionsSection"
import { SstSpecializedSections } from "../components/SstSpecializedSections"
import {
  ShieldCheck,
  GraduationCap,
  AlertTriangle,
  HardHat,
  SearchCheck,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"

type SstMainTab = "training" | "risks" | "epp" | "specialized"

const SST_TABS: { key: SstMainTab; label: string }[] = [
  { key: "training", label: "1. Capacitaciones por Cargo y Calendario" },
  { key: "risks", label: "2. Riesgos, Matriz y Plan de Prevención" },
  { key: "epp", label: "3. EPP e Inspecciones de Seguridad" },
  { key: "specialized", label: "4. Accidentes, Salud Ocup., Emergencias y Comité" },
]

const EntitySst: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const { currentEntity } = useCurrentEntity()
  const { has: hasEntityPermission } = useEntityPermissions(entityId)

  const canManage = hasEntityPermission([
    "sst.manage",
    "training.manage",
    "workers.manage",
    "organization.manage",
  ])

  const [activeTab, setActiveTab] = React.useState<SstMainTab>("training")
  const [overview, setOverview] = React.useState<EntitySstOverviewData | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async (force = false) => {
    if (!entityId) return
    try {
      const data = await loadEntitySstOverview(entityId, { forceRefresh: force })
      setOverview(data)
    } catch (err) {
      console.error("[sst] error cargando módulo SST de la entidad:", err)
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    void refresh(false)
  }, [refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh(true)
    }
    window.addEventListener(SST_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(SST_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  if (!entityId) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Seguridad y Salud en el Trabajo (SST)"
          description="No se indicó una entidad válida"
        />
        <SiteCorpAlert type="danger" title="Entidad no encontrada">
          Selecciona una entidad para gestionar su módulo de SST.
        </SiteCorpAlert>
      </div>
    )
  }

  if (loading || !overview) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title={`SST — ${currentEntity?.name ?? "Entidad"}`}
          description="Cargando información de Seguridad y Salud en el Trabajo..."
        />
        <SiteCorpLoading rows={3} />
      </div>
    )
  }

  const { state, jobs, areas, workers } = overview
  const today = new Date().toISOString().slice(0, 10)

  const activeWorkersCount = workers.filter((w) => w.employmentStatus === "active").length
  const workersWithSstTraining = new Set(
    state.workerTrainingRecords.map((r) => r.worker_id)
  ).size
  const pendingSstWorkersCount = Math.max(0, activeWorkersCount - workersWithSstTraining)

  const doneSessionsCount = state.sessions.filter((s) => s.status === "REALIZADA").length
  const notDoneSessionsCount = state.sessions.filter((s) => s.status === "NO_REALIZADA").length
  const criticalOrHighRisksCount = state.risks.filter(
    (r) =>
      r.status === "ACTIVO" &&
      (r.risk_level === "CRITICO" || r.risk_level === "IMPORTANTE")
  ).length
  const overdueActionsCount = state.preventiveActions.filter(
    (a) =>
      a.status !== "COMPLETADA" &&
      a.status !== "CANCELADA" &&
      (a.status === "VENCIDA" || a.due_date < today)
  ).length
  const pendingEppRenewalsCount = state.workerEppDeliveries.filter(
    (d) => d.renewal_due_date && d.renewal_due_date <= today
  ).length

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title={`Seguridad y Salud en el Trabajo (SST) — ${currentEntity?.name ?? "Entidad"}`}
        description="Gestión de prevención de riesgos laborales, capacitaciones de seguridad por cargo, equipos de protección personal (EPP), inspecciones, salud ocupacional y cumplimiento normativo exclusivo de esta entidad."
      />

      {/* Avisos de SST por contrataciones o cambios de cargo dentro de la entidad */}
      <PendingSstNotificationsBanner entityId={entityId} />

      {/* FRANJA DE INDICADORES CLAVE DE SST DE LA ENTIDAD */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Trabajadores al día SST
              </p>
              <p className="mt-1 text-2xl font-bold text-ink tabular-nums">
                {workersWithSstTraining} / {activeWorkersCount}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {pendingSstWorkersCount} pendiente(s)
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-primary/10 p-2 text-sitecorp-primary">
              <GraduationCap className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sesiones SST
              </p>
              <p className="mt-1 text-2xl font-bold text-sitecorp-success tabular-nums">
                {doneSessionsCount}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                Realizadas • {notDoneSessionsCount} no real.
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-success/10 p-2 text-sitecorp-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Riesgos Críticos/Altos
              </p>
              <p className="mt-1 text-2xl font-bold text-sitecorp-secondary-orange tabular-nums">
                {criticalOrHighRisksCount}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                De {state.risks.length} evaluados
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-secondary-orange/10 p-2 text-sitecorp-secondary-orange">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Medidas Vencidas
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold tabular-nums",
                  overdueActionsCount > 0 ? "text-sitecorp-danger" : "text-ink"
                )}
              >
                {overdueActionsCount}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                De {state.preventiveActions.length} en plan
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-danger/10 p-2 text-sitecorp-danger">
              <ClipboardCheck className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Entregas EPP
              </p>
              <p className="mt-1 text-2xl font-bold text-ink tabular-nums">
                {state.workerEppDeliveries.length}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {pendingEppRenewalsCount} por reponer
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-primary/10 p-2 text-sitecorp-primary">
              <HardHat className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Inspecciones / Sucesos
              </p>
              <p className="mt-1 text-2xl font-bold text-ink tabular-nums">
                {state.inspections.length}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {state.accidentsIncidents.length} accidente(s)/incid.
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-primary/10 p-2 text-sitecorp-primary">
              <SearchCheck className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>
      </div>

      {/* PESTAÑAS INTERNAS DE SECCIONES DE SST DE LA ENTIDAD */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SstMainTab)}>
        <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 h-auto rounded-xl border border-border bg-card p-1.5">
          {SST_TABS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="w-full whitespace-normal text-center h-auto py-3 px-3 rounded-lg text-xs font-medium data-[state=active]:bg-sitecorp-primary data-[state=active]:text-white sm:text-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="training" className="mt-6">
          <SstTrainingByJobSection
            entityId={entityId}
            state={state}
            jobs={jobs}
            workers={workers}
            canManage={canManage}
            onRefresh={() => refresh(true)}
          />
        </TabsContent>

        <TabsContent value="risks" className="mt-6">
          <SstRiskAndPreventionSection
            entityId={entityId}
            state={state}
            areas={areas}
            jobs={jobs}
            workers={workers}
            canManage={canManage}
            onRefresh={() => refresh(true)}
          />
        </TabsContent>

        <TabsContent value="epp" className="mt-6">
          <SstEppAndInspectionsSection
            entityId={entityId}
            state={state}
            areas={areas}
            jobs={jobs}
            workers={workers}
            canManage={canManage}
            onRefresh={() => refresh(true)}
          />
        </TabsContent>

        <TabsContent value="specialized" className="mt-6">
          <SstSpecializedSections
            entityId={entityId}
            state={state}
            areas={areas}
            jobs={jobs}
            workers={workers}
            canManage={canManage}
            onRefresh={() => refresh(true)}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EntitySst
