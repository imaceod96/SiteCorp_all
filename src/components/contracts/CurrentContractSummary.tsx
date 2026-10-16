import * as React from "react"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { FileSignature, FileText, UserMinus } from "lucide-react"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  CONTRACT_ALERT_META,
  deadlineLabel,
  formatConditionDate,
  formatContractMoney,
  type ContractAlertRow,
  type FormalizedConditions,
} from "@/modules/contracts"

interface CurrentContractSummaryProps {
  className?: string
  hasContract: boolean
  isInactive: boolean
  contractTypeName: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  representativeName: string | null
  representativePosition: string | null
  /** Condiciones contractuales vigentes (contrato original + anexos formalizados) */
  formalized: FormalizedConditions | null
  /** Salario estructural actual derivado del puesto (para detectar discrepancia) */
  currentSalaryAmount: number | null
  currentSalaryCurrency: string | null
  alert: ContractAlertRow | null
  canManage: boolean
  onRegisterContract: () => void
  onChangeContract: () => void
  onSeparate: () => void
}

const NO_WORK_INFO = "Sin información"

/**
 * Centro de contratación — «Contrato vigente» (§8).
 *
 * Tarjeta de resumen contractual que utiliza SIEMPRE las condiciones FORMALIZADAS
 * (contrato original + anexos formalizados en orden), nunca los valores vivos del
 * puesto. Distingue explícitamente el salario contractual del salario estructural
 * actual cuando difieren.
 */
export const CurrentContractSummary: React.FC<CurrentContractSummaryProps> = ({
  className,
  hasContract,
  isInactive,
  contractTypeName,
  contractStartDate,
  contractEndDate,
  representativeName,
  representativePosition,
  formalized,
  currentSalaryAmount,
  currentSalaryCurrency,
  alert,
  canManage,
  onRegisterContract,
  onChangeContract,
  onSeparate,
}) => {
  const currency = formalized?.currency_code || currentSalaryCurrency || "CUP"

  const salaryDiffers =
    formalized?.salary_amount != null &&
    currentSalaryAmount != null &&
    Number(formalized.salary_amount) !== Number(currentSalaryAmount)

  return (
    <SiteCorpCard className={className}>
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-ink">Contrato vigente</h3>
            <p className="text-sm text-muted-foreground">
              Condiciones contractuales formalizadas (contrato original + anexos formalizados)
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {!hasContract && !isInactive && (
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRegisterContract}
                >
                  <FileText className="mr-2 h-3.5 w-3.5" /> Registrar contrato
                </SiteCorpButton>
              )}
              {hasContract && !isInactive && (
                <>
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onChangeContract}
                  >
                    <FileSignature className="mr-2 h-3.5 w-3.5" /> Cambiar contrato
                  </SiteCorpButton>
                  <SiteCorpButton type="button" variant="outline" size="sm" onClick={onSeparate}>
                    <UserMinus className="mr-2 h-3.5 w-3.5" /> Dar de baja
                  </SiteCorpButton>
                </>
              )}
            </div>
          )}
        </div>

        {!hasContract ? (
          <SiteCorpAlert type="info">
            Este trabajador no tiene un contrato vigente registrado. Los anexos no pueden existir sin
            un contrato vigente.
          </SiteCorpAlert>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Tipo de contrato</dt>
                <dd className="mt-0.5">
                  <SiteCorpStatusBadge status="info">{contractTypeName || "—"}</SiteCorpStatusBadge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fecha de inicio</dt>
                <dd className="text-sm text-ink">{formatConditionDate(contractStartDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fecha de finalización</dt>
                <dd className="text-sm text-ink">
                  {contractEndDate ? formatConditionDate(contractEndDate) : "Sin fecha de fin"}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">Cargo</dt>
                <dd className="text-sm text-ink">{formalized?.job_name || NO_WORK_INFO}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Puesto</dt>
                <dd className="text-sm text-ink">{formalized?.position_name || NO_WORK_INFO}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Lugar de trabajo</dt>
                <dd className="text-sm text-ink">{formalized?.work_location || NO_WORK_INFO}</dd>
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">Jornada</dt>
                <dd className="text-sm text-ink">{formalized?.jornada || NO_WORK_INFO}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Horario</dt>
                <dd className="text-sm text-ink">{formalized?.work_schedule || NO_WORK_INFO}</dd>
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                <dd className="text-sm text-ink">
                  {formalized?.salary_group_sequence != null
                    ? `Grupo ${toRomanNumeral(formalized.salary_group_sequence)}`
                    : NO_WORK_INFO}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Salario contractual</dt>
                <dd className="text-sm font-medium text-ink">
                  {formatContractMoney(formalized?.salary_amount ?? null, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Retribución total contractual</dt>
                <dd className="text-sm text-ink">
                  {formatContractMoney(formalized?.total_compensation ?? null, currency)}
                </dd>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-muted-foreground">Representante de la entidad</dt>
                <dd className="text-sm text-ink">
                  {representativeName ? (
                    <>
                      <span className="font-medium">{representativeName}</span>
                      {representativePosition ? (
                        <span className="block text-xs text-muted-foreground">
                          {representativePosition}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="italic text-muted-foreground">Sin información histórica</span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">Estado</dt>
                <dd className="mt-0.5">
                  {isInactive ? (
                    <SiteCorpStatusBadge status="neutral">Trabajador inactivo</SiteCorpStatusBadge>
                  ) : alert ? (
                    <SiteCorpStatusBadge
                      status={
                        alert.alert_state === "NO_END_DATE"
                          ? "warning"
                          : CONTRACT_ALERT_META[alert.alert_state].badge
                      }
                    >
                      {alert.alert_state === "NO_END_DATE"
                        ? "Requiere corrección"
                        : CONTRACT_ALERT_META[alert.alert_state].label}
                    </SiteCorpStatusBadge>
                  ) : (
                    <SiteCorpStatusBadge status="success">Vigente</SiteCorpStatusBadge>
                  )}
                </dd>
              </div>
            </dl>

            {alert && !isInactive && alert.alert_state !== "NO_END_DATE" && (
              <p className="mt-3 text-xs text-muted-foreground">
                {deadlineLabel(alert.days_remaining, alert.contract_end_date)}
              </p>
            )}

            {salaryDiffers && (
              <SiteCorpAlert type="info" className="mt-3">
                El salario contractual formalizado difiere del salario estructural actual porque el
                grupo salarial, la escala o el puesto cambiaron después de la última formalización. El
                salario contractual permanece como histórico hasta que se formalice un anexo.
              </SiteCorpAlert>
            )}
          </>
        )}
      </div>
    </SiteCorpCard>
  )
}

export default CurrentContractSummary
