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
  SST_FREQUENCY_LABELS,
  SST_FREQUENCY_OPTIONS,
  SST_SESSION_STATUS_LABELS,
  formatSstFileSize,
  type EntityJobOption,
  type EntitySstState,
  type EntityWorkerSstOption,
  type SstSessionStatus,
  type SstTopicDocument,
  type SstTrainingFrequency,
  type SstTrainingSession,
} from "../../domain/entities"
import {
  createSstTrainingTopic,
  deleteSstTopicDocument,
  deleteSstTrainingSession,
  deleteSstTrainingTopic,
  downloadSstTopicDocument,
  incorporateEntityJobSstFolder,
  removeEntityJobSstFolder,
  saveSstTrainingSessionOutcome,
  scheduleSstTrainingSession,
  uploadSstTopicDocument,
} from "../../application/sst.service"
import { useToast } from "@/shared/hooks/use-toast"
import {
  FolderKanban,
  Briefcase,
  Building2,
  Plus,
  FileText,
  Upload,
  Download,
  Trash2,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Users,
  Filter,
} from "lucide-react"
import { cn } from "@/lib/utils"

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

interface SstTrainingByJobSectionProps {
  entityId: string
  state: EntitySstState
  jobs: EntityJobOption[]
  workers: EntityWorkerSstOption[]
  canManage: boolean
  onRefresh: () => Promise<void>
}

export const SstTrainingByJobSection: React.FC<SstTrainingByJobSectionProps> = ({
  entityId,
  state,
  jobs,
  workers,
  canManage,
  onRefresh,
}) => {
  const { toast } = useToast()
  const currentYear = new Date().getFullYear()

  // Filtros del Calendario Anual de SST
  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear)
  const [filterJobId, setFilterJobId] = React.useState<string>("all")
  const [filterTopicId, setFilterTopicId] = React.useState<string>("all")
  const [filterStatus, setFilterStatus] = React.useState<string>("all")

  // Carpeta de cargo activa
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!selectedFolderId && state.jobFolders.length > 0) {
      setSelectedFolderId(state.jobFolders[0].id)
    } else if (
      selectedFolderId &&
      !state.jobFolders.some((f) => f.id === selectedFolderId)
    ) {
      setSelectedFolderId(state.jobFolders[0]?.id ?? null)
    }
  }, [state.jobFolders, selectedFolderId])

  // Diálogo: Incorporar carpeta de cargo
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const [selectedJobForFolder, setSelectedJobForFolder] = React.useState<string>("")
  const [folderSubmitting, setFolderSubmitting] = React.useState(false)

  // Diálogo: Crear tema de SST en carpeta de cargo
  const [topicDialogOpen, setTopicDialogOpen] = React.useState(false)
  const [topicTitle, setTopicTitle] = React.useState("")
  const [topicDescription, setTopicDescription] = React.useState("")
  const [topicFrequency, setTopicFrequency] = React.useState<SstTrainingFrequency>("ANUAL")
  const [customFreqLabel, setCustomFreqLabel] = React.useState("")
  const [topicSubmitting, setTopicSubmitting] = React.useState(false)

  // Diálogo: Programar sesión manual en el calendario
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleTopicId, setScheduleTopicId] = React.useState<string>("")
  const [scheduleDate, setScheduleDate] = React.useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [scheduleNotes, setScheduleNotes] = React.useState<string>("")
  const [scheduleSubmitting, setScheduleSubmitting] = React.useState(false)

  // Diálogo:Gestionar resultado y participantes de sesión
  const [activeSession, setActiveSession] = React.useState<SstTrainingSession | null>(null)
  const [outcomeStatus, setOutcomeStatus] = React.useState<SstSessionStatus>("PROGRAMADA")
  const [outcomeDate, setOutcomeDate] = React.useState<string>("")
  const [outcomeNotes, setOutcomeNotes] = React.useState<string>("")
  const [selectedWorkerIds, setSelectedWorkerIds] = React.useState<string[]>([])
  const [workerSearch, setWorkerSearch] = React.useState<string>("")
  const [outcomeSubmitting, setOutcomeSubmitting] = React.useState(false)

  const jobMap = React.useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const topicMap = React.useMemo(
    () => new Map(state.topics.map((t) => [t.id, t])),
    [state.topics]
  )

  const availableJobsToIncorporate = React.useMemo(() => {
    const incorporatedJobIds = new Set(state.jobFolders.map((f) => f.job_id))
    return jobs.filter((j) => j.isActive && !incorporatedJobIds.has(j.id))
  }, [jobs, state.jobFolders])

  const activeFolder = React.useMemo(
    () => state.jobFolders.find((f) => f.id === selectedFolderId) || null,
    [state.jobFolders, selectedFolderId]
  )

  const activeFolderTopics = React.useMemo(() => {
    if (!activeFolder) return []
    return state.topics.filter((t) => t.folder_id === activeFolder.id)
  }, [state.topics, activeFolder])

  const filteredSessions = React.useMemo(() => {
    return state.sessions
      .filter((s) => {
        const year = Number(s.scheduled_date.slice(0, 4))
        if (year !== selectedYear) return false
        if (filterJobId !== "all" && s.job_id !== filterJobId) return false
        if (filterTopicId !== "all" && s.topic_id !== filterTopicId) return false
        if (filterStatus !== "all" && s.status !== filterStatus) return false
        return true
      })
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  }, [state.sessions, selectedYear, filterJobId, filterTopicId, filterStatus])

  const sessionsByMonth = React.useMemo(() => {
    const map = new Map<number, SstTrainingSession[]>()
    for (let m = 0; m < 12; m++) map.set(m, [])
    filteredSessions.forEach((s) => {
      const monthIdx = Number(s.scheduled_date.slice(5, 7)) - 1
      if (monthIdx >= 0 && monthIdx < 12) {
        map.get(monthIdx)?.push(s)
      }
    })
    return map
  }, [filteredSessions])

  const handleIncorporateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const job = jobMap.get(selectedJobForFolder)
    if (!job) {
      toast({
        variant: "destructive",
        title: "Selecciona un cargo",
        description: "Debes elegir un cargo existente en la entidad.",
      })
      return
    }
    setFolderSubmitting(true)
    try {
      const folder = await incorporateEntityJobSstFolder({
        entityId,
        jobId: job.id,
        jobName: job.name,
        areaId: job.areaId,
        areaName: job.areaName,
      })
      setSelectedFolderId(folder.id)
      setFolderDialogOpen(false)
      setSelectedJobForFolder("")
      await onRefresh()
      toast({
        title: "Carpeta de cargo incorporada",
        description: `Se habilitó la carpeta de SST para el cargo «${job.name}».`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al crear carpeta",
        description: err instanceof Error ? err.message : "No se pudo crear la carpeta de cargo.",
      })
    } finally {
      setFolderSubmitting(false)
    }
  }

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeFolder) return
    setTopicSubmitting(true)
    try {
      await createSstTrainingTopic({
        entityId,
        folderId: activeFolder.id,
        title: topicTitle,
        description: topicDescription,
        frequency: topicFrequency,
        customFrequencyLabel: customFreqLabel,
      })
      setTopicDialogOpen(false)
      setTopicTitle("")
      setTopicDescription("")
      setTopicFrequency("ANUAL")
      setCustomFreqLabel("")
      await onRefresh()
      toast({
        title: "Tema de SST creado",
        description: "El tema quedó registrado dentro de la carpeta del cargo.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el tema",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    } finally {
      setTopicSubmitting(false)
    }
  }

  const handleUploadDocument = async (topicId: string, file: File | null) => {
    if (!file) return
    try {
      await uploadSstTopicDocument({ entityId, topicId, file })
      await onRefresh()
      toast({
        title: "Documento adjuntado",
        description: `Se vinculó «${file.name}» al tema de SST.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Formato o archivo no válido",
        description: err instanceof Error ? err.message : "No se pudo subir el documento.",
      })
    }
  }

  const handleDownloadDocument = async (doc: SstTopicDocument) => {
    try {
      const blob = await downloadSstTopicDocument(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = doc.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al descargar",
        description: err instanceof Error ? err.message : "No se pudo descargar el documento.",
      })
    }
  }

  const openScheduleModal = (presetTopicId?: string) => {
    const defaultTopic =
      presetTopicId || activeFolderTopics[0]?.id || state.topics[0]?.id || ""
    setScheduleTopicId(defaultTopic)
    setScheduleDate(new Date().toISOString().slice(0, 10))
    setScheduleNotes("")
    setScheduleDialogOpen(true)
  }

  const handleScheduleSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scheduleTopicId || !scheduleDate) return
    setScheduleSubmitting(true)
    try {
      await scheduleSstTrainingSession({
        entityId,
        topicId: scheduleTopicId,
        scheduledDate: scheduleDate,
        notes: scheduleNotes,
      })
      setScheduleDialogOpen(false)
      await onRefresh()
      toast({
        title: "Sesión de SST programada",
        description: `Se programó la sesión manualmente para el ${scheduleDate}.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al programar sesión",
        description: err instanceof Error ? err.message : "No se pudo programar la sesión.",
      })
    } finally {
      setScheduleSubmitting(false)
    }
  }

  const openSessionOutcomeModal = (session: SstTrainingSession) => {
    setActiveSession(session)
    setOutcomeStatus(session.status)
    setOutcomeDate(session.scheduled_date)
    setOutcomeNotes(session.notes || "")
    setSelectedWorkerIds(session.participant_worker_ids || [])
    setWorkerSearch("")
  }

  const handleSaveOutcome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeSession) return
    setOutcomeSubmitting(true)
    try {
      await saveSstTrainingSessionOutcome({
        entityId,
        sessionId: activeSession.id,
        scheduledDate: outcomeDate,
        status: outcomeStatus,
        notes: outcomeNotes,
        participantWorkerIds: outcomeStatus === "REALIZADA" ? selectedWorkerIds : [],
        jobById: jobMap,
      })
      setActiveSession(null)
      await onRefresh()
      toast({
        title: "Sesión de SST actualizada",
        description:
          outcomeStatus === "REALIZADA"
            ? `Sesión marcada como Realizada. Se actualizó la Información adicional de ${selectedWorkerIds.length} trabajador(es).`
            : `El estado de la sesión cambió a «${SST_SESSION_STATUS_LABELS[outcomeStatus]}».`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al guardar sesión",
        description: err instanceof Error ? err.message : "No se pudo actualizar la sesión.",
      })
    } finally {
      setOutcomeSubmitting(false)
    }
  }

  const toggleWorkerSelection = (workerId: string) => {
    setSelectedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    )
  }

  const filteredModalWorkers = React.useMemo(() => {
    const q = workerSearch.trim().toLowerCase()
    const list = workers.filter((w) => w.employmentStatus === "active")
    // Ordenar primero a los trabajadores que ocupan el cargo de la sesión
    return list
      .filter((w) => {
        if (!q) return true
        return `${w.fullName} ${w.code} ${w.jobName || ""} ${w.areaName || ""}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        const aMatchesJob = activeSession && a.jobId === activeSession.job_id ? 0 : 1
        const bMatchesJob = activeSession && b.jobId === activeSession.job_id ? 0 : 1
        if (aMatchesJob !== bMatchesJob) return aMatchesJob - bMatchesJob
        return a.fullName.localeCompare(b.fullName, "es")
      })
  }, [workers, workerSearch, activeSession])

  return (
    <div className="space-y-6">
      {/* CALENDARIO ANUAL DE CAPACITACIONES DE SST DE LA ENTIDAD */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-sitecorp-primary" />
                <h2 className="text-lg font-semibold text-ink">
                  Calendario Anual de Capacitaciones de SST ({selectedYear})
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Programación manual y control de sesiones de Seguridad y Salud en el Trabajo
                exclusivas de esta entidad, organizadas por cargo.
              </p>
            </div>

            {canManage && state.topics.length > 0 && (
              <SiteCorpButton type="button" onClick={() => openScheduleModal()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Programar fecha de sesión
              </SiteCorpButton>
            )}
          </div>

          {/* Barra de filtros del calendario */}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Filter className="h-3 w-3" /> Año
              </Label>
              <SiteCorpSelect
                value={String(selectedYear)}
                onValueChange={(v) => setSelectedYear(Number(v))}
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                  <SelectItem key={yr} value={String(yr)}>
                    {yr}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Filtrar por Cargo</Label>
              <SiteCorpSelect value={filterJobId} onValueChange={setFilterJobId}>
                <SelectItem value="all">Todos los cargos con carpeta SST</SelectItem>
                {state.jobFolders.map((f) => {
                  const liveJobName = jobMap.get(f.job_id)?.name || f.job_name_snapshot
                  return (
                    <SelectItem key={f.job_id} value={f.job_id}>
                      {liveJobName}
                    </SelectItem>
                  )
                })}
              </SiteCorpSelect>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Filtrar por Tema de SST</Label>
              <SiteCorpSelect value={filterTopicId} onValueChange={setFilterTopicId}>
                <SelectItem value="all">Todos los temas</SelectItem>
                {state.topics
                  .filter((t) => filterJobId === "all" || t.job_id === filterJobId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Estado de la sesión</Label>
              <SiteCorpSelect value={filterStatus} onValueChange={setFilterStatus}>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="PROGRAMADA">Programada</SelectItem>
                <SelectItem value="REALIZADA">Realizada</SelectItem>
                <SelectItem value="NO_REALIZADA">No realizada</SelectItem>
                <SelectItem value="CANCELADA">Cancelada</SelectItem>
                <SelectItem value="REPROGRAMADA">Reprogramada</SelectItem>
              </SiteCorpSelect>
            </div>
          </div>

          {/* Cuadrícula de los 12 meses del año */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {MONTH_NAMES.map((monthName, monthIdx) => {
              const monthSessions = sessionsByMonth.get(monthIdx) || []
              return (
                <div
                  key={monthName}
                  className="flex flex-col rounded-xl border border-border bg-white p-3 shadow-xs"
                >
                  <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink">
                      {monthName}
                    </span>
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                      {monthSessions.length}
                    </span>
                  </div>

                  {monthSessions.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      Sin sesiones programadas
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {monthSessions.map((session) => {
                        const topic = topicMap.get(session.topic_id)
                        const jobName =
                          jobMap.get(session.job_id)?.name || "Cargo de la entidad"
                        return (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => openSessionOutcomeModal(session)}
                            className={cn(
                              "w-full rounded-lg border p-2 text-left text-xs transition-colors hover:bg-muted/40",
                              session.status === "REALIZADA"
                                ? "border-sitecorp-success/40 bg-sitecorp-success/5"
                                : session.status === "NO_REALIZADA" ||
                                    session.status === "CANCELADA"
                                  ? "border-sitecorp-danger/30 bg-sitecorp-danger/5"
                                  : "border-sitecorp-primary/30 bg-sitecorp-primary/5"
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono font-semibold text-ink tabular-nums">
                                {session.scheduled_date}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium">
                                {session.status === "REALIZADA" ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-sitecorp-success" />
                                ) : session.status === "NO_REALIZADA" ||
                                  session.status === "CANCELADA" ? (
                                  <XCircle className="h-3.5 w-3.5 text-sitecorp-danger" />
                                ) : (
                                  <Clock className="h-3.5 w-3.5 text-sitecorp-primary" />
                                )}
                                {SST_SESSION_STATUS_LABELS[session.status]}
                              </span>
                            </div>
                            <p className="mt-1 truncate font-medium text-ink">
                              {topic?.title || "Tema de SST"}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              Cargo: {jobName}
                            </p>
                            {session.status === "REALIZADA" && (
                              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-sitecorp-success">
                                <Users className="h-3 w-3" />
                                {session.participant_worker_ids.length} participante(s)
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </SiteCorpCard>

      {/* CARPETAS DE CAPACITACIÓN DE SST POR CARGO (`organization_jobs`) */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Columna izquierda: Carpetas de Cargos */}
        <div className="space-y-4 lg:col-span-4">
          <SiteCorpCard className="rounded-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">Carpetas por Cargo</h3>
                  <p className="text-xs text-muted-foreground">
                    1 carpeta de SST por cargo existente en la entidad
                  </p>
                </div>
                {canManage && (
                  <SiteCorpButton
                    type="button"
                    size="sm"
                    onClick={() => setFolderDialogOpen(true)}
                    disabled={availableJobsToIncorporate.length === 0}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Añadir cargo
                  </SiteCorpButton>
                )}
              </div>

              {state.jobFolders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center">
                  <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-medium text-ink">
                    Sin carpetas de cargos en SST
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selecciona un cargo existente en la estructura de esta entidad para crear su
                    carpeta de capacitación de SST.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {state.jobFolders.map((folder) => {
                    const liveJob = jobMap.get(folder.job_id)
                    const displayJobName = liveJob?.name || folder.job_name_snapshot
                    const displayAreaName = liveJob?.areaName || folder.area_name_snapshot
                    const topicCount = state.topics.filter(
                      (t) => t.folder_id === folder.id
                    ).length
                    const workersInJobCount = workers.filter(
                      (w) => w.employmentStatus === "active" && w.jobId === folder.job_id
                    ).length
                    const isSelected = folder.id === selectedFolderId

                    return (
                      <div
                        key={folder.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl border p-3 transition-colors",
                          isSelected
                            ? "border-sitecorp-primary bg-sitecorp-primary/5"
                            : "border-border bg-white hover:bg-muted/30"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedFolderId(folder.id)}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-sitecorp-primary" />
                            <span className="text-sm font-semibold text-ink">
                              {displayJobName}
                            </span>
                          </div>
                          {displayAreaName && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Building2 className="h-3 w-3" />
                              {displayAreaName}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">{topicCount} tema(s)</span>
                            <span>•</span>
                            <span className="tabular-nums">
                              {workersInJobCount} trabajador(es) en el cargo
                            </span>
                          </div>
                        </button>

                        {canManage && (
                          <button
                            type="button"
                            title="Eliminar carpeta de SST del cargo"
                            onClick={async () => {
                              await removeEntityJobSstFolder(entityId, folder.id)
                              await onRefresh()
                            }}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </SiteCorpCard>
        </div>

        {/* Columna derecha: Temas, Documentos Word/PDF y Sesiones del Cargo Seleccionado */}
        <div className="space-y-4 lg:col-span-8">
          <SiteCorpCard className="rounded-2xl">
            {!activeFolder ? (
              <div className="py-12 text-center">
                <Briefcase className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-medium text-ink">
                  Selecciona o incorpora una carpeta de cargo
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Al seleccionar un cargo podrás gestionar sus temas de SST, documentos PDF/Word y
                  fechas programadas en el calendario anual.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Briefcase className="h-5 w-5 text-sitecorp-primary" />
                      <h3 className="text-lg font-semibold text-ink">
                        Cargo: {jobMap.get(activeFolder.job_id)?.name || activeFolder.job_name_snapshot}
                      </h3>
                      <SiteCorpStatusBadge status="info">
                        {activeFolderTopics.length} tema(s) de SST
                      </SiteCorpStatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Área:{" "}
                      <strong className="font-medium text-ink">
                        {jobMap.get(activeFolder.job_id)?.areaName ||
                          activeFolder.area_name_snapshot ||
                          "—"}
                      </strong>{" "}
                      • Si el cargo cambia de nombre en la estructura de la entidad, esta carpeta
                      lo refleja automáticamente.
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      <SiteCorpButton
                        type="button"
                        size="sm"
                        onClick={() => setTopicDialogOpen(true)}
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Nuevo tema de SST
                      </SiteCorpButton>
                    </div>
                  )}
                </div>

                {activeFolderTopics.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="text-sm font-medium text-ink">
                      Este cargo aún no tiene temas de capacitación de SST
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Crea temas como Prevención de riesgos del cargo, Uso de EPP, Procedimientos de
                      trabajo seguro o Primeros auxilios.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeFolderTopics.map((topic) => {
                      const topicDocs = state.documents.filter((d) => d.topic_id === topic.id)
                      const topicSessions = state.sessions
                        .filter((s) => s.topic_id === topic.id)
                        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))

                      return (
                        <div
                          key={topic.id}
                          className="rounded-xl border border-border bg-muted/10 p-4 space-y-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-base font-semibold text-ink">{topic.title}</h4>
                                <SiteCorpStatusBadge status="neutral">
                                  Frecuencia:{" "}
                                  {topic.frequency === "PERSONALIZADA" &&
                                  topic.custom_frequency_label
                                    ? topic.custom_frequency_label
                                    : SST_FREQUENCY_LABELS[topic.frequency]}
                                </SiteCorpStatusBadge>
                              </div>
                              {topic.description && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {topic.description}
                                </p>
                              )}
                            </div>

                            {canManage && (
                              <div className="flex flex-wrap items-center gap-2">
                                <SiteCorpButton
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openScheduleModal(topic.id)}
                                >
                                  <Calendar className="mr-1.5 h-3.5 w-3.5" />
                                  Programar sesión
                                </SiteCorpButton>
                                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-muted">
                                  <Upload className="h-3.5 w-3.5 text-sitecorp-primary" />
                                  Adjuntar PDF / Word
                                  <input
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0] || null
                                      void handleUploadDocument(topic.id, f)
                                      e.currentTarget.value = ""
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteSstTrainingTopic(entityId, topic.id)
                                    await onRefresh()
                                  }}
                                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                                  title="Eliminar tema"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Documentos del tema */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Documentos adjuntos ({topicDocs.length})
                            </p>
                            {topicDocs.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Sin documentos PDF o Word adjuntos a este tema.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {topicDocs.map((doc) => (
                                  <div
                                    key={doc.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <FileText className="h-4 w-4 shrink-0 text-sitecorp-primary" />
                                      <div className="min-w-0">
                                        <p className="truncate font-medium text-ink">
                                          {doc.file_name}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground tabular-nums">
                                          {formatSstFileSize(doc.file_size)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void handleDownloadDocument(doc)}
                                        className="rounded p-1 text-sitecorp-primary hover:bg-sitecorp-primary/10"
                                        title="Descargar documento"
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                      </button>
                                      {canManage && (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            await deleteSstTopicDocument(entityId, doc.id)
                                            await onRefresh()
                                          }}
                                          className="rounded p-1 text-muted-foreground hover:text-sitecorp-danger"
                                          title="Eliminar documento"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Sesiones programadas del tema */}
                          <div className="space-y-2 border-t border-border pt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Sesiones en el calendario ({topicSessions.length})
                            </p>
                            {topicSessions.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No hay fechas programadas aún para este tema.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {topicSessions.map((sess) => (
                                  <button
                                    key={sess.id}
                                    type="button"
                                    onClick={() => openSessionOutcomeModal(sess)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                                  >
                                    <span className="font-mono font-medium text-ink tabular-nums">
                                      {sess.scheduled_date}
                                    </span>
                                    <SiteCorpStatusBadge
                                      status={
                                        sess.status === "REALIZADA"
                                          ? "success"
                                          : sess.status === "NO_REALIZADA" ||
                                              sess.status === "CANCELADA"
                                            ? "danger"
                                            : "info"
                                      }
                                    >
                                      {SST_SESSION_STATUS_LABELS[sess.status]}
                                    </SiteCorpStatusBadge>
                                    {sess.status === "REALIZADA" && (
                                      <span className="text-[11px] text-muted-foreground tabular-nums">
                                        ({sess.participant_worker_ids.length} part.)
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </SiteCorpCard>
        </div>
      </div>

      {/* DIÁLOGO: Incorporar carpeta de SST vinculada a un cargo existente */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Crear carpeta de SST por cargo</DialogTitle>
            <DialogDescription>
              Selecciona un cargo existente en la estructura organizativa de esta entidad. Cada
              cargo puede tener una única carpeta de SST y su nombre se mantiene sincronizado con el
              cargo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleIncorporateFolder} className="space-y-4">
            <div className="space-y-2">
              <Label>Cargo existente en la entidad</Label>
              <SiteCorpSelect
                value={selectedJobForFolder || "__none__"}
                onValueChange={(v) => setSelectedJobForFolder(v === "__none__" ? "" : v)}
              >
                <SelectItem value="__none__">Seleccionar cargo...</SelectItem>
                {availableJobsToIncorporate.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name} {j.areaName ? `— (${j.areaName})` : ""}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setFolderDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="submit"
                disabled={folderSubmitting || !selectedJobForFolder}
              >
                {folderSubmitting ? "Creando..." : "Crear carpeta del cargo"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Nuevo Tema de SST dentro de la carpeta del cargo */}
      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Nuevo tema de capacitación de SST</DialogTitle>
            <DialogDescription>
              El tema quedará asociado al cargo{" "}
              <strong>
                {activeFolder
                  ? jobMap.get(activeFolder.job_id)?.name || activeFolder.job_name_snapshot
                  : ""}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTopic} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del tema (obligatorio)</Label>
              <SiteCorpInput
                value={topicTitle}
                onChange={(e) => setTopicTitle(e.target.value)}
                placeholder="Ej. Prevención de riesgos eléctricos y uso de EPP"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <SiteCorpInput
                value={topicDescription}
                onChange={(e) => setTopicDescription(e.target.value)}
                placeholder="Objetivos y alcance de la capacitación de seguridad..."
              />
            </div>
            <div className="space-y-2">
              <Label>Frecuencia de capacitación</Label>
              <SiteCorpSelect
                value={topicFrequency}
                onValueChange={(v) => setTopicFrequency(v as SstTrainingFrequency)}
              >
                {SST_FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>
            {topicFrequency === "PERSONALIZADA" && (
              <div className="space-y-2">
                <Label>Detalle de frecuencia personalizada</Label>
                <SiteCorpInput
                  value={customFreqLabel}
                  onChange={(e) => setCustomFreqLabel(e.target.value)}
                  placeholder="Ej. Cada 2 años o ante cambio tecnológico"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setTopicDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={topicSubmitting}>
                {topicSubmitting ? "Guardando..." : "Crear tema"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Programar sesión manual en el calendario */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Programar sesión en el calendario de SST</DialogTitle>
            <DialogDescription>
              Selecciona el tema de SST y la fecha exacta en que se impartirá la sesión.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleScheduleSession} className="space-y-4">
            <div className="space-y-2">
              <Label>Tema de capacitación de SST</Label>
              <SiteCorpSelect value={scheduleTopicId} onValueChange={setScheduleTopicId}>
                {state.topics.map((t) => {
                  const jName = jobMap.get(t.job_id)?.name || "Cargo"
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title} ({jName})
                    </SelectItem>
                  )
                })}
              </SiteCorpSelect>
            </div>
            <div className="space-y-2">
              <Label>Fecha programada</Label>
              <SiteCorpInput
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Observaciones (opcional)</Label>
              <SiteCorpInput
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                placeholder="Instructor, local o turno..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setScheduleDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={scheduleSubmitting || !scheduleTopicId}>
                {scheduleSubmitting ? "Programando..." : "Guardar en calendario"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Estado de sesión y selección opcional de participantes */}
      <Dialog
        open={Boolean(activeSession)}
        onOpenChange={(open) => {
          if (!open) setActiveSession(null)
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Gestión de sesión de SST y participantes</DialogTitle>
            <DialogDescription>
              Al marcar la sesión como «Realizada», cada trabajador seleccionado recibirá un
              registro independiente con estado «Recibida» en su Información adicional.
            </DialogDescription>
          </DialogHeader>

          {activeSession && (
            <form onSubmit={handleSaveOutcome} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Estado de la sesión</Label>
                  <SiteCorpSelect
                    value={outcomeStatus}
                    onValueChange={(v) => setOutcomeStatus(v as SstSessionStatus)}
                  >
                    <SelectItem value="PROGRAMADA">Programada</SelectItem>
                    <SelectItem value="REALIZADA">Realizada</SelectItem>
                    <SelectItem value="NO_REALIZADA">No realizada</SelectItem>
                    <SelectItem value="CANCELADA">Cancelada</SelectItem>
                    <SelectItem value="REPROGRAMADA">Reprogramada</SelectItem>
                  </SiteCorpSelect>
                </div>

                <div className="space-y-1.5">
                  <Label>Fecha de la sesión</Label>
                  <SiteCorpInput
                    type="date"
                    value={outcomeDate}
                    onChange={(e) => setOutcomeDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Observaciones de la sesión</Label>
                <SiteCorpInput
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  placeholder="Notas sobre el desarrollo de la sesión o motivo de reprogramación..."
                />
              </div>

              {outcomeStatus === "REALIZADA" && (
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">
                      Trabajadores participantes (opcional — {selectedWorkerIds.length}{" "}
                      seleccionado(s))
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        const jobWorkerIds = workers
                          .filter(
                            (w) =>
                              w.employmentStatus === "active" &&
                              w.jobId === activeSession.job_id
                          )
                          .map((w) => w.id)
                        setSelectedWorkerIds(jobWorkerIds)
                      }}
                      className="text-xs font-medium text-sitecorp-primary hover:underline"
                    >
                      Seleccionar todos los del cargo
                    </button>
                  </div>

                  <SiteCorpInput
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="Buscar trabajador por nombre, código o cargo..."
                  />

                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {filteredModalWorkers.map((worker) => {
                      const checked = selectedWorkerIds.includes(worker.id)
                      const isSameJob = worker.jobId === activeSession.job_id
                      return (
                        <label
                          key={worker.id}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                            checked
                              ? "border-sitecorp-primary bg-sitecorp-primary/10"
                              : "border-border bg-white"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleWorkerSelection(worker.id)}
                              className="h-4 w-4 rounded border-border text-sitecorp-primary"
                            />
                            <div>
                              <p className="font-medium text-ink">{worker.fullName}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Cargo: {worker.jobName || "—"} • Área: {worker.areaName || "—"}
                              </p>
                            </div>
                          </div>
                          {isSameJob && (
                            <SiteCorpStatusBadge status="info">Cargo objetivo</SiteCorpStatusBadge>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {canManage ? (
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      await deleteSstTrainingSession(entityId, activeSession.id)
                      setActiveSession(null)
                      await onRefresh()
                    }}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4 text-sitecorp-danger" />
                    Eliminar sesión
                  </SiteCorpButton>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    onClick={() => setActiveSession(null)}
                  >
                    Cerrar
                  </SiteCorpButton>
                  {canManage && (
                    <SiteCorpButton type="submit" disabled={outcomeSubmitting}>
                      {outcomeSubmitting ? "Guardando..." : "Guardar cambios"}
                    </SiteCorpButton>
                  )}
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
