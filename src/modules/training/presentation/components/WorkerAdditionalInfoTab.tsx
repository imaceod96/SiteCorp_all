import * as React from "react"
import { Link } from "react-router-dom"
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
  loadWorkerTrainingProfile,
  registerWorkerInitialTraining,
  type WorkerTrainingProfileData,
} from "../../application/training.service"
import { TRAINING_CHANGED_EVENT } from "../../infrastructure/training.repository"
import {
  loadWorkerSstProfile,
  registerWorkerDirectSstTraining,
  registerWorkerEppDelivery,
  registerWorkerHealthAptitude,
  SST_CHANGED_EVENT,
  SST_EPP_DELIVERY_STATUS_LABELS,
  SST_HEALTH_APTITUDE_LABELS,
  type WorkerSstProfileData,
  type SstEppDeliveryStatus,
  type SstHealthAptitudeStatus,
} from "@/modules/sst"
import {
  GraduationCap,
  CheckCircle2,
  BellRing,
  Calendar,
  Building2,
  Briefcase,
  Plus,
  BookOpen,
  ArrowUpRight,
  ShieldCheck,
  HardHat,
  HeartPulse,
} from "lucide-react"
import { useToast } from "@/shared/hooks/use-toast"

interface WorkerAdditionalInfoTabProps {
  entityId: string
  workerId: string
  workerName: string
  currentAreaId: string | null
  currentAreaName: string | null
  currentJobId?: string | null
  currentJobName?: string | null
  currentPositionName: string | null
  hireDate: string | null
  canManage: boolean
}

type TrainingOriginFilter = "ALL" | "GENERAL" | "SST"

interface UnifiedTrainingRow {
  id: string
  origin: "GENERAL" | "SST"
  topicTitle: string
  scopeLabel: string
  receivedDate: string
  kindLabel: string
  isInitial: boolean
  notes: string | null
  createdAt: string
}

export const WorkerAdditionalInfoTab: React.FC<WorkerAdditionalInfoTabProps> = ({
  entityId,
  workerId,
  workerName,
  currentAreaId,
  currentAreaName,
  currentJobId = null,
  currentJobName = null,
  currentPositionName,
  hireDate,
  canManage,
}) => {
  const { toast } = useToast()
  const [profileData, setProfileData] = React.useState<WorkerTrainingProfileData>({
    records: [],
    pendingNotifications: [],
    completedNotifications: [],
    availableTopics: [],
  })
  const [sstProfile, setSstProfile] = React.useState<WorkerSstProfileData>({
    sstTrainingRecords: [],
    pendingNotifications: [],
    availableSstTopics: [],
    eppCatalog: [],
    jobEppRequirements: [],
    eppDeliveries: [],
    healthAptitudes: [],
  })
  const [loading, setLoading] = React.useState(true)
  const [originFilter, setOriginFilter] = React.useState<TrainingOriginFilter>("ALL")

  // Diálogo de registro de capacitación General
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [activeNotificationId, setActiveNotificationId] = React.useState<string | null>(null)
  const [selectedTopicId, setSelectedTopicId] = React.useState<string>("__custom__")
  const [customTopicTitle, setCustomTopicTitle] = React.useState<string>(
    "Capacitación inicial e inducción al puesto"
  )
  const [receivedDate, setReceivedDate] = React.useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [notes, setNotes] = React.useState<string>("")
  const [submitting, setSubmitting] = React.useState(false)

  // Diálogo de registro de capacitación SST por cargo
  const [sstTrainingDialogOpen, setSstTrainingDialogOpen] = React.useState(false)
  const [activeSstNotificationId, setActiveSstNotificationId] = React.useState<string | null>(null)
  const [selectedSstTopicId, setSelectedSstTopicId] = React.useState<string>("__custom__")
  const [customSstTopicTitle, setCustomSstTopicTitle] = React.useState<string>(
    "Instrucción inicial de Seguridad y Salud en el Trabajo (SST)"
  )
  const [sstReceivedDate, setSstReceivedDate] = React.useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [sstNotes, setSstNotes] = React.useState<string>("")
  const [submittingSstTraining, setSubmittingSstTraining] = React.useState(false)

  // Diálogo de entrega de EPP al trabajador
  const [eppDialogOpen, setEppDialogOpen] = React.useState(false)
  const [selectedEppId, setSelectedEppId] = React.useState<string>("__custom__")
  const [customEppName, setCustomEppName] = React.useState<string>("")
  const [eppDeliveryDate, setEppDeliveryDate] = React.useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [eppRenewalDueDate, setEppRenewalDueDate] = React.useState<string>("")
  const [eppQuantity, setEppQuantity] = React.useState<string>("1")
  const [eppStatus, setEppStatus] = React.useState<SstEppDeliveryStatus>("ENTREGADO")
  const [eppSigned, setEppSigned] = React.useState<boolean>(true)
  const [eppNotes, setEppNotes] = React.useState<string>("")
  const [submittingEpp, setSubmittingEpp] = React.useState(false)

  // Diálogo de aptitud ocupacional administrativa
  const [aptitudeDialogOpen, setAptitudeDialogOpen] = React.useState(false)
  const [evaluationType, setEvaluationType] = React.useState<
    "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO"
  >("PERIODICO")
  const [aptitudeStatus, setAptitudeStatus] = React.useState<SstHealthAptitudeStatus>("APTO")
  const [evaluationDate, setEvaluationDate] = React.useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [nextReviewDate, setNextReviewDate] = React.useState<string>("")
  const [workRestrictions, setWorkRestrictions] = React.useState<string>("")
  const [aptitudeObservations, setAptitudeObservations] = React.useState<string>("")
  const [submittingAptitude, setSubmittingAptitude] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!entityId || !workerId) return
    try {
      const [generalData, sstData] = await Promise.all([
        loadWorkerTrainingProfile(entityId, workerId),
        loadWorkerSstProfile(entityId, workerId, currentJobId),
      ])
      setProfileData(generalData)
      setSstProfile(sstData)
    } catch (err) {
      console.error("[training/sst] error cargando perfil del trabajador:", err)
    } finally {
      setLoading(false)
    }
  }, [entityId, workerId, currentJobId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh()
    }
    window.addEventListener(TRAINING_CHANGED_EVENT, handleChanged)
    window.addEventListener(SST_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(TRAINING_CHANGED_EVENT, handleChanged)
      window.removeEventListener(SST_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  const unifiedTrainings = React.useMemo<UnifiedTrainingRow[]>(() => {
    const generalRows: UnifiedTrainingRow[] = profileData.records.map((rec) => ({
      id: `gen-${rec.id}`,
      origin: "GENERAL",
      topicTitle: rec.topic_title_snapshot,
      scopeLabel: rec.area_name_snapshot || currentAreaName || "Área general",
      receivedDate: rec.received_date,
      kindLabel:
        rec.kind === "CAPACITACION_INICIAL" ? "Capacitación inicial" : "Sesión programada",
      isInitial: rec.kind === "CAPACITACION_INICIAL",
      notes: rec.notes,
      createdAt: rec.created_at,
    }))

    const sstRows: UnifiedTrainingRow[] = sstProfile.sstTrainingRecords.map((rec) => ({
      id: `sst-${rec.id}`,
      origin: "SST",
      topicTitle: rec.topic_title_snapshot,
      scopeLabel: rec.job_name_snapshot || currentJobName || "Cargo SST",
      receivedDate: rec.received_date,
      kindLabel:
        rec.kind === "INICIAL_CONTRATACION_SST"
          ? "Instrucción inicial SST"
          : rec.kind === "CAMBIO_CARGO_SST"
            ? "Instrucción cambio de cargo SST"
            : "Sesión programada SST",
      isInitial: rec.kind !== "SESION_SST",
      notes: rec.notes,
      createdAt: rec.created_at,
    }))

    return [...generalRows, ...sstRows]
      .filter((row) => (originFilter === "ALL" ? true : row.origin === originFilter))
      .sort(
        (a, b) =>
          b.receivedDate.localeCompare(a.receivedDate) ||
          b.createdAt.localeCompare(a.createdAt)
      )
  }, [
    profileData.records,
    sstProfile.sstTrainingRecords,
    currentAreaName,
    currentJobName,
    originFilter,
  ])

  const latestAptitude = sstProfile.healthAptitudes[0] ?? null

  const openRegisterDialog = (notificationId: string | null = null) => {
    setActiveNotificationId(notificationId)
    const areaTopics = profileData.availableTopics.filter(
      (t) => currentAreaId && t.areaId === currentAreaId
    )
    if (areaTopics.length > 0) {
      setSelectedTopicId(areaTopics[0].id)
      setCustomTopicTitle("")
    } else {
      setSelectedTopicId("__custom__")
      setCustomTopicTitle(
        currentAreaName
          ? `Capacitación inicial — ${currentAreaName}`
          : "Capacitación inicial e inducción al puesto"
      )
    }
    setReceivedDate(new Date().toISOString().slice(0, 10))
    setNotes("")
    setDialogOpen(true)
  }

  const openRegisterSstDialog = (notificationId: string | null = null) => {
    setActiveSstNotificationId(notificationId)
    const jobTopics = sstProfile.availableSstTopics.filter(
      (t) => currentJobId && t.jobId === currentJobId
    )
    if (jobTopics.length > 0) {
      setSelectedSstTopicId(jobTopics[0].id)
      setCustomSstTopicTitle("")
    } else {
      setSelectedSstTopicId("__custom__")
      setCustomSstTopicTitle(
        currentJobName
          ? `Instrucción inicial de SST — Cargo ${currentJobName}`
          : "Instrucción inicial de Seguridad y Salud en el Trabajo (SST)"
      )
    }
    setSstReceivedDate(new Date().toISOString().slice(0, 10))
    setSstNotes("")
    setSstTrainingDialogOpen(true)
  }

  const openEppDeliveryDialog = () => {
    const defaultEpp =
      sstProfile.jobEppRequirements[0]?.epp_id ||
      sstProfile.eppCatalog[0]?.id ||
      "__custom__"
    setSelectedEppId(defaultEpp)
    setCustomEppName("")
    setEppDeliveryDate(new Date().toISOString().slice(0, 10))
    setEppRenewalDueDate("")
    setEppQuantity("1")
    setEppStatus("ENTREGADO")
    setEppSigned(true)
    setEppNotes("")
    setEppDialogOpen(true)
  }

  const openAptitudeDialog = () => {
    setEvaluationType(latestAptitude?.evaluation_type ?? "PERIODICO")
    setAptitudeStatus(latestAptitude?.aptitude_status ?? "APTO")
    setEvaluationDate(
      latestAptitude?.evaluation_date ?? new Date().toISOString().slice(0, 10)
    )
    setNextReviewDate(latestAptitude?.next_review_date ?? "")
    setWorkRestrictions(latestAptitude?.administrative_restrictions ?? "")
    setAptitudeObservations(latestAptitude?.administrative_notes ?? "")
    setAptitudeDialogOpen(true)
  }

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId || !workerId) return

    const isCustom = selectedTopicId === "__custom__"
    if (isCustom && !customTopicTitle.trim()) {
      toast({
        variant: "destructive",
        title: "Tema requerido",
        description: "Escribe el nombre del tema de capacitación inicial.",
      })
      return
    }

    setSubmitting(true)
    try {
      await registerWorkerInitialTraining({
        entityId,
        workerId,
        topicId: isCustom ? null : selectedTopicId,
        customTopicTitle: isCustom ? customTopicTitle.trim() : null,
        areaId: currentAreaId,
        areaName: currentAreaName,
        receivedDate,
        notes: notes.trim() || null,
        notificationId: activeNotificationId,
      })

      toast({
        title: "Capacitación registrada",
        description: `Se registró la capacitación como Recibida en el historial de ${workerName}.`,
      })
      setDialogOpen(false)
      await refresh()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo registrar la capacitación",
        description: err instanceof Error ? err.message : "Ocurrió un error inesperado.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegisterSstSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId || !workerId) return

    const isCustom = selectedSstTopicId === "__custom__"
    if (isCustom && !customSstTopicTitle.trim()) {
      toast({
        variant: "destructive",
        title: "Tema de SST requerido",
        description: "Especifica el tema de capacitación de SST recibido por el trabajador.",
      })
      return
    }

    setSubmittingSstTraining(true)
    try {
      await registerWorkerDirectSstTraining({
        entityId,
        workerId,
        topicId: isCustom ? null : selectedSstTopicId,
        customTopicTitle: isCustom ? customSstTopicTitle.trim() : null,
        jobId: currentJobId,
        jobName: currentJobName,
        areaId: currentAreaId,
        areaName: currentAreaName,
        receivedDate: sstReceivedDate,
        notes: sstNotes.trim() || null,
        notificationId: activeSstNotificationId,
      })

      toast({
        title: "Capacitación de SST registrada",
        description: `Se incorporó la capacitación de SST como Recibida en la ficha de ${workerName}.`,
      })
      setSstTrainingDialogOpen(false)
      await refresh()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo registrar la capacitación de SST",
        description: err instanceof Error ? err.message : "Ocurrió un error inesperado.",
      })
    } finally {
      setSubmittingSstTraining(false)
    }
  }

  const handleEppDeliverySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const isCustom = selectedEppId === "__custom__"
    const eppItem = sstProfile.eppCatalog.find((item) => item.id === selectedEppId)
    const resolvedEppName = isCustom ? customEppName.trim() : eppItem?.name || ""

    if (!resolvedEppName) {
      toast({
        variant: "destructive",
        title: "Equipo requerido",
        description: "Selecciona o escribe el nombre del equipo de protección personal.",
      })
      return
    }

    setSubmittingEpp(true)
    try {
      await registerWorkerEppDelivery({
        entityId,
        workerId,
        workerName,
        jobId: currentJobId,
        jobName: currentJobName,
        eppId: isCustom ? null : selectedEppId,
        eppName: resolvedEppName,
        deliveryDate: eppDeliveryDate,
        renewalDueDate: eppRenewalDueDate || null,
        quantity: Math.max(1, Number(eppQuantity) || 1),
        status: eppStatus,
        signedReceipt: eppSigned,
        notes: eppNotes.trim() || null,
      })

      toast({
        title: "Entrega de EPP registrada",
        description: `Se registró la entrega nominal de EPP a ${workerName}.`,
      })
      setEppDialogOpen(false)
      await refresh()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo registrar la entrega de EPP",
        description: err instanceof Error ? err.message : "Ocurrió un error inesperado.",
      })
    } finally {
      setSubmittingEpp(false)
    }
  }

  const handleAptitudeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingAptitude(true)
    try {
      await registerWorkerHealthAptitude({
        entityId,
        workerId,
        workerName,
        jobId: currentJobId,
        jobName: currentJobName,
        evaluationType,
        evaluationDate,
        nextReviewDate: nextReviewDate || null,
        aptitudeStatus,
        administrativeRestrictions: workRestrictions.trim() || null,
        administrativeNotes: aptitudeObservations.trim() || null,
      })

      toast({
        title: "Aptitud ocupacional actualizada",
        description: `Se registró la evaluación administrativa de aptitud de ${workerName}.`,
      })
      setAptitudeDialogOpen(false)
      await refresh()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo guardar la aptitud ocupacional",
        description: err instanceof Error ? err.message : "Ocurrió un error inesperado.",
      })
    } finally {
      setSubmittingAptitude(false)
    }
  }

  const totalTrainingsCount =
    profileData.records.length + sstProfile.sstTrainingRecords.length

  return (
    <div className="space-y-6">
      {/* Bloque de Notificación de Capacitación Inicial General Pendiente */}
      {profileData.pendingNotifications.length > 0 && (
        <SiteCorpCard className="border-sitecorp-warning/40 bg-sitecorp-warning/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-sitecorp-warning/15 p-2.5 text-sitecorp-warning">
                <BellRing className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-ink">
                    Capacitación inicial general pendiente por contratación
                  </h3>
                  <SiteCorpStatusBadge status="warning">Pendiente</SiteCorpStatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Contratado el{" "}
                  <strong className="font-medium text-ink tabular-nums">
                    {profileData.pendingNotifications[0].hire_date || hireDate || "—"}
                  </strong>{" "}
                  en el área{" "}
                  <strong className="font-medium text-ink">
                    {profileData.pendingNotifications[0].area_name ||
                      currentAreaName ||
                      "Sin área asignada"}
                  </strong>
                  . Registra su capacitación inicial de área para incorporarla a su historial.
                </p>
              </div>
            </div>

            {canManage && (
              <SiteCorpButton
                type="button"
                onClick={() => openRegisterDialog(profileData.pendingNotifications[0].id)}
              >
                <GraduationCap className="mr-2 h-4 w-4" />
                Registrar capacitación inicial
              </SiteCorpButton>
            )}
          </div>
        </SiteCorpCard>
      )}

      {/* Bloque de Notificación de Capacitación SST Pendiente por Contratación o Cambio de Cargo */}
      {sstProfile.pendingNotifications.length > 0 && (
        <SiteCorpCard className="border-sitecorp-secondary-orange/40 bg-sitecorp-secondary-orange/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-sitecorp-secondary-orange/15 p-2.5 text-sitecorp-secondary-orange">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-ink">
                    Capacitación de SST pendiente por{" "}
                    {sstProfile.pendingNotifications[0].trigger_type === "CAMBIO_CARGO"
                      ? "cambio de cargo"
                      : "nueva contratación"}
                  </h3>
                  <SiteCorpStatusBadge status="warning">SST Pendiente</SiteCorpStatusBadge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cargo asignado:{" "}
                  <strong className="font-medium text-ink">
                    {sstProfile.pendingNotifications[0].job_name ||
                      currentJobName ||
                      "Sin cargo"}
                  </strong>{" "}
                  (fecha efectiva{" "}
                  <strong className="font-medium text-ink tabular-nums">
                    {sstProfile.pendingNotifications[0].effective_date || hireDate || "—"}
                  </strong>
                  ). Registra la instrucción de SST del cargo.
                </p>
              </div>
            </div>

            {canManage && (
              <SiteCorpButton
                type="button"
                onClick={() => openRegisterSstDialog(sstProfile.pendingNotifications[0].id)}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Registrar capacitación SST
              </SiteCorpButton>
            )}
          </div>
        </SiteCorpCard>
      )}

      {/* SECCIÓN 1: Información adicional — Capacitaciones recibidas (General + SST) */}
      <SiteCorpCard>
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <GraduationCap className="h-5 w-5 text-sitecorp-primary" />
                <h3 className="text-lg font-semibold text-ink">
                  Información adicional — Capacitaciones recibidas
                </h3>
                <SiteCorpStatusBadge status="info">
                  {totalTrainingsCount}{" "}
                  {totalTrainingsCount === 1 ? "registro" : "registros"}
                </SiteCorpStatusBadge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Historial individual unificado de capacitaciones generales (por área) y de
                Seguridad y Salud en el Trabajo (SST por cargo). Cada participación se conserva
                como un registro independiente aunque el trabajador cambie de área o cargo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/entity/${entityId}/training`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-sitecorp-primary transition-colors hover:bg-muted/40"
              >
                <BookOpen className="h-4 w-4" />
                Capacitación
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to={`/entity/${entityId}/sst`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-sitecorp-primary transition-colors hover:bg-muted/40"
              >
                <ShieldCheck className="h-4 w-4" />
                Módulo SST
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              {canManage && (
                <>
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openRegisterDialog(null)}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Capacitación general
                  </SiteCorpButton>
                  <SiteCorpButton
                    type="button"
                    size="sm"
                    onClick={() => openRegisterSstDialog(null)}
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    Capacitación SST
                  </SiteCorpButton>
                </>
              )}
            </div>
          </div>

          {/* Resumen de ubicación organizativa y filtro de origen */}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Área actual</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                <Building2 className="h-3.5 w-3.5 text-sitecorp-primary" />
                {currentAreaName || "Sin área asignada"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cargo actual (SST)</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                <Briefcase className="h-3.5 w-3.5 text-sitecorp-secondary-orange" />
                {currentJobName || currentPositionName || "Sin cargo asignado"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Capacitaciones recibidas</p>
              <p className="mt-0.5 text-sm font-semibold text-sitecorp-success tabular-nums">
                {profileData.records.length} general · {sstProfile.sstTrainingRecords.length} SST
              </p>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              {(["ALL", "GENERAL", "SST"] as TrainingOriginFilter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOriginFilter(key)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    originFilter === key
                      ? "bg-sitecorp-primary text-white"
                      : "border border-border bg-white text-muted-foreground hover:text-ink"
                  }`}
                >
                  {key === "ALL" ? "Todas" : key === "GENERAL" ? "General" : "SST"}
                </button>
              ))}
            </div>
          </div>

          {/* Listado histórico de capacitaciones recibidas */}
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Cargando historial de capacitaciones...
            </div>
          ) : unifiedTrainings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium text-ink">
                Sin capacitaciones registradas en este filtro
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Cuando el trabajador participe en sesiones realizadas de Capacitación General o
                de SST por cargo, aparecerán aquí con estado «Recibida».
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Tema de capacitación</th>
                    <th className="px-4 py-3">Ámbito</th>
                    <th className="px-4 py-3">Área / Cargo (snapshot)</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Tipo de sesión</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {unifiedTrainings.map((rec) => (
                    <tr key={rec.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-ink">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-sitecorp-success" />
                          <span>{rec.topicTitle}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SiteCorpStatusBadge
                          status={rec.origin === "SST" ? "warning" : "info"}
                        >
                          {rec.origin === "SST" ? "SST · Cargo" : "General · Área"}
                        </SiteCorpStatusBadge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{rec.scopeLabel}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {rec.receivedDate}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <SiteCorpStatusBadge status={rec.isInitial ? "info" : "neutral"}>
                          {rec.kindLabel}
                        </SiteCorpStatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <SiteCorpStatusBadge status="success">Recibida</SiteCorpStatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {rec.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* SECCIÓN 2: Bloque SST del Trabajador (EPP y Aptitud Ocupacional Administrativa) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sub-bloque: Equipos de Protección Personal (EPP) */}
        <SiteCorpCard>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <HardHat className="h-5 w-5 text-sitecorp-secondary-orange" />
                  <h3 className="text-base font-semibold text-ink">
                    SST — Equipos de Protección Personal (EPP)
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Entregas nominales y reposiciones vinculadas al cargo{" "}
                  <strong className="text-ink">
                    {currentJobName || "actual del trabajador"}
                  </strong>
                  .
                </p>
              </div>
              {canManage && (
                <SiteCorpButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={openEppDeliveryDialog}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Registrar entrega EPP
                </SiteCorpButton>
              )}
            </div>

            {/* EPP requeridos para su cargo actual */}
            {sstProfile.jobEppRequirements.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  EPP exigidos para el cargo ({currentJobName})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sstProfile.jobEppRequirements.map((req) => {
                    const delivered = sstProfile.eppDeliveries.some(
                      (d) =>
                        d.epp_id === req.epp_id ||
                        d.epp_name_snapshot.toLowerCase() ===
                          req.epp_name_snapshot.toLowerCase()
                    )
                    return (
                      <SiteCorpStatusBadge
                        key={req.id}
                        status={delivered ? "success" : "warning"}
                      >
                        {req.epp_name_snapshot} {delivered ? "✓ Entregado" : "• Pendiente"}
                      </SiteCorpStatusBadge>
                    )
                  })}
                </div>
              </div>
            )}

            {sstProfile.eppDeliveries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <HardHat className="mx-auto h-7 w-7 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium text-ink">
                  Sin entregas de EPP registradas
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Registra las entregas de medios de protección personal asignados al trabajador.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 font-semibold uppercase text-muted-foreground">
                      <th className="px-3 py-2.5">EPP</th>
                      <th className="px-3 py-2.5">Fecha</th>
                      <th className="px-3 py-2.5">Cant.</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5">Conformidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {sstProfile.eppDeliveries.map((del) => (
                      <tr key={del.id}>
                        <td className="px-3 py-2.5 font-medium text-ink">
                          {del.epp_name_snapshot}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {del.delivery_date}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{del.quantity}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {SST_EPP_DELIVERY_STATUS_LABELS[del.status]}
                        </td>
                        <td className="px-3 py-2.5">
                          <SiteCorpStatusBadge
                            status={del.signed_receipt ? "success" : "warning"}
                          >
                            {del.signed_receipt ? "Firmado" : "Pendiente firma"}
                          </SiteCorpStatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SiteCorpCard>

        {/* Sub-bloque: Aptitud Ocupacional Administrativa */}
        <SiteCorpCard>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <HeartPulse className="h-5 w-5 text-sitecorp-primary" />
                  <h3 className="text-base font-semibold text-ink">
                    SST — Aptitud Ocupacional Administrativa
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Control administrativo de chequeos preempleo y periódicos (sin diagnósticos
                  clínicos confidenciales).
                </p>
              </div>
              {canManage && (
                <SiteCorpButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={openAptitudeDialog}
                >
                  Actualizar aptitud
                </SiteCorpButton>
              )}
            </div>

            {!latestAptitude ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <HeartPulse className="mx-auto h-7 w-7 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium text-ink">
                  Sin evaluación de aptitud ocupacional registrada
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Registra la aptitud laboral y fecha de próximo chequeo periódico para el cargo.
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-border bg-muted/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Estado actual de aptitud ({latestAptitude.evaluation_type})
                  </span>
                  <SiteCorpStatusBadge
                    status={
                      latestAptitude.aptitude_status === "APTO"
                        ? "success"
                        : latestAptitude.aptitude_status === "APTO_CON_RESTRICCIONES"
                          ? "warning"
                          : latestAptitude.aptitude_status === "NO_APTO_TEMPORAL"
                            ? "danger"
                            : "info"
                    }
                  >
                    {SST_HEALTH_APTITUDE_LABELS[latestAptitude.aptitude_status]}
                  </SiteCorpStatusBadge>
                </div>

                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Último chequeo</p>
                    <p className="mt-0.5 font-mono text-sm font-medium text-ink tabular-nums">
                      {latestAptitude.evaluation_date || "No registrado"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Próximo chequeo</p>
                    <p className="mt-0.5 font-mono text-sm font-medium text-ink tabular-nums">
                      {latestAptitude.next_review_date || "No programado"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    Restricciones laborales administrativas
                  </p>
                  <p className="mt-0.5 text-sm text-ink">
                    {latestAptitude.administrative_restrictions ||
                      "Ninguna restricción laboral activa"}
                  </p>
                </div>

                {latestAptitude.administrative_notes && (
                  <div>
                    <p className="text-xs text-muted-foreground">Observaciones administrativas</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {latestAptitude.administrative_notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </SiteCorpCard>
      </div>

      {/* Diálogo para registrar capacitación General */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar capacitación general recibida</DialogTitle>
            <DialogDescription>
              Se agregará un registro independiente con estado «Recibida» en la Información
              adicional de {workerName}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Tema de capacitación (por área)</Label>
              <SiteCorpSelect
                value={selectedTopicId}
                onValueChange={(val) => setSelectedTopicId(val)}
              >
                <SelectItem value="__custom__">
                  Especificar tema de capacitación inicial manualmente
                </SelectItem>
                {profileData.availableTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.title} ({topic.areaName})
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            {selectedTopicId === "__custom__" && (
              <div className="space-y-2">
                <Label>Nombre del tema recibido</Label>
                <SiteCorpInput
                  value={customTopicTitle}
                  onChange={(e) => setCustomTopicTitle(e.target.value)}
                  placeholder="Ej. Inducción general al área"
                  required
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fecha de recepción</Label>
                <SiteCorpInput
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Área del trabajador</Label>
                <SiteCorpInput value={currentAreaName || "Sin área asignada"} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observaciones (opcional)</Label>
              <SiteCorpInput
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalle de la sesión o capacitación inicial impartida..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={submitting}>
                {submitting ? "Guardando..." : "Guardar como Recibida"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo para registrar capacitación SST por Cargo */}
      <Dialog open={sstTrainingDialogOpen} onOpenChange={setSstTrainingDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar capacitación de SST por cargo</DialogTitle>
            <DialogDescription>
              Registra una instrucción de Seguridad y Salud en el Trabajo como «Recibida» para{" "}
              {workerName}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRegisterSstSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Tema de SST (por cargo)</Label>
              <SiteCorpSelect
                value={selectedSstTopicId}
                onValueChange={(val) => setSelectedSstTopicId(val)}
              >
                <SelectItem value="__custom__">
                  Especificar instrucción de SST manualmente
                </SelectItem>
                {sstProfile.availableSstTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.title} ({topic.jobName})
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            {selectedSstTopicId === "__custom__" && (
              <div className="space-y-2">
                <Label>Nombre del tema de SST recibido</Label>
                <SiteCorpInput
                  value={customSstTopicTitle}
                  onChange={(e) => setCustomSstTopicTitle(e.target.value)}
                  placeholder="Ej. Prevención de riesgos específicos del cargo"
                  required
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fecha de recepción</Label>
                <SiteCorpInput
                  type="date"
                  value={sstReceivedDate}
                  onChange={(e) => setSstReceivedDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Cargo del trabajador</Label>
                <SiteCorpInput
                  value={currentJobName || currentPositionName || "Sin cargo"}
                  disabled
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observaciones (opcional)</Label>
              <SiteCorpInput
                value={sstNotes}
                onChange={(e) => setSstNotes(e.target.value)}
                placeholder="Instructor, alcance o evaluación..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setSstTrainingDialogOpen(false)}
                disabled={submittingSstTraining}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={submittingSstTraining}>
                {submittingSstTraining ? "Guardando..." : "Guardar capacitación SST"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo para registrar entrega de EPP */}
      <Dialog open={eppDialogOpen} onOpenChange={setEppDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar entrega de EPP a {workerName}</DialogTitle>
            <DialogDescription>
              Registra la dotación o reposición de un equipo de protección personal.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEppDeliverySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Equipo de Protección Personal (EPP)</Label>
              <SiteCorpSelect
                value={selectedEppId}
                onValueChange={(val) => setSelectedEppId(val)}
              >
                <SelectItem value="__custom__">
                  Especificar equipo de protección manualmente
                </SelectItem>
                {sstProfile.eppCatalog.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.category})
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            {selectedEppId === "__custom__" && (
              <div className="space-y-2">
                <Label>Nombre del EPP entregado</Label>
                <SiteCorpInput
                  value={customEppName}
                  onChange={(e) => setCustomEppName(e.target.value)}
                  placeholder="Ej. Casco dieléctrico / Botas de seguridad"
                  required
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fecha de entrega</Label>
                <SiteCorpInput
                  type="date"
                  value={eppDeliveryDate}
                  onChange={(e) => setEppDeliveryDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Cantidad entregada</Label>
                <SiteCorpInput
                  type="number"
                  min={1}
                  value={eppQuantity}
                  onChange={(e) => setEppQuantity(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Estado de entrega</Label>
                <SiteCorpSelect
                  value={eppStatus}
                  onValueChange={(val) => setEppStatus(val as SstEppDeliveryStatus)}
                >
                  {(
                    Object.keys(SST_EPP_DELIVERY_STATUS_LABELS) as SstEppDeliveryStatus[]
                  ).map((statusKey) => (
                    <SelectItem key={statusKey} value={statusKey}>
                      {SST_EPP_DELIVERY_STATUS_LABELS[statusKey]}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Próxima reposición (opcional)</Label>
                <SiteCorpInput
                  type="date"
                  value={eppRenewalDueDate}
                  onChange={(e) => setEppRenewalDueDate(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={eppSigned}
                onChange={(e) => setEppSigned(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Confirmación nominal firmada por el trabajador
            </label>

            <div className="space-y-2">
              <Label>Observaciones (opcional)</Label>
              <SiteCorpInput
                value={eppNotes}
                onChange={(e) => setEppNotes(e.target.value)}
                placeholder="Talla, lote o detalles de entrega..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setEppDialogOpen(false)}
                disabled={submittingEpp}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={submittingEpp}>
                {submittingEpp ? "Guardando..." : "Registrar entrega"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo para actualizar Aptitud Ocupacional Administrativa */}
      <Dialog open={aptitudeDialogOpen} onOpenChange={setAptitudeDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Aptitud ocupacional administrativa</DialogTitle>
            <DialogDescription>
              Actualiza la condición de aptitud laboral y fechas de chequeo médico periódico de{" "}
              {workerName}. No incluyas diagnósticos clínicos confidenciales.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAptitudeSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo de chequeo</Label>
                <SiteCorpSelect
                  value={evaluationType}
                  onValueChange={(val) =>
                    setEvaluationType(
                      val as "PRE_EMPLEO" | "PERIODICO" | "REINTEGRO" | "CAMBIO_CARGO"
                    )
                  }
                >
                  <SelectItem value="PRE_EMPLEO">Preempleo</SelectItem>
                  <SelectItem value="PERIODICO">Periódico</SelectItem>
                  <SelectItem value="CAMBIO_CARGO">Cambio de cargo</SelectItem>
                  <SelectItem value="REINTEGRO">Reintegro laboral</SelectItem>
                </SiteCorpSelect>
              </div>
              <div className="space-y-2">
                <Label>Estado de aptitud</Label>
                <SiteCorpSelect
                  value={aptitudeStatus}
                  onValueChange={(val) =>
                    setAptitudeStatus(val as SstHealthAptitudeStatus)
                  }
                >
                  {(
                    Object.keys(SST_HEALTH_APTITUDE_LABELS) as SstHealthAptitudeStatus[]
                  ).map((statusKey) => (
                    <SelectItem key={statusKey} value={statusKey}>
                      {SST_HEALTH_APTITUDE_LABELS[statusKey]}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Fecha de evaluación</Label>
                <SiteCorpInput
                  type="date"
                  value={evaluationDate}
                  onChange={(e) => setEvaluationDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha de próximo chequeo</Label>
                <SiteCorpInput
                  type="date"
                  value={nextReviewDate}
                  onChange={(e) => setNextReviewDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Restricciones laborales administrativas (si aplica)</Label>
              <SiteCorpInput
                value={workRestrictions}
                onChange={(e) => setWorkRestrictions(e.target.value)}
                placeholder="Ej. No realizar trabajos en alturas superiores a 2 m"
              />
            </div>

            <div className="space-y-2">
              <Label>Observaciones administrativas</Label>
              <SiteCorpInput
                value={aptitudeObservations}
                onChange={(e) => setAptitudeObservations(e.target.value)}
                placeholder="Ej. Chequeo periódico anual vigente"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setAptitudeDialogOpen(false)}
                disabled={submittingAptitude}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={submittingAptitude}>
                {submittingAptitude ? "Guardando..." : "Guardar aptitud"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
