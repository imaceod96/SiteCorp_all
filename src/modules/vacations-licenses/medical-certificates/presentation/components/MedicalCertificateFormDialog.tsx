/**
 * FASE 19 — Diálogo compartido de registro de certificado médico.
 *
 * Un único formulario para los DOS contextos (§42):
 *   · Página global de la entidad → selector de trabajador obligatorio.
 *   · Pestaña del expediente (WorkerDetail) → trabajador preseleccionado/bloqueado.
 * La escritura se realiza SIEMPRE por RPC SECURITY DEFINER con validación backend.
 */

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
import {
  computeMedicalCertificateDays,
  createMedicalCertificate,
  fetchWorkerEmploymentWindow,
  validateMedicalCertificateInput,
  type WorkerEmploymentWindow,
} from "@/modules/vacations-licenses/medical-certificates"
import { loadEntityActiveWorkerOptions, type EntityWorkerOption } from "@/modules/people"
import { invalidateMedicalCertificateData } from "../hooks/use-medical-certificates"
import { Loader2, X } from "lucide-react"

interface MedicalCertificateFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  /** Trabajador fijo (contexto WorkerDetail). Null = selector de trabajador (contexto global). */
  workerId?: string | null
  onSuccess?: () => void
}

const ALLOWED_EXTENSIONS = ".pdf,.doc,.docx,.jpg,.jpeg,.png"
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MedicalCertificateFormDialog({
  open,
  onOpenChange,
  entityId,
  workerId = null,
  onSuccess,
}: MedicalCertificateFormDialogProps) {
  const queryClient = useQueryClient()
  const isFixedWorker = !!workerId

  const [selectedWorkerId, setSelectedWorkerId] = React.useState<string>(workerId || "")
  const [startDate, setStartDate] = React.useState("")
  const [returnDate, setReturnDate] = React.useState("")
  const [days, setDays] = React.useState("")
  const [document, setDocument] = React.useState<File | null>(null)
  const [employmentWindow, setEmploymentWindow] =
    React.useState<WorkerEmploymentWindow | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // Contexto global: trabajadores activos de la entidad (RLS gobierna el acceso).
  const [workers, setWorkers] = React.useState<EntityWorkerOption[]>([])
  const [workersLoading, setWorkersLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSelectedWorkerId(workerId || "")
    setStartDate("")
    setReturnDate("")
    setDays("")
    setDocument(null)
    setEmploymentWindow(null)
    setFormError(null)
  }, [open, workerId])

  React.useEffect(() => {
    if (!open || isFixedWorker) return
    let cancelled = false
    const loadWorkers = async () => {
      setWorkersLoading(true)
      try {
        const options = await loadEntityActiveWorkerOptions(entityId)
        if (!cancelled) setWorkers(options)
      } catch (err) {
        console.error("Error loading entity workers:", err)
        if (!cancelled) setWorkers([])
      } finally {
        if (!cancelled) setWorkersLoading(false)
      }
    }
    loadWorkers()
    return () => {
      cancelled = true
    }
  }, [open, isFixedWorker, entityId])

  React.useEffect(() => {
    if (!open || !selectedWorkerId) {
      setEmploymentWindow(null)
      return
    }
    let cancelled = false
    fetchWorkerEmploymentWindow(selectedWorkerId)
      .then((win) => {
        if (!cancelled) setEmploymentWindow(win)
      })
      .catch(() => {
        if (!cancelled) setEmploymentWindow(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedWorkerId])

  React.useEffect(() => {
    const computed = computeMedicalCertificateDays(startDate, returnDate)
    setDays(computed !== null ? String(computed) : "")
  }, [startDate, returnDate])

  const earliestHireDate = React.useMemo(() => {
    if (!employmentWindow) return undefined
    if (employmentWindow.periods.length > 0) {
      return [...employmentWindow.periods.map((p) => p.hire_date)].sort()[0]
    }
    return employmentWindow.fallbackHireDate ?? undefined
  }, [employmentWindow])

  const validate = (): string | null => {
    if (!selectedWorkerId) return "Selecciona el trabajador."
    const parsedDays = parseInt(days, 10)
    const domainError = validateMedicalCertificateInput({
      startDate,
      returnDate,
      days: Number.isNaN(parsedDays) ? 0 : parsedDays,
      employment: employmentWindow,
    })
    if (domainError) return domainError
    if (!document) return "Debes adjuntar el certificado médico."
    if (document.size > MAX_FILE_SIZE) return "El archivo no puede superar los 10 MB."
    return null
  }

  const handleSubmit = async () => {
    setFormError(null)

    const validationError = validate()
    if (validationError) {
      setFormError(validationError)
      return
    }

    setSubmitting(true)
    try {
      await createMedicalCertificate({
        worker_id: selectedWorkerId,
        start_date: startDate,
        return_date: returnDate,
        days: parseInt(days, 10),
        document,
      })

      invalidateMedicalCertificateData(queryClient)
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al registrar el certificado."
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Registrar certificado médico</DialogTitle>
          <DialogDescription>
            Completa los datos del certificado y adjunta el documento justificativo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

          {!isFixedWorker && (
            <div className="space-y-2">
              <Label>Trabajador *</Label>
              <SiteCorpSelect
                value={selectedWorkerId}
                onValueChange={(v) => {
                  setSelectedWorkerId(v)
                  if (formError) setFormError(null)
                }}
                disabled={workersLoading}
              >
                <option value="">
                  {workersLoading ? "Cargando trabajadores..." : "Seleccionar trabajador"}
                </option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name} — {w.identification}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="mc-start-date">Fecha de salida *</Label>
            <SiteCorpInput
              id="mc-start-date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (formError) setFormError(null)
              }}
              min={earliestHireDate}
              max={returnDate || undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mc-return-date">Fecha de reincorporación *</Label>
            <SiteCorpInput
              id="mc-return-date"
              type="date"
              value={returnDate}
              onChange={(e) => {
                setReturnDate(e.target.value)
                if (formError) setFormError(null)
              }}
              min={startDate || earliestHireDate || undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mc-days">Cantidad de días *</Label>
            <SiteCorpInput
              id="mc-days"
              type="number"
              min="1"
              value={days}
              readOnly
              className="bg-muted/40"
              placeholder="Calculado automáticamente"
            />
            <p className="text-xs text-muted-foreground">
              Se calcula automáticamente entre la fecha de salida y la fecha de reincorporación.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mc-document">Certificado *</Label>
            <div className="flex items-center gap-2">
              <SiteCorpInput
                id="mc-document"
                type="file"
                accept={ALLOWED_EXTENSIONS}
                onChange={(e) => {
                  setDocument(e.target.files?.[0] ?? null)
                  if (formError) setFormError(null)
                }}
                className="flex-1"
              />
              {document && (
                <button
                  type="button"
                  onClick={() => {
                    setDocument(null)
                    if (formError) setFormError(null)
                  }}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-ink"
                  aria-label="Eliminar archivo seleccionado"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {document && (
              <p className="text-xs text-muted-foreground">
                {document.name} ({formatFileSize(document.size)})
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Formatos: PDF, DOC, DOCX, JPG, JPEG, PNG. Máx. 10 MB.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <SiteCorpButton variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </SiteCorpButton>
          <SiteCorpButton onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar certificado
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
