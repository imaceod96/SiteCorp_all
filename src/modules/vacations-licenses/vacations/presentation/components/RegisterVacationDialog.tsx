import * as React from "react"
import { useState, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/shared/hooks/use-toast"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  previewVacationConsumption,
  registerWorkerVacation,
  formatVacationDays,
} from "@/modules/vacations-licenses/vacations"
import { invalidateVacationData } from "../hooks/use-vacations"
import { CalendarCheck2 } from "lucide-react"

interface VacationWorkerOption {
  id: string
  full_name: string
  balance: number
}

interface RegisterVacationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  workers: VacationWorkerOption[]
  /** Contexto WorkerDetail: trabajador fijo (no se muestra selector). */
  preselectedWorkerId?: string | null
  preselectedWorkerName?: string | null
  preselectedBalance?: number | null
  onSuccess?: () => void
}

const formSchema = z.object({
  workerId: z.string().nonempty("El trabajador es obligatorio"),
  startDate: z.string().nonempty("La fecha de inicio es obligatoria"),
  endDate: z.string().nonempty("La fecha final es obligatoria"),
  notes: z.string().optional(),
})

/**
 * FASE 18 — Diálogo modal de registro de vacaciones.
 *
 * Un único formulario para los DOS contextos:
 *   · Pestaña del trabajador (WorkerDetail) → trabajador preseleccionado/fijo.
 *   · Página global de la entidad → selector de trabajador.
 * La escritura es SIEMPRE el RPC transaccional `register_worker_vacation`
 * (período + movimiento del ledger en una transacción, con idempotencia por
 * request_id, control de solapamiento, máximo 15 días naturales, domingos sin
 * consumo y validación de saldo en el backend).
 */
export const RegisterVacationDialog = ({
  open,
  onOpenChange,
  entityId,
  workers,
  preselectedWorkerId,
  preselectedWorkerName,
  preselectedBalance,
  onSuccess,
}: RegisterVacationDialogProps) => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [requestId] = useState(() => crypto.randomUUID())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFixedWorker = !!preselectedWorkerId && workers.length <= 1

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workerId: preselectedWorkerId || "",
      startDate: "",
      endDate: "",
      notes: "",
    },
  })

  const workerId = form.watch("workerId")
  const startDate = form.watch("startDate")
  const endDate = form.watch("endDate")

  const [preview, setPreview] = useState<{
    naturalDays: number
    sundays: number
    chargedDays: number
    valid: boolean
  } | null>(null)

  // Reset del formulario al (re)abrir: nuevo request_id de idempotencia y campos limpios.
  useEffect(() => {
    if (!open) return
    form.reset({
      workerId: preselectedWorkerId || "",
      startDate: "",
      endDate: "",
      notes: "",
    })
    setPreview(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedWorkerId])

  useEffect(() => {
    if (startDate && endDate) {
      setPreview(previewVacationConsumption(startDate, endDate))
    } else {
      setPreview(null)
    }
  }, [startDate, endDate])

  const selectedWorker = workers.find((w) => w.id === workerId)
  const workerBalance = selectedWorker?.balance ?? preselectedBalance ?? 0
  const chargedDays = preview?.chargedDays ?? 0
  const balanceOk = chargedDays <= workerBalance
  const periodValid = preview?.valid ?? false
  const canSubmit = !!workerId && periodValid && balanceOk && !submitting

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setError(null)
    setSubmitting(true)

    try {
      const result = await registerWorkerVacation({
        workerId: data.workerId,
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes ?? null,
        requestId,
      })

      // Invalida TODAS las queries de vacaciones (saldo, histórico, overview, KPIs).
      invalidateVacationData(queryClient)

      toast({
        title: "Vacaciones registradas",
        description: `Se registraron ${result.charged_days} días consumidos. Saldo actual: ${formatVacationDays(result.balance)}.`,
      })

      setSubmitting(false)
      onOpenChange(false)
      if (onSuccess) onSuccess()
    } catch (e) {
      setError(e.message || "Error desconocido al registrar vacaciones")
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {isFixedWorker && preselectedWorkerName
              ? `Registrar vacaciones — ${preselectedWorkerName}`
              : "Registrar vacaciones"}
          </DialogTitle>
          <DialogDescription>
            Período de 1 a 15 días naturales. Los domingos pertenecen al período pero no
            consumen saldo; la validación definitiva es del backend.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

          {/* Trabajador: fijo (contexto Worker) o selector (contexto global) */}
          {isFixedWorker ? (
            <div className="space-y-2">
              <Label>Trabajador</Label>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-ink">
                {preselectedWorkerName || selectedWorker?.full_name || "—"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Trabajador *</Label>
              <SiteCorpSelect
                value={workerId}
                onValueChange={(val) => form.setValue("workerId", val as string, { shouldValidate: true })}
              >
                <option value="">Seleccionar trabajador</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>
          )}

          {/* Saldo */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Disponible</p>
              <p className="text-lg font-semibold text-ink">{formatVacationDays(workerBalance)}</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">A consumir</p>
              <p className="text-lg font-semibold text-sitecorp-danger">
                {formatVacationDays(chargedDays)}
              </p>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vac-start-date">Fecha de inicio *</Label>
              <SiteCorpInput
                id="vac-start-date"
                type="date"
                {...form.register("startDate")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vac-end-date">Fecha final *</Label>
              <SiteCorpInput
                id="vac-end-date"
                type="date"
                {...form.register("endDate")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vac-notes">Observaciones (opcional)</Label>
            <SiteCorpInput id="vac-notes" {...form.register("notes")} />
          </div>

          {/* Previsualización de consumo */}
          {preview && (
            <SiteCorpAlert
              type={periodValid ? (balanceOk ? "success" : "warning") : "danger"}
              title={periodValid ? "Previsualización" : "Período inválido"}
            >
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Días naturales</p>
                  <p className="font-medium text-ink">{preview.naturalDays}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Domingos</p>
                  <p className="font-medium text-ink">{preview.sundays}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">A descontar</p>
                  <p className="font-medium text-ink">{formatVacationDays(preview.chargedDays)}</p>
                </div>
              </div>
              {!periodValid && (
                <p className="mt-2 text-sm text-sitecorp-danger">
                  El período debe tener entre 1 y 15 días naturales.
                </p>
              )}
              {periodValid && balanceOk && (
                <p className="mt-2 text-sm text-sitecorp-success">
                  Saldo suficiente: el trabajador dispone de {formatVacationDays(workerBalance)} días.
                </p>
              )}
              {periodValid && !balanceOk && (
                <p className="mt-2 text-sm text-sitecorp-danger">
                  Saldo insuficiente: dispone de {formatVacationDays(workerBalance)} días y el
                  período consumiría {formatVacationDays(preview.chargedDays)} días.
                </p>
              )}
            </SiteCorpAlert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton type="submit" disabled={!canSubmit}>
              {submitting ? "Guardando…" : "Guardar vacaciones"}
              {!submitting && <CalendarCheck2 className="ml-2 h-4 w-4" />}
            </SiteCorpButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default RegisterVacationDialog
