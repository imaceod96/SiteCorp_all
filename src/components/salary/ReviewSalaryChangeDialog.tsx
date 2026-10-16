import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { showSuccess } from "@/utils/toast"
import { ensureEventDocumentation } from "@/domains/document-generation"
import {
  applySalaryChange,
  fetchSalaryChangeImpact,
  finalizeSalaryChangeEvent,
  previewSalaryChange,
  type SalaryChangeApplyResult,
  type SalaryChangeImpactRow,
  type SalaryChangePreview,
} from "@/modules/contracts"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  Loader2,
  Users,
} from "lucide-react"

interface ReviewSalaryChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string | null
  groupLabel: string
  scaleLabel: string
  onApplied: (result: SalaryChangeApplyResult) => void | Promise<void>
}

const todayIso = () => new Date().toISOString().split("T")[0]

const money = (amount: number | null | undefined, currency: string | null | undefined) =>
  amount === null || amount === undefined
    ? "—"
    : `${amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} ${currency || ""}`.trim()

const ReviewSalaryChangeDialog: React.FC<ReviewSalaryChangeDialogProps> = ({
  open,
  onOpenChange,
  groupId,
  groupLabel,
  scaleLabel,
  onApplied,
}) => {
  const [newAmount, setNewAmount] = React.useState("")
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayIso())
  const [notes, setNotes] = React.useState("")
  const [preview, setPreview] = React.useState<SalaryChangePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [impactOpen, setImpactOpen] = React.useState(false)
  const [impactRows, setImpactRows] = React.useState<SalaryChangeImpactRow[]>([])
  const [impactLoading, setImpactLoading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setNewAmount("")
    setEffectiveFrom(todayIso())
    setNotes("")
    setPreview(null)
    setPreviewError(null)
    setImpactOpen(false)
    setImpactRows([])
    setError(null)
  }, [open, groupId])

  const parsedAmount = Number.parseFloat(newAmount.replace(",", "."))
  const hasValidAmount = !Number.isNaN(parsedAmount) && parsedAmount > 0 && !!effectiveFrom

  // Previsualización del impacto (no aplica nada)
  React.useEffect(() => {
    if (!open || !groupId || !hasValidAmount) {
      setPreview(null)
      setPreviewError(null)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await previewSalaryChange(groupId, parsedAmount, effectiveFrom)
        if (!cancelled) {
          setPreview(data)
          setPreviewError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(
            err instanceof Error ? err.message : "No se pudo calcular el impacto del cambio"
          )
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, groupId, parsedAmount, effectiveFrom, hasValidAmount])

  const loadImpact = async () => {
    if (!groupId || !hasValidAmount) return
    setImpactOpen(true)
    setImpactLoading(true)
    try {
      setImpactRows(await fetchSalaryChangeImpact(groupId, parsedAmount, effectiveFrom))
    } catch (err) {
      setImpactRows([])
      setError(
        err instanceof Error ? err.message : "No se pudo obtener el listado de trabajadores"
      )
    } finally {
      setImpactLoading(false)
    }
  }

  const currency = preview?.currency_code || "CUP"
  const previousAmount = preview?.previous_amount ?? null
  const sameAmount = previousAmount !== null && previousAmount === parsedAmount
  const conflictingValue =
    !!preview?.value_exists_on_date && preview.existing_amount_on_date !== parsedAmount
  const changeIsEmpty = previousAmount === null ? false : sameAmount
  const canSubmit =
    !!groupId && hasValidAmount && !submitting && !conflictingValue && !changeIsEmpty && !previewError

  const handleSubmit = async () => {
    if (!groupId || !canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      // Captura de los afectados ANTES de aplicar (salario anterior real por trabajador).
      const impact = await fetchSalaryChangeImpact(groupId, parsedAmount, effectiveFrom).catch(
        () => [] as SalaryChangeImpactRow[]
      )

      const result = await applySalaryChange(
        groupId,
        parsedAmount,
        preview?.currency_code || null,
        effectiveFrom,
        notes
      )

      // Evento documental masivo: Movimientos de Nómina (Reubicación) + lotes ZIP.
      if (result.status === "APPLIED" && impact.length > 0) {
        try {
          const event = await finalizeSalaryChangeEvent(
            groupId,
            effectiveFrom,
            `Cambio salarial · ${scaleLabel} · Grupo ${groupLabel}`,
            impact.map((row) => ({
              worker_id: row.worker_id,
              previous_amount: row.previous_amount,
            }))
          )

          // Cierre documental automático (§75): genera los movimientos individuales,
          // reconstruye lotes y empaqueta los ZIP de los lotes que superan 5 documentos.
          try {
            const docs = await ensureEventDocumentation(event.event_id)
            if (docs.generated > 0 || docs.zipsCreated > 0) {
              showSuccess(
                `Documentación del evento: ${docs.generated} movimiento(s) generado(s)` +
                  (docs.zipsCreated > 0 ? ` y ${docs.zipsCreated} ZIP listo(s) para descarga.` : ".")
              )
            }
          } catch (docsError) {
            console.error("No se pudo cerrar la documentación del evento salarial", docsError)
          }
        } catch (eventError) {
          // El cambio salarial YA se aplicó: el fallo de documentación no debe revertirlo.
          console.error("No se pudo materializar el evento documental del cambio salarial", eventError)
        }
      }

      if (result.status === "UNCHANGED") {
        showSuccess("El importe ya estaba registrado con esa fecha de vigencia.")
      } else if (result.workers_affected === 0) {
        showSuccess(
          "Importe salarial actualizado. No hubo trabajadores afectados, por lo que no se generaron anexos."
        )
      } else {
        showSuccess(
          `Cambio salarial aplicado: ${result.workers_affected} trabajador(es), ${result.salary_history_created} registro(s) histórico(s) y ${result.addendums_created} anexo(s) pendiente(s) de generar.`
        )
      }

      onOpenChange(false)
      await onApplied(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el cambio salarial")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Revisar cambio salarial</DialogTitle>
          <DialogDescription>
            Se creará una nueva vigencia del importe sin destruir los valores anteriores. Los
            trabajadores afectados conservarán su contrato vigente.
          </DialogDescription>
        </DialogHeader>

        {/* Grupo y escala */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Grupo y escala
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
              <dd className="text-sm font-medium text-ink">{groupLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Escala</dt>
              <dd className="text-sm font-medium text-ink">{scaleLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Importe vigente anterior</dt>
              <dd className="text-sm font-medium text-ink">
                {previousAmount === null ? (
                  <span className="italic text-muted-foreground">Sin importe vigente</span>
                ) : (
                  <>
                    {money(previousAmount, currency)}
                    {preview?.previous_effective_from && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        desde {preview.previous_effective_from}
                      </span>
                    )}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nuevo importe</dt>
              <dd className="text-sm font-medium text-ink">
                {hasValidAmount ? money(parsedAmount, currency) : "—"}
              </dd>
            </div>
            {preview && preview.difference !== null && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">Diferencia</dt>
                  <dd
                    className={cn(
                      "flex items-center gap-1 text-sm font-medium",
                      preview.is_decrease ? "text-sitecorp-danger" : "text-sitecorp-success"
                    )}
                  >
                    {preview.is_decrease ? (
                      <ArrowDownRight className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                    {money(Math.abs(preview.difference), currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Variación</dt>
                  <dd className="text-sm font-medium text-ink">
                    {preview.variation_pct === null
                      ? "—"
                      : `${preview.variation_pct > 0 ? "+" : ""}${preview.variation_pct}%`}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>

        {/* Nuevo importe y fecha efectiva */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Nuevo importe *</Label>
            <SiteCorpInput
              type="number"
              min="0"
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Fecha efectiva *</Label>
            <SiteCorpInput
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
        </div>

        {preview?.is_retroactive && (
          <SiteCorpAlert type="warning">
            <span className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              La fecha efectiva es anterior a hoy. El cambio se registrará con esa fecha y no se
              calculan atrasos salariales en esta fase.
            </span>
          </SiteCorpAlert>
        )}

        {preview?.is_future && (
          <SiteCorpAlert type="info">
            <span className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              El nuevo importe entrará en vigor el {preview.new_effective_date}. Hasta esa fecha el
              salario vigente seguirá siendo el anterior.
            </span>
          </SiteCorpAlert>
        )}

        {preview?.is_decrease && (
          <SiteCorpAlert type="warning">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Disminución salarial: el nuevo importe es inferior al vigente.
            </span>
          </SiteCorpAlert>
        )}

        {previewError && <SiteCorpAlert type="danger">{previewError}</SiteCorpAlert>}

        {conflictingValue && (
          <SiteCorpAlert type="danger">
            Ya existe un importe registrado para este grupo con la fecha de vigencia{" "}
            {preview?.new_effective_date}. Seleccione otra fecha efectiva.
          </SiteCorpAlert>
        )}

        {!conflictingValue && changeIsEmpty && (
          <SiteCorpAlert type="info">
            El nuevo importe coincide con el vigente: no hay cambio salarial que registrar.
          </SiteCorpAlert>
        )}

        {/* Trabajadores afectados */}
        {preview && !conflictingValue && (
          <div className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-ink">
                  Trabajadores afectados:{" "}
                  <span className="font-semibold">{preview.workers_affected}</span>
                </span>
                {previewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              {preview.workers_affected > 0 && (
                <SiteCorpButton variant="outline" size="sm" type="button" onClick={loadImpact}>
                  {impactOpen ? "Actualizar listado" : "Ver trabajadores afectados"}
                </SiteCorpButton>
              )}
            </div>

            {previousAmount === null && (
              <p className="mt-2 text-xs text-muted-foreground">
                El grupo no tiene un importe vigente anterior: se registrará como valor inicial y no
                se generarán anexos salariales.
              </p>
            )}

            {impactOpen && (
              <div className="mt-3 border-t border-border pt-3">
                {impactLoading ? (
                  <p className="text-sm text-muted-foreground">Cargando trabajadores…</p>
                ) : impactRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Ningún trabajador activo resulta afectado por este cambio.
                  </p>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {impactRows.map((row) => (
                      <div
                        key={row.worker_id}
                        className="rounded-lg border border-border bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-medium text-ink">{row.worker_name}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {row.worker_code}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            CI: {row.identification}
                          </span>
                          <span className="ml-auto text-sm text-ink">
                            {money(row.previous_amount, row.currency_code)} →{" "}
                            <span className="font-medium">
                              {money(preview.new_amount, row.currency_code)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>Área: {row.area_name || "—"}</span>
                          <span>Cargo: {row.job_name || "—"}</span>
                          <span>Puesto: {row.position_name || "—"}</span>
                          <span>
                            Grupo: {row.group_sequence_number ?? "—"}
                          </span>
                          <span>
                            Contrato vigente:{" "}
                            {row.contract_type_name
                              ? `${row.contract_type_name} (${row.contract_start_date})`
                              : "Sin contrato vigente"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label>Observaciones (opcional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
            placeholder="Motivo o referencia del cambio salarial"
          />
        </div>

        {/* Confirmación explícita */}
        <div className="rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-4">
          <p className="flex items-start gap-2 text-sm text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-primary" />
            <span>
              Este cambio afectará a{" "}
              <span className="font-semibold">{preview?.workers_affected ?? 0}</span> trabajador(es).
              Se registrará un cambio salarial en sus expedientes y se preparará un anexo
              contractual <span className="font-medium">pendiente de generar</span> para cada
              trabajador afectado. El contrato vigente no se cierra ni se sustituye.
            </span>
          </p>
        </div>

        {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <SiteCorpButton variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </SiteCorpButton>
          <SiteCorpButton type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            {submitting ? "Aplicando…" : "Confirmar cambio salarial"}
          </SiteCorpButton>
        </div>

        {preview?.value_exists_on_date &&
          preview.existing_amount_on_date === parsedAmount &&
          !conflictingValue && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SiteCorpStatusBadge status="info">
                Ya registrado con esa fecha
              </SiteCorpStatusBadge>
              Aplicar de nuevo no duplicará históricos ni anexos.
            </p>
          )}
      </DialogContent>
    </Dialog>
  )
}

export default ReviewSalaryChangeDialog
