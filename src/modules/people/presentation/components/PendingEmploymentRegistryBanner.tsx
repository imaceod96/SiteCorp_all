import * as React from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, ArrowUpRight, ClipboardList } from "lucide-react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { loadEntityEmploymentRegistryIncompleteSummary } from "../../application/employment-registry.queries"
import { EMPLOYMENT_REGISTRY_CHANGED_EVENT } from "../../infrastructure/employment-registry.repository"
import type { EmploymentPeriodIncompleteSummary } from "../../domain/employment-registry.rules"

interface PendingEmploymentRegistryBannerProps {
  entityId: string
}

export const PendingEmploymentRegistryBanner: React.FC<
  PendingEmploymentRegistryBannerProps
> = ({ entityId }) => {
  const { permissions, loading: permissionsLoading } = useEntityPermissions(entityId)
  const canViewWorkers =
    permissions.includes("workers.view") || permissions.includes("workers.manage")

  const [incompleteSummary, setIncompleteSummary] =
    React.useState<EmploymentPeriodIncompleteSummary | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!entityId || !canViewWorkers) {
      setIncompleteSummary(null)
      setLoading(false)
      return
    }
    try {
      const data = await loadEntityEmploymentRegistryIncompleteSummary(entityId)
      setIncompleteSummary(data)
    } catch {
      setIncompleteSummary(null)
    } finally {
      setLoading(false)
    }
  }, [entityId, canViewWorkers])

  React.useEffect(() => {
    if (permissionsLoading) return
    void refresh()
  }, [permissionsLoading, refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh()
    }
    window.addEventListener(EMPLOYMENT_REGISTRY_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(EMPLOYMENT_REGISTRY_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  if (
    permissionsLoading ||
    loading ||
    !canViewWorkers ||
    !incompleteSummary ||
    incompleteSummary.incompletePeriodsCount === 0
  ) {
    return null
  }

  const count = incompleteSummary.incompletePeriodsCount
  const label = count === 1 ? "registro" : "registros"

  return (
    <SiteCorpCard className="rounded-2xl border-sitecorp-warning/40 bg-sitecorp-warning/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sitecorp-warning/15 p-2.5 text-sitecorp-warning">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">
                Información pendiente en el Registro de Altas y Bajas
              </h3>
              <span className="font-mono text-xs font-semibold tabular-nums text-amber-800">
                · {count} {label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Hay{" "}
              <strong className="font-mono font-semibold tabular-nums text-ink">
                {count}
              </strong>{" "}
              {label} de Altas y Bajas con información pendiente de completar. Revisa los
              números de alta, procedencia, números de baja o motivos pendientes de
              validación.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
              {incompleteSummary.missingHireNumberCount > 0 && (
                <span>
                  Sin número de alta:{" "}
                  <strong className="font-mono font-semibold tabular-nums text-ink">
                    {incompleteSummary.missingHireNumberCount}
                  </strong>
                </span>
              )}
              {incompleteSummary.missingSourceOriginCount > 0 && (
                <span>
                  Sin procedencia:{" "}
                  <strong className="font-mono font-semibold tabular-nums text-ink">
                    {incompleteSummary.missingSourceOriginCount}
                  </strong>
                </span>
              )}
              {incompleteSummary.missingSeparationNumberCount > 0 && (
                <span>
                  Bajas sin número:{" "}
                  <strong className="font-mono font-semibold tabular-nums text-ink">
                    {incompleteSummary.missingSeparationNumberCount}
                  </strong>
                </span>
              )}
              {incompleteSummary.pendingValidationReasonCount > 0 && (
                <span>
                  Motivos pendientes de validación:{" "}
                  <strong className="font-mono font-semibold tabular-nums text-ink">
                    {incompleteSummary.pendingValidationReasonCount}
                  </strong>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <Link to={`/entity/${entityId}/settings/altas-bajas`}>
            <SiteCorpButton size="sm" variant="outline" className="bg-white">
              <ClipboardList className="mr-1.5 h-4 w-4 text-sitecorp-primary" />
              Revisar datos
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </SiteCorpButton>
          </Link>
        </div>
      </div>
    </SiteCorpCard>
  )
}
