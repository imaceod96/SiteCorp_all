import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { loadEntityPendingTrainingNotifications } from "../../application/training.service"
import { TRAINING_CHANGED_EVENT } from "../../infrastructure/training.repository"
import type { InitialTrainingNotification } from "../../domain/entities"
import { BellRing, GraduationCap, ArrowUpRight, UserCheck, Building2, Calendar } from "lucide-react"

interface PendingInitialTrainingBannerProps {
  entityId: string
  /** Si se muestra desde el Resumen de la entidad, incluye enlace rápido al módulo Capacitación */
  showTrainingModuleLink?: boolean
}

export const PendingInitialTrainingBanner: React.FC<PendingInitialTrainingBannerProps> = ({
  entityId,
  showTrainingModuleLink = false,
}) => {
  const [notifications, setNotifications] = React.useState<InitialTrainingNotification[]>([])
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!entityId) return
    try {
      const pending = await loadEntityPendingTrainingNotifications(entityId)
      setNotifications(pending)
    } catch {
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh()
    }
    window.addEventListener(TRAINING_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(TRAINING_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  if (loading || notifications.length === 0) {
    return null
  }

  return (
    <SiteCorpCard className="rounded-2xl border-sitecorp-warning/40 bg-sitecorp-warning/5">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-sitecorp-warning/15 p-2.5 text-sitecorp-warning">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-ink">
                  Capacitación inicial pendiente por nuevas contrataciones
                </h3>
                <SiteCorpStatusBadge status="warning">
                  {notifications.length}{" "}
                  {notifications.length === 1 ? "pendiente" : "pendientes"}
                </SiteCorpStatusBadge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Trabajadores recién contratados en esta entidad que requieren gestión de su
                capacitación inicial en su ficha individual.
              </p>
            </div>
          </div>

          {showTrainingModuleLink && (
            <Link
              to={`/entity/${entityId}/training`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-sitecorp-primary shadow-sm transition-colors hover:bg-muted/40"
            >
              <GraduationCap className="h-4 w-4" />
              Ir a Capacitación
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="divide-y divide-border rounded-xl border border-border bg-white">
          {notifications.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <UserCheck className="h-4 w-4 shrink-0 text-sitecorp-primary" />
                  <span className="text-sm font-semibold text-ink">{item.worker_name}</span>
                  {item.worker_code && (
                    <span className="font-mono text-xs text-muted-foreground">
                      ({item.worker_code})
                    </span>
                  )}
                  <SiteCorpStatusBadge status="warning">
                    Capacitación inicial pendiente
                  </SiteCorpStatusBadge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    Área:{" "}
                    <strong className="font-medium text-ink">
                      {item.area_name || "Sin área especificada"}
                    </strong>
                  </span>
                  {item.position_name && (
                    <span>
                      Puesto: <strong className="font-medium text-ink">{item.position_name}</strong>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Calendar className="h-3.5 w-3.5" />
                    Contratado el: <strong className="font-medium text-ink">{item.hire_date}</strong>
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <Link
                  to={`/entity/${entityId}/workers/${item.worker_id}?tab=informacion-adicional`}
                >
                  <SiteCorpButton size="sm" variant="outline">
                    <GraduationCap className="mr-1.5 h-4 w-4 text-sitecorp-primary" />
                    Gestionar en ficha
                  </SiteCorpButton>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteCorpCard>
  )
}
