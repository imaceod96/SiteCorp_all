import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
import { ensureAddendumDocumentGenerated } from "@/modules/contracts"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Label } from "@/shared/components/ui/label"
import { AddendumChangesList } from "@/modules/contracts/presentation/components/AddendumChangesList"
import { ContractRetributionFields } from "@/modules/contracts/presentation/components/ContractConditionsFields"
import type { RepresentativeSelectSlotRenderer } from "@/modules/contracts/presentation/components/representative-select-slot"
import {
  MANUAL_ADDENDUM_REASON_CODES,
  addendumReasonLabel,
  buildComponentsPayload,
  componentsTotal,
  createManualAddendum,
  formatContractMoney,
  hasInvalidComponent,
  type AddendumChange,
  type AddendumReasonCode,
  type CompensationComponentDraft,
  type CompensationComponentType,
  type FormalizedConditions,
  type PaymentMethodOption,
} from "@/modules/contracts"
import { showError, showSuccess } from "@/utils/toast"
import { Info } from "lucide-react"

interface CreateManualAddendumDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workerId: string
  entityId: string
  canManage: boolean
  /** Condiciones contractuales formalizadas vigentes (base del antes/después) */
  formalized: FormalizedConditions | null
  paymentMethods: PaymentMethodOption[]
  onCreated: () => void
  /** Selector de representante inyectado por el contexto propietario (Personas). */
  renderRepresentativeSelect: RepresentativeSelectSlotRenderer
}

const today = () => new Date().toISOString().slice(0, 10)

const numberText = (value: string): string => {
  const parsed = Number(value.replace(",", "."))
  if (!Number.isFinite(parsed)) return value
  return Number.isInteger(parsed)
    ? String(parsed)
    : parsed.toLocaleString("es-CU", { maximumFractionDigits: 2 })
}

const sameComponents = (
  a: { component_type: string; description: string; amount: number }[],
  b: { component_type: string; description: string; amount: number }[]
): boolean => {
  if (a.length !== b.length) return false
  const key = (row: { component_type: string; description: string; amount: number }) =>
    `${row.component_type}|${row.description.trim()}|${Number(row.amount).toFixed(2)}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((value, index) => value === right[index])
}

/**
 * Fase 11A.6 — Anexo manual (§63/§64/§67/§68).
 *
 * Sólo permite condiciones que NO exigen mover la asignación:
 *   condiciones retributivas, forma de pago, lugar de trabajo y jornada/horario.
 * El puesto/cargo se cambia con «Cambiar de puesto» y el salario de escala proviene
 * de la escala salarial: ninguno de los dos se edita aquí.
 */
export const CreateManualAddendumDialog: React.FC<CreateManualAddendumDialogProps> = ({
  open,
  onOpenChange,
  workerId,
  entityId,
  canManage,
  formalized,
  paymentMethods,
  onCreated,
  renderRepresentativeSelect,
}) => {
  const [reasonCode, setReasonCode] = React.useState<AddendumReasonCode>("COMPENSATION_CHANGE")
  const [reason, setReason] = React.useState("")
  const [effectiveDate, setEffectiveDate] = React.useState(today())
  const [notes, setNotes] = React.useState("")

  const [paymentMethodId, setPaymentMethodId] = React.useState("")
  const [paymentSchedule, setPaymentSchedule] = React.useState("")
  const [workLocation, setWorkLocation] = React.useState("")
  const [dailyHours, setDailyHours] = React.useState("")
  const [weeklyHours, setWeeklyHours] = React.useState("")
  const [monthlyHours, setMonthlyHours] = React.useState("")
  const [workSchedule, setWorkSchedule] = React.useState("")
  const [components, setComponents] = React.useState<CompensationComponentDraft[]>([])

  const [formalizeNow, setFormalizeNow] = React.useState(false)
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )

  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [processStage, setProcessStage] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  const baseComponents = React.useMemo(
    () =>
      (formalized?.components || []).map((row) => ({
        component_type: row.component_type,
        description: row.description,
        amount: Number(row.amount),
      })),
    [formalized]
  )

  React.useEffect(() => {
    if (!open) return
    setReasonCode("COMPENSATION_CHANGE")
    setReason("")
    setEffectiveDate(today())
    setNotes("")
    setPaymentMethodId(formalized?.payment_method_id || "")
    setPaymentSchedule(formalized?.payment_schedule || "")
    setWorkLocation(formalized?.work_location || "")
    setDailyHours(formalized?.daily_hours != null ? String(formalized.daily_hours) : "")
    setWeeklyHours(formalized?.weekly_hours != null ? String(formalized.weekly_hours) : "")
    setMonthlyHours(formalized?.monthly_hours != null ? String(formalized.monthly_hours) : "")
    setWorkSchedule(formalized?.work_schedule || "")
    setComponents(
      (formalized?.components || []).map((row, index) => ({
        key: `formalized-${index}-${row.component_type}`,
        component_type: (row.component_type as CompensationComponentType) || "OTHER",
        description: row.description,
        amount: String(row.amount),
      }))
    )
    setFormalizeNow(false)
    setSignatureDate("")
    setSignaturePlace("")
    setRepresentativeAssignmentId(null)
    setError(null)
  }, [open, formalized])

  const componentsPayload = React.useMemo(() => buildComponentsPayload(components), [components])
  const componentsChanged = React.useMemo(
    () => !sameComponents(baseComponents, componentsPayload),
    [baseComponents, componentsPayload]
  )

  const currency = formalized?.currency_code || "CUP"

  /** Cambios antes/después que se enviarán al backend (vista previa + payload). */
  const changes = React.useMemo<AddendumChange[]>(() => {
    const rows: AddendumChange[] = []

    if (paymentMethodId && paymentMethodId !== (formalized?.payment_method_id || "")) {
      const newName = paymentMethods.find((m) => m.id === paymentMethodId)?.name || null
      rows.push({
        field_code: "PAYMENT_METHOD",
        old_value: formalized?.payment_method_name ?? null,
        new_value: newName,
        old_display_value: formalized?.payment_method_name ?? null,
        new_display_value: newName,
        old_reference_id: formalized?.payment_method_id ?? null,
        new_reference_id: paymentMethodId,
        display_order: 12,
      })
    }

    const typedPaySchedule = paymentSchedule.trim()
    if (typedPaySchedule !== (formalized?.payment_schedule || "").trim()) {
      rows.push({
        field_code: "PAYMENT_SCHEDULE",
        old_value: formalized?.payment_schedule ?? null,
        new_value: typedPaySchedule || null,
        old_display_value: formalized?.payment_schedule ?? null,
        new_display_value: typedPaySchedule || null,
        display_order: 12,
      })
    }

    const typedLocation = workLocation.trim()
    if (typedLocation !== (formalized?.work_location || "").trim()) {
      rows.push({
        field_code: "WORK_LOCATION",
        old_value: formalized?.work_location ?? null,
        new_value: typedLocation || null,
        old_display_value: formalized?.work_location ?? null,
        new_display_value: typedLocation || null,
        display_order: 7,
      })
    }

    const hoursRows: {
      code: string
      label: string
      value: string
      previous: number | null
      order: number
    }[] = [
      { code: "DAILY_HOURS", label: "h/día", value: dailyHours, previous: formalized?.daily_hours ?? null, order: 8 },
      { code: "WEEKLY_HOURS", label: "h/semana", value: weeklyHours, previous: formalized?.weekly_hours ?? null, order: 9 },
      { code: "MONTHLY_HOURS", label: "h/mes", value: monthlyHours, previous: formalized?.monthly_hours ?? null, order: 10 },
    ]

    hoursRows.forEach((row) => {
      const typed = row.value.trim().replace(",", ".")
      if (!typed) return
      const parsed = Number(typed)
      if (!Number.isFinite(parsed) || parsed < 0) return
      if (row.previous !== null && Number(row.previous) === parsed) return
      rows.push({
        field_code: row.code,
        old_value: row.previous !== null ? String(row.previous) : null,
        new_value: String(parsed),
        old_display_value: row.previous !== null ? `${numberText(String(row.previous))} ${row.label}` : null,
        new_display_value: `${numberText(typed)} ${row.label}`,
        display_order: row.order,
      })
    })

    const typedSchedule = workSchedule.trim()
    if (typedSchedule !== (formalized?.work_schedule || "").trim()) {
      rows.push({
        field_code: "WORK_SCHEDULE",
        old_value: formalized?.work_schedule ?? null,
        new_value: typedSchedule || null,
        old_display_value: formalized?.work_schedule ?? null,
        new_display_value: typedSchedule || null,
        display_order: 11,
      })
    }

    // Conceptos retributivos: el backend registra sus filas y recalcula el total
    if (componentsChanged) {
      const previousTotal = baseComponents.reduce((total, row) => total + Number(row.amount), 0)
      const newTotal = componentsTotal(components)
      const previousByType = (type: string) =>
        baseComponents
          .filter((row) => row.component_type === type)
          .reduce((total, row) => total + Number(row.amount), 0)
      const newByType = (type: string) =>
        componentsPayload
          .filter((row) => row.component_type === type)
          .reduce((total, row) => total + Number(row.amount), 0)

      const typeRows: { code: string; order: number }[] = [
        { code: "ADDITIONAL_PAYMENT", order: 13 },
        { code: "ABNORMAL_CONDITIONS", order: 14 },
        { code: "OTHER_PAYMENT", order: 15 },
      ]

      typeRows.forEach((row) => {
        const before = previousByType(row.code)
        const after = newByType(row.code)
        if (before === after) return
        rows.push({
          field_code: row.code,
          old_value: String(before),
          new_value: String(after),
          old_display_value: formatContractMoney(before, currency),
          new_display_value: formatContractMoney(after, currency),
          display_order: row.order,
        })
      })

      const beforeTotal = (formalized?.salary_amount ?? 0) + previousTotal
      const afterTotal = (formalized?.salary_amount ?? 0) + newTotal
      if (beforeTotal !== afterTotal) {
        rows.push({
          field_code: "TOTAL_COMPENSATION",
          old_value: String(beforeTotal),
          new_value: String(afterTotal),
          old_display_value: formatContractMoney(beforeTotal, currency),
          new_display_value: formatContractMoney(afterTotal, currency),
          display_order: 16,
        })
      }
    }

    return rows.sort((a, b) => a.display_order - b.display_order)
  }, [
    paymentMethodId,
    paymentSchedule,
    paymentMethods,
    workLocation,
    dailyHours,
    weeklyHours,
    monthlyHours,
    workSchedule,
    components,
    componentsPayload,
    componentsChanged,
    baseComponents,
    formalized,
    currency,
  ])

  const handleSubmit = async () => {
    setError(null)

    if (!formalized) {
      setError(
        "El trabajador no tiene un contrato vigente con condiciones formalizadas: no se puede crear un anexo huérfano."
      )
      return
    }
    if (!effectiveDate) {
      setError("La fecha efectiva es obligatoria.")
      return
    }
    if (changes.length === 0) {
      setError("Indique al menos una condición que cambie: sin cambios no se crea un anexo.")
      return
    }
    if (hasInvalidComponent(components)) {
      setError(
        "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)."
      )
      return
    }
    if (formalizeNow) {
      if (!signatureDate) {
        setError("La fecha de firma es obligatoria para formalizar el anexo.")
        return
      }
      if (!signaturePlace.trim()) {
        setError("El lugar de firma es obligatorio para formalizar el anexo.")
        return
      }
      if (!representativeAssignmentId) {
        setError("Seleccione el representante vigente en la fecha de firma.")
        return
      }
    }

    setSubmitting(true)
    try {
      const result = await createManualAddendum({
        workerId,
        changes: changes.map((row) => ({
          field_code: row.field_code,
          old_value: row.old_value,
          new_value: row.new_value,
          old_display_value: row.old_display_value,
          new_display_value: row.new_display_value,
          old_reference_id: row.old_reference_id ?? null,
          new_reference_id: row.new_reference_id ?? null,
          display_order: row.display_order,
        })),
        reasonCode,
        reason: reason.trim() || addendumReasonLabel(reasonCode),
        effectiveDate,
        notes,
        components: componentsChanged ? componentsPayload : undefined,
        signatureDate: formalizeNow ? signatureDate : null,
        signaturePlace: formalizeNow ? signaturePlace : null,
        representativeAssignmentId: formalizeNow ? representativeAssignmentId : null,
        requireFormalized: formalizeNow,
      })

      const number =
        result.addendum_number != null ? `Anexo Nº ${result.addendum_number}` : "Anexo"

      // §42: el documento del anexo se genera automáticamente al formalizarlo.
      let documentWarning: string | null = null
      if (result.addendum_status === "FORMALIZED" && result.addendum_id) {
        setProcessStage("Generando documento del anexo…")
        try {
          const doc = await ensureAddendumDocumentGenerated(result.addendum_id)
          if (!doc.skipped && !doc.generated) {
            documentWarning =
              doc.result?.error || "No se pudo generar el documento del anexo automáticamente."
          }
        } catch (genErr) {
          documentWarning =
            genErr instanceof Error
              ? genErr.message
              : "No se pudo generar el documento del anexo automáticamente."
        }
      }

      invalidateContractAlertData(queryClient)
      setProcessStage(null)

      showSuccess(
        result.addendum_status === "FORMALIZED"
          ? documentWarning
            ? `${number} creado y formalizado, pero el documento no se pudo generar: ${documentWarning}`
            : `Cambio aplicado correctamente. Se generó automáticamente el ${number} y su documento.`
          : `${number} creado como pendiente de formalizar.`
      )
      onOpenChange(false)
      onCreated()
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      let friendly = message || "No se pudo registrar el anexo."
      if (/contrato vigente/i.test(message)) {
        friendly =
          "El trabajador no tiene un contrato vigente: registre el contrato antes de crear un anexo."
      } else if (/anexo manual/i.test(message)) {
        friendly = message
      } else if (/Datos pendientes/i.test(message)) {
        friendly = message
      } else if (/permiso/i.test(message)) {
        friendly = "No tiene permiso para gestionar anexos de esta entidad."
      }
      setError(friendly)
      showError(friendly)
    } finally {
      setSubmitting(false)
      setProcessStage(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Nuevo anexo al contrato</DialogTitle>
          <DialogDescription>
            Registra una modificación de condiciones contractuales del contrato vigente sin crear un
            contrato nuevo.
          </DialogDescription>
        </DialogHeader>

        {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

        {!formalized ? (
          <SiteCorpAlert type="warning" title="Sin contrato vigente">
            Este trabajador no tiene un contrato vigente con condiciones formalizadas. Registre el
            contrato antes de crear un anexo.
          </SiteCorpAlert>
        ) : (
          <>
            {/* Base formalizada */}
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Condiciones contractuales formalizadas vigentes
              </p>
              <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Cargo / Puesto</dt>
                  <dd className="text-sm text-ink">
                    {formalized.job_name || "—"}
                    {formalized.position_name ? ` · ${formalized.position_name}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Salario de escala</dt>
                  <dd className="text-sm text-ink">
                    {formatContractMoney(formalized.salary_amount, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Forma de pago</dt>
                  <dd className="text-sm text-ink">{formalized.payment_method_name || "—"}</dd>
                </div>
              </dl>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                El cargo y el puesto se modifican con «Cambiar de puesto» y el salario de escala
                proviene de la escala salarial: este anexo no puede editarlos.
              </p>
            </div>

            {/* Datos del anexo */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Motivo *</Label>
                <SiteCorpSelect
                  value={reasonCode}
                  onValueChange={(value) => setReasonCode(value as AddendumReasonCode)}
                >
                  {MANUAL_ADDENDUM_REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {addendumReasonLabel(code)}
                    </option>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Fecha efectiva *</Label>
                <SiteCorpInput
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Fecha desde la cual aplican las nuevas condiciones.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Descripción del motivo</Label>
                <SiteCorpInput
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej.: Modificación de condiciones retributivas por acuerdo"
                />
              </div>
            </div>

            {/* Condiciones modificables */}
            <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Forma de pago</Label>
                <SiteCorpSelect value={paymentMethodId} onValueChange={setPaymentMethodId}>
                  <option value="">Sin cambio</option>
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Día / momento de pago</Label>
                <SiteCorpInput
                  value={paymentSchedule}
                  onChange={(e) => setPaymentSchedule(e.target.value)}
                  placeholder="Ej.: Día 10 de cada mes"
                />
                <p className="text-xs text-muted-foreground">
                  Condición distinta de la forma de pago.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Lugar de trabajo</Label>
                <SiteCorpInput
                  value={workLocation}
                  onChange={(e) => setWorkLocation(e.target.value)}
                  placeholder="Ej.: Dirección General"
                />
              </div>
              <div className="space-y-2">
                <Label>Horas diarias</Label>
                <SiteCorpInput
                  type="number"
                  min="0"
                  step="0.5"
                  value={dailyHours}
                  onChange={(e) => setDailyHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Horas semanales</Label>
                <SiteCorpInput
                  type="number"
                  min="0"
                  step="0.5"
                  value={weeklyHours}
                  onChange={(e) => setWeeklyHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Horas mensuales</Label>
                <SiteCorpInput
                  type="number"
                  min="0"
                  step="0.5"
                  value={monthlyHours}
                  onChange={(e) => setMonthlyHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Horario</Label>
                <SiteCorpInput
                  value={workSchedule}
                  onChange={(e) => setWorkSchedule(e.target.value)}
                  placeholder="Ej.: Lunes a viernes, 8:00–17:00"
                />
              </div>
            </div>

            <ContractRetributionFields
              components={components}
              onComponentsChange={setComponents}
              baseSalaryAmount={formalized.salary_amount}
              baseSalaryCurrency={currency}
              salaryGroupSequence={formalized.salary_group_sequence}
              salaryHint="Los conceptos específicos del contrato pueden modificarse con un anexo: el salario de escala se mantiene."
            />

            {/* Comparación antes/después */}
            <AddendumChangesList
              changes={changes}
              title="Cambios contractuales"
              emptyLabel="Todavía no hay cambios: modifique alguna condición para generar el anexo."
            />

            {/* Formalización opcional */}
            <div className="space-y-4 rounded-xl border border-border p-4">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input"
                  checked={formalizeNow}
                  onChange={(e) => setFormalizeNow(e.target.checked)}
                />
                <span>
                  Formalizar ahora
                  <span className="block text-xs text-muted-foreground">
                    Si no se marca, el anexo queda pendiente: el movimiento operativo puede
                    ejecutarse y la firma completarse después.
                  </span>
                </span>
              </label>

              {formalizeNow && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Fecha de firma *</Label>
                      <SiteCorpInput
                        type="date"
                        value={signatureDate}
                        onChange={(e) => setSignatureDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Lugar de firma *</Label>
                      <SiteCorpInput
                        value={signaturePlace}
                        onChange={(e) => setSignaturePlace(e.target.value)}
                        placeholder="Ej.: La Habana"
                      />
                    </div>
                  </div>
                  {renderRepresentativeSelect({
                    entityId,
                    onDate: signatureDate,
                    value: representativeAssignmentId,
                    onChange: setRepresentativeAssignmentId,
                    canManage,
                    label: "Representante que suscribe el anexo *",
                  })}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
                placeholder="Opcional"
              />
            </div>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <SiteCorpButton variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </SiteCorpButton>
          <SiteCorpButton
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !formalized || changes.length === 0}
          >
            {processStage
              ? processStage
              : submitting
                ? "Registrando…"
                : formalizeNow
                  ? "Crear y formalizar anexo"
                  : "Crear anexo pendiente"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CreateManualAddendumDialog
