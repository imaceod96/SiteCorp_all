import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
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
import { saveDownloadedFile } from "@/modules/people/infrastructure/expediente-storage"
import {
  TRAINING_FREQUENCY_LABELS,
  TRAINING_FREQUENCY_OPTIONS,
  TRAINING_SESSION_STATUS_LABELS,
  formatFileSize,
  isAllowedTrainingDocumentFile,
  type EntityAreaOption,
  type EntityTrainingState,
  type EntityWorkerOption,
  type TrainingFolder,
  type TrainingFrequency,
  type TrainingSession,
  type TrainingSessionStatus,
  type TrainingTopic,
  type TrainingTopicDocument,
} from "../../domain/entities"
import {
  createTrainingTopic,
  deleteTrainingSession,
  deleteTrainingTopic,
  deleteTrainingTopicDocument,
  downloadTrainingTopicDocument,
  incorporateEntityAreaFolder,
  loadEntityTrainingOverview,
  removeEntityAreaFolder,
  saveTrainingSessionOutcome,
  scheduleTrainingSession,
  updateTrainingTopic,
  uploadTrainingTopicDocument,
} from "../../application/training.service"
import { TRAINING_CHANGED_EVENT } from "../../infrastructure/training.repository"
import { PendingInitialTrainingBanner } from "../components/PendingInitialTrainingBanner"
import {
  FolderPlus,
  FolderOpen,
  BookOpen,
  Calendar as CalendarIcon,
  FileText,
  Upload,
  Download,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Filter,
  Pencil,
  ChevronRight,
  ChevronDown,
  Search,
  GraduationCap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/shared/hooks/use-toast"

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

const statusBadgeVariant = (
  status: TrainingSessionStatus
): "info" | "success" | "danger" | "warning" | "neutral" => {
  if (status === "REALIZADA") return "success"
  if (status === "NO_REALIZADA") return "danger"
  return "info"
}

const EntityTraining: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const { currentEntity } = useCurrentEntity()
  const { has: hasEntityPermission } = useEntityPermissions(entityId)
  const { toast } = useToast()

  const canManage = hasEntityPermission([
    "training.manage",
    "workers.manage",
    "organization.manage",
    "hiring.manage",
  ])

  const [state, setState] = React.useState<EntityTrainingState>({
    folders: [],
    topics: [],
    documents: [],
    sessions: [],
    workerRecords: [],
    notifications: [],
  })
  const [areas, setAreas] = React.useState<EntityAreaOption[]>([])
  const [workers, setWorkers] = React.useState<EntityWorkerOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Filtros del Calendario Anual Principal
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear)
  const [filterAreaId, setFilterAreaId] = React.useState<string>("all")
  const [filterTopicId, setFilterTopicId] = React.useState<string>("all")
  const [filterStatus, setFilterStatus] = React.useState<string>("all")

  // Expansión de carpetas en la sección de Estructura Organizativa
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(new Set())

  // Diálogo 1: Incorporar carpeta de área
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const [selectedNewAreaId, setSelectedNewAreaId] = React.useState<string>("")
  const [newFolderDesc, setNewFolderDesc] = React.useState<string>("")
  const [folderSubmitting, setFolderSubmitting] = React.useState(false)

  // Diálogo 2: Crear / Editar tema de capacitación
  const [topicDialogOpen, setTopicDialogOpen] = React.useState(false)
  const [editingTopic, setEditingTopic] = React.useState<TrainingTopic | null>(null)
  const [topicFolderId, setTopicFolderId] = React.useState<string>("")
  const [topicTitle, setTopicTitle] = React.useState<string>("")
  const [topicDescription, setTopicDescription] = React.useState<string>("")
  const [topicFrequency, setTopicFrequency] = React.useState<TrainingFrequency>("TRIMESTRAL")
  const [topicSubmitting, setTopicSubmitting] = React.useState(false)

  // Diálogo 3: Programar sesión manualmente en el calendario
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleFolderId, setScheduleFolderId] = React.useState<string>("")
  const [scheduleTopicId, setScheduleTopicId] = React.useState<string>("")
  const [scheduleDate, setScheduleDate] = React.useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [scheduleNotes, setScheduleNotes] = React.useState<string>("")
  const [scheduleSubmitting, setScheduleSubmitting] = React.useState(false)

  // Diálogo 4: Gestionar sesión (Realizada / No realizada + Participantes)
  const [sessionModalOpen, setSessionModalOpen] = React.useState(false)
  const [activeSession, setActiveSession] = React.useState<TrainingSession | null>(null)
  const [sessionDateInput, setSessionDateInput] = React.useState<string>("")
  const [sessionStatusInput, setSessionStatusInput] =
    React.useState<TrainingSessionStatus>("PROGRAMADA")
  const [sessionNotesInput, setSessionNotesInput] = React.useState<string>("")
  const [selectedParticipantIds, setSelectedParticipantIds] = React.useState<Set<string>>(
    new Set()
  )
  const [participantSearch, setParticipantSearch] = React.useState<string>("")
  const [participantAreaFilter, setParticipantAreaFilter] = React.useState<string>("all")
  const [sessionSubmitting, setSessionSubmitting] = React.useState(false)

  // Subida de documentos Word / PDF por tema
  const [uploadingTopicId, setUploadingTopicId] = React.useState<string | null>(null)
  const fileInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({})

  const loadData = React.useCallback(
    async (opts: { silent?: boolean; forceRefresh?: boolean } = {}) => {
      if (!entityId) return
      if (!opts.silent) setLoading(true)
      setError(null)
      try {
        const overview = await loadEntityTrainingOverview(entityId, {
          forceRefresh: opts.forceRefresh,
        })
        setState(overview.state)
        setAreas(overview.areas)
        setWorkers(overview.workers)
        setExpandedFolderIds((prev) => {
          if (prev.size > 0) return prev
          return new Set(overview.state.folders.map((f) => f.id))
        })
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar la información de capacitación de la entidad."
        )
      } finally {
        if (!opts.silent) setLoading(false)
      }
    },
    [entityId]
  )

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  React.useEffect(() => {
    const handleChanged = () => {
      void loadData({ silent: true })
    }
    window.addEventListener(TRAINING_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(TRAINING_CHANGED_EVENT, handleChanged)
    }
  }, [loadData])

  // Mapas de consulta rápida
  const areaNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const a of areas) {
      map.set(a.id, a.name)
    }
    for (const f of state.folders) {
      if (!map.has(f.area_id)) {
        map.set(f.area_id, f.area_name_snapshot)
      }
    }
    return map
  }, [areas, state.folders])

  const folderById = React.useMemo(
    () => new Map(state.folders.map((f) => [f.id, f])),
    [state.folders]
  )

  const topicById = React.useMemo(
    () => new Map(state.topics.map((t) => [t.id, t])),
    [state.topics]
  )

  const workerById = React.useMemo(
    () => new Map(workers.map((w) => [w.id, w])),
    [workers]
  )

  // Áreas organizativas de la entidad que aún no tienen carpeta de capacitación creada
  const availableAreasForNewFolder = React.useMemo(() => {
    const usedAreaIds = new Set(state.folders.map((f) => f.area_id))
    return areas.filter((a) => a.is_active && !usedAreaIds.has(a.id))
  }, [areas, state.folders])

  // Opciones de años para el calendario anual
  const yearOptions = React.useMemo(() => {
    const years = new Set<number>([
      currentYear - 1,
      currentYear,
      currentYear + 1,
      currentYear + 2,
    ])
    for (const s of state.sessions) {
      const y = Number(s.scheduled_date.slice(0, 4))
      if (Number.isFinite(y) && y > 2000 && y < 2100) years.add(y)
    }
    return Array.from(years).sort((a, b) => a - b)
  }, [currentYear, state.sessions])

  // Temas filtrados según el área elegida en el filtro del calendario
  const filterableTopics = React.useMemo(() => {
    if (filterAreaId === "all") return state.topics
    return state.topics.filter((t) => t.area_id === filterAreaId)
  }, [state.topics, filterAreaId])

  // Sesiones del calendario anual filtradas por Año, Área, Tema y Estado
  const filteredYearSessions = React.useMemo(() => {
    const yearPrefix = `${selectedYear}-`
    return state.sessions
      .filter((s) => {
        if (!s.scheduled_date.startsWith(yearPrefix)) return false
        if (filterAreaId !== "all" && s.area_id !== filterAreaId) return false
        if (filterTopicId !== "all" && s.topic_id !== filterTopicId) return false
        if (filterStatus !== "all" && s.status !== filterStatus) return false
        return true
      })
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  }, [state.sessions, selectedYear, filterAreaId, filterTopicId, filterStatus])

  // Agrupación de sesiones por mes (0..11) para la cuadrícula del Calendario Anual
  const sessionsByMonth = React.useMemo(() => {
    const groups: TrainingSession[][] = Array.from({ length: 12 }, () => [])
    for (const s of filteredYearSessions) {
      const monthIndex = Number(s.scheduled_date.slice(5, 7)) - 1
      if (monthIndex >= 0 && monthIndex < 12) {
        groups[monthIndex].push(s)
      }
    }
    return groups
  }, [filteredYearSessions])

  // Indicadores resumen de la entidad
  const kpis = React.useMemo(() => {
    const yearPrefix = `${selectedYear}-`
    const yearSessions = state.sessions.filter((s) => s.scheduled_date.startsWith(yearPrefix))
    const completedCount = yearSessions.filter((s) => s.status === "REALIZADA").length
    const pendingCount = yearSessions.filter((s) => s.status === "PROGRAMADA").length
    const notCompletedCount = yearSessions.filter((s) => s.status === "NO_REALIZADA").length
    return {
      foldersCount: state.folders.length,
      topicsCount: state.topics.length,
      yearTotalSessions: yearSessions.length,
      completedCount,
      pendingCount,
      notCompletedCount,
      totalReceivedRecords: state.workerRecords.length,
    }
  }, [state, selectedYear])

  // --- Handlers: Carpetas de Área ---
  const openIncorporateFolderDialog = () => {
    setSelectedNewAreaId(availableAreasForNewFolder[0]?.id || "")
    setNewFolderDesc("")
    setFolderDialogOpen(true)
  }

  const handleIncorporateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId || !selectedNewAreaId) return
    const areaObj = areas.find((a) => a.id === selectedNewAreaId)
    if (!areaObj) return

    setFolderSubmitting(true)
    try {
      const folder = await incorporateEntityAreaFolder({
        entityId,
        areaId: areaObj.id,
        areaName: areaObj.name,
        description: newFolderDesc.trim() || null,
      })
      setExpandedFolderIds((prev) => new Set([...prev, folder.id]))
      setFolderDialogOpen(false)
      toast({
        title: "Carpeta de área incorporada",
        description: `El área «${areaObj.name}» se habilitó como carpeta de capacitación.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al incorporar carpeta",
        description: err instanceof Error ? err.message : "No se pudo crear la carpeta.",
      })
    } finally {
      setFolderSubmitting(false)
    }
  }

  const handleDeleteFolder = async (folder: TrainingFolder) => {
    if (!entityId) return
    const areaLabel = areaNameById.get(folder.area_id) || folder.area_name_snapshot
    try {
      await removeEntityAreaFolder(entityId, folder.id)
      toast({
        title: "Carpeta retirada",
        description: `Se retiró la carpeta de «${areaLabel}». El historial recibido por los trabajadores se conserva intacto.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo retirar la carpeta",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  // --- Handlers: Temas de Capacitación ---
  const openCreateTopicDialog = (defaultFolderId?: string) => {
    setEditingTopic(null)
    setTopicFolderId(defaultFolderId || state.folders[0]?.id || "")
    setTopicTitle("")
    setTopicDescription("")
    setTopicFrequency("TRIMESTRAL")
    setTopicDialogOpen(true)
  }

  const openEditTopicDialog = (topic: TrainingTopic) => {
    setEditingTopic(topic)
    setTopicFolderId(topic.folder_id)
    setTopicTitle(topic.title)
    setTopicDescription(topic.description || "")
    setTopicFrequency(topic.frequency)
    setTopicDialogOpen(true)
  }

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId) return
    setTopicSubmitting(true)
    try {
      if (editingTopic) {
        await updateTrainingTopic({
          entityId,
          topicId: editingTopic.id,
          title: topicTitle,
          description: topicDescription,
          frequency: topicFrequency,
        })
        toast({
          title: "Tema actualizado",
          description: "Se guardaron los cambios del tema de capacitación.",
        })
      } else {
        const created = await createTrainingTopic({
          entityId,
          folderId: topicFolderId,
          title: topicTitle,
          description: topicDescription,
          frequency: topicFrequency,
        })
        setExpandedFolderIds((prev) => new Set([...prev, created.folder_id]))
        toast({
          title: "Tema creado",
          description: `El tema «${created.title}» se agregó a la carpeta.`,
        })
      }
      setTopicDialogOpen(false)
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al guardar el tema",
        description: err instanceof Error ? err.message : "Revisa los datos ingresados.",
      })
    } finally {
      setTopicSubmitting(false)
    }
  }

  const handleDeleteTopic = async (topic: TrainingTopic) => {
    if (!entityId) return
    try {
      await deleteTrainingTopic(entityId, topic.id)
      toast({
        title: "Tema eliminado",
        description: `Se eliminó el tema «${topic.title}». Las capacitaciones ya recibidas por los trabajadores se conservan en sus fichas.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al eliminar el tema",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  // --- Handlers: Documentos Word y PDF ---
  const handleFileSelected = async (topicId: string, file: File | null) => {
    if (!entityId || !file) return
    if (!isAllowedTrainingDocumentFile(file)) {
      toast({
        variant: "destructive",
        title: "Formato no permitido",
        description: "Solo se admiten documentos Word (.doc, .docx) y PDF (.pdf).",
      })
      return
    }

    setUploadingTopicId(topicId)
    try {
      await uploadTrainingTopicDocument({
        entityId,
        topicId,
        file,
      })
      toast({
        title: "Documento adjuntado",
        description: `Se subió «${file.name}» correctamente.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al subir documento",
        description: err instanceof Error ? err.message : "No se pudo subir el archivo.",
      })
    } finally {
      setUploadingTopicId(null)
      const inputEl = fileInputRefs.current[topicId]
      if (inputEl) inputEl.value = ""
    }
  }

  const handleDownloadDocument = async (doc: TrainingTopicDocument) => {
    try {
      const blob = await downloadTrainingTopicDocument(doc)
      saveDownloadedFile(blob, doc.file_name)
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo descargar el documento",
        description: err instanceof Error ? err.message : "Archivo no disponible.",
      })
    }
  }

  const handleDeleteDocument = async (doc: TrainingTopicDocument) => {
    if (!entityId) return
    try {
      await deleteTrainingTopicDocument(entityId, doc.id)
      toast({
        title: "Documento eliminado",
        description: `Se retiró «${doc.file_name}» del tema.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar el documento",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  // --- Handlers: Programar sesión en calendario ---
  const openScheduleSessionDialog = (preselectedTopic?: TrainingTopic) => {
    const initialFolderId =
      preselectedTopic?.folder_id || state.folders[0]?.id || ""
    const folderTopics = state.topics.filter((t) => t.folder_id === initialFolderId)
    const initialTopicId =
      preselectedTopic?.id || folderTopics[0]?.id || state.topics[0]?.id || ""

    setScheduleFolderId(initialFolderId)
    setScheduleTopicId(initialTopicId)
    setScheduleDate(`${selectedYear}-${new Date().toISOString().slice(5, 10)}`)
    setScheduleNotes("")
    setScheduleDialogOpen(true)
  }

  const handleScheduleSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId || !scheduleTopicId || !scheduleDate) return
    setScheduleSubmitting(true)
    try {
      const created = await scheduleTrainingSession({
        entityId,
        topicId: scheduleTopicId,
        scheduledDate: scheduleDate,
        notes: scheduleNotes,
      })
      const scheduledYr = Number(created.scheduled_date.slice(0, 4))
      if (Number.isFinite(scheduledYr)) {
        setSelectedYear(scheduledYr)
      }
      setScheduleDialogOpen(false)
      toast({
        title: "Sesión programada",
        description: `Se programó la sesión para el ${created.scheduled_date} en el calendario anual.`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo programar la sesión",
        description: err instanceof Error ? err.message : "Revisa los datos.",
      })
    } finally {
      setScheduleSubmitting(false)
    }
  }

  // --- Handlers: Gestionar realización y participantes de una sesión ---
  const openManageSessionModal = (session: TrainingSession) => {
    setActiveSession(session)
    setSessionDateInput(session.scheduled_date)
    setSessionStatusInput(session.status)
    setSessionNotesInput(session.notes || "")
    setSelectedParticipantIds(new Set(session.participant_worker_ids || []))
    setParticipantSearch("")
    setParticipantAreaFilter(session.area_id || "all")
    setSessionModalOpen(true)
  }

  const filteredModalWorkers = React.useMemo(() => {
    const q = participantSearch.trim().toLowerCase()
    return workers.filter((w) => {
      if (participantAreaFilter !== "all" && w.areaId !== participantAreaFilter) {
        return false
      }
      if (!q) return true
      return (
        w.fullName.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        w.identification.toLowerCase().includes(q) ||
        (w.positionName || "").toLowerCase().includes(q)
      )
    })
  }, [workers, participantSearch, participantAreaFilter])

  const toggleParticipant = (workerId: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev)
      if (next.has(workerId)) {
        next.delete(workerId)
      } else {
        next.add(workerId)
      }
      return next
    })
  }

  const selectAllVisibleWorkers = () => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev)
      for (const w of filteredModalWorkers) {
        next.add(w.id)
      }
      return next
    })
  }

  const clearSelectedWorkers = () => {
    setSelectedParticipantIds(new Set())
  }

  const handleSaveSessionOutcome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!entityId || !activeSession) return

    setSessionSubmitting(true)
    try {
      const participantIds =
        sessionStatusInput === "REALIZADA" ? Array.from(selectedParticipantIds) : []

      await saveTrainingSessionOutcome({
        entityId,
        sessionId: activeSession.id,
        scheduledDate: sessionDateInput,
        status: sessionStatusInput,
        notes: sessionNotesInput,
        participantWorkerIds: participantIds,
        areaNameByAreaId: areaNameById,
      })

      setSessionModalOpen(false)
      toast({
        title: "Sesión actualizada",
        description:
          sessionStatusInput === "REALIZADA"
            ? `Sesión marcada como Realizada con ${participantIds.length} participante(s) registrado(s) en su Información adicional.`
            : `Estado de la sesión actualizado a «${TRAINING_SESSION_STATUS_LABELS[sessionStatusInput]}».`,
      })
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo guardar la sesión",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    } finally {
      setSessionSubmitting(false)
    }
  }

  const handleDeleteSession = async (session: TrainingSession) => {
    if (!entityId) return
    try {
      await deleteTrainingSession(entityId, session.id)
      toast({
        title: "Sesión eliminada",
        description: "La fecha programada fue retirada del calendario.",
      })
      if (activeSession?.id === session.id) {
        setSessionModalOpen(false)
      }
      await loadData({ silent: true })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar la sesión",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  if (!entityId) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Capacitación" description="No se indicó una entidad" />
        <SiteCorpAlert type="danger" title="Entidad no encontrada">
          Selecciona una entidad válida para gestionar su módulo de Capacitación.
        </SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title={`Capacitación — ${currentEntity?.name ?? "Entidad"}`}
        description="Calendario anual de capacitaciones, carpetas por área organizativa, temas, documentos Word/PDF y registro de participantes."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={openIncorporateFolderDialog}
                disabled={availableAreasForNewFolder.length === 0}
              >
                <FolderPlus className="mr-1.5 h-4 w-4" />
                Incorporar carpeta de área
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => openCreateTopicDialog()}
                disabled={state.folders.length === 0}
              >
                <BookOpen className="mr-1.5 h-4 w-4" />
                Nuevo tema
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                onClick={() => openScheduleSessionDialog()}
                disabled={state.topics.length === 0}
              >
                <CalendarIcon className="mr-1.5 h-4 w-4" />
                Programar sesión
              </SiteCorpButton>
            </div>
          ) : undefined
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error al cargar Capacitación">
          {error}
        </SiteCorpAlert>
      )}

      {/* Notificaciones de capacitación inicial pendiente por contrataciones en esta entidad */}
      <PendingInitialTrainingBanner entityId={entityId} />

      {/* Indicadores Operativos del Módulo de Capacitación */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Carpetas de área
              </p>
              <p className="mt-1 text-3xl font-bold text-ink tabular-nums">
                {kpis.foldersCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                de {areas.filter((a) => a.is_active).length} área(s) en la entidad
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-primary/10 p-2.5 text-sitecorp-primary">
              <FolderOpen className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Temas de capacitación
              </p>
              <p className="mt-1 text-3xl font-bold text-ink tabular-nums">
                {kpis.topicsCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.documents.length} documento(s) Word / PDF
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-secondary-orange/10 p-2.5 text-sitecorp-secondary-orange">
              <BookOpen className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sesiones en {selectedYear}
              </p>
              <p className="mt-1 text-3xl font-bold text-ink tabular-nums">
                {kpis.yearTotalSessions}
              </p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {kpis.completedCount} realizadas · {kpis.pendingCount} programadas ·{" "}
                {kpis.notCompletedCount} no realizadas
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-success/10 p-2.5 text-sitecorp-success">
              <CalendarIcon className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard className="rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Capacitaciones recibidas
              </p>
              <p className="mt-1 text-3xl font-bold text-ink tabular-nums">
                {kpis.totalReceivedRecords}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Registros en fichas de trabajadores
              </p>
            </div>
            <div className="rounded-xl bg-sitecorp-primary/10 p-2.5 text-sitecorp-primary">
              <GraduationCap className="h-5 w-5" />
            </div>
          </div>
        </SiteCorpCard>
      </div>

      {loading ? (
        <SiteCorpLoading rows={4} />
      ) : (
        <>
          {/* =================================================================== */}
          {/* SECCIÓN 1: CALENDARIO ANUAL PRINCIPAL DE LA ENTIDAD                 */}
          {/* =================================================================== */}
          <SiteCorpCard className="rounded-2xl">
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-5 w-5 text-sitecorp-primary" />
                    <h2 className="text-lg font-semibold text-ink">
                      Calendario anual de capacitaciones — {selectedYear}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Muestra exclusivamente las capacitaciones de{" "}
                    <strong className="font-medium text-ink">
                      {currentEntity?.name || "esta entidad"}
                    </strong>
                    . Haz clic sobre cualquier sesión para registrar su realización y seleccionar
                    los trabajadores participantes.
                  </p>
                </div>

                {/* Filtros: Año, Área, Tema y Estado */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Filter className="h-3.5 w-3.5" />
                    Filtrar:
                  </div>

                  {/* Filtro Año */}
                  <div className="w-28">
                    <SiteCorpSelect
                      value={String(selectedYear)}
                      onValueChange={(val) => setSelectedYear(Number(val))}
                    >
                      {yearOptions.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          Año {y}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>
                  </div>

                  {/* Filtro Área */}
                  <div className="w-44">
                    <SiteCorpSelect
                      value={filterAreaId}
                      onValueChange={(val) => {
                        setFilterAreaId(val)
                        setFilterTopicId("all")
                      }}
                    >
                      <SelectItem value="all">Todas las áreas</SelectItem>
                      {state.folders.map((f) => (
                        <SelectItem key={f.area_id} value={f.area_id}>
                          {areaNameById.get(f.area_id) || f.area_name_snapshot}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>
                  </div>

                  {/* Filtro Tema */}
                  <div className="w-48">
                    <SiteCorpSelect
                      value={filterTopicId}
                      onValueChange={(val) => setFilterTopicId(val)}
                    >
                      <SelectItem value="all">Todos los temas</SelectItem>
                      {filterableTopics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.title}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>
                  </div>

                  {/* Filtro Estado */}
                  <div className="w-40">
                    <SiteCorpSelect
                      value={filterStatus}
                      onValueChange={(val) => setFilterStatus(val)}
                    >
                      <SelectItem value="all">Todos los estados</SelectItem>
                      <SelectItem value="PROGRAMADA">Programada</SelectItem>
                      <SelectItem value="REALIZADA">Realizada</SelectItem>
                      <SelectItem value="NO_REALIZADA">No realizada</SelectItem>
                    </SiteCorpSelect>
                  </div>
                </div>
              </div>

              {/* Cuadrícula de los 12 meses del año */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {MONTH_NAMES.map((monthName, monthIdx) => {
                  const monthSessions = sessionsByMonth[monthIdx] || []
                  return (
                    <div
                      key={monthName}
                      className="flex flex-col rounded-xl border border-border bg-white p-3.5"
                    >
                      <div className="mb-2.5 flex items-center justify-between border-b border-border pb-2">
                        <span className="text-sm font-semibold text-ink">{monthName}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                          {monthSessions.length}{" "}
                          {monthSessions.length === 1 ? "sesión" : "sesiones"}
                        </span>
                      </div>

                      {monthSessions.length === 0 ? (
                        <p className="py-5 text-center text-xs text-muted-foreground">
                          Sin sesiones programadas
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {monthSessions.map((session) => {
                            const topic = topicById.get(session.topic_id)
                            const areaName =
                              areaNameById.get(session.area_id) ||
                              folderById.get(session.folder_id)?.area_name_snapshot ||
                              "Área"
                            const dayNumber = session.scheduled_date.slice(8, 10)
                            return (
                              <button
                                key={session.id}
                                type="button"
                                onClick={() => openManageSessionModal(session)}
                                className={cn(
                                  "w-full rounded-lg border p-2.5 text-left transition-colors",
                                  session.status === "REALIZADA"
                                    ? "border-sitecorp-success/30 bg-sitecorp-success/5 hover:bg-sitecorp-success/10"
                                    : session.status === "NO_REALIZADA"
                                      ? "border-sitecorp-danger/30 bg-sitecorp-danger/5 hover:bg-sitecorp-danger/10"
                                      : "border-sitecorp-primary/25 bg-sitecorp-primary/5 hover:bg-sitecorp-primary/10"
                                )}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-mono text-xs font-semibold text-ink tabular-nums">
                                    Día {dayNumber}
                                  </span>
                                  <SiteCorpStatusBadge status={statusBadgeVariant(session.status)}>
                                    {TRAINING_SESSION_STATUS_LABELS[session.status]}
                                  </SiteCorpStatusBadge>
                                </div>
                                <p
                                  className="mt-1 truncate text-xs font-semibold text-ink"
                                  title={topic?.title}
                                >
                                  {topic?.title || "Tema de capacitación"}
                                </p>
                                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span className="truncate">{areaName}</span>
                                  {session.status === "REALIZADA" && (
                                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-sitecorp-success tabular-nums">
                                      <Users className="h-3 w-3" />
                                      {session.participant_worker_ids.length}
                                    </span>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Tabla cronológica de sesiones filtradas en el año */}
              {filteredYearSessions.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Detalle cronológico de sesiones en {selectedYear} ({filteredYearSessions.length})
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2.5">Fecha</th>
                          <th className="px-4 py-2.5">Carpeta de área</th>
                          <th className="px-4 py-2.5">Tema</th>
                          <th className="px-4 py-2.5">Frecuencia</th>
                          <th className="px-4 py-2.5">Estado</th>
                          <th className="px-4 py-2.5">Participantes</th>
                          <th className="px-4 py-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-white">
                        {filteredYearSessions.map((session) => {
                          const topic = topicById.get(session.topic_id)
                          const areaName =
                            areaNameById.get(session.area_id) ||
                            folderById.get(session.folder_id)?.area_name_snapshot ||
                            "—"
                          return (
                            <tr key={session.id} className="hover:bg-muted/20">
                              <td className="px-4 py-2.5 font-mono text-xs font-medium text-ink tabular-nums">
                                {session.scheduled_date}
                              </td>
                              <td className="px-4 py-2.5 text-ink">{areaName}</td>
                              <td className="px-4 py-2.5 font-medium text-ink">
                                {topic?.title || "—"}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                {topic ? TRAINING_FREQUENCY_LABELS[topic.frequency] : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                <SiteCorpStatusBadge status={statusBadgeVariant(session.status)}>
                                  {TRAINING_SESSION_STATUS_LABELS[session.status]}
                                </SiteCorpStatusBadge>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                                {session.status === "REALIZADA"
                                  ? `${session.participant_worker_ids.length} trabajador(es)`
                                  : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <SiteCorpButton
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openManageSessionModal(session)}
                                  >
                                    {canManage ? "Registrar / Participantes" : "Ver detalle"}
                                  </SiteCorpButton>
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSession(session)}
                                      className="rounded-md p-1.5 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                                      title="Eliminar sesión"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </SiteCorpCard>

          {/* =================================================================== */}
          {/* SECCIÓN 2: CARPETAS DE ÁREA → TEMAS → DOCUMENTOS Y SESIONES         */}
          {/* =================================================================== */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  Carpetas de capacitación por área organizativa
                </h2>
                <p className="text-xs text-muted-foreground">
                  Estructura vinculada exclusivamente a las áreas creadas en la entidad:{" "}
                  <strong className="font-medium text-ink">
                    Entidad → Capacitación → Carpeta de área → Tema → Documentos y sesiones
                  </strong>
                </p>
              </div>

              {canManage && availableAreasForNewFolder.length > 0 && (
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  onClick={openIncorporateFolderDialog}
                >
                  <FolderPlus className="mr-1.5 h-4 w-4" />
                  Incorporar carpeta de área
                </SiteCorpButton>
              )}
            </div>

            {areas.length === 0 ? (
              <SiteCorpCard className="rounded-2xl">
                <div className="py-8 text-center">
                  <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-semibold text-ink">
                    Esta entidad aún no tiene áreas organizativas creadas
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                    El módulo de Capacitación utiliza exclusivamente las áreas existentes en la
                    estructura organizativa de la entidad. Crea primero las áreas en Configuración
                    de Plantilla.
                  </p>
                  <div className="mt-4">
                    <Link to={`/entity/${entityId}/settings/staffing`}>
                      <SiteCorpButton size="sm" variant="outline">
                        Ir a Configuración de Plantilla
                      </SiteCorpButton>
                    </Link>
                  </div>
                </div>
              </SiteCorpCard>
            ) : state.folders.length === 0 ? (
              <SiteCorpCard className="rounded-2xl">
                <div className="py-10 text-center">
                  <FolderPlus className="mx-auto h-9 w-9 text-sitecorp-primary/70" />
                  <p className="mt-3 text-base font-semibold text-ink">
                    No hay carpetas de área incorporadas todavía
                  </p>
                  <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                    Incorpora una o más de las {areas.length} áreas organizativas existentes de la
                    entidad como carpetas de capacitación para comenzar a registrar sus temas,
                    documentos Word/PDF y sesiones del calendario.
                  </p>
                  {canManage && (
                    <div className="mt-4">
                      <SiteCorpButton type="button" onClick={openIncorporateFolderDialog}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        Incorporar primera carpeta de área
                      </SiteCorpButton>
                    </div>
                  )}
                </div>
              </SiteCorpCard>
            ) : (
              <div className="space-y-4">
                {state.folders.map((folder) => {
                  const areaName =
                    areaNameById.get(folder.area_id) || folder.area_name_snapshot
                  const folderTopics = state.topics.filter((t) => t.folder_id === folder.id)
                  const isExpanded = expandedFolderIds.has(folder.id)

                  return (
                    <SiteCorpCard key={folder.id} className="rounded-2xl">
                      <div className="space-y-4">
                        {/* Cabecera de la Carpeta de Área */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => toggleFolderExpand(folder.id)}
                            className="flex items-center gap-3 text-left"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            )}
                            <div className="rounded-xl bg-sitecorp-primary/10 p-2.5 text-sitecorp-primary">
                              <FolderOpen className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold text-ink">{areaName}</h3>
                                <SiteCorpStatusBadge status="neutral">
                                  {folderTopics.length}{" "}
                                  {folderTopics.length === 1 ? "tema" : "temas"}
                                </SiteCorpStatusBadge>
                              </div>
                              {folder.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {folder.description}
                                </p>
                              )}
                            </div>
                          </button>

                          {canManage && (
                            <div className="flex items-center gap-2">
                              <SiteCorpButton
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openCreateTopicDialog(folder.id)}
                              >
                                <Plus className="mr-1.5 h-4 w-4" />
                                Nuevo tema en esta área
                              </SiteCorpButton>
                              <button
                                type="button"
                                onClick={() => handleDeleteFolder(folder)}
                                className="rounded-lg p-2 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                                title="Retirar carpeta de área"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Contenido desplegable de la Carpeta: Lista de Temas */}
                        {isExpanded && (
                          <div className="space-y-4 border-t border-border pt-4">
                            {folderTopics.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-border py-6 text-center">
                                <p className="text-sm text-muted-foreground">
                                  Esta carpeta de área aún no tiene temas de capacitación.
                                </p>
                                {canManage && (
                                  <div className="mt-3">
                                    <SiteCorpButton
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openCreateTopicDialog(folder.id)}
                                    >
                                      <Plus className="mr-1.5 h-4 w-4" />
                                      Crear primer tema
                                    </SiteCorpButton>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {folderTopics.map((topic) => {
                                  const topicDocs = state.documents.filter(
                                    (d) => d.topic_id === topic.id
                                  )
                                  const topicSessions = state.sessions
                                    .filter((s) => s.topic_id === topic.id)
                                    .sort((a, b) =>
                                      a.scheduled_date.localeCompare(b.scheduled_date)
                                    )

                                  return (
                                    <div
                                      key={topic.id}
                                      className="rounded-xl border border-border bg-muted/15 p-4"
                                    >
                                      {/* Cabecera del Tema */}
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="space-y-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <BookOpen className="h-4 w-4 text-sitecorp-primary" />
                                            <h4 className="text-sm font-semibold text-ink">
                                              {topic.title}
                                            </h4>
                                            <SiteCorpStatusBadge status="info">
                                              Frecuencia:{" "}
                                              {TRAINING_FREQUENCY_LABELS[topic.frequency]}
                                            </SiteCorpStatusBadge>
                                          </div>
                                          {topic.description && (
                                            <p className="text-xs text-muted-foreground">
                                              {topic.description}
                                            </p>
                                          )}
                                        </div>

                                        {canManage && (
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <input
                                              ref={(el) => {
                                                fileInputRefs.current[topic.id] = el
                                              }}
                                              type="file"
                                              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                              className="hidden"
                                              onChange={(e) => {
                                                const f = e.target.files?.[0] || null
                                                void handleFileSelected(topic.id, f)
                                              }}
                                            />
                                            <SiteCorpButton
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              disabled={uploadingTopicId === topic.id}
                                              onClick={() =>
                                                fileInputRefs.current[topic.id]?.click()
                                              }
                                            >
                                              <Upload className="mr-1.5 h-3.5 w-3.5" />
                                              {uploadingTopicId === topic.id
                                                ? "Subiendo..."
                                                : "Subir Word / PDF"}
                                            </SiteCorpButton>

                                            <SiteCorpButton
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              onClick={() => openScheduleSessionDialog(topic)}
                                            >
                                              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                                              Programar fecha
                                            </SiteCorpButton>

                                            <button
                                              type="button"
                                              onClick={() => openEditTopicDialog(topic)}
                                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-ink"
                                              title="Editar tema"
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() => handleDeleteTopic(topic)}
                                              className="rounded-md p-1.5 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                                              title="Eliminar tema"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                        )}
                                      </div>

                                      {/* Subsecciones del Tema: Documentos (Word y PDF) y Sesiones programadas */}
                                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                        {/* Documentos del Tema */}
                                        <div className="rounded-xl border border-border bg-white p-3.5">
                                          <div className="mb-2.5 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                              <FileText className="h-3.5 w-3.5" />
                                              Documentos Word y PDF ({topicDocs.length})
                                            </span>
                                          </div>

                                          {topicDocs.length === 0 ? (
                                            <p className="py-3 text-xs text-muted-foreground">
                                              Sin documentos adjuntos para este tema.
                                            </p>
                                          ) : (
                                            <ul className="divide-y divide-border">
                                              {topicDocs.map((doc) => (
                                                <li
                                                  key={doc.id}
                                                  className="flex items-center justify-between gap-2 py-2"
                                                >
                                                  <div className="min-w-0 flex-1">
                                                    <p
                                                      className="truncate text-xs font-medium text-ink"
                                                      title={doc.file_name}
                                                    >
                                                      {doc.file_name}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground tabular-nums">
                                                      {formatFileSize(doc.file_size)} ·{" "}
                                                      {doc.created_at.slice(0, 10)}
                                                    </p>
                                                  </div>
                                                  <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                      type="button"
                                                      onClick={() => handleDownloadDocument(doc)}
                                                      className="rounded-md p-1.5 text-sitecorp-primary hover:bg-sitecorp-primary/10"
                                                      title="Descargar documento"
                                                    >
                                                      <Download className="h-4 w-4" />
                                                    </button>
                                                    {canManage && (
                                                      <button
                                                        type="button"
                                                        onClick={() => handleDeleteDocument(doc)}
                                                        className="rounded-md p-1.5 text-muted-foreground hover:bg-sitecorp-danger/10 hover:text-sitecorp-danger"
                                                        title="Eliminar documento"
                                                      >
                                                        <Trash2 className="h-4 w-4" />
                                                      </button>
                                                    )}
                                                  </div>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>

                                        {/* Sesiones Programadas del Tema */}
                                        <div className="rounded-xl border border-border bg-white p-3.5">
                                          <div className="mb-2.5 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                              <CalendarIcon className="h-3.5 w-3.5" />
                                              Sesiones programadas ({topicSessions.length})
                                            </span>
                                          </div>

                                          {topicSessions.length === 0 ? (
                                            <p className="py-3 text-xs text-muted-foreground">
                                              No hay fechas programadas aún para este tema.
                                            </p>
                                          ) : (
                                            <ul className="divide-y divide-border">
                                              {topicSessions.map((session) => (
                                                <li
                                                  key={session.id}
                                                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                                                >
                                                  <div className="space-y-0.5">
                                                    <div className="flex items-center gap-2">
                                                      <span className="font-mono text-xs font-semibold text-ink tabular-nums">
                                                        {session.scheduled_date}
                                                      </span>
                                                      <SiteCorpStatusBadge
                                                        status={statusBadgeVariant(session.status)}
                                                      >
                                                        {
                                                          TRAINING_SESSION_STATUS_LABELS[
                                                            session.status
                                                          ]
                                                        }
                                                      </SiteCorpStatusBadge>
                                                    </div>
                                                    {session.status === "REALIZADA" && (
                                                      <p className="text-[11px] text-muted-foreground tabular-nums">
                                                        {session.participant_worker_ids.length}{" "}
                                                        participante(s) registrado(s)
                                                      </p>
                                                    )}
                                                  </div>

                                                  <div className="flex items-center gap-1">
                                                    <SiteCorpButton
                                                      type="button"
                                                      size="sm"
                                                      variant="outline"
                                                      onClick={() =>
                                                        openManageSessionModal(session)
                                                      }
                                                    >
                                                      {canManage ? "Gestionar" : "Ver"}
                                                    </SiteCorpButton>
                                                  </div>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </SiteCorpCard>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===================================================================== */}
      {/* DIÁLOGO 1: INCORPORAR CARPETA DE ÁREA                                 */}
      {/* ===================================================================== */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Incorporar carpeta de área</DialogTitle>
            <DialogDescription>
              Selecciona una de las áreas organizativas ya existentes en esta entidad para
              habilitar su carpeta de capacitación.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleIncorporateFolder} className="space-y-4">
            <div className="space-y-2">
              <Label>Área organizativa de la entidad</Label>
              <SiteCorpSelect
                value={selectedNewAreaId}
                onValueChange={(val) => setSelectedNewAreaId(val)}
              >
                {availableAreasForNewFolder.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.code ? `(${a.code})` : ""}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-2">
              <Label>Descripción u objetivo formativo del área (opcional)</Label>
              <SiteCorpInput
                value={newFolderDesc}
                onChange={(e) => setNewFolderDesc(e.target.value)}
                placeholder="Ej. Plan anual de formación técnica y seguridad del área..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setFolderDialogOpen(false)}
                disabled={folderSubmitting}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={folderSubmitting || !selectedNewAreaId}>
                {folderSubmitting ? "Incorporando..." : "Incorporar carpeta"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIÁLOGO 2: CREAR / EDITAR TEMA DE CAPACITACIÓN                        */}
      {/* ===================================================================== */}
      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingTopic ? "Editar tema de capacitación" : "Nuevo tema de capacitación"}
            </DialogTitle>
            <DialogDescription>
              Define el tema, su carpeta de área correspondiente y la frecuencia de referencia.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveTopic} className="space-y-4">
            {!editingTopic && (
              <div className="space-y-2">
                <Label>Carpeta de área</Label>
                <SiteCorpSelect
                  value={topicFolderId}
                  onValueChange={(val) => setTopicFolderId(val)}
                >
                  {state.folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {areaNameById.get(f.area_id) || f.area_name_snapshot}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
            )}

            <div className="space-y-2">
              <Label>Nombre del tema</Label>
              <SiteCorpInput
                value={topicTitle}
                onChange={(e) => setTopicTitle(e.target.value)}
                placeholder="Ej. Normas de protección e higiene del trabajo"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Frecuencia del tema</Label>
              <SiteCorpSelect
                value={topicFrequency}
                onValueChange={(val) => setTopicFrequency(val as TrainingFrequency)}
              >
                {TRAINING_FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-2">
              <Label>Descripción o contenido (opcional)</Label>
              <SiteCorpInput
                value={topicDescription}
                onChange={(e) => setTopicDescription(e.target.value)}
                placeholder="Resumen de los objetivos o alcance del tema..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setTopicDialogOpen(false)}
                disabled={topicSubmitting}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={topicSubmitting || !topicTitle.trim()}>
                {topicSubmitting ? "Guardando..." : "Guardar tema"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIÁLOGO 3: PROGRAMAR FECHA DE SESIÓN MANUALMENTE EN EL CALENDARIO     */}
      {/* ===================================================================== */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Programar sesión de capacitación</DialogTitle>
            <DialogDescription>
              Selecciona el tema y la fecha programada para incorporarla al calendario anual de la
              entidad.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleScheduleSession} className="space-y-4">
            <div className="space-y-2">
              <Label>Carpeta de área</Label>
              <SiteCorpSelect
                value={scheduleFolderId}
                onValueChange={(val) => {
                  setScheduleFolderId(val)
                  const firstTopic = state.topics.find((t) => t.folder_id === val)
                  setScheduleTopicId(firstTopic?.id || "")
                }}
              >
                {state.folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {areaNameById.get(f.area_id) || f.area_name_snapshot}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-2">
              <Label>Tema de capacitación</Label>
              <SiteCorpSelect
                value={scheduleTopicId}
                onValueChange={(val) => setScheduleTopicId(val)}
              >
                {state.topics
                  .filter((t) => !scheduleFolderId || t.folder_id === scheduleFolderId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title} ({TRAINING_FREQUENCY_LABELS[t.frequency]})
                    </SelectItem>
                  ))}
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
              <Label>Observaciones de programación (opcional)</Label>
              <SiteCorpInput
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                placeholder="Horario previsto, salón, instructor..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setScheduleDialogOpen(false)}
                disabled={scheduleSubmitting}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="submit"
                disabled={scheduleSubmitting || !scheduleTopicId || !scheduleDate}
              >
                {scheduleSubmitting ? "Programando..." : "Programar en calendario"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===================================================================== */}
      {/* DIÁLOGO 4: GESTIONAR SESIÓN (REALIZADA / NO REALIZADA + PARTICIPANTES)*/}
      {/* ===================================================================== */}
      <Dialog open={sessionModalOpen} onOpenChange={setSessionModalOpen}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>
              {activeSession
                ? topicById.get(activeSession.topic_id)?.title || "Sesión de capacitación"
                : "Sesión de capacitación"}
            </DialogTitle>
            <DialogDescription>
              Registra si la sesión fue realizada o no. Al marcarla como «Realizada», cada
              trabajador seleccionado recibirá automáticamente un registro de capacitación
              «Recibida» en su Información adicional.
            </DialogDescription>
          </DialogHeader>

          {activeSession && (
            <form
              onSubmit={handleSaveSessionOutcome}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Fecha de la sesión</Label>
                    <SiteCorpInput
                      type="date"
                      value={sessionDateInput}
                      onChange={(e) => setSessionDateInput(e.target.value)}
                      disabled={!canManage}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Carpeta de área</Label>
                    <SiteCorpInput
                      value={
                        areaNameById.get(activeSession.area_id) ||
                        folderById.get(activeSession.folder_id)?.area_name_snapshot ||
                        "Área"
                      }
                      disabled
                    />
                  </div>
                </div>

                {/* Selector de estado de la sesión */}
                <div className="space-y-2">
                  <Label>Estado de la sesión</Label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {(
                      [
                        {
                          value: "PROGRAMADA",
                          label: "Programada",
                          icon: <Clock className="h-4 w-4" />,
                          activeClass: "border-sitecorp-primary bg-sitecorp-primary/10 text-sitecorp-primary",
                        },
                        {
                          value: "REALIZADA",
                          label: "Realizada",
                          icon: <CheckCircle2 className="h-4 w-4" />,
                          activeClass: "border-sitecorp-success bg-sitecorp-success/10 text-sitecorp-success",
                        },
                        {
                          value: "NO_REALIZADA",
                          label: "No realizada",
                          icon: <XCircle className="h-4 w-4" />,
                          activeClass: "border-sitecorp-danger bg-sitecorp-danger/10 text-sitecorp-danger",
                        },
                      ] as const
                    ).map((item) => {
                      const active = sessionStatusInput === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          disabled={!canManage}
                          onClick={() => setSessionStatusInput(item.value)}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
                            active
                              ? item.activeClass
                              : "border-border bg-white text-ink hover:bg-muted/40"
                          )}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Observaciones de la sesión (opcional)</Label>
                  <SiteCorpInput
                    value={sessionNotesInput}
                    onChange={(e) => setSessionNotesInput(e.target.value)}
                    disabled={!canManage}
                    placeholder="Notas sobre la sesión, motivo si no se realizó, etc."
                  />
                </div>

                {/* Selección opcional de trabajadores participantes cuando está REALIZADA */}
                {sessionStatusInput === "REALIZADA" && (
                  <div className="space-y-3 rounded-xl border border-border bg-muted/15 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-ink">
                          Trabajadores participantes ({selectedParticipantIds.size} seleccionado(s))
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Selecciona opcionalmente los trabajadores que asistieron. Cada uno
                          recibirá un registro independiente «Recibida» en su ficha.
                        </p>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-2">
                          <SiteCorpButton
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={selectAllVisibleWorkers}
                          >
                            Marcar visibles
                          </SiteCorpButton>
                          {selectedParticipantIds.size > 0 && (
                            <SiteCorpButton
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={clearSelectedWorkers}
                            >
                              Limpiar
                            </SiteCorpButton>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Filtros de búsqueda de trabajadores */}
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <SiteCorpInput
                          value={participantSearch}
                          onChange={(e) => setParticipantSearch(e.target.value)}
                          placeholder="Buscar por nombre, código o CI..."
                          className="pl-9"
                        />
                      </div>
                      <SiteCorpSelect
                        value={participantAreaFilter}
                        onValueChange={(val) => setParticipantAreaFilter(val)}
                      >
                        <SelectItem value="all">Todas las áreas de la entidad</SelectItem>
                        {areas.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            Área: {a.name}
                          </SelectItem>
                        ))}
                      </SiteCorpSelect>
                    </div>

                    {/* Lista de trabajadores */}
                    <div className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-white">
                      {filteredModalWorkers.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          No hay trabajadores que coincidan con el filtro seleccionado.
                        </p>
                      ) : (
                        filteredModalWorkers.map((w) => {
                          const checked = selectedParticipantIds.has(w.id)
                          return (
                            <label
                              key={w.id}
                              className={cn(
                                "flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/30",
                                checked && "bg-sitecorp-primary/5"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canManage}
                                  onChange={() => toggleParticipant(w.id)}
                                  className="h-4 w-4 rounded border-border text-sitecorp-primary focus:ring-sitecorp-primary"
                                />
                                <div>
                                  <p className="font-medium text-ink">
                                    {w.fullName}{" "}
                                    <span className="font-mono text-xs text-muted-foreground">
                                      ({w.code})
                                    </span>
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {w.areaName || "Sin área"}
                                    {w.positionName ? ` · ${w.positionName}` : ""}
                                  </p>
                                </div>
                              </div>

                              <Link
                                to={`/entity/${entityId}/workers/${w.id}?tab=informacion-adicional`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs font-medium text-sitecorp-primary hover:underline"
                              >
                                Ver ficha
                              </Link>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border bg-muted/20 px-6 py-4">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(activeSession)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-sitecorp-danger hover:underline"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar sesión
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    onClick={() => setSessionModalOpen(false)}
                    disabled={sessionSubmitting}
                  >
                    Cerrar
                  </SiteCorpButton>
                  {canManage && (
                    <SiteCorpButton type="submit" disabled={sessionSubmitting}>
                      {sessionSubmitting ? "Guardando..." : "Guardar sesión"}
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

export default EntityTraining
