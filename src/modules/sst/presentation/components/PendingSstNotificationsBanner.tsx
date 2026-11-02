import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { loadEntityPendingSstNotifications } from "../../application/sst.service"
import { SST_CHANGED_EVENT } from "../../infrastructure/sst.repository"
import type { SstOnboardingNotification } from "../../domain/entities"
import { ShieldAlert, ArrowUpRight, UserCheck, Briefcase, Building2 } from "lucide-react"

interface PendingSstNotificationsBannerProps {
  entityId: string
  showSstModuleLink?: boolean
}

export const PendingSstNotificationsBanner: React.FC<PendingSstNotificationsBannerProps> = ({
  entityId,
  showSstModuleLink = false,
}) => {
  const [notifications, setNotifications] = React.useState<SstOnboardingNotification[]>([])

  const refresh = React.useCallback(async () => {
    if (!entityId) return
    try {
      const items = await loadEntityPendingSstNotifications(entityId)
      setNotifications(items)
    } catch {
      // Ignore load error
    }
  }, [entityId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh()
    }
    window.addEventListener(SST_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(SST_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  if (notifications.length === 0) return null

  return (
    <SiteCorpCard className="border-sitecorp-secondary-orange/40 bg-sitecorp-secondary-orange/5">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-sitecorp-secondary-orange/15 p-2.5 text-sitecorp-secondary-orange">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  Avisos de SST pendientes por contratación o cambio de cargo
                </h3>
                <SiteCorpStatusBadge status="warning">
                  {notifications.length}{" "}
                  {notifications.length === 1 ? "pendiente" : "pendientes"}
                </SiteCorpStatusBadge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Trabajadores de esta entidad que requieren instrucción de Seguridad y Salud en el
                Trabajo (SST), entrega de EPP o evaluación para su cargo actual.
              </p>
            </div>
          </div>

          {showSstModuleLink && (
            <Link
              to={`/entity/${entityId}/sst`}
              className="inline-flex items-center gap-1 rounded-lg border border-sitecorp-secondary-orange/30 bg-white px-3 py-1.5 text-xs font-medium text-sitecorp-secondary-orange transition-colors hover:bg-sitecorp-secondary-orange/10"
            >
              Ir a SST de la entidad
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {notifications.slice(0, 6).map((notif) => (
            <div
              key={notif.id}
              className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-white p-3 shadow-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <UserCheck className="h-4 w-4 text-sitecorp-primary" />
                    {notif.worker_name}
                  </span>
                  <SiteCorpStatusBadge
                    status={notif.trigger_type === "CAMBIO_CARGO" ? "info" : "warning"}
                  >
                    {notif.trigger_type === "CAMBIO_CARGO"
                      ? "Cambio de cargo"
                      : "Nueva contratación"}
                  </SiteCorpStatusBadge>
                </div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5 text-sitecorp-secondary-orange" />
                  Cargo: <strong className="font-medium text-ink">{notif.job_name || "—"}</strong>
                </p>
                {notif.area_name && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Área: {notif.area_name}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                <span className="font-mono text-muted-foreground tabular-nums">
                  Fecha: {notif.effective_date}
                </span>
                <Link
                  to={`/entity/${entityId}/workers/${notif.worker_id}?tab=informacion-adicional`}
                  className="inline-flex items-center gap-1 font-medium text-sitecorp-primary hover:underline"
                >
                  Gestionar en ficha
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteCorpCard>
  )
}
