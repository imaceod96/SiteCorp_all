import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Label } from "@/shared/components/ui/label"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { showSuccess, showError } from "@/utils/toast"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
import {
  loadSeparationReasons,
  registerWorkerSeparation,
  validateSeparationInput,
  type SeparationReason,
} from "@/modules/people"
import { formatSalary } from "@/modules/organization-structure"
import type { SeparateWorkerDialogProps } from "@/shared/components/worker-action-contracts"
import { AlertTriangle, UserMinus } from "lucide-react"

// Las props del flujo son un contrato compartido con la página de vencimientos
// contractuales (módulo Contratos): viven en la capa compartida para que Contratos no
// dependa de la presentación de Personas.

const groupLabel = (sequence: number | null | undefined) =>
  sequence == null ? "—" : `Grupo ${toRomanNumeral(sequence)}`

const SeparateWorkerDialog: React.FC<SeparateWorkerDialogProps> = ({
  open,
  onOpenChange,
  workerId,
  current,
  onSuccess,
}) => {
  const [reasons, setReasons] = React.useState<SeparationReason[]>([])
  const [loading, setLoading] = React.useState(false)
  const [effectiveDate, setEffectiveDate] = React.useState("")
  const [reasonId, setReasonId] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!open) return
    setEffectiveDate("")
    setReasonId("")
    setNotes("")
    setError(null)
    setLoading(true)
    loadSeparationReasons()
      .then((data) => setReasons(data))
      .catch((err) => {
        console.error("Error loading separation reasons:", err)
        setError("No se pudieron cargar los motivos de baja.")
      })
      .finally(() => setLoading(false))
  }, [open])

  const handleSubmit = async () => {
    setError(null)

    // Regla del dominio: fecha efectiva, motivo y no anterior al inicio del puesto actual.
    const invalid = validateSeparationInput({
      effectiveDate,
      currentPositionStartDate: current.startDate,
      separationReasonId: reasonId,
    })
    if (invalid) {
      setError(invalid)
      return
    }

    setSubmitting(true)
    try {
      // Caso de uso: registra la baja (pasa a Reingresos) y su movimiento de nómina.
      await registerWorkerSeparation({
        workerId,
        effectiveDate,
        separationReasonId: reasonId,
        notes,
      })

      // La baja cierra el contrato vigente: recalcular alertas de vencimiento.
      invalidateContractAlertData(queryClient)
      showSuccess("Baja registrada correctamente.")
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      let friendly = "No se pudo registrar la baja."
      if (/no est[aá] activo/i.test(msg)) {
        friendly = "El trabajador ya no está activo."
      } else if (/anterior al inicio/i.test(msg)) {
        friendly = "La fecha de baja no puede ser anterior al inicio del puesto actual."
      } else if (/motivo/i.test(msg)) {
        friendly = "Selecciona un motivo de baja válido."
      } else if (/no tiene un puesto actual/i.test(msg)) {
        friendly = "El trabajador no tiene un puesto actual asignado."
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Dar de baja</DialogTitle>
          <DialogDescription>
            Se cerrará el puesto actual y el trabajador quedará inactivo. Su historial
            laboral, contratos y documentos se conservan.
          </DialogDescription>
        </DialogHeader>

        <SiteCorpAlert type="warning">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Esta acción libera la plaza ocupada. El trabajador no se elimina y podrá
            reincorporarse más adelante.
          </span>
        </SiteCorpAlert>

        {/* Situación actual */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Situación actual
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Área</dt>
              <dd className="text-sm font-medium text-ink">{current.areaName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cargo</dt>
              <dd className="text-sm font-medium text-ink">{current.jobName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Puesto</dt>
              <dd className="text-sm font-medium text-ink">{current.positionName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
              <dd className="text-sm font-medium text-ink">{groupLabel(current.groupSequence)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Salario de referencia</dt>
              <dd className="text-sm font-medium text-ink">
                {current.salary ? formatSalary(current.salary) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Inicio del puesto actual</dt>
              <dd className="text-sm font-medium text-ink">{current.startDate || "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Fecha efectiva de baja *</Label>
            <SiteCorpInput
              type="date"
              value={effectiveDate}
              min={current.startDate || undefined}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Último día trabajado. El puesto actual se cierra en esta fecha.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Motivo de baja *</Label>
            <SiteCorpSelect value={reasonId} onValueChange={setReasonId}>
              <option value="">{loading ? "Cargando motivos…" : "Seleccionar motivo"}</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </SiteCorpSelect>
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

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <SiteCorpButton variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </SiteCorpButton>
          <SiteCorpButton
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loading}
          >
            <UserMinus className="mr-2 h-4 w-4" />
            {submitting ? "Procesando…" : "Confirmar baja"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SeparateWorkerDialog
