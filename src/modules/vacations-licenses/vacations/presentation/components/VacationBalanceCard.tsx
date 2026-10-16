import * as React from "react"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import {
  VACATION_STATUS_LABELS,
  formatVacationDays,
  type VacationSummary,
  type VacationStatus,
} from "@/modules/vacations-licenses/vacations"
import { AlertTriangle, CalendarClock, CalendarPlus, CalendarCheck2, TrendingUp } from "lucide-react"

const statusTone: Record<VacationStatus, "success" | "warning" | "danger"> = {
  NORMAL: "success",
  NEAR_LIMIT: "warning",
  LIMIT_REACHED: "danger",
}

/** Cabecera de saldo de vacaciones de un trabajador. */
const VacationBalanceCard = ({ summary }: { summary: VacationSummary }) => {
  const stats = [
    {
      label: "Devengado este año",
      value: `${formatVacationDays(summary.accrued_this_year)} d`,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Consumido este año",
      value: `${formatVacationDays(summary.consumed_this_year)} d`,
      icon: <CalendarCheck2 className="h-4 w-4" />,
    },
    {
      label: "Próximo devengo",
      value: `+${formatVacationDays(summary.next_accrual)} d`,
      icon: <CalendarPlus className="h-4 w-4" />,
    },
    {
      label: "Saldo proyectado",
      value: `${formatVacationDays(summary.projected_balance)} d`,
      icon: <CalendarClock className="h-4 w-4" />,
    },
  ]

  return (
    <SiteCorpCard>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center">
        <div className="rounded-2xl bg-sitecorp-primary/5 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Saldo disponible
          </p>
          <p className="mt-1 text-4xl font-bold text-sitecorp-primary">
            {formatVacationDays(summary.balance)}
            <span className="ml-1 text-base font-medium text-muted-foreground">días</span>
          </p>
          <div className="mt-3 flex items-center gap-2">
            <SiteCorpStatusBadge status={statusTone[summary.status]}>
              {VACATION_STATUS_LABELS[summary.status]}
            </SiteCorpStatusBadge>
            {summary.opening_cutoff && (
              <span className="text-xs text-muted-foreground">
                Desde saldo inicial ({summary.opening_cutoff})
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                {stat.icon}
                <span className="text-xs">{stat.label}</span>
              </div>
              <p className="mt-1 text-lg font-semibold text-ink">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      {summary.scheduled_future_days > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {formatVacationDays(summary.scheduled_future_days)} días corresponden a vacaciones futuras
          ya programadas (el saldo disponible ya está reservado).
        </p>
      )}

      {!summary.has_schedule && (
        <div className="mt-4">
          <SiteCorpAlert type="warning" title="Sin horario configurado en el Puesto">
            El puesto del trabajador no tiene horario por días configurado, por lo que no se puede
            determinar el devengo automático. Configure el horario del Puesto para habilitar el
            cálculo.
          </SiteCorpAlert>
        </div>
      )}

      {summary.status === "NEAR_LIMIT" && (
        <div className="mt-4">
          <SiteCorpAlert type="warning" title="Próximo al límite">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este trabajador alcanzará el máximo acumulable de 24 días en el próximo devengo. Se
                acreditarán {formatVacationDays(Math.max(0, 24 - summary.balance))} días;
                {" "}
                {formatVacationDays(summary.unaccredited_projection)} no se acreditarán por alcanzar
                el máximo.
              </span>
            </span>
          </SiteCorpAlert>
        </div>
      )}

      {summary.status === "LIMIT_REACHED" && (
        <div className="mt-4">
          <SiteCorpAlert type="warning" title="Límite alcanzado">
            El trabajador ha alcanzado el máximo acumulable de 24 días. Los nuevos devengos no se
            acreditarán hasta que consuma saldo.
          </SiteCorpAlert>
        </div>
      )}

      {summary.current_vacation_end && summary.current_vacation_return && (
        <p className="mt-4 text-sm text-ink">
          <strong>De vacaciones</strong> · reincorporación prevista el{" "}
          {summary.current_vacation_return}.
        </p>
      )}
    </SiteCorpCard>
  )
}

export default VacationBalanceCard
