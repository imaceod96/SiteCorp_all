import * as React from "react"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { ArrowRight, FilePlus2, FileSignature } from "lucide-react"
import {
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  addendumReasonLabel,
  formatConditionDate,
  formatContractMoney,
  type ContractAddendum,
} from "@/domains/contracts"

export interface TimelineContractRow {
  id: string
  typeName: string | null
  startDate: string
  endDate: string | null
  isCurrent: boolean
}

interface ContractualTimelineProps {
  className?: string
  contracts: TimelineContractRow[]
  addendums: ContractAddendum[]
  onOpenAddendum: (addendumId: string) => void
}

interface TimelineEvent {
  key: string
  date: string
  kind: "CONTRACT" | "ADDENDUM"
  addendumId?: string
  title: string
  subtitle: string
  changes: { label: string; before: string; after: string }[]
}

const FIELD_LABELS: Record<string, string> = {
  AREA: "Área",
  JOB: "Cargo",
  POSITION: "Puesto",
  OCCUPATIONAL_CATEGORY: "Categoría ocupacional",
  SALARY_GROUP: "Grupo salarial",
  SALARY: "Salario",
  WORK_LOCATION: "Lugar de trabajo",
  DAILY_HOURS: "Horas diarias",
  WEEKLY_HOURS: "Horas semanales",
  MONTHLY_HOURS: "Horas mensuales",
  WORK_SCHEDULE: "Horario",
  PAYMENT_METHOD: "Forma de pago",
  PAYMENT_SCHEDULE: "Día / momento de pago",
  ADDITIONAL_PAYMENT: "Pagos adicionales",
  ABNORMAL_CONDITIONS: "Condiciones anormales",
  OTHER_PAYMENT: "Otros pagos",
  TOTAL_COMPENSATION: "Total contractual",
}

const formatSide = (
  display: string | null,
  value: string | null,
  currency: string | null
): string => {
  if (display && display.trim() !== "") return display
  if (value == null || value === "") return "—"
  return value
}

/**
 * Centro de contratación — Histórico contractual (§9/§10/§11).
 *
 * Timeline cronológico que combina el contrato inicial y los anexos formalizados
 * (y pendientes) en el orden real de vigencia. Cada evento resume su motivo y los
 * cambios antes/después congelados en el snapshot.
 */
export const ContractualTimeline: React.FC<ContractualTimelineProps> = ({
  className,
  contracts,
  addendums,
  onOpenAddendum,
}) => {
  const events = React.useMemo<TimelineEvent[]>(() => {
    const rows: TimelineEvent[] = []

    contracts.forEach((contract) => {
      rows.push({
        key: `contract-${contract.id}`,
        date: contract.startDate,
        kind: "CONTRACT",
        title: "Contratación",
        subtitle: contract.typeName ? `Contrato inicial · ${contract.typeName}` : "Contrato inicial",
        changes: [],
      })
    })

    addendums.forEach((addendum) => {
      const currency = addendum.currency_code
      const changes = (addendum.changes || [])
        .filter((change) => change.field_code !== "TOTAL_COMPENSATION")
        .map((change) => ({
          label: FIELD_LABELS[change.field_code] || change.field_code,
          before: formatSide(change.old_display_value, change.old_value, currency),
          after: formatSide(change.new_display_value, change.new_value, currency),
        }))

      rows.push({
        key: `addendum-${addendum.id}`,
        date: addendum.effective_date,
        kind: "ADDENDUM",
        addendumId: addendum.id,
        title: addendum.addendum_number
          ? `Anexo Nº ${addendum.addendum_number}`
          : "Anexo al contrato",
        subtitle: addendumReasonLabel(addendum.reason_code),
        changes,
      })
    })

    return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }, [contracts, addendums])

  const addendumById = React.useMemo(() => {
    const map = new Map<string, ContractAddendum>()
    addendums.forEach((row) => map.set(row.id, row))
    return map
  }, [addendums])

  return (
    <SiteCorpCard className={className}>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-ink">Histórico contractual</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Contrato inicial y anexos en orden cronológico de vigencia
        </p>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin contrato ni anexos registrados.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-border pl-6">
            {events.map((event) => {
              const addendum = event.addendumId ? addendumById.get(event.addendumId) : undefined
              return (
                <li key={event.key} className="relative">
                  <span
                    className={`absolute -left-[31px] top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${
                      event.kind === "CONTRACT"
                        ? "bg-sitecorp-primary text-white"
                        : "bg-sitecorp-warning text-white"
                    }`}
                  >
                    {event.kind === "CONTRACT" ? (
                      <FileSignature className="h-3 w-3" />
                    ) : (
                      <FilePlus2 className="h-3 w-3" />
                    )}
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {formatConditionDate(event.date)}
                    </span>
                    <span className="text-sm font-medium text-ink">{event.title}</span>
                    {addendum && (
                      <SiteCorpStatusBadge
                        status={ADDENDUM_STATUS_BADGE[addendum.status] || "neutral"}
                      >
                        {ADDENDUM_STATUS_LABELS[addendum.status] || addendum.status}
                      </SiteCorpStatusBadge>
                    )}
                    {event.kind === "CONTRACT" && (
                      <SiteCorpStatusBadge status="info">Contratación</SiteCorpStatusBadge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">{event.subtitle}</p>

                  {event.changes.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {event.changes.map((change, index) => (
                        <li
                          key={`${event.key}-${index}`}
                          className="flex flex-wrap items-center gap-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{change.label}:</span>
                          <span className="text-ink">{change.before}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-ink">{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {addendum &&
                    addendum.total_before != null &&
                    addendum.total_after != null &&
                    addendum.total_before !== addendum.total_after && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Total contractual:</span>
                        <span className="text-ink">
                          {formatContractMoney(addendum.total_before, addendum.currency_code)}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium text-ink">
                          {formatContractMoney(addendum.total_after, addendum.currency_code)}
                        </span>
                      </p>
                    )}

                  {event.addendumId && (
                    <button
                      type="button"
                      onClick={() => onOpenAddendum(event.addendumId as string)}
                      className="mt-1.5 text-xs font-medium text-sitecorp-primary hover:underline"
                    >
                      Ver detalle del anexo
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </SiteCorpCard>
  )
}

export default ContractualTimeline
