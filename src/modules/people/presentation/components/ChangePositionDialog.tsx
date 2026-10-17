import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateContractAlertData } from "@/modules/contracts/presentation/hooks/use-contract-alerts"
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
import {
  resolveApplicableScaleId,
  fetchSalaryValuesForGroups,
  salaryForGroup,
  formatSalary,
  type SalaryValue,
} from "@/modules/organization-structure"
import { ArrowRight, AlertTriangle, FileSignature, Info } from "lucide-react"
import { PositionWorkInfoReadOnly } from "@/modules/organization-structure/presentation/components/PositionWorkInfoReadOnly"
import {
  fetchEntityScheduleSegments,
  type PositionScheduleSegment,
} from "@/modules/organization-structure"
import { AddendumChangesList } from "@/modules/contracts/presentation/components/AddendumChangesList"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import {
  changeWorkerPosition,
  loadTransitionWorkspace,
  previewPositionChange,
  validatePositionChangeInput,
  type PositionChangePreview,
  type StaffingPosition,
} from "@/modules/people"
import {
  MISSING_ADDENDUM_TEMPLATE_MESSAGE,
  formatConditionDate,
  resolveAddendumTemplateAvailability,
  type TemplateAvailability,
} from "@/modules/contracts"
import ResolutionForm, {
  type ResolutionFormValues,
} from "@/modules/resolutions/presentation/components/ResolutionForm"
import { updateJobWorkContent } from "@/modules/resolutions"
import type { WorkerCurrentSituation } from "@/shared/components/worker-action-contracts"

// El modelo de vista y las props del flujo son un contrato compartido con la página de
// vencimientos contractuales (módulo Contratos): viven en la capa compartida para que
// Contratos no dependa de la presentación de Personas.

interface ChangePositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workerId: string
  entityId: string
  current: WorkerCurrentSituation
  onSuccess: () => void
}

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const groupLabel = (sequence: number | null | undefined) =>
  sequence == null ? "—" : `Grupo ${toRomanNumeral(sequence)}`

const salaryLabel = (value: SalaryValue | null, hasGroup: boolean) => {
  if (value) return formatSalary(value)
  if (hasGroup) return "Salario no configurado"
  return "—"
}

const ChangePositionDialog: React.FC<ChangePositionDialogProps> = ({
  open,
  onOpenChange,
  workerId,
  entityId,
  current,
  onSuccess,
}) => {
  const [positions, setPositions] = React.useState<StaffingPosition[]>([])
  const [occupancy, setOccupancy] = React.useState<Record<string, number>>({})
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
  const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<
    Record<string, SalaryValue | null>
  >({})
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [selectedPositionId, setSelectedPositionId] = React.useState("")
  const [effectiveDate, setEffectiveDate] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [segmentsByPosition, setSegmentsByPosition] = React.useState<
    Record<string, PositionScheduleSegment[]>
  >({})

  // Fase 11A.6: diferencias contractuales y anexo
  const [preview, setPreview] = React.useState<PositionChangePreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [createAddendum, setCreateAddendum] = React.useState(true)
  const [formalizeNow, setFormalizeNow] = React.useState(false)
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  // Centro de contratación: plantilla del anexo y estado de proceso documental
  const [addendumTemplate, setAddendumTemplate] = React.useState<TemplateAvailability | null>(null)
  const [addendumTemplateChecking, setAddendumTemplateChecking] = React.useState(false)
  const [processStage, setProcessStage] = React.useState<string | null>(null)
  const [resolutionValues, setResolutionValues] = React.useState<ResolutionFormValues | null>(null)
  const queryClient = useQueryClient()

  const loadPositions = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setLoadError(null)
    try {
      // Caso de uso (lectura): puestos con su estructura y la ocupación vigente de la
      // entidad (asignación actual con trabajador activo, igual que la Plantilla Operativa).
      const [workspace, segments] = await Promise.all([
        loadTransitionWorkspace(entityId),
        fetchEntityScheduleSegments(entityId),
      ])
      setPositions(workspace.positions)
      setOccupancy(workspace.occupancy.counts)

      // Fase 11A.3: horarios habituales de los puestos (solo lectura)
      setSegmentsByPosition(segments)

      setApplicableScaleId(await resolveApplicableScaleId(entityId))
      const groupIds = workspace.positions
        .map((p) => p.job?.salary_group?.id)
        .filter((id): id is string => !!id)
      setSalaryValuesByGroup(await fetchSalaryValuesForGroups(groupIds))
    } catch (err) {
      console.error("Error loading positions for change:", err)
      setLoadError("No se pudieron cargar los puestos disponibles.")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    if (!open) return
    setSelectedPositionId("")
    setEffectiveDate("")
    setReason("")
    setNotes("")
    setError(null)
    setOccupancy({})
    setPreview(null)
    setPreviewError(null)
    setCreateAddendum(true)
    setFormalizeNow(false)
    setSignatureDate("")
    setSignaturePlace("")
    setRepresentativeAssignmentId(null)
    setResolutionValues(null)
    loadPositions()
  }, [open, loadPositions])

  const selectable = React.useMemo(
    () =>
      positions.filter(
        (p) =>
          p.is_active &&
          p.id !== current.positionId &&
          (occupancy[p.id] || 0) < (p.authorized_quantity || 0)
      ),
    [positions, occupancy, current.positionId]
  )

  const selected = React.useMemo(
    () => positions.find((p) => p.id === selectedPositionId) || null,
    [positions, selectedPositionId]
  )

  /** §45: si el NUEVO Cargo es Especialista Principal, el documento es la Resolución. */
  const isPrincipalSpecialist = selected?.job?.is_principal_specialist === true

  const selectedGroup = selected?.job?.salary_group || null
  const selectedSalary = salaryForGroup(applicableScaleId, selectedGroup, salaryValuesByGroup)

  const minDate = current.startDate ? addDays(current.startDate, 1) : undefined

  // Fase 11A.6: diferencias contractuales calculadas en el backend (§21/§22)
  React.useEffect(() => {
    if (!open || !selectedPositionId || !effectiveDate) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)

    previewPositionChange({ workerId, newPositionId: selectedPositionId, effectiveDate })
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        // Sin contrato vigente no puede existir un anexo: nunca se crea uno huérfano
        setCreateAddendum(result.has_contractual_changes && !!result.employment_contract_id)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("Error previewing position change:", err)
        setPreview(null)
        setPreviewError(
          err instanceof Error
            ? err.message
            : "No se pudieron calcular las diferencias contractuales."
        )
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedPositionId, effectiveDate, workerId])

  // §41/§43: si el anexo se va a formalizar, se valida su plantilla documental
  // ANTES de aplicar el cambio, para no dejar cambios sin documento.
  React.useEffect(() => {
    if (!open || !formalizeNow || !signatureDate) {
      setAddendumTemplate(null)
      setAddendumTemplateChecking(false)
      return
    }
    let active = true
    setAddendumTemplateChecking(true)
    resolveAddendumTemplateAvailability(entityId, signatureDate)
      .then((result) => {
        if (active) setAddendumTemplate(result)
      })
      .catch((err) => {
        console.error("Error resolving addendum template:", err)
        if (active) setAddendumTemplate(null)
      })
      .finally(() => {
        if (active) setAddendumTemplateChecking(false)
      })
    return () => {
      active = false
    }
  }, [open, formalizeNow, signatureDate, entityId])

  const addendumTemplateBlocked =
    !!addendumTemplate &&
    (addendumTemplate.status === "NONE" ||
      addendumTemplate.status === "AMBIGUOUS" ||
      addendumTemplate.status === "UNKNOWN")

  const handleSubmit = async () => {
    setError(null)

    const withAddendum = createAddendum && !!preview?.has_contractual_changes
    const formalizeAddendumNow = withAddendum && formalizeNow

    // Reglas del dominio: puesto destino, fecha efectiva posterior al inicio del puesto
    // actual y —en la vía de contrato— diferencias contractuales y formalización del anexo.
    const invalid = validatePositionChangeInput({
      newPositionId: selectedPositionId,
      effectiveDate,
      currentPositionStartDate: current.startDate,
      addendum: isPrincipalSpecialist
        ? {
            create: false,
            formalize: false,
            previewLoading: false,
            signatureDate: "",
            signaturePlace: "",
            representativeAssignmentId: null,
            templateBlockedMessage: null,
          }
        : {
            create: withAddendum,
            formalize: formalizeAddendumNow,
            previewLoading,
            signatureDate,
            signaturePlace,
            representativeAssignmentId,
            templateBlockedMessage: addendumTemplateBlocked
              ? MISSING_ADDENDUM_TEMPLATE_MESSAGE
              : null,
          },
    })
    if (invalid) {
      setError(invalid)
      return
    }

    // §45: movimiento formal hacia un Cargo Especialista Principal → RESOLUCIÓN.
    if (isPrincipalSpecialist) {
      if (!resolutionValues || !resolutionValues.valid) {
        setError(resolutionValues?.error || "Complete la información de la Resolución.")
        return
      }
      setSubmitting(true)
      try {
        if (resolutionValues.workContentChanged && selected?.job?.id) {
          try {
            await updateJobWorkContent(selected.job.id, resolutionValues.workContent || "")
          } catch {
            /* best-effort: el snapshot conserva el valor introducido */
          }
        }

        // Caso de uso: movimiento formal hacia un Cargo Especialista Principal. La
        // Resolución es su documento sustitutivo y se genera en la misma operación,
        // junto con el movimiento de nómina de la reubicación.
        setProcessStage("Generando Resolución…")
        const result = await changeWorkerPosition({
          workerId,
          newPositionId: selectedPositionId,
          effectiveDate,
          reason,
          notes,
          representativeAssignmentId: resolutionValues.representativeAssignmentId,
          resolutionDate: resolutionValues.resolutionDate,
        })

        invalidateContractAlertData(queryClient)
        setProcessStage(null)

        if (result.documentWarning) {
          showError(
            `El movimiento se realizó, pero la Resolución no se pudo generar: ${result.documentWarning}. Puede regenerarla desde la pestaña Documentos del trabajador.`
          )
        } else {
          showSuccess(
            "Cambio de puesto realizado. Resolución generada y archivada en los Documentos del trabajador."
          )
        }
        onOpenChange(false)
        onSuccess()
      } catch (err) {
        const msg = err instanceof Error ? err.message : ""
        const friendly = msg || "No se pudo completar el cambio de puesto."
        setError(friendly)
        showError(friendly)
      } finally {
        setSubmitting(false)
        setProcessStage(null)
      }
      return
    }

    setSubmitting(true)
    try {
      // §42/§65: al formalizarlo, el documento del anexo se genera automáticamente.
      if (formalizeAddendumNow) setProcessStage("Generando documento del anexo…")

      // Caso de uso: cierra la asignación actual, crea la nueva, registra el anexo en la
      // misma transacción y genera los documentos (aviso si alguno no se pudo generar).
      const result = await changeWorkerPosition({
        workerId,
        newPositionId: selectedPositionId,
        effectiveDate,
        reason,
        notes,
        addendum: withAddendum
          ? {
              create: true,
              formalize: formalizeAddendumNow,
              signatureDate,
              signaturePlace,
              representativeAssignmentId,
            }
          : undefined,
      })

      const addendumStatus = result.addendum?.addendum_status
      const addendumNumber = result.addendum?.addendum_number

      invalidateContractAlertData(queryClient)
      setProcessStage(null)

      if (addendumStatus === "FORMALIZED") {
        showSuccess(
          result.documentWarning
            ? `Cambio de puesto realizado. Anexo Nº ${addendumNumber} formalizado, pero el documento no se pudo generar: ${result.documentWarning}`
            : `Cambio aplicado correctamente. Se generó automáticamente el Anexo Nº ${addendumNumber} y su documento.`
        )
      } else {
        showSuccess(
          addendumNumber
            ? `Cambio de puesto realizado. Anexo Nº ${addendumNumber} pendiente de formalizar.`
            : result.addendum_skipped === "NO_CONTRACT"
              ? "Cambio de puesto realizado. No se registró anexo: el trabajador no tiene un contrato vigente."
              : "Cambio de puesto realizado correctamente."
        )
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      let friendly = "No se pudo completar el cambio de puesto."
      if (/vacantes/i.test(msg)) {
        friendly = "El puesto seleccionado ya no tiene vacantes disponibles."
      } else if (/no est[aá] activo/i.test(msg)) {
        friendly = "El puesto seleccionado no está activo."
      } else if (/no pertenece a la entidad/i.test(msg)) {
        friendly = "El puesto seleccionado no pertenece a la entidad del trabajador."
      } else if (/posterior al inicio/i.test(msg)) {
        friendly = "La fecha efectiva debe ser posterior al inicio del puesto actual."
      } else if (/ya ocupa/i.test(msg)) {
        friendly = "El trabajador ya ocupa ese puesto."
      } else if (/Datos pendientes/i.test(msg)) {
        friendly = msg
      } else if (/contrato vigente/i.test(msg)) {
        friendly =
          "El trabajador no tiene un contrato vigente: no se puede registrar el anexo contractual."
      } else if (/permiso/i.test(msg)) {
        friendly = "No tiene permiso para realizar movimientos de trabajadores."
      } else if (msg) {
        friendly = msg
      }
      setError(friendly)
      showError(friendly)
    } finally {
      setSubmitting(false)
      setProcessStage(null)
    }
  }

  const hasChanges = !!preview?.has_contractual_changes
  const addendumWillBeCreated = createAddendum && hasChanges

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Cambiar de puesto</DialogTitle>
          <DialogDescription>
            Se cerrará el puesto actual y se creará una nueva asignación, conservando la trayectoria
            laboral del trabajador. Si el cambio modifica condiciones contractuales se prepara un
            anexo al contrato vigente.
          </DialogDescription>
        </DialogHeader>

        {loadError && <SiteCorpAlert type="danger">{loadError}</SiteCorpAlert>}

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
              <dd className="text-sm font-medium text-ink">
                {current.positionName || "—"}
                {current.positionCode ? (
                  <span className="ml-1 text-xs text-muted-foreground">{current.positionCode}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
              <dd className="text-sm font-medium text-ink">{groupLabel(current.groupSequence)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Salario de referencia</dt>
              <dd className="text-sm font-medium text-ink">
                {salaryLabel(current.salary, current.groupSequence != null)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Selección del nuevo puesto */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nuevo puesto *</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando puestos…</p>
            ) : selectable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay puestos con vacantes disponibles en esta entidad.
              </p>
            ) : (
              <SiteCorpSelect
                value={selectedPositionId}
                onValueChange={(v) => setSelectedPositionId(v)}
              >
                <option value="">Seleccionar puesto</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.job ? ` · ${p.job.name}` : ""} (
                    {occupancy[p.id] || 0}/{p.authorized_quantity})
                  </option>
                ))}
              </SiteCorpSelect>
            )}
          </div>

          {/* Comparación Actual / Nueva */}
          {selected && (
            <div className="rounded-xl border border-border p-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Actual
                  </p>
                  <dl className="space-y-1.5">
                    <div>
                      <dt className="text-xs text-muted-foreground">Área</dt>
                      <dd className="text-sm text-ink">{current.areaName || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Cargo</dt>
                      <dd className="text-sm text-ink">{current.jobName || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Puesto</dt>
                      <dd className="text-sm text-ink">{current.positionName || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                      <dd className="text-sm text-ink">{groupLabel(current.groupSequence)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Salario</dt>
                      <dd className="text-sm text-ink">
                        {salaryLabel(current.salary, current.groupSequence != null)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="hidden justify-center sm:flex">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sitecorp-primary/10 text-sitecorp-primary">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>

                <div className="rounded-lg bg-sitecorp-primary/5 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
                    Nueva
                  </p>
                  <dl className="space-y-1.5">
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
                      <dd className="text-sm font-medium text-ink">{selected.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                      <dd className="text-sm font-medium text-ink">
                        {groupLabel(selectedGroup?.sequence_number)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Salario</dt>
                      <dd className="text-sm font-medium text-ink">
                        {salaryLabel(selectedSalary, !!selectedGroup)}
                      </dd>
                    </div>
                  </dl>
                  {selectedGroup && !selectedSalary && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-sitecorp-warning">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      El grupo salarial del nuevo cargo no tiene importe configurado en la escala
                      aplicable.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ocupación: {occupancy[selected.id] || 0}/{selected.authorized_quantity} ·{" "}
                    {Math.max(
                      0,
                      (selected.authorized_quantity || 0) - (occupancy[selected.id] || 0)
                    )}{" "}
                    vacante(s)
                  </p>
                </div>
              </div>

              {/* Fase 11A.3: configuración estructural del nuevo puesto (solo lectura) */}
              <PositionWorkInfoReadOnly
                className="mt-3"
                title="Información laboral del nuevo puesto"
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

          {/* Fecha efectiva */}
          <div className="space-y-2">
            <Label>Fecha efectiva *</Label>
            <SiteCorpInput
              type="date"
              value={effectiveDate}
              min={minDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Inicio del nuevo puesto. El puesto actual finalizará el día anterior. Es también la
              fecha de vigencia del anexo.
            </p>
          </div>

          {/* Diferencias contractuales (Fase 11A.6) — no aplica a la Resolución */}
          {!isPrincipalSpecialist && (selected && !effectiveDate ? (
            <SiteCorpAlert type="info">
              Indique la fecha efectiva para calcular las diferencias contractuales del cambio.
            </SiteCorpAlert>
          ) : selectedPositionId && effectiveDate && previewLoading ? (
            <p className="text-sm text-muted-foreground">
              Calculando diferencias contractuales…
            </p>
          ) : previewError ? (
            <SiteCorpAlert type="danger">{previewError}</SiteCorpAlert>
          ) : preview ? (
            <>
              {hasChanges ? (
                <AddendumChangesList
                  changes={preview.changes}
                  description="Condiciones del contrato vigente que cambian con este movimiento. Sólo se muestran los campos que cambian."
                />
              ) : (
                <SiteCorpAlert type="info" title="Sin cambios contractuales">
                  Este cambio no modifica condiciones contractuales representables: no se creará
                  ningún anexo.
                </SiteCorpAlert>
              )}

              {hasChanges && !preview.employment_contract_id && (
                <SiteCorpAlert type="warning" title="Sin contrato vigente">
                  El trabajador no tiene un contrato vigente sobre el que formalizar el anexo: el
                  cambio de puesto se realizará sin registrar anexo.
                </SiteCorpAlert>
              )}

              {hasChanges && (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-input"
                      checked={createAddendum}
                      disabled={!preview.employment_contract_id}
                      onChange={(e) => setCreateAddendum(e.target.checked)}
                    />
                    <span>
                      Generar anexo al contrato vigente
                      <span className="block text-xs text-muted-foreground">
                        El anexo se registra en la misma operación del cambio de puesto. Si no se
                        formaliza ahora, queda pendiente de firma.
                      </span>
                    </span>
                  </label>

                  {createAddendum && (
                    <>
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-input"
                          checked={formalizeNow}
                          onChange={(e) => setFormalizeNow(e.target.checked)}
                        />
                        <span>
                          Formalizar ahora (fecha de firma, lugar y representante)
                          <span className="block text-xs text-muted-foreground">
                            Firmar después es válido: el anexo quedará pendiente y podrá formalizarse
                            desde la ficha del trabajador.
                          </span>
                        </span>
                      </label>

                      {formalizeNow && (
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
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
                          <RepresentativeSelect
                            entityId={entityId}
                            onDate={signatureDate}
                            value={representativeAssignmentId}
                            onChange={setRepresentativeAssignmentId}
                            canManage
                            label="Representante que suscribe el anexo *"
                            dateHint={`Representante vigente en la fecha de firma${
                              signatureDate ? ` (${formatConditionDate(signatureDate)})` : ""
                            }.`}
                          />
                          {addendumTemplateBlocked && (
                            <SiteCorpAlert type="warning" title="Plantilla de anexo requerida">
                              <span className="whitespace-pre-line">
                                {MISSING_ADDENDUM_TEMPLATE_MESSAGE}
                              </span>
                            </SiteCorpAlert>
                          )}
                          {addendumTemplateChecking && !addendumTemplateBlocked && (
                            <p className="text-xs text-muted-foreground">
                              Comprobando la plantilla del anexo…
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          ) : null)}

          {/* §45: Resolución para Cargo destino Especialista Principal */}
          {isPrincipalSpecialist && (
            <ResolutionForm
              key={`${selectedPositionId}-${effectiveDate}`}
              entityId={entityId}
              positionId={selectedPositionId}
              workerId={workerId}
              initialResolutionDate={effectiveDate}
              canManageContractData
              onValuesChange={setResolutionValues}
            />
          )}

          {/* Motivo */}
          <div className="space-y-2">
            <Label>Motivo</Label>
            <SiteCorpInput
              value={reason}
              placeholder="Promoción interna, reorganización, necesidad del servicio…"
              onChange={(e) => setReason(e.target.value)}
            />
            {addendumWillBeCreated && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileSignature className="h-3.5 w-3.5" />
                El anexo quedará registrado como «Cambio de puesto» en el contrato vigente.
              </p>
            )}
          </div>

          {/* Observaciones */}
          <div className="space-y-2">
            <Label>Observaciones</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
              placeholder="Opcional"
            />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              La asignación anterior se cierra y la nueva se crea en una sola transacción: si algo
              falla, no se aplica ningún cambio.
            </p>
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
            disabled={
              submitting ||
              loading ||
              selectable.length === 0 ||
              previewLoading ||
              (isPrincipalSpecialist
                ? !resolutionValues || !resolutionValues.valid
                : formalizeNow && (addendumTemplateBlocked || addendumTemplateChecking))
            }
          >
            {processStage
              ? processStage
              : submitting
                ? "Procesando…"
                : isPrincipalSpecialist
                  ? "Confirmar movimiento y Resolución"
                  : "Confirmar cambio de puesto"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ChangePositionDialog
