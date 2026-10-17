import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Label } from "@/shared/components/ui/label"
import { showSuccess, showError } from "@/utils/toast"
import {
  fetchEntityScheduleSegments,
  fetchSalaryValuesForGroups,
  formatSalary,
  resolveApplicableScaleId,
  salaryForGroup,
  type PositionScheduleSegment,
  type SalaryValue,
} from "@/modules/organization-structure"
import { PositionWorkInfoReadOnly } from "@/modules/organization-structure/presentation/components/PositionWorkInfoReadOnly"
import {
  createWorkerPluriemploy,
  loadContractChangeWorkspace,
  loadTransitionWorkspace,
  validatePluriemployInput,
  type ContractTypeOption,
  type StaffingPosition,
} from "@/modules/people"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import type { RepresentativePositionRow } from "@/modules/representatives"
import { ContractFormalizationAlerts } from "@/modules/contracts/presentation/components/ContractFormalizationAlerts"
import {
  ContractRetributionFields,
  ContractSignatureFields,
} from "@/modules/contracts/presentation/components/ContractConditionsFields"
import { ContractFormalizationSummary } from "@/modules/contracts/presentation/components/ContractFormalizationSummary"
import {
  EMPTY_FORMALIZATION_PENDING,
  buildComponentsPayload,
  fetchPaymentMethods,
  formatConditionDate,
  hasInvalidComponent,
  type CompensationComponentDraft,
  type ContractFormalizationPending,
  type PaymentMethodOption,
} from "@/modules/contracts"
import { FileSignature, Layers } from "lucide-react"

/**
 * Pluriempleo — Alta del SEGUNDO contrato de un trabajador activo.
 *
 * Reutiliza los MISMOS componentes, validaciones y casos de uso de la contratación ya
 * existente: condiciones formalizadas (`ContractSignatureFields`), conceptos retributivos
 * (`ContractRetributionFields`), checklist del backend (`ContractFormalizationAlerts`),
 * representante vigente (`RepresentativeSelect`) y resumen (`ContractFormalizationSummary`).
 *
 * No crea candidato ni proceso de selección y no duplica al trabajador: abre una segunda
 * asignación y un segundo contrato sobre la MISMA ficha mediante `create_worker_pluriemploy`.
 */
interface PluriemployContractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workerId: string
  entityId: string
  workerName: string
  workerIdentification: string
  /** Puesto del primer contrato vigente: no puede repetirse en el segundo. */
  currentPositionId: string | null
  onSuccess: () => void
}

const PluriemployContractDialog: React.FC<PluriemployContractDialogProps> = ({
  open,
  onOpenChange,
  workerId,
  entityId,
  workerName,
  workerIdentification,
  currentPositionId,
  onSuccess,
}) => {
  const queryClient = useQueryClient()

  const [positions, setPositions] = React.useState<StaffingPosition[]>([])
  const [occupancy, setOccupancy] = React.useState<Record<string, number>>({})
  const [segmentsByPosition, setSegmentsByPosition] = React.useState<
    Record<string, PositionScheduleSegment[]>
  >({})
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
  const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<
    Record<string, SalaryValue | null>
  >({})
  const [contractTypes, setContractTypes] = React.useState<ContractTypeOption[]>([])
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])
  const [canManageContractData, setCanManageContractData] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [positionId, setPositionId] = React.useState("")
  const [hireDate, setHireDate] = React.useState("")
  const [contractTypeId, setContractTypeId] = React.useState("")
  const [contractStartDate, setContractStartDate] = React.useState("")
  const [contractEndDate, setContractEndDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [paymentMethodId, setPaymentMethodId] = React.useState("")
  const [paymentSchedule, setPaymentSchedule] = React.useState("")
  const [components, setComponents] = React.useState<CompensationComponentDraft[]>([])
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  const [pending, setPending] = React.useState<ContractFormalizationPending | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadWorkspace = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [workspace, segments, contractWorkspace, methods] = await Promise.all([
        loadTransitionWorkspace(entityId),
        fetchEntityScheduleSegments(entityId),
        loadContractChangeWorkspace(entityId),
        fetchPaymentMethods(),
      ])
      setPositions(workspace.positions)
      setOccupancy(workspace.occupancy.counts)
      setSegmentsByPosition(segments)
      setContractTypes(contractWorkspace.contractTypes)
      setCanManageContractData(workspace.canManageContractData)
      setPaymentMethods(methods)

      setApplicableScaleId(await resolveApplicableScaleId(entityId))
      const groupIds = workspace.positions
        .map((p) => p.job?.salary_group?.id)
        .filter((id): id is string => !!id)
      setSalaryValuesByGroup(await fetchSalaryValuesForGroups(groupIds))
    } catch (err) {
      console.error("Error loading pluriemploy workspace:", err)
      setLoadError("No se pudieron cargar los puestos disponibles.")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    if (!open) return
    setPositionId("")
    setHireDate("")
    setContractTypeId("")
    setContractStartDate("")
    setContractEndDate("")
    setNotes("")
    setSignatureDate("")
    setSignaturePlace("")
    setPaymentMethodId("")
    setPaymentSchedule("")
    setComponents([])
    setRepresentativeAssignmentId(null)
    setPending(null)
    setError(null)
    loadWorkspace()
  }, [open, loadWorkspace])

  /**
   * Puestos admitidos como SEGUNDO puesto: activos, distintos del primero, con vacante y
   * con Cargo sujeto a contrato (el Cargo Especialista Principal se documenta con
   * Resolución, no con contrato laboral).
   */
  const selectable = React.useMemo(
    () =>
      positions.filter(
        (p) =>
          p.is_active &&
          p.id !== currentPositionId &&
          p.job?.is_principal_specialist !== true &&
          (occupancy[p.id] || 0) < (p.authorized_quantity || 0)
      ),
    [positions, occupancy, currentPositionId]
  )

  const selected = React.useMemo(
    () => positions.find((p) => p.id === positionId) || null,
    [positions, positionId]
  )

  const selectedGroup = selected?.job?.salary_group || null
  const selectedSalary = salaryForGroup(applicableScaleId, selectedGroup, salaryValuesByGroup)

  const selectedType = contractTypes.find((t) => t.id === contractTypeId) || null
  const isDetermined = selectedType?.code === "DETERMINADO"
  const formalizationBlocked = (pending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0
  const selectedRepresentative =
    representatives.find((row) => row.assignment_id === representativeAssignmentId) || null

  React.useEffect(() => {
    if (!isDetermined) setContractEndDate("")
  }, [isDetermined])

  const handleSubmit = async () => {
    setError(null)

    const invalid = validatePluriemployInput({
      positionId,
      hireDate,
      positionAvailable:
        !!selected && (occupancy[selected.id] || 0) < (selected.authorized_quantity || 0),
      contractTypeId,
      isDetermined,
      endDate: contractEndDate,
      signatureDate,
      signaturePlace,
      paymentMethodId,
      hasInvalidComponents: hasInvalidComponent(components),
      blocking: (pending || EMPTY_FORMALIZATION_PENDING).blocking,
      representativeAssignmentId,
    })
    if (invalid) {
      setError(invalid)
      return
    }

    setSubmitting(true)
    try {
      // Caso de uso: segundo contrato (nueva asignación + contrato + snapshots +
      // bitácora + movimiento de nómina), con el documento del contrato generado después.
      const outcome = await createWorkerPluriemploy({
        workerId,
        positionId,
        hireDate,
        contractTypeId,
        contractStartDate: contractStartDate || hireDate,
        contractEndDate,
        isDetermined,
        notes,
        representativeAssignmentId,
        signatureDate,
        signaturePlace,
        paymentMethodId,
        paymentScheduleText: paymentSchedule,
        compensationComponents: buildComponentsPayload(components),
      })

      invalidateContractAlertData(queryClient)

      if (outcome.documentWarning) {
        showError(
          `Segundo contrato registrado, pero su documento no se pudo generar: ${outcome.documentWarning}. Puede regenerarlo desde la pestaña Documentos del trabajador.`
        )
      } else {
        showSuccess(
          "Pluriempleo formalizado: el trabajador conserva su ficha y ahora tiene dos contratos vigentes."
        )
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      let friendly = "No se pudo formalizar el segundo contrato."
      if (/vacantes/i.test(msg)) {
        friendly = "El puesto seleccionado ya no tiene vacantes disponibles."
      } else if (/no est[aá] activo/i.test(msg)) {
        friendly = "El puesto seleccionado no está activo."
      } else if (/no pertenece a la entidad/i.test(msg)) {
        friendly = "El puesto seleccionado no pertenece a la entidad del trabajador."
      } else if (/ya ocupa/i.test(msg)) {
        friendly = "El trabajador ya ocupa el puesto seleccionado."
      } else if (/ya tiene 2 contratos/i.test(msg)) {
        friendly = "El trabajador ya tiene 2 contratos activos: no se puede crear un tercero."
      } else if (/Especialista Principal/i.test(msg)) {
        friendly =
          "El puesto seleccionado pertenece a un Cargo Especialista Principal: se formaliza con Resolución, no con contrato laboral."
      } else if (/use la contrataci[oó]n normal/i.test(msg)) {
        friendly = "El trabajador no tiene un contrato activo: use la contratación normal."
      } else if (/Datos pendientes/i.test(msg)) {
        friendly = msg
      } else if (msg) {
        friendly = msg
      }
      setError(friendly)
      showError(friendly)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-sitecorp-primary" /> Pluriempleo
          </DialogTitle>
          <DialogDescription>
            Formaliza un SEGUNDO contrato para un puesto distinto de la misma entidad. El
            trabajador conserva una única ficha: se añaden una asignación y un contrato
            independientes, sin duplicar la persona ni crear candidato.
          </DialogDescription>
        </DialogHeader>

        {loadError && <SiteCorpAlert type="danger">{loadError}</SiteCorpAlert>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Segundo puesto *</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando puestos…</p>
            ) : selectable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay otros puestos con vacantes disponibles en esta entidad.
              </p>
            ) : (
              <SiteCorpSelect value={positionId} onValueChange={setPositionId}>
                <option value="">Seleccionar puesto</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.job ? ` · ${p.job.name}` : ""} ({occupancy[p.id] || 0}/
                    {p.authorized_quantity})
                  </option>
                ))}
              </SiteCorpSelect>
            )}
          </div>

          {selected && (
            <div className="rounded-xl border border-border p-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Área</dt>
                  <dd className="text-sm font-medium text-ink">
                    {selected.job?.area?.name || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cargo</dt>
                  <dd className="text-sm font-medium text-ink">{selected.job?.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Puesto</dt>
                  <dd className="text-sm font-medium text-ink">
                    {selected.name}
                    {selected.code ? (
                      <span className="ml-1 text-xs text-muted-foreground">{selected.code}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Salario de escala del puesto</dt>
                  <dd className="text-sm font-medium text-ink">
                    {selectedSalary ? formatSalary(selectedSalary) : "Salario no configurado"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Capacidad</dt>
                  <dd className="text-sm text-ink">
                    Ocupación {occupancy[selected.id] || 0}/{selected.authorized_quantity} ·{" "}
                    {Math.max(
                      0,
                      (selected.authorized_quantity || 0) - (occupancy[selected.id] || 0)
                    )}{" "}
                    vacante(s)
                  </dd>
                </div>
              </dl>

              <PositionWorkInfoReadOnly
                className="mt-3"
                title="Información laboral del segundo puesto"
                workLocation={selected.work_location}
                dailyHours={selected.daily_hours}
                weeklyHours={selected.weekly_hours}
                monthlyHours={selected.monthly_hours}
                breakMinutes={selected.break_minutes}
                scheduleNotes={selected.schedule_notes}
                segments={segmentsByPosition[selected.id] || []}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Incorporación al puesto *</Label>
              <SiteCorpInput
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Inicio del contrato</Label>
              <SiteCorpInput
                type="date"
                value={contractStartDate}
                placeholder={hireDate}
                onChange={(e) => setContractStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Si se deja vacío, se usa la fecha de incorporación al puesto.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Tipo de contrato *</Label>
              <SiteCorpSelect value={contractTypeId} onValueChange={setContractTypeId}>
                <option value="">Seleccionar tipo</option>
                {contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>
          </div>

          {isDetermined && (
            <div className="space-y-2">
              <Label>Fin del contrato *</Label>
              <SiteCorpInput
                type="date"
                value={contractEndDate}
                min={contractStartDate || hireDate || undefined}
                onChange={(e) => setContractEndDate(e.target.value)}
              />
            </div>
          )}

          <ContractSignatureFields
            signatureDate={signatureDate}
            onSignatureDateChange={setSignatureDate}
            signaturePlace={signaturePlace}
            onSignaturePlaceChange={setSignaturePlace}
            paymentMethodId={paymentMethodId}
            onPaymentMethodIdChange={setPaymentMethodId}
            paymentMethods={paymentMethods}
            paymentSchedule={paymentSchedule}
            onPaymentScheduleChange={setPaymentSchedule}
          />

          <ContractFormalizationAlerts
            entityId={entityId}
            positionId={selected?.id ?? null}
            signatureDate={signatureDate || null}
            signaturePlace={signaturePlace || null}
            paymentMethodId={paymentMethodId || null}
            representativeAssignmentId={representativeAssignmentId}
            canManage={canManageContractData}
            onPendingChange={setPending}
          />

          <RepresentativeSelect
            entityId={entityId}
            onDate={signatureDate}
            value={representativeAssignmentId}
            onChange={setRepresentativeAssignmentId}
            canManage={canManageContractData}
            label="Representante que suscribe el contrato *"
            dateHint={`Representante vigente en la fecha de firma (${formatConditionDate(
              signatureDate
            )}).`}
            onOptionsChange={setRepresentatives}
          />

          <ContractRetributionFields
            components={components}
            onComponentsChange={setComponents}
            baseSalaryAmount={selectedSalary?.amount ?? null}
            baseSalaryCurrency={selectedSalary?.currency_code ?? null}
            salaryGroupSequence={selectedGroup?.sequence_number ?? null}
            disabled={!selected}
            salaryHint="El salario de escala del segundo contrato se deriva del puesto y de la escala aplicable a la entidad."
          />

          <div className="space-y-2">
            <Label>Observaciones</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
              placeholder="Ej.: Segundo puesto autorizado por necesidad del servicio."
            />
          </div>

          <ContractFormalizationSummary
            title="Resumen del segundo contrato"
            workerName={workerName}
            personIdentification={workerIdentification}
            positionName={selected?.name || "—"}
            jobName={selected?.job?.name || null}
            areaName={selected?.job?.area?.name || null}
            contractTypeName={selectedType?.name || null}
            startDate={contractStartDate || hireDate}
            endDate={isDetermined ? contractEndDate || null : null}
            signatureDate={signatureDate}
            signaturePlace={signaturePlace}
            paymentMethodName={
              paymentMethods.find((method) => method.id === paymentMethodId)?.name || null
            }
            representativeName={selectedRepresentative?.person_name || null}
            representativeTitle={selectedRepresentative?.title || null}
            baseSalaryAmount={selectedSalary?.amount ?? null}
            baseSalaryCurrency={selectedSalary?.currency_code ?? null}
            salaryGroupSequence={selectedGroup?.sequence_number ?? null}
            components={components}
          />

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <SiteCorpButton variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </SiteCorpButton>
          <SiteCorpButton
            type="button"
            onClick={handleSubmit}
            disabled={
              submitting ||
              loading ||
              !positionId ||
              !hireDate ||
              !contractTypeId ||
              !signatureDate ||
              !signaturePlace.trim() ||
              !paymentMethodId ||
              hasInvalidComponent(components) ||
              formalizationBlocked ||
              !representativeAssignmentId
            }
          >
            <FileSignature className="mr-2 h-4 w-4" />
            {submitting ? "Formalizando…" : "Formalizar segundo contrato"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PluriemployContractDialog
