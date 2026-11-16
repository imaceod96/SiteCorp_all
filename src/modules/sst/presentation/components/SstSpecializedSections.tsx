import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SelectItem } from "@/shared/components/ui/select"
import { Label } from "@/shared/components/ui/label"
import {
  SST_HEALTH_APTITUDE_LABELS,
  type EntityAreaOption,
  type EntityJobOption,
  type EntitySstState,
  type EntityWorkerSstOption,
  type SstHealthAptitudeStatus,
} from "../../domain/entities"
import {
  createSstAccidentIncident,
  createSstCommitteeRecord,
  createSstEmergencyPlan,
  createSstSafeWorkProcedure,
  registerWorkerHealthAptitude,
} from "../../application/sst.service"
import { useToast } from "@/shared/hooks/use-toast"
import { addDaysIsoInCuba, formatIsoDateToDisplay, todayIsoInCuba } from "@/utils/cuba-date"
import {
  HeartPulse,
  Flame,
  Users,
  FileCheck2,
  AlertOctagon,
  BarChart3,
  Plus,
} from "lucide-react"

const HEALTH_EVALUATION_TYPE_LABELS: Record<string, string> = {
  PRE_EMPLEO: "Chequeo pre-empleo",
  INGRESO: "Chequeo de ingreso",
  PERIODICO: "Chequeo periódico",
  REINTEGRO: "Chequeo de reintegro",
  CAMBIO_CARGO: "Por cambio de cargo",
  CAMBIO_PUESTO: "Por cambio de puesto",
  EGRESO: "Chequeo de egreso",
}

const PROCEDURE_STATUS_LABELS: Record<string, string> = {
  VIGENTE: "Vigente",
  EN_REVISION: "En revisión",
  OBSOLETO: "Obsoleto",
}

interface SstSpecializedSectionsProps {
  entityId: string
  state: EntitySstState
  areas: EntityAreaOption[]
  jobs: EntityJobOption[]
  workers: EntityWorkerSstOption[]
  canManage: boolean
  onRefresh: () => Promise<void>
}

export const SstSpecializedSections: React.FC<SstSpecializedSectionsProps> = ({
  entityId,
  state,
  areas,
  jobs,
  workers,
  canManage,
  onRefresh,
}) => {
  const { toast } = useToast()
  const workerMap = React.useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const areaMap = React.useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas])
  const areaActiveMap = React.useMemo(
    () => new Map(areas.map((a) => [a.id, a.isActive !== false])),
    [areas]
  )
  const jobMap = React.useMemo(() => new Map(jobs.map((j) => [j.id, j.name])), [jobs])

  // Formulario rápido: Accidente / Incidente
  const [eventType, setEventType] = React.useState<
    "ACCIDENTE_CON_LESION" | "INCIDENTE_SIN_LESION" | "OTRO"
  >("INCIDENTE_SIN_LESION")
  const [occurredAt, setOccurredAt] = React.useState(() => todayIsoInCuba())
  const [affectedWorkerId, setAffectedWorkerId] = React.useState("")
  const [accidentDesc, setAccidentDesc] = React.useState("")
  const [accidentCauses, setAccidentCauses] = React.useState("")
  const [accidentSeverity, setAccidentSeverity] = React.useState<
    "LEVE" | "MODERADO" | "GRAVE" | "MORTAL"
  >("LEVE")
  const [daysLost, setDaysLost] = React.useState("0")

  // Formulario rápido: Salud ocupacional administrativa
  const [healthWorkerId, setHealthWorkerId] = React.useState("")
  const [healthType, setHealthType] = React.useState<
    "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO"
  >("PERIODICO")
  const [healthDate, setHealthDate] = React.useState(() => todayIsoInCuba())
  const [healthNextDate, setHealthNextDate] = React.useState(
    () => addDaysIsoInCuba(365)
  )
  const [healthStatus, setHealthStatus] = React.useState<SstHealthAptitudeStatus>("APTO")
  const [healthRestrictions, setHealthRestrictions] = React.useState("")

  // Formulario rápido: Emergencias / Comité / Procedimientos
  const [planTitle, setPlanTitle] = React.useState("")
  const [planAreaId, setPlanAreaId] = React.useState("")
  const [drillDate, setDrillDate] = React.useState(() => todayIsoInCuba())

  const [commTitle, setCommTitle] = React.useState("")
  const [commDate, setCommDate] = React.useState(() => todayIsoInCuba())
  const [commNotes, setCommNotes] = React.useState("")

  const [procCode, setProcCode] = React.useState("PTS-01")
  const [procTitle, setProcTitle] = React.useState("")
  const [procJobId, setProcJobId] = React.useState("")
  const [procPermit, setProcPermit] = React.useState(false)

  const handleSaveAccident = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accidentDesc.trim()) return
    const today = todayIsoInCuba()
    if (occurredAt > today) {
      toast({
        variant: "destructive",
        title: "Fecha inválida",
        description: "La fecha del accidente o incidente no puede ser futura.",
      })
      return
    }
    const w = workerMap.get(affectedWorkerId)
    if (w?.hireDate && occurredAt < w.hireDate) {
      toast({
        variant: "destructive",
        title: "Fecha anterior a la incorporación",
        description: `El trabajador seleccionado se incorpora el ${formatIsoDateToDisplay(w.hireDate)}.`,
      })
      return
    }
    try {
      await createSstAccidentIncident({
        entityId,
        eventType,
        occurredAt,
        affectedWorkerId: w?.id || null,
        affectedWorkerName: w?.fullName || null,
        areaId: w?.areaId || null,
        areaName: w?.areaName || null,
        jobId: w?.jobId || null,
        jobName: w?.jobName || null,
        description: accidentDesc,
        immediateCauses: accidentCauses,
        severity: accidentSeverity,
        daysLost: eventType === "ACCIDENTE_CON_LESION" ? Math.max(0, Number(daysLost) || 0) : 0,
      })
      setAccidentDesc("")
      setAccidentCauses("")
      setDaysLost("0")
      await onRefresh()
      toast({
        title: "Evento laboral registrado",
        description: "El registro se incorporó al historial de accidentes e incidentes de la entidad.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al registrar",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  const handleSaveHealthAptitude = async (e: React.FormEvent) => {
    e.preventDefault()
    const w = workerMap.get(healthWorkerId)
    if (!w) return
    if (w.hireDate && healthDate < w.hireDate && healthType !== "PRE_EMPLEO") {
      toast({
        variant: "destructive",
        title: "Fecha anterior a la incorporación",
        description: `El trabajador se incorpora el ${formatIsoDateToDisplay(w.hireDate)}.`,
      })
      return
    }
    if (healthNextDate && healthNextDate <= healthDate) {
      toast({
        variant: "destructive",
        title: "Fecha de próxima revisión inválida",
        description: "La fecha de próxima revisión debe ser posterior a la fecha de evaluación.",
      })
      return
    }
    try {
      await registerWorkerHealthAptitude({
        entityId,
        workerId: w.id,
        workerName: w.fullName,
        jobId: w.jobId,
        jobName: w.jobName,
        evaluationType: healthType,
        evaluationDate: healthDate,
        nextReviewDate: healthNextDate || null,
        aptitudeStatus: healthStatus,
        administrativeRestrictions: healthRestrictions,
      })
      setHealthRestrictions("")
      await onRefresh()
      toast({
        title: "Aptitud ocupacional registrada",
        description: `Se actualizó el estado administrativo de aptitud en la ficha de ${w.fullName}.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al guardar aptitud",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* 7. ACCIDENTES E INCIDENTES LABORALES */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <AlertOctagon className="h-5 w-5 text-sitecorp-danger" />
            <div>
              <h2 className="text-base font-semibold text-ink">
                7. Accidentes e Incidentes Laborales
              </h2>
              <p className="text-xs text-muted-foreground">
                Registro e investigación de accidentes con lesión e incidentes sin lesión de esta
                entidad, conservando el historial tras el cierre.
              </p>
            </div>
          </div>

          {canManage && (
            <form
              onSubmit={handleSaveAccident}
              className="grid gap-3 rounded-xl border border-border bg-muted/15 p-3.5 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-1">
                <Label className="text-xs">Tipo de suceso</Label>
                <SiteCorpSelect
                  value={eventType}
                  onValueChange={(v) => {
                    const nextType = v as "ACCIDENTE_CON_LESION" | "INCIDENTE_SIN_LESION" | "OTRO"
                    setEventType(nextType)
                    if (nextType === "INCIDENTE_SIN_LESION") {
                      setAccidentSeverity("LEVE")
                    }
                    if (nextType !== "ACCIDENTE_CON_LESION") {
                      setDaysLost("0")
                    }
                  }}
                >
                  <SelectItem value="INCIDENTE_SIN_LESION">Incidente sin lesión</SelectItem>
                  <SelectItem value="ACCIDENTE_CON_LESION">Accidente con lesión</SelectItem>
                  <SelectItem value="OTRO">Otro suceso de seguridad</SelectItem>
                </SiteCorpSelect>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Fecha de ocurrencia</Label>
                <SiteCorpInput
                  type="date"
                  max={todayIsoInCuba()}
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Trabajador involucrado (opcional)</Label>
                <SiteCorpSelect
                  value={affectedWorkerId || "__none__"}
                  onValueChange={(v) => setAffectedWorkerId(v === "__none__" ? "" : v)}
                >
                  <SelectItem value="__none__">Trabajador involucrado (opcional)</SelectItem>
                  {workers
                    .filter((w) => !w.hireDate || w.hireDate <= (occurredAt || todayIsoInCuba()))
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.fullName}
                      </SelectItem>
                    ))}
                </SiteCorpSelect>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Severidad</Label>
                <SiteCorpSelect
                  value={accidentSeverity}
                  onValueChange={(v) =>
                    setAccidentSeverity(v as "LEVE" | "MODERADO" | "GRAVE" | "MORTAL")
                  }
                >
                  <SelectItem value="LEVE">Severidad: Leve</SelectItem>
                  <SelectItem value="MODERADO">Severidad: Moderado</SelectItem>
                  <SelectItem value="GRAVE">Severidad: Grave</SelectItem>
                  <SelectItem value="MORTAL">Severidad: Mortal</SelectItem>
                </SiteCorpSelect>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descripción del suceso</Label>
                <SiteCorpInput
                  value={accidentDesc}
                  onChange={(e) => setAccidentDesc(e.target.value)}
                  placeholder="Descripción del suceso..."
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Causas inmediatas</Label>
                <SiteCorpInput
                  value={accidentCauses}
                  onChange={(e) => setAccidentCauses(e.target.value)}
                  placeholder="Causas inmediatas identificadas..."
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Días perdidos</Label>
                <SiteCorpInput
                  type="number"
                  min={0}
                  value={daysLost}
                  disabled={eventType !== "ACCIDENTE_CON_LESION"}
                  onChange={(e) => setDaysLost(e.target.value)}
                  placeholder="Días perdidos"
                  title="Días laborales perdidos por incapacidad (solo aplica a accidente con lesión)"
                />
              </div>

              <div className="flex items-end">
                <SiteCorpButton type="submit" size="sm" className="w-full sm:w-auto">
                  <Plus className="mr-1 h-4 w-4" /> Registrar suceso
                </SiteCorpButton>
              </div>
            </form>
          )}

          {state.accidentsIncidents.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Sin accidentes ni incidentes laborales registrados en esta entidad.
            </p>
          ) : (
            <div className="space-y-2">
              {state.accidentsIncidents.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-xs"
                >
                  <div>
                    <p className="font-semibold text-ink">
                      {formatIsoDateToDisplay(item.occurred_at)} — {item.description}
                    </p>
                    <p className="text-muted-foreground">
                      Trabajador: {item.affected_worker_name || "No especificado"} • Cargo:{" "}
                      {item.job_name_snapshot || "—"}
                      {item.severity ? ` • Severidad: ${item.severity}` : ""}
                      {item.days_lost ? ` • Días perdidos: ${item.days_lost}` : ""}
                    </p>
                  </div>
                  <SiteCorpStatusBadge
                    status={
                      item.event_type === "ACCIDENTE_CON_LESION" ? "danger" : "warning"
                    }
                  >
                    {item.event_type === "ACCIDENTE_CON_LESION"
                      ? "Accidente con lesión"
                      : item.event_type === "INCIDENTE_SIN_LESION"
                        ? "Incidente sin lesión"
                        : "Otro suceso"}
                  </SiteCorpStatusBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* 8. SALUD OCUPACIONAL ADMINISTRATIVA */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <HeartPulse className="h-5 w-5 text-sitecorp-success" />
            <div>
              <h2 className="text-base font-semibold text-ink">
                8. Salud Ocupacional (Control Administrativo de Aptitud)
              </h2>
              <p className="text-xs text-muted-foreground">
                Control de chequeos pre-empleo y periódicos, conclusión administrativa de aptitud y
                restricciones del puesto (sin almacenar diagnósticos médicos confidenciales).
              </p>
            </div>
          </div>

          {canManage && (
            <form
              onSubmit={handleSaveHealthAptitude}
              className="grid gap-3 rounded-xl border border-border bg-muted/15 p-3.5 sm:grid-cols-2 lg:grid-cols-7"
            >
              <SiteCorpSelect
                value={healthWorkerId || "__none__"}
                onValueChange={(v) => setHealthWorkerId(v === "__none__" ? "" : v)}
              >
                <SelectItem value="__none__">Seleccionar trabajador...</SelectItem>
                {workers
                  .filter(
                    (w) =>
                      w.employmentStatus === "active" &&
                      (healthType === "PRE_EMPLEO" ||
                        !w.hireDate ||
                        w.hireDate <= (healthDate || todayIsoInCuba()))
                  )
                  .map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.fullName}
                    </SelectItem>
                  ))}
              </SiteCorpSelect>

              <SiteCorpSelect
                value={healthType}
                onValueChange={(v) =>
                  setHealthType(v as "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO")
                }
              >
                <SelectItem value="PRE_EMPLEO">Chequeo pre-empleo</SelectItem>
                <SelectItem value="PERIODICO">Chequeo periódico</SelectItem>
                <SelectItem value="CAMBIO_CARGO">Por cambio de cargo</SelectItem>
                <SelectItem value="REINTEGRO">Por reintegro</SelectItem>
              </SiteCorpSelect>

              <SiteCorpSelect
                value={healthStatus}
                onValueChange={(v) => setHealthStatus(v as SstHealthAptitudeStatus)}
              >
                <SelectItem value="APTO">Apto</SelectItem>
                <SelectItem value="APTO_CON_RESTRICCIONES">Apto con restricciones</SelectItem>
                <SelectItem value="NO_APTO_TEMPORAL">No apto temporal</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
              </SiteCorpSelect>

              <SiteCorpInput
                type="date"
                value={healthDate}
                onChange={(e) => setHealthDate(e.target.value)}
                title="Fecha de evaluación"
                required
              />

              <SiteCorpInput
                type="date"
                min={addDaysIsoInCuba(1, healthDate || todayIsoInCuba())}
                value={healthNextDate}
                onChange={(e) => setHealthNextDate(e.target.value)}
                title="Próxima revisión"
              />

              <SiteCorpInput
                value={healthRestrictions}
                onChange={(e) => setHealthRestrictions(e.target.value)}
                placeholder="Restricciones administrativas..."
              />

              <SiteCorpButton type="submit" size="sm" disabled={!healthWorkerId}>
                Guardar aptitud
              </SiteCorpButton>
            </form>
          )}

          {state.healthAptitudes.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Sin evaluaciones de aptitud ocupacional registradas en esta entidad.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {state.healthAptitudes.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white p-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-ink">{h.worker_name_snapshot}</p>
                    <p className="text-muted-foreground">
                      {HEALTH_EVALUATION_TYPE_LABELS[h.evaluation_type] || h.evaluation_type} • Eval.:{" "}
                      {formatIsoDateToDisplay(h.evaluation_date)}
                      {h.next_review_date
                        ? ` • Próx.: ${formatIsoDateToDisplay(h.next_review_date)}`
                        : ""}
                    </p>
                    {h.administrative_restrictions && (
                      <p className="text-sitecorp-warning">
                        Restricción: {h.administrative_restrictions}
                      </p>
                    )}
                  </div>
                  <SiteCorpStatusBadge
                    status={
                      h.aptitude_status === "APTO"
                        ? "success"
                        : h.aptitude_status === "APTO_CON_RESTRICCIONES"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {SST_HEALTH_APTITUDE_LABELS[h.aptitude_status]}
                  </SiteCorpStatusBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* 9. EMERGENCIAS, 10. COMITÉ SST Y 11. PROCEDIMIENTOS DE TRABAJO SEGURO */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 9. Emergencias y protección contra incendios */}
        <SiteCorpCard className="rounded-2xl">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Flame className="h-4 w-4 text-sitecorp-secondary-orange" />
              <h3 className="text-sm font-semibold text-ink">
                9. Emergencias y Contra Incendios
              </h3>
            </div>
            {canManage && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!planTitle.trim()) return
                  if (!drillDate) {
                    toast({
                      variant: "destructive",
                      title: "Fecha de simulacro obligatoria",
                      description: "Debes indicar la fecha del simulacro para registrar el plan.",
                    })
                    return
                  }
                  try {
                    await createSstEmergencyPlan({
                      entityId,
                      areaId: planAreaId || null,
                      areaName: planAreaId ? areaMap.get(planAreaId) || null : null,
                      title: planTitle,
                      planType: "EMERGENCIA_Y_EVACUACION",
                      version: "1.0",
                      lastDrillDate: drillDate,
                    })
                    setPlanTitle("")
                    await onRefresh()
                  } catch (err) {
                    toast({
                      variant: "destructive",
                      title: "Error al registrar plan",
                      description: err instanceof Error ? err.message : "Error inesperado.",
                    })
                  }
                }}
                className="space-y-2"
              >
                <SiteCorpInput
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  placeholder="Nombre del plan o simulacro..."
                  required
                />
                <div className="flex gap-2">
                  <SiteCorpInput
                    type="date"
                    value={drillDate}
                    onChange={(e) => setDrillDate(e.target.value)}
                    title="Fecha de simulacro"
                    required
                  />
                  <SiteCorpButton type="submit" size="sm">
                    Añadir
                  </SiteCorpButton>
                </div>
              </form>
            )}
            <div className="space-y-1.5">
              {state.emergencyPlans.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                >
                  <p className="font-medium text-ink">{p.title}</p>
                  {p.last_drill_date && (
                    <p className="text-muted-foreground">
                      Simulacro: {formatIsoDateToDisplay(p.last_drill_date)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </SiteCorpCard>

        {/* 10. Comité de Seguridad y Salud */}
        <SiteCorpCard className="rounded-2xl">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Users className="h-4 w-4 text-sitecorp-primary" />
              <h3 className="text-sm font-semibold text-ink">
                10. Comité de Seguridad y Salud
              </h3>
            </div>
            {canManage && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!commTitle.trim()) return
                  await createSstCommitteeRecord({
                    entityId,
                    recordType: "ACTA_REUNION",
                    title: commTitle,
                    recordDate: commDate,
                    agreementsOrNotes: commNotes,
                  })
                  setCommTitle("")
                  setCommNotes("")
                  await onRefresh()
                }}
                className="space-y-2"
              >
                <SiteCorpInput
                  value={commTitle}
                  onChange={(e) => setCommTitle(e.target.value)}
                  placeholder="Acta, acuerdo o integrante del Comité..."
                  required
                />
                <div className="flex gap-2">
                  <SiteCorpInput
                    type="date"
                    value={commDate}
                    onChange={(e) => setCommDate(e.target.value)}
                  />
                  <SiteCorpButton type="submit" size="sm">
                    Registrar
                  </SiteCorpButton>
                </div>
              </form>
            )}
            <div className="space-y-1.5">
              {state.committeeRecords.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                >
                  <p className="font-medium text-ink">{c.title}</p>
                  <p className="text-muted-foreground">
                    {formatIsoDateToDisplay(c.record_date)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </SiteCorpCard>

        {/* 11. Procedimientos de Trabajo Seguro (PTS) */}
        <SiteCorpCard className="rounded-2xl">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <FileCheck2 className="h-4 w-4 text-sitecorp-success" />
              <h3 className="text-sm font-semibold text-ink">
                11. Procedimientos de Trabajo Seguro
              </h3>
            </div>
            {canManage && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!procTitle.trim()) return
                  await createSstSafeWorkProcedure({
                    entityId,
                    code: procCode,
                    title: procTitle,
                    jobId: procJobId || null,
                    jobName: procJobId ? jobMap.get(procJobId) || null : null,
                    version: "1.0",
                    requiresSpecialPermit: procPermit,
                  })
                  setProcTitle("")
                  await onRefresh()
                }}
                className="space-y-2"
              >
                <div className="flex gap-2">
                  <SiteCorpInput
                    value={procCode}
                    onChange={(e) => setProcCode(e.target.value)}
                    placeholder="Código"
                    className="w-24"
                  />
                  <SiteCorpInput
                    value={procTitle}
                    onChange={(e) => setProcTitle(e.target.value)}
                    placeholder="Título del procedimiento seguro..."
                    required
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={procPermit}
                      onChange={(e) => setProcPermit(e.target.checked)}
                    />
                    Exige permiso especial (altura, caliente, eléctrico)
                  </label>
                  <SiteCorpButton type="submit" size="sm">
                    Guardar PTS
                  </SiteCorpButton>
                </div>
              </form>
            )}
            <div className="space-y-1.5">
              {state.safeWorkProcedures.map((proc) => (
                <div
                  key={proc.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-medium text-ink">
                      {proc.code} — {proc.title}
                    </p>
                    {proc.requires_special_permit && (
                      <p className="text-sitecorp-secondary-orange">Requiere permiso de trabajo</p>
                    )}
                  </div>
                  <SiteCorpStatusBadge status="success">
                    {PROCEDURE_STATUS_LABELS[proc.status] || proc.status}
                  </SiteCorpStatusBadge>
                </div>
              ))}
            </div>
          </div>
        </SiteCorpCard>
      </div>

      {/* 12. INFORMES E INDICADORES DE CUMPLIMIENTO POR CARGO */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <BarChart3 className="h-5 w-5 text-sitecorp-primary" />
            <div>
              <h2 className="text-base font-semibold text-ink">
                12. Resumen de Cumplimiento de SST por Cargo de la Entidad
              </h2>
              <p className="text-xs text-muted-foreground">
                Consolidado de carpetas de SST, temas, sesiones realizadas, riesgos asociados y EPP
                requeridos por cada cargo de la entidad.
              </p>
            </div>
          </div>

          <div className="w-full min-w-0 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Cargo en la entidad</th>
                  <th className="px-4 py-3">Área</th>
                  <th className="px-4 py-3">Temas SST</th>
                  <th className="px-4 py-3">Sesiones realizadas</th>
                  <th className="px-4 py-3">Riesgos activos</th>
                  <th className="px-4 py-3">EPP obligatorios</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {jobs.map((job) => {
                  const topicsCount = state.topics.filter((t) => t.job_id === job.id).length
                  const doneSessions = state.sessions.filter(
                    (s) => s.job_id === job.id && s.status === "REALIZADA"
                  ).length
                  const activeRisks = state.risks.filter(
                    (r) => r.job_id === job.id && r.status === "ACTIVO"
                  ).length
                  const eppReqs = state.jobEppRequirements.filter(
                    (req) => req.job_id === job.id
                  ).length

                  return (
                    <tr key={job.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium text-ink">{job.name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {job.areaName
                          ? `${job.areaName}${
                              job.areaId && areaActiveMap.get(job.areaId) === false
                                ? " (inactiva)"
                                : ""
                            }`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{topicsCount}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-sitecorp-success tabular-nums">
                        {doneSessions}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{activeRisks}</td>
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{eppReqs}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </SiteCorpCard>
    </div>
  )
}
