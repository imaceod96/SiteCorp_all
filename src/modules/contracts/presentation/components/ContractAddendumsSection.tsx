import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { AddendumDetailDialog } from "@/modules/contracts/presentation/components/AddendumDetailDialog"
import { CreateManualAddendumDialog } from "@/modules/contracts/presentation/components/CreateManualAddendumDialog"
import type { RepresentativeSelectSlotRenderer } from "@/modules/contracts/presentation/components/representative-select-slot"
import { ContractualDocumentSection } from "@/modules/document-generation/presentation/components/ContractualDocumentSection"
import {
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  addendumReasonLabel,
} from "@/modules/contracts/domain/addendum-labels"
import { isAddendumPending } from "@/modules/contracts/domain/rules"
import { formatConditionDate, formatContractMoney } from "@/modules/contracts/domain/formats"
import type {
  ContractAddendum,
  FormalizedConditions,
  PaymentMethodOption,
  WorkerContractualConditions,
} from "@/modules/contracts/domain/entities"
import { ArrowRight, FilePlus2, UserCheck } from "lucide-react"

interface ContractRow {
  id: string
  typeName: string | null
  startDate: string
  endDate: string | null
  isCurrent: boolean
}

export interface OperationalConditions {
  jobName: string | null
  positionName: string | null
  groupSequence: number | null
  salaryAmount: number | null
  salaryCurrency: string | null
}

interface ContractAddendumsSectionProps {
  workerId: string
  entityId: string
  canManage: boolean
  addendums: ContractAddendum[]
  contracts: ContractRow[]
  conditions: WorkerContractualConditions | null
  operational: OperationalConditions
  paymentMethods: PaymentMethodOption[]
  onChanged: () => void
  /** Selector de representante inyectado por el contexto propietario (Personas). */
  renderRepresentativeSelect: RepresentativeSelectSlotRenderer
  className?: string
}

/**
 * Fase 11A.6 — «Contratos y anexos» dentro de la ficha del trabajador (§51).
 *
 * Distingue explícitamente:
 *   ESTADO OPERATIVO ACTUAL        → asignación y escala vigentes
 *   CONDICIONES FORMALIZADAS       → contrato original + anexos formalizados
 *   ANEXOS PENDIENTES              → cambios detectados, todavía no formalizados
 */
export const ContractAddendumsSection: React.FC<ContractAddendumsSectionProps> = ({
  workerId,
  entityId,
  canManage,
  addendums,
  contracts,
  conditions,
  operational,
  paymentMethods,
  onChanged,
  renderRepresentativeSelect,
  className,
}) => {
  const [detailAddendumId, setDetailAddendumId] = React.useState<string | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [manualOpen, setManualOpen] = React.useState(false)

  const formalized: FormalizedConditions | null = conditions?.formalized ?? null
  const pending = React.useMemo(
    () => addendums.filter((row) => isAddendumPending(row.status)),
    [addendums]
  )
  const currentContract = contracts.find((row) => row.isCurrent) || contracts[0] || null

  const detailAddendum =
    addendums.find((row) => row.id === detailAddendumId) ||
    null

  const addendumsByContract = React.useMemo(() => {
    const map: Record<string, ContractAddendum[]> = {}
    addendums.forEach((row) => {
      const list = map[row.employment_contract_id] || (map[row.employment_contract_id] = [])
      list.push(row)
    })
    Object.values(map).forEach((list) =>
      list.sort((a, b) => (a.addendum_number || 0) - (b.addendum_number || 0))
    )
    return map
  }, [addendums])

  const openDetail = (addendumId: string) => {
    setDetailAddendumId(addendumId)
    setDetailOpen(true)
  }

  const currency = formalized?.currency_code || operational.salaryCurrency || "CUP"
  const pendingDifference = conditions?.pending_difference ?? null

  return (
    <div className={className}>
      <SiteCorpCard
        title="Contratos y anexos"
        description="El contrato establece las condiciones iniciales; los anexos las modifican sin crear un contrato nuevo"
      >
        {/* Estado operativo vs condiciones formalizadas (§42/§43) */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estado operativo actual
            </p>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">Cargo / Puesto</dt>
                <dd className="text-sm text-ink">
                  {operational.jobName || "—"}
                  {operational.positionName ? ` · ${operational.positionName}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Salario vigente (escala)</dt>
                <dd className="text-sm font-medium text-ink">
                  {operational.salaryAmount === null
                    ? "Sin salario configurado"
                    : formatContractMoney(operational.salaryAmount, operational.salaryCurrency)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              Se resuelve desde el puesto actual y la escala salarial vigente.
            </p>
          </div>

          <div className="rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
                Condiciones contractuales formalizadas
              </p>
              {formalized?.has_formalized_addendums && (
                <SiteCorpStatusBadge status="info">
                  {formalized.applied_addendums.length} anexo(s)
                </SiteCorpStatusBadge>
              )}
            </div>

            {!formalized ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Sin contrato vigente registrado para este trabajador.
              </p>
            ) : (
              <>
                <dl className="mt-2 space-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Cargo / Puesto</dt>
                    <dd className="text-sm text-ink">
                      {formalized.job_name || "—"}
                      {formalized.position_name ? ` · ${formalized.position_name}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Salario formalizado</dt>
                    <dd className="text-sm font-medium text-ink">
                      {formatContractMoney(formalized.salary_amount, currency)}
                      {formalized.salary_group_sequence != null
                        ? ` · Grupo ${formalized.salary_group_sequence}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total contractual formalizado</dt>
                    <dd className="text-sm text-ink">
                      {formatContractMoney(formalized.total_compensation, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Forma de pago</dt>
                    <dd className="text-sm text-ink">{formalized.payment_method_name || "—"}</dd>
                  </div>
                </dl>
                {formalized.has_formalized_addendums ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Incluye los anexos formalizados en orden efectivo (
                    {formalized.applied_addendums
                      .map((row) => `Nº ${row.addendum_number ?? "—"}`)
                      .join(", ")}
                    ). Los anexos pendientes todavía no forman parte de este resultado.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Todavía no hay anexos formalizados: coinciden con el contrato original.
                  </p>
                )}
              </>
            )}

            {pending.length > 0 && (
              <div className="mt-3 rounded-lg border border-sitecorp-warning/40 bg-sitecorp-warning/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-sitecorp-warning">
                  Anexos pendientes de formalizar
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-ink">
                  {pending.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">
                        Anexo Nº {row.addendum_number ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {addendumReasonLabel(row.reason_code)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatConditionDate(row.effective_date)}
                      </span>
                    </li>
                  ))}
                </ul>
                {pendingDifference !== null && pendingDifference !== 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    Diferencia contractual pendiente:{" "}
                    <span className="font-semibold text-ink">
                      {pendingDifference > 0 ? "+" : "−"}
                      {formatContractMoney(Math.abs(pendingDifference), currency)}
                    </span>
                  </p>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  El estado operativo ya puede reflejar el cambio: sólo la formalización lo incorpora
                  a las condiciones contractuales.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Contratos y sus anexos (§51) */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Contratos registrados</h4>
            {canManage && currentContract && (
              <SiteCorpButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualOpen(true)}
                disabled={!formalized}
                title={
                  formalized
                    ? undefined
                    : "El trabajador no tiene un contrato vigente sobre el que formalizar el anexo"
                }
              >
                <FilePlus2 className="mr-2 h-3.5 w-3.5" /> Nuevo anexo
              </SiteCorpButton>
            )}
          </div>

          {contracts.length === 0 ? (
            <SiteCorpAlert type="warning" title="Sin contrato">
              Este trabajador no tiene contratos registrados. Los anexos no pueden existir sin un
              contrato vigente.
            </SiteCorpAlert>
          ) : (
            <ul className="space-y-3">
              {contracts.map((contract) => {
                const rows = addendumsByContract[contract.id] || []
                return (
                  <li key={contract.id} className="rounded-xl border border-border">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                      <span className="text-sm font-medium text-ink">
                        {contract.typeName || "Contrato"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatConditionDate(contract.startDate)}
                        {contract.isCurrent
                          ? contract.endDate
                            ? ` · previsto hasta ${formatConditionDate(contract.endDate)}`
                            : " · sin fecha de fin"
                          : ""}
                      </span>
                      {contract.isCurrent ? (
                        <SiteCorpStatusBadge status="success">Vigente</SiteCorpStatusBadge>
                      ) : (
                        <SiteCorpStatusBadge status="neutral">Finalizado</SiteCorpStatusBadge>
                      )}
                    </div>

                    {rows.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Sin anexos: las condiciones del contrato no se han modificado.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {rows.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => openDetail(row.id)}
                              className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                            >
                              <span className="flex flex-wrap items-baseline gap-2">
                                <span className="text-sm font-medium text-ink">
                                  Anexo Nº {row.addendum_number ?? "—"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {addendumReasonLabel(row.reason_code)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatConditionDate(row.effective_date)}
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                <SiteCorpStatusBadge
                                  status={ADDENDUM_STATUS_BADGE[row.status] || "neutral"}
                                >
                                  {ADDENDUM_STATUS_LABELS[row.status] || row.status}
                                </SiteCorpStatusBadge>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Fase 11B.2: documento contractual del contrato (§61/§62) */}
                    <ContractualDocumentSection
                      kind="CONTRACT"
                      sourceId={contract.id}
                      canManage={canManage}
                      className="mx-3 mb-3"
                    />
                  </li>
                )
              })}
            </ul>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Un anexo formalizado no se elimina: para revertir una condición se registra un anexo
            posterior. Los anexos quedan vinculados al contrato vigente en el momento del cambio.
          </p>
        </div>
      </SiteCorpCard>

      <AddendumDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        addendum={detailAddendum}
        entityId={entityId}
        canManage={canManage}
        onChanged={onChanged}
        renderRepresentativeSelect={renderRepresentativeSelect}
      />

      <CreateManualAddendumDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        workerId={workerId}
        entityId={entityId}
        canManage={canManage}
        formalized={formalized}
        paymentMethods={paymentMethods}
        onCreated={onChanged}
        renderRepresentativeSelect={renderRepresentativeSelect}
      />
    </div>
  )
}

export default ContractAddendumsSection
