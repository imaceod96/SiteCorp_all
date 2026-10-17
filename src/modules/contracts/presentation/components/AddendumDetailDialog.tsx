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
} from "@/components/ui/dialog"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Label } from "@/components/ui/label"
import { AddendumChangesList } from "@/modules/contracts/presentation/components/AddendumChangesList"
import { ContractualDocumentSection } from "@/modules/document-generation/presentation/components/ContractualDocumentSection"
import type { RepresentativeSelectSlotRenderer } from "@/modules/contracts/presentation/components/representative-select-slot"
import {
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  addendumReasonLabel,
  cancelAddendum,
  fetchAddendumPending,
  formalizeAddendum,
  formatConditionDate,
  formatContractMoney,
  isAddendumPending,
  type AddendumPending,
  type ContractAddendum,
} from "@/modules/contracts"
import { showError, showSuccess } from "@/utils/toast"
import { AlertTriangle, CheckCircle2, FileSignature, XCircle } from "lucide-react"

interface AddendumDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  addendum: ContractAddendum | null
  entityId: string
  canManage: boolean
  onChanged: () => void
  /** Selector de representante inyectado por el contexto propietario (Personas). */
  renderRepresentativeSelect: RepresentativeSelectSlotRenderer
}

const FORM_BLOCKING_ITEMS = [
  "Fecha de firma",
  "Lugar de firma",
  "Representante autorizado vigente en la fecha de firma",
]

const friendlyFormalizeError = (message: string): string => {
  if (/representante/i.test(message)) {
    return "El representante seleccionado no estaba vigente en la fecha de firma del anexo."
  }
  if (/Datos pendientes|Faltan datos/i.test(message)) return message
  if (/formalizado/i.test(message)) return "El anexo ya está formalizado."
  if (/cancelado/i.test(message)) return "El anexo está cancelado y no puede formalizarse."
  if (/permiso/i.test(message)) return "No tiene permiso para formalizar este anexo."
  return message || "No se pudo formalizar el anexo."
}

/**
 * Fase 11A.6 — Detalle del anexo, formalización y cancelación (§52/§79/§80/§81).
 *
 * FORMALIZED significa que los datos estructurados están confirmados: todavía no
 * existe un PDF/DOCX (se generará en la fase documental).
 */
export const AddendumDetailDialog: React.FC<AddendumDetailDialogProps> = ({
  open,
  onOpenChange,
  addendum,
  entityId,
  canManage,
  onChanged,
  renderRepresentativeSelect,
}) => {
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  const [pending, setPending] = React.useState<AddendumPending | null>(null)
  const [loadingPending, setLoadingPending] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false)
  const [processStage, setProcessStage] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  const addendumId = addendum?.id ?? null
  const status = addendum?.status ?? null
  const isPending = status ? isAddendumPending(status) : false

  React.useEffect(() => {
    if (!open || !addendumId) return
    setSignatureDate(addendum?.signature_date || "")
    setSignaturePlace(addendum?.signature_place || "")
    setRepresentativeAssignmentId(addendum?.representative_assignment_id || null)
    setError(null)
  }, [open, addendumId, addendum?.signature_date, addendum?.signature_place, addendum?.representative_assignment_id])

  React.useEffect(() => {
    if (!open || !addendumId) return
    let cancelled = false
    setLoadingPending(true)
    fetchAddendumPending(addendumId)
      .then((result) => {
        if (!cancelled) setPending(result)
      })
      .catch((err) => {
        console.error("Error loading addendum checklist:", err)
        if (!cancelled) setPending(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, addendumId])

  const remoteBlocking = React.useMemo(
    () => (pending?.blocking || []).filter((item) => !FORM_BLOCKING_ITEMS.includes(item)),
    [pending]
  )

  const localPending = React.useMemo(() => {
    const items: string[] = []
    if (!signatureDate) items.push("Fecha de firma")
    if (!signaturePlace.trim()) items.push("Lugar de firma")
    if (!representativeAssignmentId) {
      items.push("Representante autorizado vigente en la fecha de firma")
    }
    return items
  }, [signatureDate, signaturePlace, representativeAssignmentId])

  const checklist = React.useMemo(() => {
    const done: string[] = ["Cambio detectado", "Condiciones anteriores y nuevas"]
    if (addendum?.effective_date) done.push("Fecha efectiva")
    return { done, missing: [...remoteBlocking, ...localPending] }
  }, [addendum?.effective_date, remoteBlocking, localPending])

  const canFormalize =
    canManage && isPending && checklist.missing.length === 0 && !loadingPending && !submitting

  const handleFormalize = async () => {
    if (!addendumId) return
    setError(null)
    setSubmitting(true)
    try {
      await formalizeAddendum({
        addendumId,
        signatureDate,
        signaturePlace,
        representativeAssignmentId,
      })

      // §42: al formalizar, el documento del anexo se genera automáticamente.
      let documentWarning: string | null = null
      setProcessStage("Generando documento del anexo…")
      try {
        const doc = await ensureAddendumDocumentGenerated(addendumId)
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
      invalidateContractAlertData(queryClient)
      setProcessStage(null)

      showSuccess(
        documentWarning
          ? `Anexo formalizado. Sus condiciones forman parte del histórico contractual, pero el documento no se pudo generar: ${documentWarning}`
          : "Anexo formalizado. Se generó automáticamente su documento contractual."
      )
      onOpenChange(false)
      onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      const friendly = friendlyFormalizeError(message)
      setError(friendly)
      showError(friendly)
    } finally {
      setSubmitting(false)
      setProcessStage(null)
    }
  }

  const handleCancelAddendum = async () => {
    if (!addendumId) return
    setError(null)
    setCancelling(true)
    try {
      await cancelAddendum({ addendumId, reason: "Cancelado desde la ficha del trabajador" })
      showSuccess("Anexo pendiente cancelado. El movimiento laboral realizado no se revierte.")
      setConfirmCancelOpen(false)
      onOpenChange(false)
      onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      const friendly = /formalizado/i.test(message)
        ? "Un anexo formalizado no puede cancelarse: registre un anexo nuevo con las condiciones corregidas."
        : message || "No se pudo cancelar el anexo."
      setError(friendly)
      showError(friendly)
    } finally {
      setCancelling(false)
    }
  }

  if (!addendum) return null

  const numberLabel = addendum.addendum_number ? `Anexo Nº ${addendum.addendum_number}` : "Anexo"
  const currency = addendum.currency_code
  const totalBefore = addendum.total_before
  const totalAfter = addendum.total_after

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {numberLabel}
              <SiteCorpStatusBadge status={ADDENDUM_STATUS_BADGE[addendum.status] || "neutral"}>
                {ADDENDUM_STATUS_LABELS[addendum.status] || addendum.status}
              </SiteCorpStatusBadge>
            </DialogTitle>
            <DialogDescription>
              {addendumReasonLabel(addendum.reason_code)}
              {addendum.reason ? ` · ${addendum.reason}` : ""}
            </DialogDescription>
          </DialogHeader>

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

          {/* Datos del anexo */}
          <dl className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Motivo</dt>
              <dd className="text-sm font-medium text-ink">
                {addendum.reason || addendumReasonLabel(addendum.reason_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fecha efectiva</dt>
              <dd className="text-sm font-medium text-ink">
                {formatConditionDate(addendum.effective_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fecha de firma</dt>
              <dd className="text-sm text-ink">
                {addendum.signature_date ? (
                  formatConditionDate(addendum.signature_date)
                ) : (
                  <span className="italic text-muted-foreground">Pendiente</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lugar de firma</dt>
              <dd className="text-sm text-ink">
                {addendum.signature_place || (
                  <span className="italic text-muted-foreground">Pendiente</span>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Representante de la entidad</dt>
              <dd className="text-sm text-ink">
                {addendum.representative_captured_at && addendum.representative_name_snapshot ? (
                  <>
                    <span className="font-medium">{addendum.representative_name_snapshot}</span>
                    <span className="block text-xs text-muted-foreground">
                      {addendum.representative_position_snapshot || "—"}
                    </span>
                  </>
                ) : (
                  <span className="italic text-muted-foreground">
                    Se registra al formalizar (no cambia después: snapshot histórico).
                  </span>
                )}
              </dd>
            </div>
            {(totalBefore !== null || totalAfter !== null) && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Total contractual</dt>
                <dd className="text-sm text-ink">
                  {formatContractMoney(totalBefore, currency)} →{" "}
                  <span className="font-semibold text-sitecorp-primary">
                    {formatContractMoney(totalAfter, currency)}
                  </span>
                </dd>
              </div>
            )}
            {addendum.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Observaciones</dt>
                <dd className="text-sm text-ink">{addendum.notes}</dd>
              </div>
            )}
          </dl>

          <AddendumChangesList
            changes={addendum.changes}
            title="Condiciones anteriores y nuevas"
            description="Sólo se muestran los campos que cambian con este anexo."
          />

          {/* Fase 11B.2: documento del anexo (§63) */}
          {addendum.status === "FORMALIZED" && (
            <ContractualDocumentSection
              kind="ADDENDUM"
              sourceId={addendum.id}
              canManage={canManage}
              className="mt-4"
            />
          )}

          {/* Formalización */}
          {isPending && canManage && (
            <div className="space-y-4 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <FileSignature className="h-4 w-4 text-sitecorp-primary" />
                <p className="text-sm font-semibold text-ink">Formalizar anexo</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Complete únicamente los datos que faltan para la firma. Las condiciones del cambio ya
                están registradas y no se vuelven a capturar.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="addendum-signature-date">Fecha de firma *</Label>
                  <SiteCorpInput
                    id="addendum-signature-date"
                    type="date"
                    value={signatureDate}
                    onChange={(e) => setSignatureDate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Puede ser anterior a la fecha efectiva
                    {addendum.effective_date
                      ? ` (${formatConditionDate(addendum.effective_date)})`
                      : ""}
                    .
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addendum-signature-place">Lugar de firma *</Label>
                  <SiteCorpInput
                    id="addendum-signature-place"
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
                dateHint: `Representante vigente en la fecha de firma${
                  signatureDate ? ` (${formatConditionDate(signatureDate)})` : ""
                }.`,
              })}

              {/* Checklist del anexo pendiente (§79) */}
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Checklist del anexo
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {checklist.done.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-ink">
                      <CheckCircle2 className="h-4 w-4 text-sitecorp-success" />
                      {item}
                    </li>
                  ))}
                  {checklist.missing.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-muted-foreground">
                      <XCircle className="h-4 w-4 text-sitecorp-warning" />
                      {item}
                    </li>
                  ))}
                </ul>
                {(pending?.warnings || []).length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    {(pending?.warnings || []).map((warning) => (
                      <li key={warning} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sitecorp-warning" />
                        Aviso: {warning}
                      </li>
                    ))}
                  </ul>
                )}
                {remoteBlocking.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Los datos pendientes marcados provienen de la configuración contractual de la
                    entidad o de la persona: no se completan en este formulario.
                  </p>
                )}
              </div>
            </div>
          )}

          {status === "FORMALIZED" && (
            <SiteCorpAlert type="success" title="Anexo formalizado">
              Sus condiciones forman parte del histórico contractual del trabajador. El documento
              Word del anexo se genera automáticamente desde el motor documental.
            </SiteCorpAlert>
          )}

          {status === "CANCELLED" && (
            <SiteCorpAlert type="info" title="Anexo cancelado">
              Se conserva la auditoría
              {addendum.cancelled_at
                ? ` (${new Date(addendum.cancelled_at).toLocaleString("es-CU")})`
                : ""}
              . La cancelación no revierte el movimiento laboral realizado.
            </SiteCorpAlert>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
            <div>
              {isPending && canManage && (
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmCancelOpen(true)}
                  disabled={cancelling}
                  className="border-sitecorp-danger/40 text-sitecorp-danger hover:bg-sitecorp-danger/5"
                >
                  <XCircle className="mr-2 h-4 w-4" /> Cancelar anexo pendiente
                </SiteCorpButton>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <SiteCorpButton variant="outline" type="button" onClick={() => onOpenChange(false)}>
                Cerrar
              </SiteCorpButton>
              {isPending && canManage && (
                <SiteCorpButton
                  type="button"
                  onClick={handleFormalize}
                  disabled={!canFormalize}
                  title={
                    checklist.missing.length > 0
                      ? `Datos pendientes: ${checklist.missing.join(" · ")}`
                      : undefined
                  }
                >
                  {processStage ? processStage : submitting ? "Formalizando…" : "Formalizar anexo"}
                </SiteCorpButton>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación de cancelación (§81) */}
      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cancelar anexo pendiente</DialogTitle>
            <DialogDescription>
              El anexo quedará como cancelado y se conservará su auditoría.
            </DialogDescription>
          </DialogHeader>
          <SiteCorpAlert type="warning" title="Atención">
            Cancelar el anexo no revierte el cambio laboral realizado. Si el cambio ya se ejecutó,
            seguirá vigente en la asignación y en el salario actual.
          </SiteCorpAlert>
          <div className="flex justify-end gap-2">
            <SiteCorpButton
              variant="outline"
              type="button"
              onClick={() => setConfirmCancelOpen(false)}
            >
              Volver
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              onClick={handleCancelAddendum}
              disabled={cancelling}
              className="bg-sitecorp-danger hover:bg-sitecorp-danger/90"
            >
              {cancelling ? "Cancelando…" : "Cancelar anexo"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AddendumDetailDialog
