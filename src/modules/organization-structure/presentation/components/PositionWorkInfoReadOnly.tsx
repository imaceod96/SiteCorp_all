import * as React from "react"
import { cn } from "@/lib/utils"
import type { PositionScheduleSegment } from "@/modules/organization-structure/domain/entities"
import { NO_WORK_INFO_LABEL } from "@/modules/organization-structure/domain/rules"
import {
  formatBreak,
  formatJornada,
  formatScheduleByDay,
} from "@/modules/organization-structure/domain/formatters"

interface PositionWorkInfoReadOnlyProps {
  workLocation?: string | null
  dailyHours?: number | null
  weeklyHours?: number | null
  monthlyHours?: number | null
  breakMinutes?: number | null
  scheduleNotes?: string | null
  segments?: PositionScheduleSegment[]
  title?: string
  className?: string
}

/**
 * Información laboral del Puesto en modo solo lectura (Fase 11A.3).
 *
 * Se muestra durante contratación, cambio de puesto y en el detalle del
 * trabajador: siempre resuelta desde el Puesto, nunca reintroducida ni copiada.
 */
export const PositionWorkInfoReadOnly = ({
  workLocation,
  dailyHours,
  weeklyHours,
  monthlyHours,
  breakMinutes,
  scheduleNotes,
  segments,
  title = "Información del puesto (solo lectura)",
  className,
}: PositionWorkInfoReadOnlyProps) => {
  const jornada = formatJornada({
    daily_hours: dailyHours ?? null,
    weekly_hours: weeklyHours ?? null,
    monthly_hours: monthlyHours ?? null,
  })
  const descanso = formatBreak(breakMinutes ?? null)
  const byDay = React.useMemo(() => formatScheduleByDay(segments), [segments])

  return (
    <div className={cn("rounded-xl border border-border bg-muted/30 p-3", className)}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Lugar de trabajo</dt>
          <dd className="text-sm text-ink">{workLocation || NO_WORK_INFO_LABEL}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Jornada</dt>
          <dd className="text-sm text-ink">{jornada || NO_WORK_INFO_LABEL}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Descanso</dt>
          <dd className="text-sm text-ink">{descanso || NO_WORK_INFO_LABEL}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-muted-foreground">Horario habitual</dt>
          <dd className="text-sm text-ink">
            {byDay.length === 0 ? (
              NO_WORK_INFO_LABEL
            ) : (
              <ul className="space-y-0.5">
                {byDay.map((row) => (
                  <li key={row.day}>
                    <span className="font-medium">{row.day}</span>{" "}
                    <span className="text-muted-foreground">{row.ranges}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {scheduleNotes && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Observaciones del horario</dt>
            <dd className="text-sm text-ink">{scheduleNotes}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export default PositionWorkInfoReadOnly
