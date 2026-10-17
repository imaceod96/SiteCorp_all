import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SelectItem } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ArrowLeft,
  FolderTree,
  Plus,
  Pencil,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  CornerDownRight,
  ArrowRightLeft,
  PowerOff,
  Power,
  Briefcase,
  Network,
  Search,
  Loader2,
  FileSpreadsheet,
} from "lucide-react"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  NO_OCCUPATIONAL_CATEGORY_LABEL,
  NO_PREPARATION_LEVEL_LABEL,
  NO_WORK_INFO_LABEL,
  buildAnexo14FileName,
  buildAnexo14WorkbookBlob,
  buildAreaTree,
  fetchAnexo14Rows,
  formatBreak,
  formatJornada,
  formatPreparationLevels,
  formatScheduleByDay,
  formatScheduleSummary,
  hasWorkInfo,
  loadStaffingConfiguration,
  saveAnexo14Blob,
  setAreaActive,
  setJobActive,
  setPositionActive,
  type AreaNode,
  type OrganizationArea,
  type OrganizationJob,
  type OrganizationPosition,
  type PreparationLevel,
  type SalaryValue,
} from "@/modules/organization-structure"
import { JobForm } from "@/modules/organization-structure/presentation/components/JobForm"
import { AreaForm } from "@/modules/organization-structure/presentation/components/AreaForm"
import { PositionForm, type PositionJobOption, type PositionEditingData } from "@/modules/organization-structure/presentation/components/PositionForm"

/**
 * CONFIGURACIÓN DE PLANTILLA — áreas, cargos y puestos de la entidad.
 *
 * La pantalla no compone ninguna consulta: el caso de uso del dominio de estructura
 * organizativa le entrega las áreas, los cargos (con su área, categoría ocupacional, grupo
 * salarial e importe vigente), los puestos con su horario habitual, el árbol Área → Cargo →
 * Puesto y los permisos internos. Las escrituras (crear, editar y activar) también se piden
 * al dominio.
 *
 * El aislamiento es el de siempre: `organization_entity_id` (Grupo Empresarial → Empresa →
 * UEB) + RLS por `company_client_id`, que nunca se envía desde el cliente.
 */

type StatusFilter = "active" | "inactive" | "all"

const EntitySettingsStaffing = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [areas, setAreas] = React.useState<OrganizationArea[]>([])
  const [jobs, setJobs] = React.useState<OrganizationJob[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [entityName, setEntityName] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("active")
  const [areaFilter, setAreaFilter] = React.useState<string>("all")
  // Fase 11A.2: filtro por categoría ocupacional del cargo
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all")
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [notice, setNotice] = React.useState<{ type: "success" | "danger"; message: string } | null>(null)

  // Separate dialog states for Areas and Jobs
  const [areaDialogOpen, setAreaDialogOpen] = React.useState(false)
  const [jobDialogOpen, setJobDialogOpen] = React.useState(false)
  const [editingArea, setEditingArea] = React.useState<OrganizationArea | null>(null)
  const [editingJob, setEditingJob] = React.useState<OrganizationJob | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  // Positions state (separate dialog state to avoid cross-contamination)
  const [positions, setPositions] = React.useState<OrganizationPosition[]>([])
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
  const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<Record<string, SalaryValue | null>>({})
  const [positionSearch, setPositionSearch] = React.useState("")
  const [jobFilter, setJobFilter] = React.useState<string>("all")
  const [positionDialogOpen, setPositionDialogOpen] = React.useState(false)
  const [editingPosition, setEditingPosition] = React.useState<PositionEditingData | null>(null)
  const [activeTab, setActiveTab] = React.useState("areas")
  // Datos derivados del Cargo que la vista de Puestos muestra (nunca se copian al Puesto).
  const [categoryNameById, setCategoryNameById] = React.useState<Record<string, string>>({})
  const [preparationLevelsByJob, setPreparationLevelsByJob] = React.useState<
    Record<string, PreparationLevel[]>
  >({})
  const [exporting, setExporting] = React.useState(false)

  const showNotice = (type: "success" | "danger", message: string) => {
    setNotice({ type, message })
    setTimeout(() => setNotice(null), 5000)
  }

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setError("Parámetros de URL no válidos")
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Caso de uso del dominio: permisos, entidad, áreas, cargos con su grupo salarial,
      // puestos con su cargo y horario, escala aplicable e importes vigentes por grupo.
      const workspace = await loadStaffingConfiguration(entityId)
      if (!workspace.authorized) {
        setJobs([])
        setPositions([])
        setError("No tiene permiso para ver la configuración de plantilla de esta entidad")
        return
      }

      setCanManage(workspace.canManage)
      setEntityName(workspace.entityName)
      setAreas(workspace.areas)
      setJobs(workspace.jobs)
      setCategoryNameById(workspace.categoryNameById)
      setPreparationLevelsByJob(workspace.preparationLevelsByJob)
      setApplicableScaleId(workspace.applicableScaleId)
      setSalaryValuesByGroup(workspace.salaryValuesByGroup)
      setPositions(workspace.positions)
    } catch (err) {
      console.error("Error loading data:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los datos")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // Keep every node expanded by default when data changes
  React.useEffect(() => {
    setExpanded(new Set(areas.map(a => a.id)))
  }, [areas])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredJobs = React.useMemo(() => {
    let result = jobs

    // Filter by area
    if (areaFilter !== "all") {
      result = result.filter(j => j.area_id === areaFilter)
    }

    // Filter by occupational category (Fase 11A.2)
    if (categoryFilter === "none") {
      result = result.filter(j => !j.occupational_category_id)
    } else if (categoryFilter !== "all") {
      result = result.filter(j => j.occupational_category_id === categoryFilter)
    }

    // Filter by status
    if (statusFilter === "active") {
      result = result.filter(j => j.is_active)
    } else if (statusFilter === "inactive") {
      result = result.filter(j => !j.is_active)
    }

    return result
  }, [jobs, areaFilter, statusFilter, categoryFilter])

  // Opciones del filtro de categoría: sólo las categorías realmente usadas en los cargos
  const categoryFilterOptions = React.useMemo(() => {
    const map = new Map<string, string>()
    jobs.forEach(j => {
      if (j.occupational_category) map.set(j.occupational_category.id, j.occupational_category.name)
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [jobs])

  // Cargos históricos sin categoría ocupacional (Fase 11A.2)
  const jobsMissingCategory = React.useMemo(
    () => jobs.filter(j => j.is_active && !j.occupational_category_id).length,
    [jobs]
  )

  const activeJobs = React.useMemo(() => jobs.filter(j => j.is_active), [jobs])

  // Opciones del filtro Cargo: cargos de la entidad, acotados al área filtrada
  const jobFilterOptions = React.useMemo(() => {
    if (areaFilter !== "all") {
      return jobs.filter(j => j.area_id === areaFilter)
    }
    return jobs
  }, [jobs, areaFilter])

  const filteredPositions = React.useMemo(() => {
    const search = positionSearch.trim().toLowerCase()
    let result = positions

    if (areaFilter !== "all") {
      result = result.filter(p => p.job?.area_id === areaFilter)
    }
    if (jobFilter !== "all") {
      result = result.filter(p => p.job_id === jobFilter)
    }
    if (statusFilter === "active") {
      result = result.filter(p => p.is_active)
    } else if (statusFilter === "inactive") {
      result = result.filter(p => !p.is_active)
    }
    if (search) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.code.toLowerCase().includes(search) ||
        (p.job?.name || "").toLowerCase().includes(search) ||
        (p.job?.area?.name || "").toLowerCase().includes(search)
      )
    }

    return [...result].sort((a, b) =>
      (a.job?.name || "").localeCompare(b.job?.name || "") ||
      a.position_order - b.position_order ||
      a.name.localeCompare(b.name)
    )
  }, [positions, areaFilter, jobFilter, statusFilter, positionSearch])

  // Salario resuelto: Puesto → Cargo → Grupo salarial → Escala aplicable → valor vigente
  const resolvePositionSalary = React.useCallback(
    (position: OrganizationPosition): SalaryValue | null => {
      if (!applicableScaleId) return null
      const group = position.job?.salary_group
      if (!group || group.salary_scale_id !== applicableScaleId) return null
      return salaryValuesByGroup[group.id] || null
    },
    [applicableScaleId, salaryValuesByGroup]
  )

  // Opciones de cargo para el formulario (información derivada del cargo incluida)
  const positionJobOptions: PositionJobOption[] = React.useMemo(
    () =>
      jobs.map(j => ({
        id: j.id,
        name: j.name,
        code: j.code,
        is_active: j.is_active,
        area_id: j.area_id,
        area: j.area
          ? { id: j.area.id, name: j.area.name, code: j.area.code }
          : { id: j.area_id, name: "—", code: "—" },
        salary_group: j.salary_group
          ? {
              id: j.salary_group.id,
              salary_scale_id: j.salary_group.salary_scale_id,
              sequence_number: j.salary_group.sequence_number,
            }
          : null,
        occupational_category: j.occupational_category
          ? { id: j.occupational_category.id, name: j.occupational_category.name }
          : null,
        preparation_levels: (preparationLevelsByJob[j.id] || []).map(level => ({
          id: level.id,
          code: level.code,
          name: level.name,
        })),
      })),
    [jobs, preparationLevelsByJob]
  )

  // Position dialog handlers
  const openCreatePositionDialog = () => {
    setEditingPosition(null)
    setFormError(null)
    setPositionDialogOpen(true)
  }

  const openEditPositionDialog = (position: OrganizationPosition) => {
      setEditingPosition({
        id: position.id,
        job_id: position.job_id,
        code: position.code,
        name: position.name,
        description: position.description,
        authorized_quantity: position.authorized_quantity,
        work_location: position.work_location,
        daily_hours: position.daily_hours,
        weekly_hours: position.weekly_hours,
        monthly_hours: position.monthly_hours,
        break_minutes: position.break_minutes,
        schedule_notes: position.schedule_notes,
        schedule_segments: position.schedule_segments || [],
      })
      setFormError(null)
      setPositionDialogOpen(true)
    }

  const handlePositionSave = async () => {
    await loadData()
    setPositionDialogOpen(false)
    setEditingPosition(null)
  }

  /**
   * Anexo 14 de Puestos: exporta EXCLUSIVAMENTE la estructura de puestos del
   * alcance que se está viendo (entidad + filtros activos de área/cargo/estado).
   * La autorización y el orden organizativo se resuelven en el backend.
   */
  const handleExportAnexo14 = async () => {
    if (!entityId || exporting) return
    setExporting(true)
    try {
      const rows = await fetchAnexo14Rows(entityId, {
        includeInactive: statusFilter !== "active",
        areaId: areaFilter !== "all" ? areaFilter : null,
        jobId: jobFilter !== "all" ? jobFilter : null,
      })
      if (rows.length === 0) {
        showNotice("danger", "No hay puestos que exportar con el alcance actual.")
        return
      }
      const blob = await buildAnexo14WorkbookBlob(rows, {
        entityName,
        generatedAt: new Date(),
      })
      saveAnexo14Blob(blob, buildAnexo14FileName(entityName))
    } catch (err) {
      console.error("Error generating Anexo 14:", err)
      showNotice("danger", "No se pudo generar el Anexo 14. Inténtalo nuevamente.")
    } finally {
      setExporting(false)
    }
  }

  const handleToggleActivePosition = async (position: OrganizationPosition) => {
    if (position.is_active) {
      if (!confirm(`¿Desactivar el puesto "${position.name}"?`)) return
    } else {
      const job = jobs.find(j => j.id === position.job_id)
      if (job && !job.is_active) {
        showNotice("danger", "No se puede reactivar este puesto porque su cargo está inactivo. Reactiva primero el cargo.")
        return
      }
      if (!confirm(`¿Reactivar el puesto "${position.name}"?`)) return
    }

    try {
      await setPositionActive(position.id, !position.is_active)
      await loadData()
      showNotice("success", position.is_active ? "Puesto desactivado" : "Puesto reactivado")
    } catch (err) {
      console.error("Error toggling position state:", err)
      const message = err instanceof Error ? err.message : "Error al cambiar el estado del puesto"
      showNotice("danger", message)
    }
  }

  const tree = React.useMemo(() => buildAreaTree(areas), [areas])

  // Area dialog handlers
  const openCreateAreaDialog = () => {
    setEditingArea(null)
    setFormError(null)
    setAreaDialogOpen(true)
  }

  const openEditAreaDialog = (area: OrganizationArea) => {
    setEditingArea(area)
    setFormError(null)
    setAreaDialogOpen(true)
  }

  // Job dialog handlers
  const openCreateJobDialog = () => {
    setEditingJob(null)
    setFormError(null)
    setJobDialogOpen(true)
  }

  const openEditJobDialog = (job: OrganizationJob) => {
    setEditingJob(job)
    setFormError(null)
    setJobDialogOpen(true)
  }

  const handleAreaSave = async () => {
    await loadData()
    setAreaDialogOpen(false)
    setEditingArea(null)
  }

  const handleJobSave = async () => {
    await loadData()
    setJobDialogOpen(false)
    setEditingJob(null)
  }

  const handleToggleActiveArea = async (area: OrganizationArea) => {
        if (area.is_active) {
          if (!confirm(`¿Desactivar el área "${area.name}"?`)) return
        } else {
          if (!confirm(`¿Reactivar el área "${area.name}"?`)) return
        }
    
        try {
          await setAreaActive(area.id, !area.is_active)
          await loadData()
          showNotice("success", area.is_active ? "Área desactivada" : "Área reactivada")
        } catch (err) {
          console.error("Error toggling area state:", err)
          const message = err instanceof Error ? err.message : "Error al cambiar el estado del área"
          showNotice("danger", message)
        }
      }
  
    const handleToggleActiveJob = async (job: OrganizationJob) => {
        if (job.is_active) {
          if (!confirm(`¿Desactivar el cargo "${job.name}"?`)) return
        } else {
          // Validate that the area is active before allowing reactivation
          const area = areas.find(a => a.id === job.area_id)
          if (area && !area.is_active) {
            showNotice("danger", "No se puede reactivar este cargo porque su área está inactiva. Reactiva primero el área.")
            return
          }
          if (!confirm(`¿Reactivar el cargo "${job.name}"?`)) return
        }
    
        try {
          await setJobActive(job.id, !job.is_active)
          await loadData()
          showNotice("success", job.is_active ? "Cargo desactivado" : "Cargo reactivado")
        } catch (err) {
          console.error("Error toggling job state:", err)
          const message = err instanceof Error ? err.message : "Error al cambiar el estado del cargo"
          showNotice("danger", message)
        }
      }

  const renderNode = (node: AreaNode): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isExpanded = expanded.has(node.id)

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-muted/40",
            !node.is_active && "opacity-70"
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
              aria-label={isExpanded ? "Contraer" : "Expandir"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="flex h-6 w-6 shrink-0" />
          )}

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                "text-sm font-medium",
                node.is_active ? "text-ink" : "text-muted-foreground"
              )}
            >
              {node.name}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {node.code}
            </span>
            <SiteCorpStatusBadge status={node.is_active ? "success" : "neutral"}>
              {node.is_active ? "Activa" : "Inactiva"}
            </SiteCorpStatusBadge>
            {node.description && (
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                {node.description}
              </span>
            )}
          </div>

          {canManage && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                  aria-label="Acciones del área"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <button
                  type="button"
                  onClick={() => openEditAreaDialog(node)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-ink hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => openEditAreaDialog(node)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-ink hover:bg-muted"
                >
                  <ArrowRightLeft className="h-4 w-4" /> Mover
                </button>
                {node.is_active && (
                  <button
                    type="button"
                    onClick={() => openCreateAreaDialog()}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-ink hover:bg-muted"
                  >
                    <CornerDownRight className="h-4 w-4" /> Añadir subárea
                  </button>
                )}
                <div className="my-1 h-px bg-border" />
                {node.is_active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleActiveArea(node)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-sitecorp-danger hover:bg-muted"
                                  >
                                    <PowerOff className="h-4 w-4" /> Desactivar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleActiveArea(node)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-ink hover:bg-muted"
                                  >
                                    <Power className="h-4 w-4" /> Reactivar
                                  </button>
                                )}
              </PopoverContent>
            </Popover>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div className="ml-4 border-l border-border pl-2">
            {node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Configuración de plantilla"
          description="Cargando estructura de áreas, cargos y puestos..."
        />
        <SiteCorpLoading rows={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Configuración de plantilla"
          description="Define la estructura organizativa y los puestos autorizados de esta entidad."
        />
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
        <div className="flex justify-end">
          <SiteCorpButton variant="outline" onClick={() => navigate(`/entity/${entityId}/settings`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver a ajustes
          </SiteCorpButton>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
              title="Configuración de plantilla"
              description="Define la estructura organizativa y los puestos autorizados de esta entidad."
              actions={
                <SiteCorpButton variant="outline" onClick={() => navigate(`/entity/${entityId}/settings`)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Volver a ajustes
                </SiteCorpButton>
              }
            />

      {notice && <SiteCorpAlert type={notice.type}>{notice.message}</SiteCorpAlert>}

      <SiteCorpCard>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="areas">
              <FolderTree className="mr-2 h-4 w-4" /> Áreas
            </TabsTrigger>
            <TabsTrigger value="cargos">
              <Briefcase className="mr-2 h-4 w-4" /> Cargos
            </TabsTrigger>
            <TabsTrigger value="puestos">
              <Network className="mr-2 h-4 w-4" /> Puestos
            </TabsTrigger>
          </TabsList>

          {/* ================= ÁREAS ================= */}
          <TabsContent value="areas" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Áreas</h3>
                <p className="text-sm text-muted-foreground">
                  Define la estructura interna de áreas y subáreas de esta entidad.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SiteCorpSelect
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                >
                  <SelectItem value="active">Activas</SelectItem>
                  <SelectItem value="inactive">Inactivas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SiteCorpSelect>
                {canManage && (
                  <SiteCorpButton onClick={openCreateAreaDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Nueva área
                  </SiteCorpButton>
                )}
              </div>
            </div>

            {areas.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <FolderTree className="mb-4 h-12 w-12 text-muted-foreground" />
                <h4 className="mb-1 text-base font-semibold text-ink">No hay áreas configuradas.</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  Comienza creando la estructura interna de esta entidad.
                </p>
                {canManage && (
                  <SiteCorpButton onClick={openCreateAreaDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Crear primera área
                  </SiteCorpButton>
                )}
              </div>
            ) : tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <p className="text-sm text-muted-foreground">
                  {statusFilter === "inactive"
                    ? "No hay áreas inactivas."
                    : "No hay áreas que coincidan con el filtro seleccionado."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[320px] space-y-0.5">
                  {tree.map(node => renderNode(node))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ================= CARGOS ================= */}
          <TabsContent value="cargos" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Cargos</h3>
                <p className="text-sm text-muted-foreground">
                  Define los cargos de la entidad, su área y grupo salarial.
                </p>
              </div>
              {canManage && (
                <SiteCorpButton onClick={openCreateJobDialog}>
                  <Plus className="mr-2 h-4 w-4" /> Nuevo cargo
                </SiteCorpButton>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SiteCorpSelect
                value={areaFilter}
                onValueChange={(value) => setAreaFilter(value)}
              >
                <SelectItem value="all">Todas las áreas</SelectItem>
                {areas.filter(a => a.is_active).map(area => (
                  <SelectItem key={area.id} value={area.id}>
                    {area.name} ({area.code})
                  </SelectItem>
                ))}
              </SiteCorpSelect>
              <SiteCorpSelect
                value={categoryFilter}
                onValueChange={(value) => setCategoryFilter(value)}
              >
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categoryFilterOptions.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">Sin categoría ocupacional</SelectItem>
              </SiteCorpSelect>
              <SiteCorpSelect
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SiteCorpSelect>
            </div>

            {/* Cargos históricos sin categoría ocupacional */}
            {jobsMissingCategory > 0 && (
              <SiteCorpAlert type="warning">
                {jobsMissingCategory === 1
                  ? "1 cargo activo no tiene categoría ocupacional configurada."
                  : `${jobsMissingCategory} cargos activos no tienen categoría ocupacional configurada.`}{" "}
                Complétala editando el cargo; no se ha asignado ninguna categoría automáticamente.
              </SiteCorpAlert>
            )}

            {/* Empty state */}
            {jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Briefcase className="mb-4 h-12 w-12 text-muted-foreground" />
                <h4 className="mb-1 text-base font-semibold text-ink">No hay cargos configurados.</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  Comienza creando los cargos que conformarán la plantilla de esta entidad.
                </p>
                {canManage && (
                  <SiteCorpButton onClick={openCreateJobDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Crear primer cargo
                  </SiteCorpButton>
                )}
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <p className="text-sm text-muted-foreground">
                  {statusFilter === "inactive"
                    ? "No hay cargos inactivos."
                    : "No hay cargos que coincidan con el filtro seleccionado."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Group jobs by area */}
                {areas.filter(a => a.is_active).map(area => {
                  const areaJobs = filteredJobs.filter(j => j.area_id === area.id)
                  if (areaJobs.length === 0) return null

                  return (
                    <div key={area.id} className="space-y-2">
                      <h4 className="text-sm font-semibold text-ink">
                        {area.name} ({area.code})
                      </h4>
                      <div className="space-y-2">
                        {areaJobs.map(job => (
                          <div
                            key={job.id}
                            className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-sm font-medium text-ink">
                                {job.name}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {job.code}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Grupo: {job.salary_group
                                  ? toRomanNumeral(job.salary_group.sequence_number)
                                  : "N/A"}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {job.salary_group?.current_value
                                  ? `${job.salary_group.current_value.amount.toLocaleString("es-CU", {
                                      minimumFractionDigits: 2,
                                    })} ${job.salary_group.current_value.currency_code}`
                                  : "Sin salario"}
                              </span>
                              {job.occupational_category ? (
                                <SiteCorpStatusBadge status="info">
                                  {job.occupational_category.name}
                                </SiteCorpStatusBadge>
                              ) : (
                                <SiteCorpStatusBadge status="warning">
                                  {NO_OCCUPATIONAL_CATEGORY_LABEL}
                                </SiteCorpStatusBadge>
                              )}
                              <SiteCorpStatusBadge status={job.is_active ? "success" : "neutral"}>
                                {job.is_active ? "Activo" : "Inactivo"}
                              </SiteCorpStatusBadge>
                            </div>

                            {canManage && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditJobDialog(job)}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                                  aria-label="Editar cargo"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                {job.is_active ? (
                                                                                                  <button
                                                                                                    type="button"
                                                                                                    onClick={() => handleToggleActiveJob(job)}
                                                                                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-sitecorp-danger"
                                                                                                    aria-label="Desactivar cargo"
                                                                                                  >
                                                                                                    <PowerOff className="h-4 w-4" />
                                                                                                  </button>
                                                                                                ) : (
                                                                                                  <button
                                                                                                    type="button"
                                                                                                    onClick={() => handleToggleActiveJob(job)}
                                                                                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                                                                                                    aria-label="Reactivar cargo"
                                                                                                  >
                                                                                                    <Power className="h-4 w-4" />
                                                                                                  </button>
                                                                                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ================= PUESTOS ================= */}
          <TabsContent value="puestos" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Puestos</h3>
                <p className="text-sm text-muted-foreground">
                  Define los puestos autorizados de la plantilla a partir de los cargos.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SiteCorpButton
                  variant="outline"
                  onClick={handleExportAnexo14}
                  disabled={exporting || positions.length === 0}
                  title="Descargar el Anexo 14 con la estructura de puestos (sólo puestos)"
                >
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                  )}
                  {exporting ? "Generando Anexo 14..." : "Exportar Anexo 14"}
                </SiteCorpButton>
                {canManage && activeJobs.length > 0 && (
                  <SiteCorpButton onClick={openCreatePositionDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Nuevo puesto
                  </SiteCorpButton>
                )}
              </div>
            </div>

            {/* Sin cargos activos: requisito previo */}
            {activeJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Briefcase className="mb-4 h-12 w-12 text-muted-foreground" />
                <h4 className="mb-1 text-base font-semibold text-ink">No hay cargos activos.</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  Primero debes crear al menos un cargo para poder crear puestos.
                </p>
                <SiteCorpButton variant="outline" onClick={() => setActiveTab("cargos")}>
                  <Briefcase className="mr-2 h-4 w-4" /> Ir a Cargos
                </SiteCorpButton>
              </div>
            ) : positions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Network className="mb-4 h-12 w-12 text-muted-foreground" />
                <h4 className="mb-1 text-base font-semibold text-ink">No hay puestos configurados todavía.</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  Crea los puestos autorizados a partir de los cargos de esta entidad.
                </p>
                {canManage && (
                  <SiteCorpButton onClick={openCreatePositionDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Crear primer puesto
                  </SiteCorpButton>
                )}
              </div>
            ) : (
              <>
                {/* Filtros y búsqueda */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <SiteCorpInput
                      value={positionSearch}
                      onChange={(e) => setPositionSearch(e.target.value)}
                      placeholder="Buscar por puesto, código, cargo o área..."
                      className="pl-9"
                    />
                  </div>
                  <SiteCorpSelect
                    value={areaFilter}
                    onValueChange={(value) => {
                      setAreaFilter(value)
                      setJobFilter("all")
                    }}
                  >
                    <SelectItem value="all">Todas las áreas</SelectItem>
                    {areas.filter(a => a.is_active).map(area => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.name} ({area.code})
                      </SelectItem>
                    ))}
                  </SiteCorpSelect>
                  <SiteCorpSelect
                    value={jobFilter}
                    onValueChange={(value) => setJobFilter(value)}
                  >
                    <SelectItem value="all">Todos los cargos</SelectItem>
                    {jobFilterOptions.map(job => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.name}{!job.is_active ? " (inactivo)" : ""}
                      </SelectItem>
                    ))}
                  </SiteCorpSelect>
                  <SiteCorpSelect
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                  >
                    <SelectItem value="active">Activos</SelectItem>
                    <SelectItem value="inactive">Inactivos</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SiteCorpSelect>
                </div>

                {filteredPositions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                    <p className="text-sm text-muted-foreground">
                      No hay puestos que coincidan con la búsqueda o el filtro seleccionado.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredPositions.map(position => {
                      const salary = resolvePositionSalary(position)
                      return (
                        <div
                          key={position.id}
                          className="rounded-xl border border-border bg-white p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-sm font-semibold text-ink">
                                {position.name}
                              </span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {position.code}
                              </span>
                              <SiteCorpStatusBadge status={position.is_active ? "success" : "neutral"}>
                                {position.is_active ? "Activo" : "Inactivo"}
                              </SiteCorpStatusBadge>
                            </div>

                            {/* Información principal del Puesto. Categoría ocupacional,
                                nivel de preparación y grupo escala se muestran derivados
                                del Cargo; sólo la cantidad autorizada es del Puesto. */}
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                              <div>
                                <dt className="text-xs text-muted-foreground">Categoría Ocupacional</dt>
                                <dd className="text-sm font-medium text-ink">
                                  {position.job?.occupational_category_id
                                    ? categoryNameById[position.job.occupational_category_id] ||
                                      NO_OCCUPATIONAL_CATEGORY_LABEL
                                    : NO_OCCUPATIONAL_CATEGORY_LABEL}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">No. de puestos</dt>
                                <dd className="text-sm font-medium text-ink">
                                  {position.authorized_quantity}
                                </dd>
                                <p className="text-[11px] text-muted-foreground">Cantidad autorizada</p>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">Nivel de preparación</dt>
                                <dd className="text-sm font-medium text-ink">
                                  {formatPreparationLevels(
                                    position.job ? preparationLevelsByJob[position.job.id] : undefined
                                  ) || NO_PREPARATION_LEVEL_LABEL}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">Grupo escala</dt>
                                <dd className="text-sm font-medium text-ink">
                                  {position.job?.salary_group
                                    ? toRomanNumeral(position.job.salary_group.sequence_number)
                                    : "N/A"}
                                </dd>
                              </div>
                            </dl>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Área: {position.job?.area?.name || "—"}</span>
                              <span>Cargo: {position.job?.name || "—"}</span>
                              <span>
                                Salario:{" "}
                                {salary ? (
                                  `${salary.amount.toLocaleString("es-CU", {
                                    minimumFractionDigits: 2,
                                  })} ${salary.currency_code}`
                                ) : (
                                  <span className="italic">
                                    {applicableScaleId ? "Salario no configurado" : "Sin escala configurada"}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>

                          {canManage && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditPositionDialog(position)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                                aria-label="Editar puesto"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              {position.is_active ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleActivePosition(position)}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-sitecorp-danger"
                                  aria-label="Desactivar puesto"
                                >
                                  <PowerOff className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleToggleActivePosition(position)}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
                                  aria-label="Reactivar puesto"
                                >
                                  <Power className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          )}
                          </div>

                          {/* Fase 11A.3: información laboral del puesto */}
                          <PositionWorkDetail position={position} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </SiteCorpCard>

      {/* New / Edit Area Dialog */}
      <Dialog
        open={areaDialogOpen}
        onOpenChange={(open) => {
          setAreaDialogOpen(open)
          if (!open) {
            setEditingArea(null)
            setFormError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingArea ? "Editar área" : "Nueva área"}</DialogTitle>
            <DialogDescription>
              {editingArea
                ? "Modifica los datos del área."
                : "Crea una nueva área para esta entidad."}
            </DialogDescription>
          </DialogHeader>
          <AreaForm
            entityId={entityId!}
            areas={areas}
            editingArea={editingArea}
            onSuccess={handleAreaSave}
            onCancel={() => {
              setAreaDialogOpen(false)
              setEditingArea(null)
              setFormError(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* New / Edit Job Dialog */}
      <Dialog
        open={jobDialogOpen}
        onOpenChange={(open) => {
          setJobDialogOpen(open)
          if (!open) {
            setEditingJob(null)
            setFormError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? "Editar cargo" : "Nuevo cargo"}</DialogTitle>
            <DialogDescription>
              {editingJob
                ? "Modifica los datos, la clasificación laboral y el contenido de trabajo del cargo."
                : "Crea un nuevo cargo para esta entidad: información general, clasificación laboral, retribución y contenido de trabajo."}
            </DialogDescription>
          </DialogHeader>
          <JobForm
            entityId={entityId!}
            editingJob={editingJob}
            onSuccess={handleJobSave}
            onCancel={() => {
              setJobDialogOpen(false)
              setEditingJob(null)
              setFormError(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* New / Edit Position Dialog */}
      <Dialog
        open={positionDialogOpen}
        onOpenChange={(open) => {
          setPositionDialogOpen(open)
          if (!open) {
            setEditingPosition(null)
            setFormError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[660px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPosition ? "Editar puesto" : "Nuevo puesto"}</DialogTitle>
            <DialogDescription>
              {editingPosition
                ? "Modifica los datos, la ubicación, la jornada y el horario habitual del puesto."
                : "Crea un puesto a partir de un cargo de esta entidad, con su ubicación, jornada y horario habitual."}
            </DialogDescription>
          </DialogHeader>
          <PositionForm
            entityId={entityId!}
            jobs={positionJobOptions}
            applicableScaleId={applicableScaleId}
            salaryValuesByGroup={salaryValuesByGroup}
            editingPosition={editingPosition}
            onSuccess={handlePositionSave}
            onCancel={() => {
              setPositionDialogOpen(false)
              setEditingPosition(null)
              setFormError(null)
            }}
          />
        </DialogContent>
      </Dialog>


    </div>
  )
}

/**
 * Información laboral del puesto (Fase 11A.3): lugar de trabajo, jornada,
 * horario habitual y descanso. Datos estructurales del puesto: los trabajadores
 * asignados al mismo puesto los comparten.
 */
const PositionWorkDetail = ({ position }: { position: OrganizationPosition }) => {
  const [open, setOpen] = React.useState(false)

  const segments = position.schedule_segments || []
  const jornada = formatJornada(position)
  const scheduleSummary = formatScheduleSummary(segments)
  const descanso = formatBreak(position.break_minutes)
  const configured = hasWorkInfo(position, segments)

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          Lugar: <span className="text-ink">{position.work_location || NO_WORK_INFO_LABEL}</span>
        </span>
        <span>
          Jornada: <span className="text-ink">{jornada || NO_WORK_INFO_LABEL}</span>
        </span>
        <span>
          Horario: <span className="text-ink">{scheduleSummary || NO_WORK_INFO_LABEL}</span>
        </span>
        {configured && (
          <button
            type="button"
            onClick={() => setOpen(prev => !prev)}
            className="font-medium text-sitecorp-primary underline-offset-2 hover:underline"
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
          </button>
        )}
      </div>

      {open && configured && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Lugar de trabajo</dt>
              <dd className="text-sm text-ink">{position.work_location || NO_WORK_INFO_LABEL}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Jornada</dt>
              <dd className="text-sm text-ink">
                {position.daily_hours !== null && position.daily_hours !== undefined && (
                  <span className="mr-2 block">{position.daily_hours} h/día</span>
                )}
                {position.weekly_hours !== null && position.weekly_hours !== undefined && (
                  <span className="mr-2 block">{position.weekly_hours} h/semana</span>
                )}
                {position.monthly_hours !== null && position.monthly_hours !== undefined && (
                  <span className="mr-2 block">{position.monthly_hours} h/mes</span>
                )}
                {!jornada && NO_WORK_INFO_LABEL}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Horario</dt>
              <dd className="text-sm text-ink">
                {formatScheduleByDay(segments).length === 0 ? (
                  NO_WORK_INFO_LABEL
                ) : (
                  <ul className="space-y-0.5">
                    {formatScheduleByDay(segments).map(row => (
                      <li key={row.day}>
                        <span className="font-medium">{row.day}</span>{" "}
                        <span className="text-muted-foreground">{row.ranges}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Descanso</dt>
              <dd className="text-sm text-ink">{descanso || NO_WORK_INFO_LABEL}</dd>
            </div>
            {position.schedule_notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Observaciones del horario</dt>
                <dd className="text-sm text-ink">{position.schedule_notes}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

export default EntitySettingsStaffing
