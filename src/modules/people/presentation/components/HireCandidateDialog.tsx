import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
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
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
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
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import ResolutionForm, {
  type ResolutionFormValues,
} from "@/modules/resolutions/presentation/components/ResolutionForm"
import { updateJobWorkContent } from "@/modules/resolutions"
import { checkHiringReadiness } from "@/modules/people/application/contract-readiness.queries"
import {
  hireCandidateWithContract,
  hireCandidateWithResolution,
} from "@/modules/people/application/hiring.commands"
import { loadHiringWorkspace } from "@/modules/people/application/staffing.queries"
import {
  isSpecialDocumentRole,
  requiresResolution,
  validateHireInput,
} from "@/modules/people/domain/rules"
import type {
  ContractTypeOption,
  EmploymentLink,
  HireablePerson,
  ReadinessResult,
  StaffingPosition,
} from "@/modules/people/domain/entities"
import { AlertTriangle, UserPlus, RefreshCw, Search } from "lucide-react"
import { PositionWorkInfoReadOnly } from "@/modules/organization-structure/presentation/components/PositionWorkInfoReadOnly"
import { ContractReadinessChecklist } from "@/modules/people/presentation/components/ContractReadinessChecklist"
import {
  missingContractTemplateMessage,
  resolveContractTemplateAvailability,
  type TemplateAvailability,
} from "@/modules/contracts"
import {
  fetchEntityScheduleSegments,
  type PositionScheduleSegment,
} from "@/modules/organization-structure"
import {
  ContractRetributionFields,
  ContractSignatureFields,
} from "@/modules/contracts/presentation/components/ContractConditionsFields"
import { ContractFormalizationAlerts } from "@/modules/contracts/presentation/components/ContractFormalizationAlerts"
import { ContractFormalizationSummary } from "@/modules/contracts/presentation/components/ContractFormalizationSummary"
import type { RepresentativePositionRow } from "@/modules/representatives"
import {
  EMPTY_FORMALIZATION_PENDING,
  buildComponentsPayload,
  fetchPaymentMethods,
  formatConditionDate,
  hasInvalidComponent,
  type CompensationComponentDraft,
  type ContractFormalizationPending,
  type PaymentMethodOption,
} from "@/modules/contracts"

export interface HireCandidateTarget {
  id: string
  fullName: string
  identification: string
  /** Trabajador vinculado (si la persona ya tuvo un expediente laboral) */
  worker?: EmploymentLink | null
}

interface HireCandidateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  /** Persona ya definida (flujo desde la ficha del candidato) */
  candidate?: HireCandidateTarget | null
  /** Puesto ya definido (flujo «Cubrir puesto» desde Contratación) */
  presetPositionId?: string | null
  onSuccess: (workerId: string) => void
}

const fullNameOf = (c: {
  first_name: string
  first_surname: string
  second_surname: string | null
}) => [c.first_name, c.first_surname, c.second_surname].filter(Boolean).join(" ")

const groupLabel = (sequence: number | null | undefined) =>
  sequence == null ? "—" : `Grupo ${toRomanNumeral(sequence)}`

const hasAvailableCapacity = (
  position: StaffingPosition | null,
  occupancy: Record<string, number>
) => {
  if (!position || !position.is_active) return false
  return (occupancy[position.id] || 0) < (position.authorized_quantity || 0)
}

const HireCandidateDialog: React.FC<HireCandidateDialogProps> = ({
  open,
  onOpenChange,
  entityId,
  candidate = null,
  presetPositionId = null,
  onSuccess,
}) => {
  const [positions, setPositions] = React.useState<StaffingPosition[]>([])
  const [occupancy, setOccupancy] = React.useState<Record<string, number>>({})
  const [candidates, setCandidates] = React.useState<HireablePerson[]>([])
  const [contractTypes, setContractTypes] = React.useState<ContractTypeOption[]>([])
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
  const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<
    Record<string, SalaryValue | null>
  >({})
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [positionId, setPositionId] = React.useState("")
  const [selectedCandidateId, setSelectedCandidateId] = React.useState("")
  const [candidateSearch, setCandidateSearch] = React.useState("")
  const [hireDate, setHireDate] = React.useState("")
  const [contractTypeId, setContractTypeId] = React.useState("")
  const [contractStartDate, setContractStartDate] = React.useState("")
  const [contractEndDate, setContractEndDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  // Fase 11A.5: condiciones formalizadas en el contrato
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [signatureDate, setSignatureDate] = React.useState("")
  const [signaturePlace, setSignaturePlace] = React.useState("")
  const [paymentMethodId, setPaymentMethodId] = React.useState("")
  const [paymentSchedule, setPaymentSchedule] = React.useState("")
  const [components, setComponents] = React.useState<CompensationComponentDraft[]>([])
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])
  const [pending, setPending] = React.useState<ContractFormalizationPending | null>(null)
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  const [canManageOrganization, setCanManageOrganization] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()
  const [readiness, setReadiness] = React.useState<ReadinessResult | null>(null)
  const [readinessLoading, setReadinessLoading] = React.useState(false)
  // Centro de contratación: validación de la plantilla documental ANTES de contratar
  const [templateAvailability, setTemplateAvailability] =
    React.useState<TemplateAvailability | null>(null)
  const [templateChecking, setTemplateChecking] = React.useState(false)
  const [processStage, setProcessStage] = React.useState<string | null>(null)
  const [resolutionValues, setResolutionValues] = React.useState<ResolutionFormValues | null>(null)
  const [segmentsByPosition, setSegmentsByPosition] = React.useState<
    Record<string, PositionScheduleSegment[]>
  >({})

  const loadData = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setLoadError(null)
    try {
      // Caso de uso (lectura): puestos con su estructura y ocupación vigente, personas
      // candidatas con su vínculo laboral, tipos de contrato activos y permiso de los
      // datos contractuales de la entidad.
      const [workspace, segments] = await Promise.all([
        loadHiringWorkspace(entityId),
        fetchEntityScheduleSegments(entityId),
      ])
      setPositions(workspace.positions)
      setOccupancy(workspace.occupancy.counts)
      setCandidates(workspace.people)
      setContractTypes(workspace.contractTypes)
      setCanManageOrganization(workspace.canManageContractData)

      // Fase 11A.3: horarios habituales de los puestos (solo lectura)
      setSegmentsByPosition(segments)

      // Fase 11A.5: catálogo global de formas de pago (A tiempo / A rendimiento)
      setPaymentMethods(await fetchPaymentMethods())

      setApplicableScaleId(await resolveApplicableScaleId(entityId))
      const groupIds = workspace.positions
        .map((p) => p.job?.salary_group?.id)
        .filter((id): id is string => !!id)
      setSalaryValuesByGroup(await fetchSalaryValuesForGroups(groupIds))
    } catch (err) {
      console.error("Error loading hiring data:", err)
      setLoadError("No se pudieron cargar los datos para la contratación.")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    if (!open) return
    setPositionId(presetPositionId || "")
    setSelectedCandidateId(candidate?.id || "")
    setCandidateSearch("")
    setHireDate("")
    setContractTypeId("")
    setContractStartDate("")
    setContractEndDate("")
    setNotes("")
    setSignatureDate("")
    setSignaturePlace("")
    setPaymentMethodId("")
    setPaymentSchedule("")
    setComponents([])
    setRepresentatives([])
    setPending(null)
    setRepresentativeAssignmentId(null)
    setError(null)
    setOccupancy({})
    setResolutionValues(null)
    loadData()
  }, [open, candidate?.id, presetPositionId, loadData])

  const vacantPositions = React.useMemo(
    () =>
      positions.filter(
        (p) => p.is_active && (occupancy[p.id] || 0) < (p.authorized_quantity || 0)
      ),
    [positions, occupancy]
  )

  const selected = React.useMemo(
    () => positions.find((p) => p.id === positionId) || null,
    [positions, positionId]
  )

  const selectableCandidates = React.useMemo(
    () => candidates.filter((c) => c.worker?.employment_status !== "active"),
    [candidates]
  )

  const filteredCandidates = React.useMemo(() => {
    const search = candidateSearch.trim().toLowerCase()
    if (!search) return selectableCandidates
    return selectableCandidates.filter((c) =>
      [c.first_name, c.first_surname, c.second_surname, c.identification, c.email, c.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    )
  }, [selectableCandidates, candidateSearch])

  const selectedCandidate = React.useMemo<HireCandidateTarget | null>(() => {
    if (candidate) return candidate
    const found = candidates.find((c) => c.id === selectedCandidateId)
    if (!found) return null
    return {
      id: found.id,
      fullName: fullNameOf(found),
      identification: found.identification,
      worker: found.worker,
    }
  }, [candidate, candidates, selectedCandidateId])

  const isReincorporation =
    !!selectedCandidate?.worker && selectedCandidate.worker.employment_status !== "active"

  const selectedGroup = selected?.job?.salary_group || null
  const selectedSalary = salaryForGroup(applicableScaleId, selectedGroup, salaryValuesByGroup)
  /**
   * §44: si el Cargo destino es Especialista Principal, el documento es una
   * RESOLUCIÓN (nunca un contrato). El comportamiento de Cuadro NO se modifica.
   */
  const isPrincipalSpecialist = requiresResolution(selected?.job)
  const selectedType = contractTypes.find((t) => t.id === contractTypeId) || null
  const isDetermined = selectedType?.code === "DETERMINADO"
  const vacancies = selected
    ? Math.max(0, (selected.authorized_quantity || 0) - (occupancy[selected.id] || 0))
    : 0

  /**
   * Fase 11A.5: el representante que comparece se resuelve por la FECHA DE FIRMA
   * (no por la fecha de inicio), porque es la fecha en que se formaliza el contrato.
   */
  const contractReferenceDate = signatureDate
  const baseSalaryAmount = selectedSalary?.amount ?? null
  const baseSalaryCurrency = selectedSalary?.currency_code ?? null
  const formalizationBlocked = (pending || EMPTY_FORMALIZATION_PENDING).blocking.length > 0
  const selectedRepresentative =
    representatives.find((row) => row.assignment_id === representativeAssignmentId) || null

  React.useEffect(() => {
    if (!isDetermined) setContractEndDate("")
  }, [isDetermined])

  // Preparación contractual (§26/§39): se revisa la integridad completa antes de
  // permitir la contratación, de modo que la generación documental nunca sea el
  // primer punto donde se descubre un dato estructural faltante.
  React.useEffect(() => {
    if (!open) {
      setReadiness(null)
      return
    }
    let active = true
    setReadinessLoading(true)
    checkHiringReadiness({
      candidateId: selectedCandidate?.id || null,
      workerId: selectedCandidate?.worker?.id || null,
      positionId: positionId || null,
      signatureDate: signatureDate || null,
      contractTypeId: contractTypeId || null,
      signaturePlace: signaturePlace || null,
      paymentMethodId: paymentMethodId || null,
      representativeAssignmentId: representativeAssignmentId || null,
      contractStartDate: contractStartDate || hireDate || null,
      contractEndDate: isDetermined ? contractEndDate || null : null,
    })
      .then((result) => {
        if (active) setReadiness(result)
      })
      .catch((err) => {
        console.error("Error validating hiring readiness:", err)
        if (active) setReadiness(null)
      })
      .finally(() => {
        if (active) setReadinessLoading(false)
      })
    return () => {
      active = false
    }
  }, [
    open,
    selectedCandidate?.id,
    selectedCandidate?.worker?.id,
    positionId,
    signatureDate,
    contractTypeId,
    signaturePlace,
    paymentMethodId,
    representativeAssignmentId,
    contractStartDate,
    contractEndDate,
    hireDate,
    isDetermined,
  ])

  // §16/§17: la contratación exige una plantilla documental activa aplicable.
  // Se valida ANTES de crear el contrato para no dejar contrataciones sin documento.
  React.useEffect(() => {
    if (!open || !entityId || !selectedType || !signatureDate) {
      setTemplateAvailability(null)
      setTemplateChecking(false)
      return
    }
    let active = true
    setTemplateChecking(true)
    resolveContractTemplateAvailability(entityId, selectedType.code, signatureDate)
      .then((result) => {
        if (active) setTemplateAvailability(result)
      })
      .catch((err) => {
        console.error("Error resolving contract template:", err)
        if (active) setTemplateAvailability(null)
      })
      .finally(() => {
        if (active) setTemplateChecking(false)
      })
    return () => {
      active = false
    }
  }, [open, entityId, selectedType, signatureDate])

  const templateBlocked =
    !!templateAvailability &&
    (templateAvailability.status === "NONE" ||
      templateAvailability.status === "AMBIGUOUS" ||
      templateAvailability.status === "UNKNOWN")

  const handleSubmit = async () => {
    setError(null)

    const specialDocumentRole = isSpecialDocumentRole(selected?.job)

    // Reglas del dominio: persona, puesto, fecha, vigencia del contrato, condiciones
    // formalizadas, preparación contractual, plantilla documental y representante.
    const invalid = validateHireInput({
      hasCandidate: !!selectedCandidate,
      positionId,
      hireDate,
      resolutionDocument: isPrincipalSpecialist,
      skipsContractTerms: specialDocumentRole,
      contractTypeId,
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
      readiness,
      templateBlockedMessage: templateBlocked
        ? missingContractTemplateMessage(selectedType?.name || null)
        : null,
      isDetermined,
      contractStartDate,
      contractEndDate,
    })
    if (invalid) {
      setError(invalid)
      return
    }

    const candidateId = selectedCandidate?.id as string

    // §44: Cargo Especialista Principal → formulario de RESOLUCIÓN (no contrato).
    if (isPrincipalSpecialist) {
      if (!resolutionValues || !resolutionValues.valid) {
        setError(resolutionValues?.error || "Complete la información de la Resolución.")
        return
      }
      setSubmitting(true)
      try {
        // Las funciones pertenecen al Cargo: se persisten en su fuente de verdad.
        if (resolutionValues.workContentChanged && selected?.job?.id) {
          try {
            await updateJobWorkContent(selected.job.id, resolutionValues.workContent || "")
          } catch {
            /* best-effort: el snapshot conserva el valor introducido */
          }
        }

        // Caso de uso: alta hacia un Cargo Especialista Principal. Si la persona ya tuvo
        // expediente, la misma operación la reincorpora sin duplicarla.
        setProcessStage("Generando Resolución…")
        const outcome = await hireCandidateWithResolution({
          candidateId,
          positionId,
          hireDate,
          notes,
          resolution: {
            representativeAssignmentId: resolutionValues.representativeAssignmentId,
            resolutionDate: resolutionValues.resolutionDate,
          },
        })
        const workerId = outcome.workerId || undefined

        invalidateContractAlertData(queryClient)
        setProcessStage(null)

        if (outcome.documentWarning) {
          showError(
            `La Resolución se registró, pero el documento no se pudo generar: ${outcome.documentWarning}. Puede regenerarlo desde la pestaña Documentos del trabajador.`
          )
        } else {
          showSuccess(
            isReincorporation
              ? "Reincorporación completada. Resolución generada y archivada en los Documentos del trabajador."
              : "Contratación completada. Resolución generada y archivada en los Documentos del trabajador."
          )
        }
        onOpenChange(false)
        if (workerId) onSuccess(workerId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ""
        const friendly = msg || "No se pudo completar la Resolución."
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
      // §13/§14/§62: el documento contractual se genera automáticamente tras formalizar
      // la contratación. No hay paso manual de «Generar contrato». Para cargos Cuadro /
      // Especialista Principal no se genera contrato ni documento alguno (§24/§25/§30).
      if (!specialDocumentRole) setProcessStage("Generando documento contractual…")

      // Caso de uso: alta con contrato formalizado. Si la persona ya tenía expediente en
      // el cliente es una recontratación: la misma operación la devuelve a Trabajadores
      // sin duplicar su identidad ni su historial. Registra además el Movimiento de
      // Nómina (Alta) en el expediente del trabajador.
      const outcome = await hireCandidateWithContract({
        candidateId,
        positionId,
        hireDate,
        notes,
        contractTypeId,
        contractStartDate,
        contractEndDate,
        isDetermined,
        specialDocumentRole,
        representativeAssignmentId,
        signatureDate,
        signaturePlace,
        paymentMethodId,
        paymentScheduleText: paymentSchedule,
        compensationComponents: buildComponentsPayload(components),
      })
      const workerId = outcome.workerId || undefined

      // Contratación/reincorporación crea el contrato vigente: recalcular alertas.
      invalidateContractAlertData(queryClient)
      setProcessStage(null)

      if (outcome.documentWarning && workerId) {
        // §67: no se presenta como completada sin documento, pero el contrato queda
        // registrado y su documento puede regenerarse desde la ficha del trabajador.
        showError(
          `La contratación se completó, pero no se pudo generar el documento contractual: ${outcome.documentWarning}. Puede regenerarlo desde la pestaña Contratación del trabajador.`
        )
        onOpenChange(false)
        onSuccess(workerId)
        return
      }

      if (specialDocumentRole) {
        showSuccess(
          isReincorporation
            ? "Reincorporación completada. Este cargo no genera contrato (Cuadro/Especialista Principal)."
            : "Contratación completada. Este cargo no genera contrato (Cuadro/Especialista Principal)."
        )
      } else {
        showSuccess(
          isReincorporation
            ? "Reincorporación completada correctamente. El contrato y su documento fueron generados."
            : "Contratación completada correctamente. El contrato y su documento fueron generados."
        )
      }
      onOpenChange(false)
      if (workerId) onSuccess(workerId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      let friendly = "No se pudo completar la contratación."
      if (/vacantes/i.test(msg)) {
        friendly = "El puesto seleccionado ya no tiene vacantes disponibles."
      } else if (/ya es un trabajador activo/i.test(msg)) {
        friendly = "Este candidato ya es un trabajador activo."
      } else if (/carn[eé] de identidad/i.test(msg)) {
        friendly = "Ya existe un trabajador con ese carné de identidad. Revise el trabajador existente."
      } else if (/obligatorios/i.test(msg)) {
        friendly = "Faltan datos obligatorios para realizar la contratación."
      } else if (/no pertenece a la entidad/i.test(msg)) {
        friendly = "El puesto seleccionado no pertenece a la entidad del candidato."
      } else if (/no est[aá] activo/i.test(msg)) {
        friendly = "El puesto seleccionado no está activo."
      } else if (/requiere una fecha/i.test(msg)) {
        friendly = "El contrato por tiempo determinado requiere una fecha final."
      } else if (/posterior/i.test(msg)) {
        friendly = "La fecha final del contrato debe ser posterior a su inicio."
      } else if (/Datos pendientes/i.test(msg)) {
        friendly = msg
      } else if (/concepto retributivo|n[uú]mero v[aá]lido|negativo/i.test(msg)) {
        friendly =
          "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)."
      } else if (/escala salarial/i.test(msg)) {
        friendly =
          "No existe una escala salarial aplicable configurada para esta entidad. Complete la configuración salarial antes de formalizar el contrato."
      } else if (/representante/i.test(msg)) {
        friendly =
          "No existe ningún representante autorizado configurado para la fecha del contrato."
      } else if (/permiso/i.test(msg)) {
        friendly = "No tiene permiso para contratar trabajadores en esta entidad."
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

  const positionFixed = !!presetPositionId
  const hasVacancy = hasAvailableCapacity(selected, occupancy)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            {positionFixed
              ? "Cubrir puesto"
              : isReincorporation
                ? "Reincorporar candidato"
                : "Contratar candidato"}
          </DialogTitle>
          <DialogDescription>
            {positionFixed
              ? "Seleccione la persona que ocupará el puesto, el tipo de contrato y la fecha de incorporación."
              : "Se creará la asignación del puesto y el contrato laboral correspondiente."}
          </DialogDescription>
        </DialogHeader>

        {loadError && <SiteCorpAlert type="danger">{loadError}</SiteCorpAlert>}

        {/* ---------- Persona ---------- */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Persona
          </p>

          {candidate ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Nombre</dt>
                <dd className="text-sm font-medium text-ink">{candidate.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Carné de identidad</dt>
                <dd className="text-sm font-medium text-ink">{candidate.identification}</dd>
              </div>
            </dl>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Cargando candidatos…</p>
          ) : selectableCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay candidatos disponibles. Registre un candidato o revise que no sea ya un
              trabajador activo.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <SiteCorpInput
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Buscar por nombre, apellidos, CI, correo o teléfono…"
                  className="pl-9"
                />
              </div>

              {filteredCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ningún candidato coincide con la búsqueda.
                </p>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-background p-2">
                  {filteredCandidates.map((c) => {
                    const reinc = !!c.worker
                    const selectedRow = selectedCandidateId === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCandidateId(c.id)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                          selectedRow
                            ? "border-sitecorp-primary bg-sitecorp-primary/5"
                            : "border-transparent hover:bg-muted"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-medium text-ink">{fullNameOf(c)}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            CI: {c.identification}
                          </span>
                          {reinc && (
                            <SiteCorpStatusBadge status="info">
                              Trabajador anterior · Reincorporación
                            </SiteCorpStatusBadge>
                          )}
                        </div>
                        {(c.email || c.phone) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[c.email, c.phone].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {selectedCandidate && (
                <p className="text-xs text-muted-foreground">
                  Seleccionado:{" "}
                  <span className="font-medium text-ink">{selectedCandidate.fullName}</span> · CI{" "}
                  {selectedCandidate.identification}
                </p>
              )}
            </div>
          )}
        </div>

        {isReincorporation && (
          <SiteCorpAlert type="info">
            <span className="flex items-start gap-2">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
              Esta persona fue trabajador anteriormente. Se reincorporará con el mismo expediente: se
              creará un nuevo período laboral y un nuevo contrato, conservando su trayectoria y
              documentos.
            </span>
          </SiteCorpAlert>
        )}

        {/* ---------- Puesto ---------- */}
        {positionFixed ? (
          selected && (
            <div className="rounded-xl border border-border bg-sitecorp-primary/5 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
                Puesto seleccionado
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Puesto</dt>
                  <dd className="text-sm font-medium text-ink">{selected.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cargo</dt>
                  <dd className="text-sm font-medium text-ink">{selected.job?.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Área</dt>
                  <dd className="text-sm font-medium text-ink">{selected.job?.area?.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                  <dd className="text-sm font-medium text-ink">
                    {groupLabel(selectedGroup?.sequence_number)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Salario de referencia</dt>
                  <dd className="text-sm font-medium text-ink">
                    {selectedSalary
                      ? formatSalary(selectedSalary)
                      : selectedGroup
                        ? "Salario no configurado"
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Vacantes disponibles</dt>
                  <dd className="text-sm font-medium text-ink">
                    {occupancy[selected.id] || 0}/{selected.authorized_quantity} ocupados ·{" "}
                    {vacancies} vacante(s)
                  </dd>
                </div>
              </dl>
              {selectedGroup && !selectedSalary && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-sitecorp-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  El grupo salarial del cargo no tiene importe configurado en la escala aplicable.
                </p>
              )}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <Label>Puesto *</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando puestos…</p>
            ) : vacantPositions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay puestos con vacantes disponibles en esta entidad.
              </p>
            ) : (
              <SiteCorpSelect value={positionId} onValueChange={setPositionId}>
                <option value="">Seleccionar puesto</option>
                {vacantPositions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.job ? ` · ${p.job.name}` : ""} ({occupancy[p.id] || 0}/
                    {p.authorized_quantity})
                  </option>
                ))}
              </SiteCorpSelect>
            )}

            {selected && (
              <div className="rounded-xl border border-border bg-sitecorp-primary/5 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sitecorp-primary">
                  Situación laboral resultante
                </p>
                <dl className="grid gap-3 sm:grid-cols-2">
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
                    <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
                    <dd className="text-sm font-medium text-ink">
                      {groupLabel(selectedGroup?.sequence_number)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Salario de referencia</dt>
                    <dd className="text-sm font-medium text-ink">
                      {selectedSalary
                        ? formatSalary(selectedSalary)
                        : selectedGroup
                          ? "Salario no configurado"
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Capacidad</dt>
                    <dd className="text-sm font-medium text-ink">
                      {occupancy[selected.id] || 0}/{selected.authorized_quantity} · {vacancies}{" "}
                      vacante(s)
                    </dd>
                  </div>
                </dl>

                {/* Fase 11A.3: configuración estructural del puesto (solo lectura) */}
                <PositionWorkInfoReadOnly
                  className="mt-3"
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
          </div>
        )}

        {/* ---------- Contrato ---------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              {isReincorporation ? "Fecha de reincorporación *" : "Fecha de incorporación *"}
            </Label>
            <SiteCorpInput
              type="date"
              value={hireDate}
              onChange={(e) => {
                setHireDate(e.target.value)
                if (!contractStartDate) setContractStartDate(e.target.value)
              }}
            />
          </div>
          {!isPrincipalSpecialist && (
            <div className="space-y-2">
              <Label>Tipo de contrato *</Label>
              <SiteCorpSelect value={contractTypeId} onValueChange={setContractTypeId}>
                <option value="">Seleccionar tipo</option>
                {contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>
          )}
        </div>

        {isPrincipalSpecialist && (
          <ResolutionForm
            key={`${positionId}-${hireDate}`}
            entityId={entityId}
            positionId={positionId}
            workerId={selectedCandidate?.worker?.id ?? null}
            personName={selectedCandidate?.fullName ?? null}
            initialResolutionDate={hireDate}
            canManageContractData={canManageOrganization}
            onValuesChange={setResolutionValues}
          />
        )}

        {!isPrincipalSpecialist && (
        <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Inicio del contrato *</Label>
            <SiteCorpInput
              type="date"
              value={contractStartDate || hireDate}
              onChange={(e) => setContractStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Final del contrato{isDetermined ? " *" : ""}</Label>
            <SiteCorpInput
              type="date"
              value={contractEndDate}
              onChange={(e) => setContractEndDate(e.target.value)}
              disabled={!isDetermined}
              min={contractStartDate || hireDate || undefined}
            />
            {!isDetermined && (
              <p className="text-xs text-muted-foreground">
                La modalidad de tiempo indeterminado no requiere fecha final.
              </p>
            )}
          </div>
        </div>

        {/* ---------- Contrato: firma, lugar, forma y momento de pago ---------- */}
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

        <ContractFormalizationAlerts
          entityId={entityId}
          positionId={positionId || null}
          signatureDate={signatureDate || null}
          signaturePlace={signaturePlace || null}
          paymentMethodId={paymentMethodId || null}
          representativeAssignmentId={representativeAssignmentId}
          canManage={canManageOrganization}
          onPendingChange={setPending}
        />

        {/* ---------- Representante (resuelto por la fecha de firma) ---------- */}
        <RepresentativeSelect
          entityId={entityId}
          onDate={contractReferenceDate}
          value={representativeAssignmentId}
          onChange={setRepresentativeAssignmentId}
          canManage={canManageOrganization}
          label="Representante que suscribe el contrato *"
          dateHint={`Representante vigente en la fecha de firma (${formatConditionDate(
            signatureDate
          )}). Los cambios posteriores de representante no modifican este contrato.`}
          onOptionsChange={setRepresentatives}
        />

        {/* ---------- Condiciones retributivas ---------- */}
        <ContractRetributionFields
          components={components}
          onComponentsChange={setComponents}
          baseSalaryAmount={baseSalaryAmount}
          baseSalaryCurrency={baseSalaryCurrency}
          salaryGroupSequence={selectedGroup?.sequence_number ?? null}
          disabled={!selected}
        />

        {/* ---------- Resumen ---------- */}
        <ContractFormalizationSummary
          workerName={selectedCandidate?.fullName || ""}
          personIdentification={selectedCandidate?.identification || null}
          positionName={selected?.name || ""}
          jobName={selected?.job?.name || null}
          areaName={selected?.job?.area?.name || null}
          contractTypeName={selectedType?.name || null}
          startDate={contractStartDate || hireDate}
          endDate={isDetermined ? contractEndDate || null : null}
          signatureDate={signatureDate}
          signaturePlace={signaturePlace}
          paymentMethodName={
            paymentMethods.find((method) => method.id === paymentMethodId)?.name || null
          }
          representativeName={selectedRepresentative?.person_name || null}
          representativeTitle={selectedRepresentative?.title || null}
          baseSalaryAmount={baseSalaryAmount}
          baseSalaryCurrency={baseSalaryCurrency}
          salaryGroupSequence={selectedGroup?.sequence_number ?? null}
          components={components}
        />

        <ContractReadinessChecklist readiness={readiness} loading={readinessLoading} />

        {/* §16/§17: la plantilla documental se valida antes de contratar */}
        {templateBlocked && selectedType && (
          <SiteCorpAlert type="warning" title="Plantilla documental requerida">
            <span className="whitespace-pre-line">
              {missingContractTemplateMessage(selectedType.name)}
            </span>
          </SiteCorpAlert>
        )}
        {templateChecking && !templateBlocked && (
          <p className="text-xs text-muted-foreground">Comprobando la plantilla documental…</p>
        )}
        </>
        )}

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
              !selectedCandidate ||
              !positionId ||
              !hasVacancy ||
              (isPrincipalSpecialist
                ? !resolutionValues || !resolutionValues.valid
                : !contractTypeId ||
                  !signatureDate ||
                  !signaturePlace.trim() ||
                  !paymentMethodId ||
                  hasInvalidComponent(components) ||
                  formalizationBlocked ||
                  !representativeAssignmentId ||
                  templateBlocked ||
                  (!!contractTypeId && !!signatureDate && templateChecking) ||
                  (!!readiness && !readiness.ready))
            }
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {processStage
              ? processStage
              : submitting
                ? "Procesando…"
                : isPrincipalSpecialist
                  ? "Confirmar Resolución"
                  : isReincorporation
                    ? "Confirmar reincorporación"
                    : "Confirmar contratación"}
          </SiteCorpButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default HireCandidateDialog
