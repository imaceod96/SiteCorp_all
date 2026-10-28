import * as React from "react"
import { cn } from "@/lib/utils"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { formatConditionDate, formatContractMoney } from "@/modules/contracts/domain/formats"

interface ResolutionSummaryProps {
  workerName: string
  personIdentification?: string | null
  positionName: string
  jobName?: string | null
  areaName?: string | null
  resolutionDate: string
  representativeName: string | null
  representativeTitle?: string | null
  municipality: string | null
  revolutionYear: string | null
  workContent: string | null
  baseSalaryAmount: number | null
  baseSalaryCurrency?: string | null
  salaryGroupSequence?: number | null
  className?: string
}

const SummaryRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </dt>
    <dd className="mt-1 text-sm text-ink">{children}</dd>
  </div>
)

export const ResolutionSummary: React.FC<ResolutionSummaryProps> = ({
  workerName,
  personIdentification,
  positionName,
  jobName,
  areaName,
  resolutionDate,
  representativeName,
  representativeTitle,
  municipality,
  revolutionYear,
  workContent,
  baseSalaryAmount,
  baseSalaryCurrency,
  salaryGroupSequence,
  className,
}) => {
  const currency = baseSalaryCurrency || null

  return (
    <div
      className={cn(
        "rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-4",
        className
      )}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
        Resumen de la Resolución
      </p>

      <dl className="space-y-3">
        <SummaryRow label="Trabajador">
          <span className="font-medium">{workerName || "—"}</span>
          {personIdentification ? (
            <span className="text-muted-foreground"> · CI {personIdentification}</span>
          ) : null}
        </SummaryRow>

        <SummaryRow label="Puesto">
          <span className="font-medium">{positionName || "—"}</span>
          {jobName ? <span className="text-muted-foreground"> · {jobName}</span> : null}
          {areaName ? <span className="text-muted-foreground"> · {areaName}</span> : null}
        </SummaryRow>

        <SummaryRow label="Resolución">
          <span className="block font-medium">Resolución de Especialista Principal</span>
          <span className="block text-muted-foreground">
            Fecha: {formatConditionDate(resolutionDate)}
          </span>
          {municipality && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Municipio: {municipality}
            </span>
          )}
          {revolutionYear && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Año de la Revolución: {revolutionYear}
            </span>
          )}
        </SummaryRow>

        <SummaryRow label="Representante">
          {representativeName ? (
            <>
              <span className="font-medium">{representativeName}</span>
              {representativeTitle ? (
                <span className="text-muted-foreground"> — {representativeTitle}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              Sin representante seleccionado para la fecha de Resolución.
            </span>
          )}
        </SummaryRow>

        {workContent && (
          <SummaryRow label="Funciones / contenido de trabajo">
            <span className="font-medium">{workContent}</span>
          </SummaryRow>
        )}

        <SummaryRow label="Retribución">
          <span className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Salario de escala
              {salaryGroupSequence != null
                ? ` (Grupo ${toRomanNumeral(salaryGroupSequence)})`
                : ""}
            </span>
            <span className="font-medium text-ink">
              {baseSalaryAmount === null
                ? "—"
                : formatContractMoney(baseSalaryAmount, currency)}
            </span>
          </span>
        </SummaryRow>
      </dl>
    </div>
  )
}

export default ResolutionSummary
