import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/components/ui/dialog"
import { Label } from "@/shared/components/ui/label"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Plus, Trash2 } from "lucide-react"
import { academicCategoryLabel } from "@/modules/organization-structure"
import {
  formatDateDMY,
  formatDecimalInput,
  formatHours,
  formatMinutesToHours,
  formatMoney,
  formatMoneyWithCurrency,
  formatTenureLabel,
  parseDecimalInput,
  parseIntegerInput,
} from "@/modules/payroll-preparation/domain/formatters"
import {
  computeClaPreview,
  computeEntryPreview,
  computeNightPreview,
  deletedNightIds,
  validateClaMinutes,
  validateNightInput,
  validateWorkedDays,
} from "@/modules/payroll-preparation/domain/rules"
import type {
  PrenominaClaConfig,
  PrenominaNightEntry,
  PrenominaWorkerEntry,
} from "@/modules/payroll-preparation/domain/entities"

interface NightRow {
  id: string | null
  start: string
  end: string
  nights: string
}

interface WorkerPrenominaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: PrenominaWorkerEntry | null
  nights: PrenominaNightEntry[]
  readOnly: boolean
  claConfig: PrenominaClaConfig | null
  onSave: (
    workedDays: number,
    nights: { id: string | null; start: string; end: string; nights: number }[],
    deletedNightIds: string[],
    cla: {
      applied: boolean
      dayUsed: boolean
      dayMinutes: number
      nightUsed: boolean
      night1Minutes: number
      night2Minutes: number
    }
  ) => Promise<void>
}

const defaultNight = (): NightRow => ({ id: null, start: "19:00", end: "07:00", nights: "1" })

const WorkerPrenominaDialog = ({
  open,
  onOpenChange,
  entry,
  nights,
  claConfig,
  readOnly,
  onSave,
}: WorkerPrenominaDialogProps) => {
  const [workedDays, setWorkedDays] = React.useState("0")
  const [rows, setRows] = React.useState<NightRow[]>([])
  const [originalIds, setOriginalIds] = React.useState<string[]>([])
  // CLA — Condiciones Laborales Anormales (captura por trabajador del período).
  // "Aplicar CLA" es mensual y por trabajador; las modalidades (used) se marcan
  // por separado según lo configurado en el Cargo.
  const [claApplied, setClaApplied] = React.useState(false)
  const [claDayUsed, setClaDayUsed] = React.useState(false)
  const [claNightUsed, setClaNightUsed] = React.useState(false)
  const [claDayMinutes, setClaDayMinutes] = React.useState("0")
  const [claNight1Minutes, setClaNight1Minutes] = React.useState("0")
  const [claNight2Minutes, setClaNight2Minutes] = React.useState("0")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !entry) return
    setWorkedDays(formatDecimalInput(entry.worked_days))
    setRows(
      nights.map((n) => ({
        id: n.id,
        start: (n.start_time || "").slice(0, 5),
        end: (n.end_time || "").slice(0, 5),
        nights: String(n.nights_worked),
      }))
    )
    setOriginalIds(nights.map((n) => n.id))
    setClaApplied(!!entry.cla_applied)
    setClaDayUsed(!!entry.cla_day_used)
    setClaNightUsed(!!entry.cla_night_used)
    setClaDayMinutes(String(entry.cla_day_minutes ?? 0))
    setClaNight1Minutes(String(entry.cla_night1_minutes ?? 0))
    setClaNight2Minutes(String(entry.cla_night2_minutes ?? 0))
    setError(null)
  }, [open, entry, nights])

  if (!entry) return null

  const currency = entry.salary_currency || "CUP"
  const workedDaysValue = parseDecimalInput(workedDays)

  const nightPreviews = rows.map((r) => computeNightPreview(r.start, r.end, parseIntegerInput(r.nights)))
  // CLA: modalidades configuradas en el Cargo + las que el usuario marcó (used).
  const claDayEnabled = !!claConfig?.day_enabled
  const claNightEnabled = !!claConfig?.night_enabled
  const claConfigured = !!claConfig?.applicable && (claDayEnabled || claNightEnabled)
  const claPreview = computeClaPreview({
    applied: claApplied,
    dayEnabled: claDayEnabled && claDayUsed,
    dayRate: claConfig?.day_rate ?? null,
    dayMinutes: parseIntegerInput(claDayMinutes),
    nightEnabled: claNightEnabled && claNightUsed,
    night1Rate: claConfig?.night1_rate ?? null,
    night1Minutes: parseIntegerInput(claNight1Minutes),
    night2Rate: claConfig?.night2_rate ?? null,
    night2Minutes: parseIntegerInput(claNight2Minutes),
  })
  const preview = computeEntryPreview(
    entry.salary_scale_amount,
    entry.tenure_base_amount,
    entry.workday_hours,
    workedDaysValue,
    nightPreviews,
    entry.academic_monthly_amount,
    claPreview
  )

  // Antigüedad: dato derivado, solo lectura (se corrige en la ficha / escala).
  const tenureMissingStart = entry.tenure_status === "NO_START_DATE"
  const tenureMissingBand = entry.tenure_status === "NO_BAND"

  // Categoría académica: concepto automático, nunca se escribe a mano.
  const academicMissingConfig = entry.academic_status !== "OK"

  const updateRow = (index: number, patch: Partial<NightRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const addRow = () => setRows((prev) => [...prev, defaultNight()])
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    setError(null)
    // Validaciones de dominio (mismos mensajes y mismo orden que antes).
    const daysError = validateWorkedDays(workedDaysValue)
    if (daysError) {
      setError(daysError)
      return
    }
    for (const row of rows) {
      const nightError = validateNightInput({
        id: row.id,
        start: row.start,
        end: row.end,
        nights: parseIntegerInput(row.nights),
      })
      if (nightError) {
        setError(nightError)
        return
      }
    }

    // CLA: minutos enteros >= 0 (no se aceptan negativos ni texto).
    let claDayMin = 0
    let claNight1Min = 0
    let claNight2Min = 0
    if (claApplied && claDayUsed && claDayEnabled) {
      const read = validateClaMinutes(claDayMinutes, "CLA diurno")
      if (read.error) {
        setError(read.error)
        return
      }
      claDayMin = read.minutes
    }
    if (claApplied && claNightUsed && claNightEnabled) {
      const read1 = validateClaMinutes(claNight1Minutes, "CLA nocturno (tramo 1)")
      if (read1.error) {
        setError(read1.error)
        return
      }
      claNight1Min = read1.minutes
      const read2 = validateClaMinutes(claNight2Minutes, "CLA nocturno (tramo 2)")
      if (read2.error) {
        setError(read2.error)
        return
      }
      claNight2Min = read2.minutes
    }

    // Registros nocturnos que el usuario eliminó (existían y ya no están).
    const removedNightIds = deletedNightIds(
      originalIds,
      rows.map((row) => ({ id: row.id }))
    )

    setSaving(true)
    try {
      await onSave(
        workedDaysValue,
        rows.map((r) => ({
          id: r.id,
          start: r.start,
          end: r.end,
          nights: parseIntegerInput(r.nights),
        })),
        removedNightIds,
        {
          applied: claApplied,
          dayUsed: claApplied && claDayUsed && claDayEnabled,
          dayMinutes: claDayMin,
          nightUsed: claApplied && claNightUsed && claNightEnabled,
          night1Minutes: claNight1Min,
          night2Minutes: claNight2Min,
        }
      )
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry.worker_name_snapshot}</DialogTitle>
          <DialogDescription>Detalle mensual de prenómina</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Datos base (snapshot) */}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Cargo: </span>
              <span className="font-medium text-ink">{entry.job_name_snapshot || "—"}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Puesto: </span>
              <span className="font-medium text-ink">{entry.position_name_snapshot || "—"}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Grupo escala: </span>
              <span className="font-medium text-ink">
                {entry.salary_group_sequence ?? "—"}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Salario escala: </span>
              <span className="font-medium text-ink">
                {entry.salary_scale_amount !== null
                  ? formatMoneyWithCurrency(entry.salary_scale_amount, currency)
                  : "Sin salario escala configurado"}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Horas jornada: </span>
              <span className="font-medium text-ink">
                {entry.workday_hours !== null ? `${formatHours(entry.workday_hours)} h` : "Sin configurar"}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Tarifa por hora: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.hourlyRate, currency)}
              </span>
            </div>
          </div>

          {/* Antigüedad (dato derivado, solo lectura) */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink">Antigüedad</h4>
              <span className="rounded-full bg-sitecorp-primary/10 px-2 py-0.5 text-[11px] font-medium text-sitecorp-primary">
                Solo lectura
              </span>
            </div>

            {tenureMissingStart ? (
              <SiteCorpAlert type="danger">
                Sin fecha de incorporación: no se puede calcular la antigüedad. Corrige la Fecha de
                incorporación en la ficha del trabajador.
              </SiteCorpAlert>
            ) : (
              <>
                {tenureMissingBand && (
                  <SiteCorpAlert type="warning">
                    Sin tramo de antigüedad configurado para la antigüedad calculada. Configura la
                    Escala de pago de antigüedad de la entidad.
                  </SiteCorpAlert>
                )}
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Fecha de incorporación: </span>
                    <span className="font-medium text-ink">
                      {formatDateDMY(entry.employment_start_date_snapshot)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Antigüedad al cierre del período: </span>
                    <span className="font-medium text-ink">
                      {formatTenureLabel(entry.tenure_years, entry.tenure_months)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tramo aplicado: </span>
                    <span className="font-medium text-ink">{entry.tenure_band_label || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Importe del tramo: </span>
                    <span className="font-medium text-ink">
                      {entry.tenure_base_amount !== null
                        ? formatMoneyWithCurrency(entry.tenure_base_amount, currency)
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tarifa antigüedad/hora: </span>
                    <span className="font-medium text-ink">
                      {formatMoneyWithCurrency(preview.tenureHourlyRate, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Horas trabajadas: </span>
                    <span className="font-medium text-ink">{formatHours(preview.workedHours)} h</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Pago por antigüedad: </span>
                    <span className="font-semibold text-ink">
                      {formatMoneyWithCurrency(preview.tenurePayment, currency)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Evaluada al último día del mes del período. Para corregirla, edita la Fecha de
                  incorporación o la Escala de antigüedad en su módulo.
                </p>
              </>
            )}
          </div>

          {/* Categoría académica (concepto automático, solo lectura) */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink">Pago categoría académica</h4>
              <span className="rounded-full bg-sitecorp-primary/10 px-2 py-0.5 text-[11px] font-medium text-sitecorp-primary">
                Automático
              </span>
            </div>

            {academicMissingConfig ? (
              <SiteCorpAlert type="danger">
                Máster/Doctor sin importe configurado. Configure el Pago por categoría académica de la
                entidad; la prenómina no podrá cerrarse hasta resolverlo.
              </SiteCorpAlert>
            ) : entry.academic_category === null ? (
              <p className="text-sm text-muted-foreground">
                Sin categoría académica (ni Máster ni Doctor): no genera pago.
              </p>
            ) : (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Categoría aplicada: </span>
                  <span className="font-medium text-ink">
                    {academicCategoryLabel(entry.academic_category)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Importe mensual: </span>
                  <span className="font-medium text-ink">
                    {entry.academic_monthly_amount !== null
                      ? formatMoneyWithCurrency(entry.academic_monthly_amount, currency)
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tarifa por hora: </span>
                  <span className="font-medium text-ink">
                    {formatMoneyWithCurrency(preview.academicHourlyRate, currency)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pago del período: </span>
                  <span className="font-semibold text-ink">
                    {formatMoneyWithCurrency(preview.academicPayment, currency)}
                  </span>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Se resuelve automáticamente: importe mensual ÷ 190,6 × horas trabajadas. Si el
              trabajador tiene Máster y Doctor, prevalece el importe de Doctor.
            </p>
          </div>

          {/* Días trabajados */}
          <div className="space-y-2">
            <Label htmlFor="prenomina-worked-days">Días trabajados</Label>
            <input
              id="prenomina-worked-days"
              type="text"
              inputMode="decimal"
              value={workedDays}
              onChange={(e) => setWorkedDays(e.target.value)}
              disabled={readOnly}
              className="flex h-10 w-full max-w-xs rounded-xl border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ej.: 20,5"
            />
            <p className="text-xs text-muted-foreground">
              Acepta decimales con coma (20,5). No se prorratea por fecha de alta.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">Horas calculadas: </span>
              <span className="font-medium text-ink">{formatHours(preview.workedHours)} h</span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">Pago salario escala: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.scaleSalaryPayment, currency)}
              </span>
            </div>
          </div>

          {/* Nocturnidad */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-ink">Nocturnidad</h4>
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin registros de nocturnidad.</p>
            )}
            {rows.map((row, index) => {
              const np = nightPreviews[index]
              return (
                <div key={index} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Hora inicio</Label>
                      <input
                        type="time"
                        value={row.start}
                        onChange={(e) => updateRow(index, { start: e.target.value })}
                        disabled={readOnly}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Hora fin</Label>
                      <input
                        type="time"
                        value={row.end}
                        onChange={(e) => updateRow(index, { end: e.target.value })}
                        disabled={readOnly}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Noches trabajadas</Label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.nights}
                        onChange={(e) => updateRow(index, { nights: e.target.value })}
                        disabled={readOnly}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>
                      Tramo 19–23: {formatHours(np.hours19_23)} h · {formatMoney(np.payment19_23)}
                    </span>
                    <span>
                      Tramo 23–07: {formatHours(np.hours23_07)} h · {formatMoney(np.payment23_07)}
                    </span>
                    <span className="font-medium text-ink">
                      Total registro: {formatMoneyWithCurrency(np.totalPayment, currency)}
                    </span>
                  </div>
                  {!readOnly && (
                    <SiteCorpButton
                      type="button"
                      variant="outline"
                      onClick={() => removeRow(index)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Eliminar registro
                    </SiteCorpButton>
                  )}
                </div>
              )
            })}
            {!readOnly && (
              <SiteCorpButton type="button" variant="outline" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" /> Añadir horario nocturno
              </SiteCorpButton>
            )}
          </div>

          {/* CLA — Condiciones Laborales Anormales (independiente de la Nocturnidad) */}
          {(claConfigured || entry.cla_applied) && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <h4 className="text-sm font-semibold text-ink">
                Condiciones Laborales Anormales (CLA)
              </h4>

              {!claConfigured ? (
                <p className="text-sm text-muted-foreground">
                  El Cargo no tiene Condiciones Laborales Anormales configuradas.
                </p>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={claApplied}
                      disabled={readOnly}
                      onChange={(e) => setClaApplied(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-ink">Aplicar CLA</span>
                  </label>

                  {claApplied && (
                    <div className="space-y-4">
                      {claDayEnabled && (
                        <div className="space-y-2 rounded-xl border border-border p-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={claDayUsed}
                              disabled={readOnly}
                              onChange={(e) => setClaDayUsed(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium text-ink">Horario diurno</span>
                          </label>
                          {claDayUsed && (
                            <div className="space-y-1 pl-6">
                              <Label>Minutos trabajados</Label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={claDayMinutes}
                                disabled={readOnly}
                                onChange={(e) => setClaDayMinutes(e.target.value)}
                                className="flex h-10 w-full max-w-xs rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                placeholder="Ej.: 150"
                              />
                              <p className="text-xs text-muted-foreground">
                                {formatMinutesToHours(parseIntegerInput(claDayMinutes))} · Tarifa{" "}
                                {formatMoneyWithCurrency(claConfig?.day_rate ?? null, currency)} ·{" "}
                                <span className="font-medium text-ink">
                                  Subtotal: {formatMoneyWithCurrency(claPreview.dayPayment, currency)}
                                </span>
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {claNightEnabled && (
                        <div className="space-y-3 rounded-xl border border-border p-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={claNightUsed}
                              disabled={readOnly}
                              onChange={(e) => setClaNightUsed(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium text-ink">Horario nocturno</span>
                          </label>
                          {claNightUsed && (
                            <div className="space-y-3 pl-6">
                              <div className="space-y-1">
                                <Label>
                                  {claConfig?.night1_start ?? "—"} – {claConfig?.night1_end ?? "—"} · Minutos trabajados
                                </Label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={claNight1Minutes}
                                  disabled={readOnly}
                                  onChange={(e) => setClaNight1Minutes(e.target.value)}
                                  className="flex h-10 w-full max-w-xs rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                  placeholder="Ej.: 90"
                                />
                                <p className="text-xs text-muted-foreground">
                                  {formatMinutesToHours(parseIntegerInput(claNight1Minutes))} · Tarifa{" "}
                                  {formatMoneyWithCurrency(claConfig?.night1_rate ?? null, currency)} ·{" "}
                                  <span className="font-medium text-ink">
                                    Subtotal: {formatMoneyWithCurrency(claPreview.night1Payment, currency)}
                                  </span>
                                </p>
                              </div>
                              <div className="space-y-1">
                                <Label>
                                  {claConfig?.night2_start ?? "—"} – {claConfig?.night2_end ?? "—"} · Minutos trabajados
                                </Label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={claNight2Minutes}
                                  disabled={readOnly}
                                  onChange={(e) => setClaNight2Minutes(e.target.value)}
                                  className="flex h-10 w-full max-w-xs rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                  placeholder="Ej.: 120"
                                />
                                <p className="text-xs text-muted-foreground">
                                  {formatMinutesToHours(parseIntegerInput(claNight2Minutes))} · Tarifa{" "}
                                  {formatMoneyWithCurrency(claConfig?.night2_rate ?? null, currency)} ·{" "}
                                  <span className="font-medium text-ink">
                                    Subtotal: {formatMoneyWithCurrency(claPreview.night2Payment, currency)}
                                  </span>
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <p className="text-sm font-semibold text-ink">
                        TOTAL CLA: {formatMoneyWithCurrency(claPreview.totalPayment, currency)}
                      </p>
                    </div>
                  )}
                </>
              )}

              <p className="text-xs text-muted-foreground">
                Se introduce MINUTOS; el sistema calcula horas ÷ 60 × tarifa del tramo. CLA es un
                concepto propio y NO sustituye a la Nocturnidad.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">Pago antigüedad: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.tenurePayment, currency)}
              </span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">Categoría académica: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.academicPayment, currency)}
              </span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">CLA total: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.claTotalPayment, currency)}
              </span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <span className="text-muted-foreground">Total nocturnidad: </span>
              <span className="font-medium text-ink">
                {formatMoneyWithCurrency(preview.totalNightPayment, currency)}
              </span>
            </div>
            <div className="rounded-xl border-2 border-sitecorp-primary/30 bg-sitecorp-primary/5 p-3 text-sm">
              <span className="text-muted-foreground">Total trabajador: </span>
              <span className="font-semibold text-ink">
                {formatMoneyWithCurrency(preview.totalPayment, currency)}
              </span>
            </div>
          </div>

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}
        </div>

        <DialogFooter>
          <SiteCorpButton type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {readOnly ? "Cerrar" : "Cancelar"}
          </SiteCorpButton>
          {!readOnly && (
            <SiteCorpButton type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </SiteCorpButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default WorkerPrenominaDialog