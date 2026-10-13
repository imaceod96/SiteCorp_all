import * as React from "react"
import { cn } from "@/lib/utils"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  COMPENSATION_COMPONENT_TYPES,
  formatConditionDate,
  formatContractMoney,
  type ContractCompensationComponent,
} from "@/domains/contracts"

interface ContractRetributionSummaryProps {
  /** Snapshot contractual (histórico, nunca recalculado) */
  salaryAmount: number | null
  salaryCurrencyCode: string | null
  salarySnapshotStatus?: string | null
  salaryEffectiveDate?: string | null
  totalCompensationSnapshot: number | null
  components: ContractCompensationComponent[]
  /** Momento en que se capturaron las condiciones (si existe) */
  capturedAt?: string | null
  salaryGroupSequence?: number | null
  /** Salario ACTUAL derivado (puede diferir del formalizado) */
  currentSalaryAmount?: number | null
  currentSalaryCurrency?: string | null
  title?: string
  className?: string
}

/**
 * Fase 11A.5 — Retribución FORMALIZADA en un contrato frente al salario ACTUAL.
 *
 * Son conceptos relacionados pero no equivalentes: el contrato conserva lo que se
 * formalizó; el salario actual se deriva del puesto/cargo/escala vigentes.
 */
export const ContractRetributionSummary: React.FC<ContractRetributionSummaryProps> = ({
  salaryAmount,
  salaryCurrencyCode,
  salarySnapshotStatus,
  salaryEffectiveDate,
  totalCompensationSnapshot,
  components,
  capturedAt,
  salaryGroupSequence,
  currentSalaryAmount = null,
  currentSalaryCurrency = null,
  title = "Condiciones retributivas formalizadas",
  className,
}) => {
  const hasHistoricalInfo =
    !!capturedAt || components.length > 0 || salarySnapshotStatus === "CAPTURED"

  const currency = salaryCurrencyCode || currentSalaryCurrency || null
  const componentSum = components.reduce((total, component) => total + component.amount, 0)
  const derivedTotal =
    totalCompensationSnapshot !== null
      ? Number(totalCompensationSnapshot)
      : salaryAmount !== null
        ? Number(salaryAmount) + componentSum
        : null

  const rowsByType = (type: string) =>
    components.filter((component) => component.component_type === type)

  const sumByType = (type: string) =>
    rowsByType(type).reduce((total, component) => total + component.amount, 0)

  const currentDiffers =
    currentSalaryAmount !== null &&
    salaryAmount !== null &&
    Number(currentSalaryAmount) !== Number(salaryAmount)

  return (
    <div className={cn("rounded-xl border border-border bg-muted/30 p-3", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>

      {!hasHistoricalInfo ? (
        <p className="mt-1 text-sm italic text-muted-foreground">
          Sin información histórica: este contrato se formalizó antes de que se registraran sus
          condiciones retributivas. No se reconstruyen de forma especulativa.
        </p>
      ) : (
        <>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
              <dd className="text-sm text-ink">
                {salaryGroupSequence == null ? "—" : `Grupo ${toRomanNumeral(salaryGroupSequence)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Salario de escala</dt>
              <dd className="text-sm font-medium text-ink">
                {salaryAmount === null
                  ? "No determinado"
                  : formatContractMoney(Number(salaryAmount), currency)}
              </dd>
            </div>
          </dl>

          {salaryAmount !== null && salaryEffectiveDate && (
            <p className="mt-1 text-xs text-muted-foreground">
              Valor de escala vigente al formalizar: {formatConditionDate(salaryEffectiveDate)}
            </p>
          )}

          {components.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Sin conceptos específicos (ni pagos adicionales, ni condiciones anormales, ni otros
              pagos).
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {COMPENSATION_COMPONENT_TYPES.map((type) => {
                const rows = rowsByType(type.code)
                if (rows.length === 0) return null
                return (
                  <li key={type.code}>
                    <p className="text-xs font-medium text-ink">
                      {type.label}: {formatContractMoney(sumByType(type.code), currency)}
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span>{row.description}</span>
                          <span>{formatContractMoney(row.amount, currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-sm font-semibold text-ink">Total contractual</span>
            <span className="text-sm font-semibold text-ink">
              {derivedTotal === null ? "—" : formatContractMoney(derivedTotal, currency)}
            </span>
          </div>
        </>
      )}

      {/* Salario operativo actual: derivado del puesto/cargo/escala vigentes */}
      {currentSalaryAmount !== null && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salario actual
          </p>
          <p className="text-sm font-medium text-ink">
            {formatContractMoney(Number(currentSalaryAmount), currentSalaryCurrency || currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {currentDiffers
              ? "Difiere del salario formalizado en este contrato porque la escala o el puesto cambiaron después de su formalización."
              : "Coincide con el salario formalizado en este contrato."}
          </p>
        </div>
      )}
    </div>
  )
}

export default ContractRetributionSummary
