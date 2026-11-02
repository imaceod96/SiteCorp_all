import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SelectItem } from "@/shared/components/ui/select"
import { Label } from "@/shared/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import {
  SST_ACTION_ORIGIN_LABELS,
  SST_ACTION_STATUS_LABELS,
  SST_PROBABILITY_LABELS,
  SST_RISK_LEVEL_LABELS,
  SST_RISK_TYPE_LABELS,
  SST_SEVERITY_LABELS,
  computeSstRiskLevel,
  type EntityAreaOption,
  type EntityJobOption,
  type EntitySstState,
  type EntityWorkerSstOption,
  type SstActionPriority,
  type SstPreventiveAction,
  type SstPreventiveActionOrigin,
  type SstPreventiveActionStatus,
  type SstProbabilityLevel,
  type SstRiskAssessment,
  type SstRiskLevel,
  type SstRiskType,
  type SstSeverityLevel,
} from "../../domain/entities"
import {
  createSstPreventiveAction,
  createSstRiskAssessment,
  updateSstPreventiveActionStatus,
  updateSstRiskStatus,
} from "../../application/sst.service"
import { useToast } from "@/shared/hooks/use-toast"
import { AlertTriangle, ShieldCheck, Plus, CheckCircle2, ClipboardCheck } from "lucide-react"
import { cn } from "@/lib/utils"

interface SstRiskAndPreventionSectionProps {
  entityId: string
  state: EntitySstState
  areas: EntityAreaOption[]
  jobs: EntityJobOption[]
  workers: EntityWorkerSstOption[]
  canManage: boolean
  onRefresh: () => Promise<void>
}

const PROBABILITIES: SstProbabilityLevel[] = ["ALTA", "MEDIA", "BAJA"]
const SEVERITIES: SstSeverityLevel[] = ["LEVE", "MODERADA", "GRAVE", "EXTREMA"]

export const SstRiskAndPreventionSection: React.FC<SstRiskAndPreventionSectionProps> = ({
  entityId,
  state,
  areas,
  jobs,
  workers,
  canManage,
  onRefresh,
}) => {
  const { toast } = useToast()

  // Filtro interactivo de matriz
  const [matrixFilterLevel, setMatrixFilterLevel] = React.useState<SstRiskLevel | "ALL">("ALL")

  // Diálogo: Evaluar nuevo riesgo laboral
  const [riskDialogOpen, setRiskDialogOpen] = React.useState(false)
  const [riskAreaId, setRiskAreaId] = React.useState<string>("")
  const [riskJobId, setRiskJobId] = React.useState<string>("")
  const [riskFacility, setRiskFacility] = React.useState<string>("")
  const [riskType, setRiskType] = React.useState<SstRiskType>("MECANICO")
  const [hazardDesc, setHazardDesc] = React.useState<string>("")
  const [causeDesc, setCauseDesc] = React.useState<string>("")
  const [consequences, setConsequences] = React.useState<string>("")
  const [probLevel, setProbLevel] = React.useState<SstProbabilityLevel>("MEDIA")
  const [sevLevel, setSevLevel] = React.useState<SstSeverityLevel>("MODERADA")
  const [existingControls, setExistingControls] = React.useState<string>("")
  const [reviewDate, setReviewDate] = React.useState<string>("")
  const [riskSubmitting, setRiskSubmitting] = React.useState(false)

  // Diálogo: Nueva medida preventiva / correctiva
  const [actionDialogOpen, setActionDialogOpen] = React.useState(false)
  const [actionOriginType, setActionOriginType] =
    React.useState<SstPreventiveActionOrigin>("RIESGO")
  const [actionOriginId, setActionOriginId] = React.useState<string | null>(null)
  const [actionOriginLabel, setActionOriginLabel] = React.useState<string>("")
  const [actionDescription, setActionDescription] = React.useState<string>("")
  const [actionAreaId, setActionAreaId] = React.useState<string>("")
  const [actionJobId, setActionJobId] = React.useState<string>("")
  const [actionResponsibleId, setActionResponsibleId] = React.useState<string>("")
  const [actionPriority, setActionPriority] = React.useState<SstActionPriority>("MEDIA")
  const [actionDueDate, setActionDueDate] = React.useState<string>(
    () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  )
  const [actionSubmitting, setActionSubmitting] = React.useState(false)

  // Diálogo: Actualizar estado de medida (con justificación obligatoria si se cancela)
  const [editingAction, setEditingAction] = React.useState<SstPreventiveAction | null>(null)
  const [nextActionStatus, setNextActionStatus] =
    React.useState<SstPreventiveActionStatus>("EN_EJECUCION")
  const [cancelJustification, setCancelJustification] = React.useState<string>("")
  const [verificationNotes, setVerificationNotes] = React.useState<string>("")

  const areaMap = React.useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas])
  const jobMap = React.useMemo(() => new Map(jobs.map((j) => [j.id, j.name])), [jobs])
  const workerMap = React.useMemo(
    () => new Map(workers.map((w) => [w.id, w.fullName])),
    [workers]
  )

  const filteredRisks = React.useMemo(() => {
    if (matrixFilterLevel === "ALL") return state.risks
    return state.risks.filter((r) => r.risk_level === matrixFilterLevel)
  }, [state.risks, matrixFilterLevel])

  const handleCreateRisk = async (e: React.FormEvent) => {
    e.preventDefault()
    setRiskSubmitting(true)
    try {
      await createSstRiskAssessment({
        entityId,
        areaId: riskAreaId || null,
        areaName: riskAreaId ? areaMap.get(riskAreaId) || null : null,
        jobId: riskJobId || null,
        jobName: riskJobId ? jobMap.get(riskJobId) || null : null,
        facilityName: riskFacility || null,
        riskType,
        hazardDescription: hazardDesc,
        causeDescription: causeDesc,
        consequences,
        probabilityLevel: probLevel,
        severityLevel: sevLevel,
        existingControls,
        reviewDate: reviewDate || null,
      })
      setRiskDialogOpen(false)
      setHazardDesc("")
      setCauseDesc("")
      setConsequences("")
      setExistingControls("")
      await onRefresh()
      toast({
        title: "Riesgo laboral registrado",
        description: "La evaluación se incorporó a la matriz de riesgos de la entidad.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al registrar riesgo",
        description: err instanceof Error ? err.message : "No se pudo guardar la evaluación.",
      })
    } finally {
      setRiskSubmitting(false)
    }
  }

  const openActionFromRisk = (risk: SstRiskAssessment) => {
    setActionOriginType("RIESGO")
    setActionOriginId(risk.id)
    setActionOriginLabel(risk.hazard_description)
    setActionDescription(`Controlar peligro: ${risk.hazard_description}`)
    setActionAreaId(risk.area_id || "")
    setActionJobId(risk.job_id || "")
    setActionPriority(
      risk.risk_level === "CRITICO"
        ? "INMEDIATA"
        : risk.risk_level === "IMPORTANTE"
          ? "ALTA"
          : "MEDIA"
    )
    setActionDialogOpen(true)
  }

  const handleCreateAction = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionSubmitting(true)
    try {
      await createSstPreventiveAction({
        entityId,
        originType: actionOriginType,
        originId: actionOriginId,
        originLabel: actionOriginLabel,
        description: actionDescription,
        areaId: actionAreaId || null,
        areaName: actionAreaId ? areaMap.get(actionAreaId) || null : null,
        jobId: actionJobId || null,
        jobName: actionJobId ? jobMap.get(actionJobId) || null : null,
        responsibleWorkerId: actionResponsibleId || null,
        responsibleName: actionResponsibleId ? workerMap.get(actionResponsibleId) || null : null,
        priority: actionPriority,
        dueDate: actionDueDate,
      })
      setActionDialogOpen(false)
      setActionOriginId(null)
      setActionOriginLabel("")
      setActionDescription("")
      await onRefresh()
      toast({
        title: "Medida preventiva registrada",
        description: "Se añadió al Plan de Prevención y Medidas Correctivas de la entidad.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear la medida",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    } finally {
      setActionSubmitting(false)
    }
  }

  const handleUpdateActionStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAction) return
    try {
      await updateSstPreventiveActionStatus({
        entityId,
        actionId: editingAction.id,
        status: nextActionStatus,
        cancellationJustification: cancelJustification,
        verificationNotes,
      })
      setEditingAction(null)
      await onRefresh()
      toast({
        title: "Estado de medida actualizado",
        description: `La medida quedó en estado «${SST_ACTION_STATUS_LABELS[nextActionStatus]}».`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Validación requerida",
        description: err instanceof Error ? err.message : "No se pudo actualizar el estado.",
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* MATRIZ INTERACTIVA E IDENTIFICACIÓN DE RIESGOS LABORALES */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-sitecorp-secondary-orange" />
                <h2 className="text-lg font-semibold text-ink">
                  Identificación y Evaluación de Riesgos Laborales (Matriz de Riesgos)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Evaluación por área, cargo o instalación de esta entidad según Probabilidad ×
                Severidad. Haz clic en cualquier nivel para filtrar.
              </p>
            </div>

            {canManage && (
              <SiteCorpButton type="button" onClick={() => setRiskDialogOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Evaluar nuevo riesgo
              </SiteCorpButton>
            )}
          </div>

          {/* Matriz de Riesgos 3 x 4 */}
          <div className="overflow-x-auto rounded-xl border border-border bg-muted/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Matriz Probabilidad × Severidad
              </span>
              {matrixFilterLevel !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setMatrixFilterLevel("ALL")}
                  className="text-xs font-medium text-sitecorp-primary hover:underline"
                >
                  Mostrar todos los niveles ({state.risks.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-5 gap-2 text-xs">
              <div className="flex items-center justify-center rounded-lg bg-muted p-2 font-semibold text-muted-foreground">
                Probabilidad \ Severidad
              </div>
              {SEVERITIES.map((sev) => (
                <div
                  key={sev}
                  className="rounded-lg bg-muted p-2 text-center font-semibold text-ink"
                >
                  {SST_SEVERITY_LABELS[sev]}
                </div>
              ))}

              {PROBABILITIES.map((prob) => (
                <React.Fragment key={prob}>
                  <div className="flex items-center justify-center rounded-lg bg-muted p-2 font-semibold text-ink">
                    {SST_PROBABILITY_LABELS[prob]}
                  </div>
                  {SEVERITIES.map((sev) => {
                    const level = computeSstRiskLevel(prob, sev)
                    const count = state.risks.filter(
                      (r) =>
                        r.probability_level === prob &&
                        r.severity_level === sev &&
                        r.status !== "CERRADO"
                    ).length
                    const isSelected = matrixFilterLevel === level
                    return (
                      <button
                        key={`${prob}-${sev}`}
                        type="button"
                        onClick={() =>
                          setMatrixFilterLevel(isSelected ? "ALL" : level)
                        }
                        className={cn(
                          "flex flex-col items-center justify-center rounded-lg border p-2.5 transition-all",
                          level === "CRITICO"
                            ? "border-sitecorp-danger/40 bg-sitecorp-danger/10 text-sitecorp-danger"
                            : level === "IMPORTANTE"
                              ? "border-sitecorp-secondary-orange/40 bg-sitecorp-secondary-orange/10 text-sitecorp-secondary-orange"
                              : level === "MODERADO"
                                ? "border-sitecorp-warning/40 bg-sitecorp-warning/10 text-ink"
                                : "border-sitecorp-success/40 bg-sitecorp-success/10 text-sitecorp-success",
                          isSelected && "ring-2 ring-sitecorp-primary"
                        )}
                      >
                        <span className="font-semibold">{SST_RISK_LEVEL_LABELS[level]}</span>
                        <span className="mt-0.5 font-mono text-sm font-bold tabular-nums">
                          {count} activo(s)
                        </span>
                      </button>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Tabla de riesgos identificados */}
          {filteredRisks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              No hay riesgos registrados para el filtro actual en esta entidad.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Peligro / Factor de riesgo</th>
                    <th className="px-4 py-3">Cargo / Área</th>
                    <th className="px-4 py-3">Valoración</th>
                    <th className="px-4 py-3">Controles existentes</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {filteredRisks.map((risk) => (
                    <tr key={risk.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{risk.hazard_description}</p>
                        <p className="text-xs text-muted-foreground">
                          {SST_RISK_TYPE_LABELS[risk.risk_type]}
                          {risk.consequences ? ` • Consecuencia: ${risk.consequences}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <p className="font-medium text-ink">
                          {risk.job_id
                            ? jobMap.get(risk.job_id) || risk.job_name_snapshot
                            : "General"}
                        </p>
                        <p>
                          {risk.area_id
                            ? areaMap.get(risk.area_id) || risk.area_name_snapshot
                            : risk.facility_name || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <SiteCorpStatusBadge
                          status={
                            risk.risk_level === "CRITICO"
                              ? "danger"
                              : risk.risk_level === "IMPORTANTE"
                                ? "warning"
                                : risk.risk_level === "MODERADO"
                                  ? "info"
                                  : "success"
                          }
                        >
                          {SST_RISK_LEVEL_LABELS[risk.risk_level]}
                        </SiteCorpStatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {risk.existing_controls || "Sin controles documentados"}
                      </td>
                      <td className="px-4 py-3">
                        <SiteCorpStatusBadge
                          status={risk.status === "CONTROLADO" ? "success" : "warning"}
                        >
                          {risk.status}
                        </SiteCorpStatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManage && (
                          <div className="inline-flex items-center gap-2">
                            <SiteCorpButton
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openActionFromRisk(risk)}
                            >
                              + Medida
                            </SiteCorpButton>
                            {risk.status === "ACTIVO" && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateSstRiskStatus({
                                    entityId,
                                    riskId: risk.id,
                                    status: "CONTROLADO",
                                  })
                                  await onRefresh()
                                }}
                                className="text-xs font-medium text-sitecorp-success hover:underline"
                              >
                                Marcar controlado
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* PLAN DE PREVENCIÓN Y MEDIDAS CORRECTIVAS */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-sitecorp-primary" />
                <h2 className="text-lg font-semibold text-ink">
                  Plan de Prevención y Medidas Correctivas
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Seguimiento de medidas derivadas de evaluaciones de riesgos, inspecciones,
                accidentes, incidentes o acuerdos del Comité de SST.
              </p>
            </div>

            {canManage && (
              <SiteCorpButton
                type="button"
                onClick={() => {
                  setActionOriginType("REVISION_INTERNA")
                  setActionOriginId(null)
                  setActionOriginLabel("")
                  setActionDescription("")
                  setActionDialogOpen(true)
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Nueva medida preventiva / correctiva
              </SiteCorpButton>
            )}
          </div>

          {state.preventiveActions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              No hay medidas preventivas o correctivas registradas en esta entidad.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Medida / Acción</th>
                    <th className="px-4 py-3">Origen</th>
                    <th className="px-4 py-3">Responsable / Área</th>
                    <th className="px-4 py-3">Prioridad y Fecha límite</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Gestión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {state.preventiveActions.map((act) => {
                    const today = new Date().toISOString().slice(0, 10)
                    const isOverdue =
                      act.status !== "COMPLETADA" &&
                      act.status !== "CANCELADA" &&
                      act.due_date < today

                    return (
                      <tr key={act.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{act.description}</p>
                          {act.cancellation_justification && (
                            <p className="mt-0.5 text-xs text-sitecorp-danger">
                              Motivo de cancelación: {act.cancellation_justification}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="font-medium text-ink">
                            {SST_ACTION_ORIGIN_LABELS[act.origin_type]}
                          </span>
                          {act.origin_label && <p className="truncate">{act.origin_label}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <p className="font-medium text-ink">
                            {act.responsible_name_snapshot || "Sin responsable nominal"}
                          </p>
                          <p>{act.area_name_snapshot || act.job_name_snapshot || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-semibold text-ink">{act.priority}</span>
                          <p className="font-mono text-muted-foreground tabular-nums">
                            Vence: {act.due_date}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <SiteCorpStatusBadge
                            status={
                              act.status === "COMPLETADA"
                                ? "success"
                                : isOverdue || act.status === "VENCIDA"
                                  ? "danger"
                                  : act.status === "CANCELADA"
                                    ? "neutral"
                                    : "warning"
                            }
                          >
                            {isOverdue && act.status !== "VENCIDA"
                              ? "Vencida"
                              : SST_ACTION_STATUS_LABELS[act.status]}
                          </SiteCorpStatusBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManage && (
                            <SiteCorpButton
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingAction(act)
                                setNextActionStatus(act.status)
                                setCancelJustification(act.cancellation_justification || "")
                                setVerificationNotes(act.verification_notes || "")
                              }}
                            >
                              Actualizar estado
                            </SiteCorpButton>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* DIÁLOGO: Evaluar nuevo riesgo */}
      <Dialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Identificar y evaluar riesgo laboral</DialogTitle>
            <DialogDescription>
              El sistema calcula automáticamente el nivel de riesgo según la matriz Probabilidad ×
              Severidad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRisk} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cargo expuesto (opcional)</Label>
                <SiteCorpSelect
                  value={riskJobId || "__none__"}
                  onValueChange={(v) => setRiskJobId(v === "__none__" ? "" : v)}
                >
                  <SelectItem value="__none__">General / Todos los cargos</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.name}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Área organizativa (opcional)</Label>
                <SiteCorpSelect
                  value={riskAreaId || "__none__"}
                  onValueChange={(v) => setRiskAreaId(v === "__none__" ? "" : v)}
                >
                  <SelectItem value="__none__">Seleccionar área...</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de riesgo</Label>
                <SiteCorpSelect
                  value={riskType}
                  onValueChange={(v) => setRiskType(v as SstRiskType)}
                >
                  {Object.entries(SST_RISK_TYPE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Instalación / Local específico</Label>
                <SiteCorpInput
                  value={riskFacility}
                  onChange={(e) => setRiskFacility(e.target.value)}
                  placeholder="Ej. Taller eléctrico, Almacén central..."
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Peligro o factor de riesgo identificado *</Label>
              <SiteCorpInput
                value={hazardDesc}
                onChange={(e) => setHazardDesc(e.target.value)}
                placeholder="Ej. Contacto eléctrico directo en tableros de distribución"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Probabilidad</Label>
                <SiteCorpSelect
                  value={probLevel}
                  onValueChange={(v) => setProbLevel(v as SstProbabilityLevel)}
                >
                  <SelectItem value="BAJA">Baja</SelectItem>
                  <SelectItem value="MEDIA">Media</SelectItem>
                  <SelectItem value="ALTA">Alta</SelectItem>
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Severidad esperada</Label>
                <SiteCorpSelect
                  value={sevLevel}
                  onValueChange={(v) => setSevLevel(v as SstSeverityLevel)}
                >
                  <SelectItem value="LEVE">Leve</SelectItem>
                  <SelectItem value="MODERADA">Moderada</SelectItem>
                  <SelectItem value="GRAVE">Grave</SelectItem>
                  <SelectItem value="EXTREMA">Extrema</SelectItem>
                </SiteCorpSelect>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Consecuencias posibles</Label>
                <SiteCorpInput
                  value={consequences}
                  onChange={(e) => setConsequences(e.target.value)}
                  placeholder="Ej. Quemaduras, electrocución..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Controles actuales</Label>
                <SiteCorpInput
                  value={existingControls}
                  onChange={(e) => setExistingControls(e.target.value)}
                  placeholder="Ej. Señalización, bloqueo y etiquetado..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setRiskDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={riskSubmitting}>
                {riskSubmitting ? "Guardando..." : "Registrar en Matriz"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Crear medida preventiva / correctiva */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Registrar medida preventiva o correctiva</DialogTitle>
            <DialogDescription>
              Define la acción concreta, responsable y fecha de vencimiento dentro de la entidad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Descripción de la medida *</Label>
              <SiteCorpInput
                value={actionDescription}
                onChange={(e) => setActionDescription(e.target.value)}
                placeholder="Ej. Instalar guardas protectoras y capacitar al personal del área"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Origen de la medida</Label>
                <SiteCorpSelect
                  value={actionOriginType}
                  onValueChange={(v) => setActionOriginType(v as SstPreventiveActionOrigin)}
                >
                  {Object.entries(SST_ACTION_ORIGIN_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <SiteCorpSelect
                  value={actionPriority}
                  onValueChange={(v) => setActionPriority(v as SstActionPriority)}
                >
                  <SelectItem value="BAJA">Baja</SelectItem>
                  <SelectItem value="MEDIA">Media</SelectItem>
                  <SelectItem value="ALTA">Alta</SelectItem>
                  <SelectItem value="INMEDIATA">Inmediata</SelectItem>
                </SiteCorpSelect>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Responsable de seguimiento</Label>
                <SiteCorpSelect
                  value={actionResponsibleId || "__none__"}
                  onValueChange={(v) => setActionResponsibleId(v === "__none__" ? "" : v)}
                >
                  <SelectItem value="__none__">Seleccionar trabajador...</SelectItem>
                  {workers
                    .filter((w) => w.employmentStatus === "active")
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.fullName}
                      </SelectItem>
                    ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Fecha límite de cumplimiento *</Label>
                <SiteCorpInput
                  type="date"
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setActionDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={actionSubmitting}>
                {actionSubmitting ? "Guardando..." : "Guardar medida"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Actualizar estado de medida preventiva (con justificación de cancelación) */}
      <Dialog
        open={Boolean(editingAction)}
        onOpenChange={(open) => {
          if (!open) setEditingAction(null)
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Actualizar estado de medida preventiva</DialogTitle>
            <DialogDescription>
              Si se cancela una medida, es obligatorio dejar constancia justificada.
            </DialogDescription>
          </DialogHeader>
          {editingAction && (
            <form onSubmit={handleUpdateActionStatus} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nuevo estado</Label>
                <SiteCorpSelect
                  value={nextActionStatus}
                  onValueChange={(v) => setNextActionStatus(v as SstPreventiveActionStatus)}
                >
                  <SelectItem value="PENDIENTE">Pendiente</SelectItem>
                  <SelectItem value="EN_EJECUCION">En ejecución</SelectItem>
                  <SelectItem value="COMPLETADA">Completada</SelectItem>
                  <SelectItem value="VENCIDA">Vencida</SelectItem>
                  <SelectItem value="CANCELADA">Cancelada (requiere justificación)</SelectItem>
                </SiteCorpSelect>
              </div>

              {nextActionStatus === "CANCELADA" && (
                <div className="space-y-1.5">
                  <Label>Justificación de la cancelación *</Label>
                  <SiteCorpInput
                    value={cancelJustification}
                    onChange={(e) => setCancelJustification(e.target.value)}
                    placeholder="Explica el motivo técnico u organizativo de la cancelación..."
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Notas de verificación / eficacia</Label>
                <SiteCorpInput
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  placeholder="Comprobación del cumplimiento..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  onClick={() => setEditingAction(null)}
                >
                  Cerrar
                </SiteCorpButton>
                <SiteCorpButton type="submit">Guardar estado</SiteCorpButton>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
