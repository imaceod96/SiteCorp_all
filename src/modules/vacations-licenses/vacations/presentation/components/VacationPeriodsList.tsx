import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import {
  VACATION_PERIOD_STATUS_LABELS,
  formatVacationDays,
  type VacationPeriod,
} from "@/modules/vacations-licenses/vacations"
import { CalendarDays, FileText, XCircle } from "lucide-react"

const statusTone: Record<VacationPeriod["status"], "info" | "success" | "neutral"> = {
  SCHEDULED: "info",
  TAKEN: "success",
  CANCELLED: "neutral",
}

const formatDate = (value: string) => {
  const [y, m, d] = value.split("-")
  return `${d}/${m}/${y}`
}

/** Historial de períodos de vacaciones de un trabajador. */
const VacationPeriodsList = ({
  periods,
  canManage,
  onCancel,
  onGenerateSc404,
  generatingSc404Id,
}: {
  periods: VacationPeriod[]
  canManage: boolean
  onCancel: (period: VacationPeriod) => void
  /** Genera el modelo SC-4-04 del período (Fase 20, generación explícita). */
  onGenerateSc404?: (period: VacationPeriod) => void
  generatingSc404Id?: string | null
}) => {
  return (
    <SiteCorpCard>
      <div className="mb-4 flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-sitecorp-primary" />
        <h3 className="text-base font-semibold text-ink">Períodos de vacaciones</h3>
      </div>

      {periods.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-ink">Sin períodos registrados</p>
          <p className="text-xs text-muted-foreground">
            Aún no se han registrado vacaciones para este trabajador.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Inicio</th>
                  <th className="px-3 py-2 font-semibold">Fin</th>
                  <th className="px-3 py-2 font-semibold">Días naturales</th>
                  <th className="px-3 py-2 font-semibold">Domingos</th>
                  <th className="px-3 py-2 font-semibold">Días descontados</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  {canManage && <th className="px-3 py-2 font-semibold">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id} className="border-b border-border/60">
                    <td className="px-3 py-3 text-ink">{formatDate(period.start_date)}</td>
                    <td className="px-3 py-3 text-ink">{formatDate(period.end_date)}</td>
                    <td className="px-3 py-3 text-ink">{period.natural_days}</td>
                    <td className="px-3 py-3 text-ink">{period.sundays_count}</td>
                    <td className="px-3 py-3 font-medium text-ink">
                      {formatVacationDays(period.charged_days)}
                    </td>
                    <td className="px-3 py-3">
                      <SiteCorpStatusBadge status={statusTone[period.status]}>
                        {VACATION_PERIOD_STATUS_LABELS[period.status]}
                      </SiteCorpStatusBadge>
                      {period.status === "CANCELLED" && period.cancel_reason && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {period.cancel_reason}
                        </p>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-3">
                        {period.status !== "CANCELLED" && (
                          <div className="flex flex-wrap gap-2">
                            {onGenerateSc404 && (
                              <SiteCorpButton
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => onGenerateSc404(period)}
                                disabled={generatingSc404Id === period.id || !!generatingSc404Id}
                                title="Generar modelo SC-4-04"
                              >
                                <FileText className="mr-1 h-3.5 w-3.5" />
                                {generatingSc404Id === period.id ? "Generando…" : "SC-4-04"}
                              </SiteCorpButton>
                            )}
                            <SiteCorpButton
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => onCancel(period)}
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                            </SiteCorpButton>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {periods.map((period) => (
              <div key={period.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink">
                    {formatDate(period.start_date)} → {formatDate(period.end_date)}
                  </p>
                  <SiteCorpStatusBadge status={statusTone[period.status]}>
                    {VACATION_PERIOD_STATUS_LABELS[period.status]}
                  </SiteCorpStatusBadge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{period.natural_days} días naturales</span>
                  <span>{period.sundays_count} domingos</span>
                  <span className="font-medium text-ink">
                    {formatVacationDays(period.charged_days)} descontados
                  </span>
                </div>
                {period.cancel_reason && (
                  <p className="mt-1 text-xs text-muted-foreground">{period.cancel_reason}</p>
                )}
                {canManage && period.status !== "CANCELLED" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {onGenerateSc404 && (
                      <SiteCorpButton
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => onGenerateSc404(period)}
                        disabled={generatingSc404Id === period.id || !!generatingSc404Id}
                      >
                        <FileText className="mr-1 h-3.5 w-3.5" />
                        {generatingSc404Id === period.id ? "Generando…" : "SC-4-04"}
                      </SiteCorpButton>
                    )}
                    <SiteCorpButton
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => onCancel(period)}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                    </SiteCorpButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </SiteCorpCard>
  )
}

export default VacationPeriodsList
