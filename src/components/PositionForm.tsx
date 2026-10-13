import * as React from "react"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  MAX_AUTHORIZED_QUANTITY,
  NO_OCCUPATIONAL_CATEGORY_LABEL,
  NO_PREPARATION_LEVEL_LABEL,
  WEEK_DAYS,
  addDraftScheduleSegments,
  formatTime,
  generatePositionCode,
  normalizeScheduleTime,
  positionSaveErrorMessage,
  positionSchedulePayload,
  removeScheduleSegment,
  savePosition,
  sortScheduleSegments,
  validatePositionInput,
  weekDayLabel,
  type PositionEditingData,
  type PositionJobOption,
  type PositionScheduleSegment,
} from "@/domains/organization-structure"
import { CalendarClock, Plus, X } from "lucide-react"

export type { PositionJobOption, PositionEditingData } from "@/domains/organization-structure"

/**
 * Puesto de la plantilla: alta y edición.
 *
 * El formulario no compone consultas ni habla con Supabase: valida con las reglas puras del
 * dominio y guarda con su caso de uso, que delega en la RPC atómica
 * `save_position_with_schedule`. El puesto es un ÚNICO registro con N plazas autorizadas
 * («No. de puestos»); las ocupadas y las vacantes se derivan de las asignaciones activas y
 * nunca se escriben aquí.
 *
 * La categoría ocupacional, el nivel de preparación, el grupo escala y el área son del
 * CARGO: se muestran derivados y de sólo lectura.
 */
interface PositionFormProps {
  entityId: string
  jobs: PositionJobOption[]
  applicableScaleId: string | null
  salaryValuesByGroup: Record<string, { amount: number; currency_code: string } | null>
  editingPosition?: PositionEditingData | null
  onSuccess: () => void
  onCancel: () => void
}

const formatSalary = (value: { amount: number; currency_code: string }) =>
  `${value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} ${value.currency_code}`

export const PositionForm: React.FC<PositionFormProps> = ({
  entityId,
  jobs,
  applicableScaleId,
  salaryValuesByGroup,
  editingPosition,
  onSuccess,
  onCancel,
}) => {
  const isEditing = !!editingPosition

  const [selectedJobId, setSelectedJobId] = React.useState<string>(
    editingPosition?.job_id || ""
  )
  const [baseName, setBaseName] = React.useState<string>(editingPosition?.name || "")
  const [authorizedQuantity, setAuthorizedQuantity] = React.useState<string>(
    editingPosition?.authorized_quantity?.toString() || "1"
  )
  const [description, setDescription] = React.useState<string>(
    editingPosition?.description || ""
  )
  // Fase 11A.3
  const [workLocation, setWorkLocation] = React.useState<string>(
    editingPosition?.work_location || ""
  )
  const [dailyHours, setDailyHours] = React.useState<string>(
    editingPosition?.daily_hours !== null && editingPosition?.daily_hours !== undefined
      ? String(editingPosition.daily_hours)
      : ""
  )
  const [weeklyHours, setWeeklyHours] = React.useState<string>(
    editingPosition?.weekly_hours !== null && editingPosition?.weekly_hours !== undefined
      ? String(editingPosition.weekly_hours)
      : ""
  )
  const [monthlyHours, setMonthlyHours] = React.useState<string>(
    editingPosition?.monthly_hours !== null && editingPosition?.monthly_hours !== undefined
      ? String(editingPosition.monthly_hours)
      : ""
  )
  const [breakMinutes, setBreakMinutes] = React.useState<string>(
    editingPosition?.break_minutes !== null && editingPosition?.break_minutes !== undefined
      ? String(editingPosition.break_minutes)
      : ""
  )
  const [scheduleNotes, setScheduleNotes] = React.useState<string>(
    editingPosition?.schedule_notes || ""
  )
  const [segments, setSegments] = React.useState<PositionScheduleSegment[]>(
    (editingPosition?.schedule_segments || []).map((segment) => ({
      day_of_week: segment.day_of_week,
      start_time: normalizeScheduleTime(segment.start_time),
      end_time: normalizeScheduleTime(segment.end_time),
    }))
  )
  const [draftDays, setDraftDays] = React.useState<number[]>([1])
  const [draftStart, setDraftStart] = React.useState<string>("08:00")
  const [draftEnd, setDraftEnd] = React.useState<string>("16:30")
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const activeJobs = React.useMemo(() => jobs.filter(j => j.is_active), [jobs])

  // Opciones del selector: solo cargos activos de esta entidad.
  // Al editar, incluir el cargo actual aunque esté inactivo para que sea visible.
  const jobOptions = React.useMemo(() => {
    if (!isEditing) return activeJobs
    const current = jobs.find(j => j.id === editingPosition!.job_id)
    if (current && !activeJobs.some(j => j.id === current.id)) {
      return [current, ...activeJobs]
    }
    return activeJobs
  }, [jobs, activeJobs, isEditing, editingPosition])

  const selectedJob = React.useMemo(
    () => jobs.find(j => j.id === selectedJobId) || null,
    [jobs, selectedJobId]
  )

  const handleJobChange = (jobId: string) => {
    setSelectedJobId(jobId)
    // Autocompletar el nombre base con el nombre del cargo mientras esté vacío
    // o coincida con el nombre del cargo previamente seleccionado.
    const job = jobs.find(j => j.id === jobId)
    if (job && !isEditing && (!baseName.trim() || jobs.some(j => j.name === baseName.trim()))) {
      setBaseName(job.name)
    }
  }

  // Información derivada de solo lectura: Área / Grupo salarial / Salario actual
  const derivedInfo = React.useMemo(() => {
    if (!selectedJob) return null
    const group = selectedJob.salary_group
    const area = selectedJob.area
    const groupLabel = group ? `Grupo ${toRomanNumeral(group.sequence_number)}` : "N/A"

    let salaryLabel: string | null = null
    if (!applicableScaleId) {
      salaryLabel = null
    } else if (group && group.salary_scale_id === applicableScaleId) {
      const value = salaryValuesByGroup[group.id]
      salaryLabel = value ? formatSalary(value) : null
    }

    const preparationLabel =
      selectedJob.preparation_levels.length > 0
        ? selectedJob.preparation_levels.map((level) => level.code).join(", ")
        : null

    return {
      areaLabel: area ? `${area.name} (${area.code})` : "N/A",
      groupLabel,
      salaryLabel,
      categoryLabel: selectedJob.occupational_category?.name || NO_OCCUPATIONAL_CATEGORY_LABEL,
      preparationLabel,
    }
  }, [selectedJob, applicableScaleId, salaryValuesByGroup])

  const sortedSegments = React.useMemo(() => sortScheduleSegments(segments), [segments])

  const toggleDraftDay = (day: number) => {
    setDraftDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]))
  }

  const handleAddSegments = () => {
    setFormError(null)

    const result = addDraftScheduleSegments(segments, {
      days: draftDays,
      start: draftStart,
      end: draftEnd,
    })
    if (result.error) {
      setFormError(result.error)
      return
    }
    setSegments(result.segments)
  }

  const removeSegment = (segment: PositionScheduleSegment) => {
    setSegments(prev => removeScheduleSegment(prev, segment))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return

    setFormError(null)

    const name = baseName.trim()
    const job = jobs.find(j => j.id === selectedJobId)

    // Reglas puras del dominio: cargo, nombre, cantidad autorizada, lugar de trabajo,
    // jornada, descanso y horario (más los valores ya convertidos).
    const validation = validatePositionInput({
      jobId: selectedJobId,
      jobExists: !!job,
      name,
      authorizedQuantity,
      workLocation,
      dailyHours,
      weeklyHours,
      monthlyHours,
      breakMinutes,
      segmentsCount: sortedSegments.length,
      scheduleNotes,
    })
    if (validation.error) {
      setFormError(validation.error)
      return
    }

    setSubmitting(true)

    try {
      await savePosition({
        entityId,
        positionId: isEditing ? editingPosition!.id : null,
        jobId: selectedJobId,
        code: isEditing ? editingPosition!.code : generatePositionCode(),
        name,
        description: description.trim() || null,
        authorizedQuantity: validation.quantity,
        workLocation: workLocation.trim() || null,
        dailyHours: validation.dailyHours,
        weeklyHours: validation.weeklyHours,
        monthlyHours: validation.monthlyHours,
        breakMinutes: validation.breakMinutes,
        scheduleNotes: scheduleNotes.trim() || null,
        segments: positionSchedulePayload(sortedSegments),
      })
      onSuccess()
    } catch (err) {
      console.error("Error saving position:", err)
      setFormError(positionSaveErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

      {/* INFORMACIÓN GENERAL */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Información general
        </p>

        <div className="space-y-2">
          <Label htmlFor="position-job">Cargo *</Label>
          <SiteCorpSelect
            value={selectedJobId}
            onValueChange={handleJobChange}
          >
            <option value="">Seleccionar cargo</option>
            {jobOptions.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name} ({job.code}){!job.is_active ? " — inactivo" : ""}
              </option>
            ))}
          </SiteCorpSelect>
          <p className="text-xs text-muted-foreground">
            Solo cargos activos de esta entidad. El área, el grupo salarial y el contenido de
            trabajo se heredan del cargo.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="position-name">Nombre del puesto *</Label>
            <SiteCorpInput
              id="position-name"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              placeholder="Ej.: Almacenero"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="position-code">Código</Label>
            <SiteCorpInput
              id="position-code"
              value={isEditing ? editingPosition!.code : "Se genera automáticamente"}
              disabled
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="position-description">Descripción</Label>
          <Textarea
            id="position-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción opcional del puesto"
            rows={2}
          />
        </div>
      </div>

      {/* CAPACIDAD */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Capacidad
        </p>
        <div className="space-y-2">
          <Label htmlFor="position-quantity">No. de puestos (cantidad autorizada) *</Label>
          <SiteCorpInput
            id="position-quantity"
            type="number"
            min={1}
            max={MAX_AUTHORIZED_QUANTITY}
            value={authorizedQuantity}
            onChange={(e) => setAuthorizedQuantity(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Número máximo de trabajadores que pueden ocupar este puesto simultáneamente. Es un
            único puesto con N plazas autorizadas; las vacantes se calculan según las asignaciones
            activas.
          </p>
        </div>
      </div>

      {/* UBICACIÓN */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ubicación
        </p>
        <div className="space-y-2">
          <Label htmlFor="position-work-location">Lugar de trabajo *</Label>
          <SiteCorpInput
            id="position-work-location"
            value={workLocation}
            onChange={(e) => setWorkLocation(e.target.value)}
            placeholder="Ej.: Almacén Central"
            required
          />
          <p className="text-xs text-muted-foreground">
            Ubicación habitual donde se ejecuta el trabajo. Es independiente del área
            organizativa del cargo.
          </p>
        </div>
      </div>

      {/* JORNADA */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Jornada
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="position-daily-hours">Horas diarias *</Label>
            <SiteCorpInput
              id="position-daily-hours"
              inputMode="decimal"
              value={dailyHours}
              onChange={(e) => setDailyHours(e.target.value)}
              placeholder="Ej.: 8"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="position-weekly-hours">Horas semanales *</Label>
            <SiteCorpInput
              id="position-weekly-hours"
              inputMode="decimal"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
              placeholder="Ej.: 44"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="position-monthly-hours">Horas mensuales *</Label>
            <SiteCorpInput
              id="position-monthly-hours"
              inputMode="decimal"
              value={monthlyHours}
              onChange={(e) => setMonthlyHours(e.target.value)}
              placeholder="Ej.: 190.6"
              required
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Se almacenan por separado: las horas mensuales no se calculan multiplicando las
          semanales.
        </p>
        <div className="space-y-2 sm:max-w-[240px]">
          <Label htmlFor="position-break">Descanso (minutos) *</Label>
          <SiteCorpInput
            id="position-break"
            inputMode="numeric"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            placeholder="Ej.: 30"
            required
          />
          <p className="text-xs text-muted-foreground">Se guarda como número de minutos.</p>
        </div>
      </div>

      {/* HORARIO HABITUAL */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Horario habitual
        </p>

        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Selecciona los días y el rango horario; se añadirá a cada día seleccionado.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((day) => {
              const selected = draftDays.includes(day.value)
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDraftDay(day.value)}
                  title={day.label}
                  className={cn(
                    "h-8 w-8 rounded-lg border text-xs font-semibold transition-colors",
                    selected
                      ? "border-sitecorp-primary bg-sitecorp-primary text-white"
                      : "border-border bg-white text-muted-foreground hover:bg-muted"
                  )}
                >
                  {day.short}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="schedule-start" className="text-xs">
                Desde
              </Label>
              <SiteCorpInput
                id="schedule-start"
                type="time"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className="w-[120px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="schedule-end" className="text-xs">
                Hasta
              </Label>
              <SiteCorpInput
                id="schedule-end"
                type="time"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="w-[120px]"
              />
            </div>
            <SiteCorpButton type="button" variant="outline" onClick={handleAddSegments}>
              <Plus className="mr-2 h-4 w-4" /> Añadir horario
            </SiteCorpButton>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Si la hora final es anterior a la inicial, se interpreta como turno que cruza
            medianoche (por ejemplo 20:00 → 04:00).
          </p>
        </div>

        {sortedSegments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin configurar: no se ha definido ningún horario para este puesto.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sortedSegments.map((segment) => (
              <li
                key={`${segment.day_of_week}-${segment.start_time}-${segment.end_time}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-ink">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{weekDayLabel(segment.day_of_week)}</span>
                  <span className="text-muted-foreground">
                    {formatTime(segment.start_time)}–{formatTime(segment.end_time)}
                    {segment.end_time < segment.start_time ? " (+1 día)" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeSegment(segment)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-sitecorp-danger"
                  aria-label="Eliminar horario"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="position-schedule-notes">Observaciones del horario</Label>
          <Textarea
            id="position-schedule-notes"
            value={scheduleNotes}
            onChange={(e) => setScheduleNotes(e.target.value)}
            placeholder="Ej.: disponibilidad para turnos rotativos"
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            Sólo para información que no pueda representarse con los segmentos de horario.
          </p>
        </div>
      </div>

      {/* CLASIFICACIÓN Y RETRIBUCIÓN (derivadas del cargo) */}
      {derivedInfo && (
        <div className="space-y-4 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Clasificación y retribución (heredadas del cargo)
          </p>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Información derivada del cargo (solo lectura)
              </p>
              <SiteCorpStatusBadge status="info">No editable aquí</SiteCorpStatusBadge>
            </div>
            <dl className="grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Categoría Ocupacional</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.categoryLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Nivel de preparación</dt>
                <dd className="text-sm font-medium text-ink">
                  {derivedInfo.preparationLabel || NO_PREPARATION_LEVEL_LABEL}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Grupo escala</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.groupLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Área</dt>
                <dd className="text-sm font-medium text-ink">{derivedInfo.areaLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Salario actual</dt>
                <dd className="text-sm font-medium text-ink">
                  {derivedInfo.salaryLabel ? (
                    derivedInfo.salaryLabel
                  ) : (
                    <span className="text-muted-foreground">
                      {applicableScaleId ? "Salario no configurado" : "Sin escala configurada"}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              La categoría ocupacional, el nivel de preparación y el grupo escala se definen en el
              Cargo. El nombre del puesto y la cantidad autorizada («No. de puestos») son propios
              del Puesto.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <SiteCorpButton variant="outline" type="button" onClick={onCancel}>
          Cancelar
        </SiteCorpButton>
        <SiteCorpButton type="submit" disabled={submitting}>
          {submitting
            ? "Guardando..."
            : isEditing
              ? "Guardar cambios"
              : "Crear puesto"}
        </SiteCorpButton>
      </div>
    </form>
  )
}
