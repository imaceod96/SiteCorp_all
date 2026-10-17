import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
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
  changeWorkerContract,
  loadContractChangeWorkspace,
  validateContractChangeInput,
  type ContractTypeOption,
} from "@/modules/people"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
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
  fetchContractConditions,
  fetchPaymentMethods,
  formatConditionDate,
  hasInvalidComponent,
  toComponentDrafts,
  type CompensationComponentDraft,
  type ContractFormalizationPending,
  type PaymentMethodOption,
} from "@/modules/contracts"
import { FileSignature } from "lucide-react"
import type { ChangeContractDialogProps } from "@/shared/components/worker-action-contracts"

// Las props del flujo son un contrato compartido con la página de vencimientos
// contractuales (módulo Contratos): viven en la capa compartida para que Contratos no
// dependa de la presentación de Personas.

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Fase 11A.5 — cambio de tipo de contrato: crea un contrato NUEVO con sus propias
 *  condiciones formalizadas. Las condiciones vigentes se precargan para revisión,
 *  nunca se heredan silenciosamente (§69). */
const ChangeContractDialog: React.FC<ChangeContractDialogProps> = ({
  open,
  onOpenChange,
  workerId,
  entityId,
  current,
  workerName = "",
  workerIdentification = null,
  positionId = null,
  positionName = null,
  jobName = null,
  areaName = null,
  salaryGroupSequence = null,
  baseSalaryAmount = null,
  baseSalaryCurrency = null,
  onSuccess,
}) => {
  const [contractTypes, setContractTypes] = React.useState<ContractTypeOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [newContractTypeId, setNewContractTypeId] = React.useState("")
  const [effectiveDate, setEffectiveDate] = React.useState("")
  const [newEndDate, setNewEndDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  // Fase 11A.5: condiciones formalizadas del nuevo contrato
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [paymentMethodId, setPaymentMethodId] = React.useState("")
  const [paymentSchedule, setPaymentSchedule] = React.useState("")
  const [components, setComponents] = React.useState<CompensationComponentDraft[]>([])
  const [preloaded, setPreloaded] = React.useState(false)
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])
  const [pending, setPending] = React.useState<ContractFormalizationPending | null>(null)
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  const [canManageOrganization, setCanManageOrganization] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!open) return
    setNewContractTypeId("")
    setEffectiveDate("")
    setNewEndDate("")
    setNotes("")
    setSignatureDate("")
    setSignaturePlace("")
    setPaymentMethodId("")
    setPaymentSchedule("")
    setComponents([])
    setPreloaded(false)
    setRepresentatives([])
    setPending(null)
    setRepresentativeAssignmentId(null)
    setError(null)
    setLoading(true)

    // Caso de uso (lectura): catálogo de tipos de contrato activos y permiso de los
    // datos contractuales de la entidad.
    loadContractChangeWorkspace(entityId)
      .then((workspace) => {
        setContractTypes(workspace.contractTypes)
        setCanManageOrganization(workspace.canManageContractData)
      })
      .catch((err) => {
        console.error("Error loading contract types:", err)
        setError("No se pudieron cargar los tipos de contrato.")
      })
      .finally(() => setLoading(false))

    // Fase 11A.5: catálogo de formas de pago + condiciones del contrato vigente
    // precargadas como borrador revisable (no se heredan sin mostrar).
    const loadConditions = async () => {
      try {
        setPaymentMethods(await fetchPaymentMethods())
      } catch (err) {
        console.error("Error loading payment methods:", err)
      }
      try {
        const snapshot = await fetchContractConditions(current.id)
        if (snapshot) {
          setSignaturePlace(snapshot.signature_place || "")
          setPaymentMethodId(snapshot.payment_method_id || "")
          setPaymentSchedule(snapshot.payment_schedule_text || "")
          setComponents(toComponentDrafts(snapshot.components))
          setPreloaded(
            !!snapshot.signature_place ||
              !!snapshot.payment_method_id ||
              snapshot.components.length > 0
          )
        }
      } catch (err) {
        console.error("Error loading current contract conditions:", err)
      }
    }
    loadConditions()
  }, [open, entityId, current.id])

  const selectedType = contractTypes.find((t) => t.id === newContractTypeId) || null
  const isDetermined = selectedType?.code === "DETERMINADO"
  const minDate = current.startDate ? addDays(current.startDate, 1) : undefined
  const formalizationBlocked = (pending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0
  const selectedRepresentative =
    representatives.find((row) => row.assignment_id === representativeAssignmentId) || null

  React.useEffect(() => {
    if (!isDetermined) setNewEndDate("")
  }, [isDetermined])

  const handleSubmit = async () => {
    setError(null)

    // Reglas del dominio: tipo nuevo, fecha efectiva posterior al contrato vigente,
    // vigencia del contrato determinado y condiciones formalizadas.
    const invalid = validateContractChangeInput({
      newContractTypeId,
      effectiveDate,
      currentContractStartDate: current.startDate || null,
      isDetermined,
      newEndDate,
      signatureDate,
      formalization: {
        representativeAssignmentId,
        signatureDate,
        signaturePlace,
        paymentMethodId,
        paymentScheduleText: paymentSchedule,
        hasInvalidComponents: hasInvalidComponent(components),
        blocking: (pending || EMPTY_FORMALIZATION_PENDING).blocking,
      },
    })
    if (invalid) {
      setError(invalid)
      return
    }

    setSubmitting(true)
    try {
      // Caso de uso: cierra el contrato vigente, crea el nuevo con sus condiciones y
      // genera su documento (devolviendo aviso si no se pudo generar).
      const outcome = await changeWorkerContract({
        workerId,
        newContractTypeId,
        effectiveDate,
        newEndDate,
        isDetermined,
        notes,
        representativeAssignmentId,
        signatureDate,
        signaturePlace,
        paymentMethodId,
        paymentScheduleText: paymentSchedule,
        compensationComponents: buildComponentsPayload(components),
      })

      // El contrato vigente cambió: recalcular alertas de vencimiento y resumen.
      invalidateContractAlertData(queryClient)
      showSuccess(
        outcome.documentWarning
          ? `Cambio de contrato realizado, pero no se pudo generar su documento: ${outcome.documentWarning}`
          : "Cambio de contrato realizado correctamente. El contrato y su documento fueron generados."
      )
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      let friendly = "No se pudo completar el cambio de contrato."
      if (/posterior al inicio del contrato/i.test(msg)) {
        friendly = "La fecha efectiva debe ser posterior al inicio del contrato vigente."
      } else if (/requiere una fecha de finalizaci[oó]n/i.test(msg)) {
        friendly = "El contrato por tiempo determinado requiere una fecha de finalización."
      } else if (/posterior a la fecha efectiva/i.test(msg)) {
        friendly = "La fecha de finalización debe ser posterior a la fecha efectiva."
      } else if (/Datos pendientes/i.test(msg)) {
        friendly = msg
      } else if (/concepto retributivo|n[uú]mero v[aá]lido|negativo/i.test(msg)) {
        friendly =
          "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)."
      } else if (/escala salarial/i.test(msg)) {
        friendly =
          "No existe una escala salarial aplicable configurada para esta entidad. Complete la configuración salarial antes de formalizar el contrato."
      } else if (/representante/i.test(msg)) {
        friendly = "No hay representantes configurados para la fecha de firma seleccionada."
      } else if (/no tiene un contrato vigente/i.test(msg)) {
        friendly = "El trabajador no tiene un contrato vigente."
      } else if (/no est[aá] activo/i.test(msg)) {
        friendly = "El trabajador no está activo. Utiliza Reincorporar."
      } else if (/permiso/i.test(msg)) {
        friendly = "No tiene permiso para gestionar trabajadores."
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Cambiar contrato</DialogTitle>
          <DialogDescription>
            Se cerrará el contrato vigente y se creará uno nuevo. El contrato anterior se
            conserva como histórico. El puesto, la capacidad y el salario no cambian.
          </DialogDescription>
        </DialogHeader>

        {/* Contrato actual */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contrato actual
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Tipo</dt>
              <dd className="text-sm font-medium text-ink">{current.typeName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fecha de inicio</dt>
              <dd className="text-sm font-medium text-ink">
                {formatConditionDate(current.startDate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Finalización prevista</dt>
              <dd className="text-sm font-medium text-ink">
                {current.endDate ? formatConditionDate(current.endDate) : "Sin fecha de fin"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nuevo tipo de contrato *</Label>
            <SiteCorpSelect value={newContractTypeId} onValueChange={setNewContractTypeId}>
              <option value="">{loading ? "Cargando tipos…" : "Seleccionar tipo"}</option>
              {contractTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SiteCorpSelect>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fecha efectiva *</Label>
              <SiteCorpInput
                type="date"
                value={effectiveDate}
                min={minDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Finalización prevista{isDetermined ? " *" : ""}</Label>
              <SiteCorpInput
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                disabled={!isDetermined}
                min={effectiveDate || undefined}
              />
              {!isDetermined && (
                <p className="text-xs text-muted-foreground">
                  La modalidad de tiempo indeterminado no requiere fecha de finalización.
                </p>
              )}
            </div>
          </div>

          {/* Condiciones formalizadas del nuevo contrato */}
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

          {preloaded && (
            <SiteCorpAlert type="info">
              Se precargaron la forma de pago, el lugar de firma y los conceptos retributivos del
              contrato vigente. Revíselos antes de confirmar: el nuevo contrato conserva sus propias
              condiciones formalizadas.
            </SiteCorpAlert>
          )}

          <ContractFormalizationAlerts
            entityId={entityId}
            positionId={positionId}
            signatureDate={signatureDate || null}
            signaturePlace={signaturePlace || null}
            paymentMethodId={paymentMethodId || null}
            representativeAssignmentId={representativeAssignmentId}
            canManage={canManageOrganization}
            onPendingChange={setPending}
          />

          <RepresentativeSelect
            entityId={entityId}
            onDate={signatureDate}
            value={representativeAssignmentId}
            onChange={setRepresentativeAssignmentId}
            canManage={canManageOrganization}
            label="Representante que suscribe el contrato *"
            dateHint={`Representante vigente en la fecha de firma (${formatConditionDate(
              signatureDate
            )}). Los cambios posteriores de representante no modifican este contrato.`}
            onOptionsChange={setRepresentatives}
          />

          <ContractRetributionFields
            components={components}
            onComponentsChange={setComponents}
            baseSalaryAmount={baseSalaryAmount}
            baseSalaryCurrency={baseSalaryCurrency}
            salaryGroupSequence={salaryGroupSequence}
            salaryHint="El salario de escala del nuevo contrato se deriva del cargo y la escala aplicable a la entidad."
          />

          <div className="space-y-2">
            <Label>Observaciones</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
              placeholder="Ej.: Conversión a contrato por tiempo indeterminado."
            />
          </div>

          <ContractFormalizationSummary
            title="Resumen del nuevo contrato"
            workerName={workerName}
            personIdentification={workerIdentification}
            positionName={positionName || "—"}
            jobName={jobName}
            areaName={areaName}
            contractTypeName={selectedType?.name || null}
            startDate={effectiveDate}
            endDate={isDetermined ? newEndDate || null : null}
            signatureDate={signatureDate}
            signaturePlace={signaturePlace}
            paymentMethodName={
              paymentMethods.find((method) => method.id === paymentMethodId)?.name || null
            }
            representativeName={selectedRepresentative?.person_name || null}
            representativeTitle={selectedRepresentative?.title || null}
            baseSalaryAmount={baseSalaryAmount}
            baseSalaryCurrency={baseSalaryCurrency}
            salaryGroupSequence={salaryGroupSequence}
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
              !newContractTypeId ||
              !signatureDate ||
              !signaturePlace.trim() ||
              !paymentMethodId ||
              hasInvalidComponent(components) ||
              formalizationBlocked ||
              !representativeAssignmentId
            }
          >
            <FileSignature className="mr-2 h-4 w-4" />
            {submitting ? "Procesando…" : "Confirmar cambio de contrato"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ChangeContractDialog
