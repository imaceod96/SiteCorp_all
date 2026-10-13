import * as React from "react"
import { cn } from "@/lib/utils"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  componentsTotal,
  formatConditionDate,
  formatContractMoney,
  type CompensationComponentDraft,
} from "@/domains/contracts"

interface ContractFormalizationSummaryProps {
  /** Persona que suscribe el contrato */
  workerName: string
  personIdentification?: string | null
  /** Puesto y cargo resultantes */
  positionName: string
  jobName?: string | null
  areaName?: string | null
  /** Contrato */
  contractTypeName: string | null
  startDate: string
  endDate?: string | null
  signatureDate: string
  signaturePlace: string
  paymentMethodName: string | null
  representativeName: string | null
  representativeTitle?: string | null
  /** Retribución formalizada */
  baseSalaryAmount: number | null
  baseSalaryCurrency?: string | null
  salaryGroupSequence?: number | null
  components: CompensationComponentDraft[]
  title?: string
  disabled?: boolean
  className?: string
}

interface SummaryRowProps {
  label: string
  children: React.ReactNode
}

const SummaryRow: React.FC<SummaryRowProps> = ({ label, children }) => (
  <div className="border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-sm text-ink">{children}</dd>
  </div>
)

/**
 * Fase 11A.5 — Resumen contractual previo a confirmar (§91).
 *
 * Compartido por TODOS los flujos que crean un contrato: contratar candidato,
 * cubrir puesto, reincorporar, cambiar de contrato y registrar contrato.
 * Los importes son una vista previa: el importe definitivo lo calcula el backend.
 */
export const ContractFormalizationSummary: React.FC<ContractFormalizationSummaryProps> = ({
  workerName,
  personIdentification,
  positionName,
  jobName,
  areaName,
  contractTypeName,
  startDate,
  endDate,
  signatureDate,
  signaturePlace,
  paymentMethodName,
  representativeName,
  representativeTitle,
  baseSalaryAmount,
  baseSalaryCurrency,
  salaryGroupSequence,
  components,
  title = "Resumen del contrato",
  disabled = false,
  className,
}) => {
  const sumByType = (type: string) =>
    componentsTotal(components.filter((component) => component.component_type === type))

  const additions = sumByType("ADDITIONAL_PAYMENT")
  const abnormal = sumByType("ABNORMAL_CONDITIONS")
  const others = sumByType("OTHER")
  const componentsSum = additions + abnormal + others
  const total = (baseSalaryAmount ?? 0) + componentsSum
  const currency = baseSalaryCurrency || null

  return (
    <div
      className={cn(
        "rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-4",
        disabled && "opacity-60",
        className
      )}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
        {title}
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

        <SummaryRow label="Contrato">
          <span className="block font-medium">{contractTypeName || "—"}</span>
          <span className="block text-muted-foreground">
            {formatConditionDate(startDate)} — {endDate ? formatConditionDate(endDate) : "Indefinido"}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Firmado el {formatConditionDate(signatureDate)} en {signaturePlace || "—"}
          </span>
        </SummaryRow>

        <SummaryRow label="Forma de pago">
          <span className="font-medium">{paymentMethodName || "—"}</span>
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
              Sin representante seleccionado para la fecha de firma.
            </span>
          )}
        </SummaryRow>

        <SummaryRow label="Retribución">
          <span className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Salario de escala
              {salaryGroupSequence != null
                ? ` (Grupo ${toRomanNumeral(salaryGroupSequence)})`
                : ""}
            </span>
            <span className="font-medium text-ink">
              {baseSalaryAmount === null ? "—" : formatContractMoney(baseSalaryAmount, currency)}
            </span>
          </span>
          <span className="mt-1 flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Pagos adicionales</span>
            <span className="text-ink">{formatContractMoney(additions, currency)}</span>
          </span>
          <span className="mt-1 flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Condiciones anormales</span>
            <span className="text-ink">{formatContractMoney(abnormal, currency)}</span>
          </span>
          <span className="mt-1 flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Otros pagos</span>
            <span className="text-ink">{formatContractMoney(others, currency)}</span>
          </span>
          <span className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2">
            <span className="font-semibold text-ink">Total contractual</span>
            <span className="font-semibold text-ink">
              {baseSalaryAmount === null ? "—" : formatContractMoney(total, currency)}
            </span>
          </span>
        </SummaryRow>
      </dl>
    </div>
  )
}

export default ContractFormalizationSummary
