import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"
import { showError, showSuccess } from "@/utils/toast"
import {
  OFFICIAL_SEPARATION_CAUSE_COLUMNS,
  computeEmploymentRegistrySummary,
  downloadEmploymentRegistryWorkbook,
  filterAndSortEmploymentPeriods,
  formatCargoAndCategory,
  formatDateDisplay,
  formatPeriodOriginLabel,
  loadEntityEmploymentRegistryView,
  resolveOfficialSeparationColumn,
  updateEmploymentPeriodHireNumber,
  updateEmploymentPeriodSeparationNumber,
  updateEmploymentPeriodSourceOrigin,
  type EmploymentPeriodRow,
  type EmploymentRegistryFilterState,
  type PeriodOriginFilter,
  type PeriodSortOrder,
  type PeriodStatusFilter,
  type SeparationReason,
} from "@/modules/people"

type EditableFieldKind = "HIRE_NUMBER" | "SOURCE_ORIGIN" | "SEPARATION_NUMBER"

const INITIAL_FILTERS: EmploymentRegistryFilterState = {
  search: "",
  status: "ALL",
  origin: "ALL",
  reasonId: "",
  dateFrom: "",
  dateTo: "",
  sortBy: "HIRE_DATE_DESC",
}

const EntitySettingsEmploymentRegistry: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()
  const { permissions, loading: permissionsLoading } = useEntityPermissions(entityId)

  const canManageWorkers = permissions.includes("workers.manage")
  const canViewRegistry =
    canManageWorkers || permissions.includes("workers.view")

  const [periods, setPeriods] = React.useState<EmploymentPeriodRow[]>([])
  const [reasons, setReasons] = React.useState<SeparationReason[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const [filters, setFilters] = React.useState<EmploymentRegistryFilterState>(INITIAL_FILTERS)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  // Estado de edición en línea de Número de alta, Procedencia y Número de baja (solo en CLOSED)
  const [editingPeriodId, setEditingPeriodId] = React.useState<string | null>(null)
  const [editingField, setEditingField] = React.useState<EditableFieldKind | null>(null)
  const [editingValue, setEditingValue] = React.useState("")
  const [savingField, setSavingField] = React.useState(false)

  const fetchRegistry = React.useCallback(async () => {
    if (!entityId || !canViewRegistry) return
    setLoading(true)
    setError(null)
    try {
      const view = await loadEntityEmploymentRegistryView(entityId)
      setPeriods(view.periods)
      setReasons(view.separationReasons)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el registro histórico de altas y bajas."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId, canViewRegistry])

  React.useEffect(() => {
    if (permissionsLoading) return
    if (!canViewRegistry) {
      setLoading(false)
      return
    }
    void fetchRegistry()
  }, [permissionsLoading, canViewRegistry, fetchRegistry])

  const summary = React.useMemo(
    () => computeEmploymentRegistrySummary(periods),
    [periods]
  )

  const filteredPeriods = React.useMemo(
    () => filterAndSortEmploymentPeriods(periods, filters),
    [periods, filters]
  )

  const totalPages = Math.max(1, Math.ceil(filteredPeriods.length / pageSize))

  React.useEffect(() => {
    setPage(1)
  }, [filters, pageSize])

  const paginatedPeriods = React.useMemo(() => {
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    return filteredPeriods.slice(start, start + pageSize)
  }, [filteredPeriods, page, pageSize, totalPages])

  const hasActiveFilters =
    filters.search.trim() !== "" ||
    filters.status !== "ALL" ||
    filters.origin !== "ALL" ||
    filters.reasonId !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.sortBy !== "HIRE_DATE_DESC"

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS)
  }

  const handleStartEditField = (
    row: EmploymentPeriodRow,
    field: EditableFieldKind
  ) => {
    if (!canManageWorkers) return
    if (field === "SEPARATION_NUMBER" && row.status !== "CLOSED") return
    setEditingPeriodId(row.id)
    setEditingField(field)
    if (field === "HIRE_NUMBER") {
      setEditingValue(row.hireNumber ?? "")
    } else if (field === "SOURCE_ORIGIN") {
      setEditingValue(row.sourceOrigin ?? "")
    } else {
      setEditingValue(row.separationNumber ?? "")
    }
  }

  const handleCancelEditField = () => {
    setEditingPeriodId(null)
    setEditingField(null)
    setEditingValue("")
  }

  const handleSaveField = async (
    row: EmploymentPeriodRow,
    field: EditableFieldKind
  ) => {
    if (!canManageWorkers || savingField) return
    if (field === "SEPARATION_NUMBER" && row.status !== "CLOSED") {
      showError("El número de baja solo puede editarse en períodos laborales cerrados.")
      return
    }

    const normalized = editingValue.trim() || null
    setSavingField(true)
    try {
      if (field === "HIRE_NUMBER") {
        const updated = await updateEmploymentPeriodHireNumber({
          periodId: row.id,
          hireNumber: normalized,
        })
        setPeriods((prev) =>
          prev.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  hireNumber: updated.hire_number,
                  updatedAt: updated.updated_at,
                }
              : item
          )
        )
        showSuccess("Número de alta actualizado correctamente.")
      } else if (field === "SOURCE_ORIGIN") {
        const updated = await updateEmploymentPeriodSourceOrigin({
          periodId: row.id,
          sourceOrigin: normalized,
        })
        setPeriods((prev) =>
          prev.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  sourceOrigin: updated.source_origin,
                  updatedAt: updated.updated_at,
                }
              : item
          )
        )
        showSuccess("Procedencia actualizada correctamente.")
      } else if (field === "SEPARATION_NUMBER") {
        const updated = await updateEmploymentPeriodSeparationNumber({
          periodId: row.id,
          separationNumber: normalized,
        })
        setPeriods((prev) =>
          prev.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  separationNumber: updated.separation_number,
                  updatedAt: updated.updated_at,
                }
              : item
          )
        )
        showSuccess("Número de baja actualizado correctamente.")
      }

      setEditingPeriodId(null)
      setEditingField(null)
      setEditingValue("")
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudo guardar el cambio en el período laboral."
      showError(msg)
    } finally {
      setSavingField(false)
    }
  }

  const handleExportExcel = async () => {
    if (filteredPeriods.length === 0 || exporting) return
    setExporting(true)
    try {
      await downloadEmploymentRegistryWorkbook(filteredPeriods, {
        entityName: currentEntity?.name || "Entidad",
        generatedAt: new Date(),
      })
      showSuccess("Registro de Altas y Bajas exportado a Excel (.xlsx).")
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : "No se pudo generar el archivo Excel del registro."
      )
    } finally {
      setExporting(false)
    }
  }

  if (permissionsLoading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Altas y Bajas"
          description="Verificando permisos de acceso..."
        />
        <SiteCorpLoading rows={4} />
      </div>
    )
  }

  if (!canViewRegistry) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Altas y Bajas"
          description={`Registro laboral histórico de ${currentEntity?.name || "esta entidad"}`}
          actions={
            <SiteCorpButton
              variant="outline"
              onClick={() => navigate(`/entity/${entityId}/settings`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a Ajustes
            </SiteCorpButton>
          }
        />
        <SiteCorpAlert type="warning" title="Acceso restringido">
          No tiene permiso para consultar el registro de altas y bajas en esta entidad. Se
          requiere el permiso de consulta o gestión de trabajadores.
        </SiteCorpAlert>
      </div>
    )
  }

  const startIndex = filteredPeriods.length === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, filteredPeriods.length)

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Altas y Bajas"
        description={`Registro histórico centralizado de altas, bajas definitivas y reincorporaciones de ${currentEntity?.name || "esta entidad"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SiteCorpButton
              variant="outline"
              onClick={() => navigate(`/entity/${entityId}/settings`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a Ajustes
            </SiteCorpButton>
            <SiteCorpButton
              variant="outline"
              onClick={() => void fetchRegistry()}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </SiteCorpButton>
            <SiteCorpButton
              onClick={() => void handleExportExcel()}
              disabled={loading || exporting || filteredPeriods.length === 0}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar Excel (17 columnas)
            </SiteCorpButton>
          </div>
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error al cargar el registro">
          {error}
        </SiteCorpAlert>
      )}

      {/* Resumen cuantitativo del registro de la entidad */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total de períodos</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">
            {summary.totalPeriods}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Historial completo de la entidad
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Períodos activos</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {summary.activePeriods}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vínculo laboral vigente
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Bajas definitivas</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">
            {summary.closedPeriods}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Períodos laborales cerrados
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Reincorporaciones</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-sitecorp-primary">
            {summary.reentryPeriods}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nuevos períodos por reingreso
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Pendientes de validación
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="font-mono text-2xl font-bold tabular-nums text-amber-700">
              {summary.pendingValidationPeriods}
            </p>
            {summary.pendingValidationPeriods > 0 && (
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    status:
                      prev.status === "PENDING_VALIDATION"
                        ? "ALL"
                        : "PENDING_VALIDATION",
                  }))
                }
                className="text-xs font-medium text-sitecorp-primary underline-offset-2 hover:underline"
              >
                {filters.status === "PENDING_VALIDATION" ? "Ver todos" : "Filtrar"}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Discrepancias catálogo vs. texto
          </p>
        </div>
      </div>

      {summary.pendingValidationPeriods > 0 && (
        <SiteCorpAlert
          type="warning"
          title="Motivos históricos pendientes de validación documental"
        >
          Se han detectado{" "}
          <strong className="font-mono tabular-nums">
            {summary.pendingValidationPeriods}
          </strong>{" "}
          bajas históricas donde el motivo del catálogo difiere de la descripción del
          movimiento o presenta contradicción con un reingreso posterior. Estos registros se
          conservan con sus datos originales y en la exportación oficial de 17 columnas no se
          les asigna una marca «X» automática en causas no verificadas.
        </SiteCorpAlert>
      )}

      {/* Filtros y búsqueda */}
      <SiteCorpCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Selector segmentado de estado */}
            <div
              role="group"
              aria-label="Filtrar por estado del período"
              className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
            >
              {(
                [
                  { key: "ALL", label: `Todos (${summary.totalPeriods})` },
                  { key: "ACTIVE", label: `Activos (${summary.activePeriods})` },
                  { key: "CLOSED", label: `Bajas cerradas (${summary.closedPeriods})` },
                  {
                    key: "PENDING_VALIDATION",
                    label: `Pendientes de validación (${summary.pendingValidationPeriods})`,
                  },
                  {
                    key: "INCOMPLETE",
                    label: `Datos incompletos (${summary.incompletePeriods})`,
                  },
                ] as { key: PeriodStatusFilter; label: string }[]
              ).map((tab) => {
                const active = filters.status === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, status: tab.key }))
                    }
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      active
                        ? "bg-card text-ink shadow-sm"
                        : "text-muted-foreground hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Buscador */}
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <SiteCorpInput
                type="search"
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                placeholder="Buscar por trabajador, CI, código, cargo, procedencia o No. alta/baja..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Origen del período
              </label>
              <SiteCorpSelect
                value={filters.origin}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    origin: value as PeriodOriginFilter,
                  }))
                }
              >
                <option value="ALL">Todos los orígenes</option>
                <option value="INITIAL_HIRE">Alta inicial</option>
                <option value="REINCORPORATION">Reincorporación</option>
                <option value="MIGRATION">Carga inicial (Migración)</option>
              </SiteCorpSelect>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Motivo de baja
              </label>
              <SiteCorpSelect
                value={filters.reasonId}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, reasonId: value }))
                }
              >
                <option value="">Todos los motivos</option>
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Fecha desde
              </label>
              <SiteCorpInput
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Fecha hasta
              </label>
              <SiteCorpInput
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, dateTo: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Orden cronológico
              </label>
              <SiteCorpSelect
                value={filters.sortBy}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    sortBy: value as PeriodSortOrder,
                  }))
                }
              >
                <option value="HIRE_DATE_DESC">Fecha de alta (más recientes)</option>
                <option value="HIRE_DATE_ASC">Fecha de alta (más antiguos)</option>
                <option value="SEPARATION_DATE_DESC">
                  Fecha de baja (más recientes)
                </option>
                <option value="WORKER_NAME_ASC">Trabajador (A–Z)</option>
              </SiteCorpSelect>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                Mostrando{" "}
                <strong className="font-mono tabular-nums text-ink">
                  {filteredPeriods.length}
                </strong>{" "}
                de{" "}
                <strong className="font-mono tabular-nums text-ink">
                  {periods.length}
                </strong>{" "}
                períodos laborales
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="font-medium text-sitecorp-primary hover:underline"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* Tabla principal de períodos laborales */}
      <SiteCorpCard>
        {loading ? (
          <SiteCorpLoading rows={6} />
        ) : filteredPeriods.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground/60" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ink">
                No se encontraron períodos laborales con los filtros aplicados
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                El registro se alimenta automáticamente de las contrataciones, cargas
                iniciales, bajas definitivas y reincorporaciones realizadas en esta entidad.
              </p>
            </div>
            {hasActiveFilters && (
              <SiteCorpButton variant="outline" onClick={handleResetFilters}>
                Restablecer filtros
              </SiteCorpButton>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Fecha de alta</TableHead>
                    <TableHead className="whitespace-nowrap">Número de alta</TableHead>
                    <TableHead className="min-w-[220px]">Trabajador y cargo</TableHead>
                    <TableHead className="whitespace-nowrap">Carné de identidad</TableHead>
                    <TableHead className="min-w-[200px] whitespace-nowrap">
                      Procedencia
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Fecha de baja</TableHead>
                    <TableHead className="whitespace-nowrap">Número de baja</TableHead>
                    <TableHead className="min-w-[250px]">
                      Motivo de baja / Modelo oficial
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedPeriods.map((row) => {
                    const isEditingHireNumber =
                      editingPeriodId === row.id && editingField === "HIRE_NUMBER"
                    const isEditingSourceOrigin =
                      editingPeriodId === row.id && editingField === "SOURCE_ORIGIN"
                    const isEditingSeparationNumber =
                      editingPeriodId === row.id && editingField === "SEPARATION_NUMBER"

                    const resolution = resolveOfficialSeparationColumn(row)
                    const officialColDef = OFFICIAL_SEPARATION_CAUSE_COLUMNS.find(
                      (c) => c.key === resolution.columnKey
                    )
                    const originLabel = formatPeriodOriginLabel(
                      row.originType,
                      row.periodSequence
                    )
                    const cargoAndCategory = formatCargoAndCategory(
                      row.positionNameSnapshot,
                      row.occupationalCategorySnapshot
                    )

                    return (
                      <TableRow key={row.id} className="align-top">
                        {/* 1. Fecha de alta */}
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-ink">
                          {formatDateDisplay(row.hireDate)}
                        </TableCell>

                        {/* 2. Número de alta (editable en línea con workers.manage) */}
                        <TableCell className="whitespace-nowrap">
                          {isEditingHireNumber ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void handleSaveField(row, "HIRE_NUMBER")
                                  } else if (e.key === "Escape") {
                                    handleCancelEditField()
                                  }
                                }}
                                aria-label={`Número de alta para ${row.workerFullName}`}
                                placeholder="Ej. 0042"
                                className="h-8 w-28 rounded-md border border-input bg-background px-2 font-mono text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
                                autoFocus
                                disabled={savingField}
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveField(row, "HIRE_NUMBER")}
                                disabled={savingField}
                                title="Guardar número de alta"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sitecorp-primary text-white hover:bg-sitecorp-primary/90 disabled:opacity-50"
                              >
                                {savingField ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditField}
                                disabled={savingField}
                                title="Cancelar"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-ink"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span
                                className={
                                  row.hireNumber
                                    ? "font-mono text-xs font-medium tabular-nums text-ink"
                                    : "text-xs text-muted-foreground"
                                }
                              >
                                {row.hireNumber || "Sin asignar"}
                              </span>
                              {canManageWorkers && (
                                <button
                                  type="button"
                                  onClick={() => handleStartEditField(row, "HIRE_NUMBER")}
                                  title="Editar número de alta"
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* 3. Trabajador y cargo */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <Link
                              to={`/entity/${entityId}/workers/${row.workerId}`}
                              className="text-sm font-medium text-ink hover:text-sitecorp-primary hover:underline"
                            >
                              {row.workerFullName}
                            </Link>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-mono tabular-nums">{row.workerCode}</span>
                              <span aria-hidden="true">·</span>
                              <span>{cargoAndCategory}</span>
                            </div>
                            {row.areaNameSnapshot && (
                              <p className="text-xs text-muted-foreground">
                                {row.areaNameSnapshot}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        {/* 4. Carné de identidad */}
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink">
                          {row.workerIdentification}
                        </TableCell>

                        {/* 5. Procedencia real editable + origen histórico del período preservado */}
                        <TableCell className="whitespace-nowrap">
                          <div className="space-y-1 text-xs">
                            {isEditingSourceOrigin ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      void handleSaveField(row, "SOURCE_ORIGIN")
                                    } else if (e.key === "Escape") {
                                      handleCancelEditField()
                                    }
                                  }}
                                  aria-label={`Procedencia para ${row.workerFullName}`}
                                  placeholder="Ej. traslado, sector estatal..."
                                  className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
                                  autoFocus
                                  disabled={savingField}
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveField(row, "SOURCE_ORIGIN")}
                                  disabled={savingField}
                                  title="Guardar procedencia"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sitecorp-primary text-white hover:bg-sitecorp-primary/90 disabled:opacity-50"
                                >
                                  {savingField ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditField}
                                  disabled={savingField}
                                  title="Cancelar"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-ink"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span
                                  className={
                                    row.sourceOrigin
                                      ? "font-medium text-ink"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {row.sourceOrigin || "Sin especificar"}
                                </span>
                                {canManageWorkers && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditField(row, "SOURCE_ORIGIN")}
                                    title="Editar procedencia del trabajador"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Metadato histórico inmutable del período */}
                            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {originLabel} · Período #{row.periodSequence}
                            </p>
                          </div>
                        </TableCell>

                        {/* 6. Fecha de baja */}
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-ink">
                          {row.status === "CLOSED"
                            ? formatDateDisplay(row.separationDate)
                            : "—"}
                        </TableCell>

                        {/* 7. Número de baja (editable únicamente en períodos CLOSED con workers.manage) */}
                        <TableCell className="whitespace-nowrap">
                          {row.status !== "CLOSED" ? (
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              —
                            </span>
                          ) : isEditingSeparationNumber ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void handleSaveField(row, "SEPARATION_NUMBER")
                                  } else if (e.key === "Escape") {
                                    handleCancelEditField()
                                  }
                                }}
                                aria-label={`Número de baja para ${row.workerFullName}`}
                                placeholder="Ej. B-0018"
                                className="h-8 w-28 rounded-md border border-input bg-background px-2 font-mono text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary"
                                autoFocus
                                disabled={savingField}
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveField(row, "SEPARATION_NUMBER")}
                                disabled={savingField}
                                title="Guardar número de baja"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sitecorp-primary text-white hover:bg-sitecorp-primary/90 disabled:opacity-50"
                              >
                                {savingField ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditField}
                                disabled={savingField}
                                title="Cancelar"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-ink"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span
                                className={
                                  row.separationNumber
                                    ? "font-mono text-xs font-medium tabular-nums text-ink"
                                    : "text-xs text-muted-foreground"
                                }
                              >
                                {row.separationNumber || "Sin asignar"}
                              </span>
                              {canManageWorkers && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStartEditField(row, "SEPARATION_NUMBER")
                                  }
                                  title="Editar número de baja"
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* 8. Motivo de baja y correspondencia con modelo oficial */}
                        <TableCell>
                          {row.status !== "CLOSED" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : resolution.isPendingValidation ? (
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center gap-1.5 font-medium text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>Pendiente de validación</span>
                              </div>
                              <p className="text-ink">
                                <span className="text-muted-foreground">Catálogo:</span>{" "}
                                {row.separationReasonCatalogSnapshot || "—"}
                              </p>
                              {row.separationReasonMovementSnapshot && (
                                <p className="text-muted-foreground">
                                  <span>Texto movimiento:</span>{" "}
                                  {row.separationReasonMovementSnapshot}
                                </p>
                              )}
                              {row.inconsistencyCode ===
                                "CONTRADICTION_DECEASED_REINCORPORATED" && (
                                <p className="font-medium text-red-700">
                                  Contradicción material: baja por Fallecimiento seguida de
                                  reincorporación.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-0.5 text-xs">
                              <p className="font-medium text-ink">
                                {row.separationReasonCatalogSnapshot || "—"}
                                {row.separationOtherReason
                                  ? `: ${row.separationOtherReason}`
                                  : ""}
                              </p>
                              {officialColDef && (
                                <p className="text-muted-foreground">
                                  Excel Col. {officialColDef.columnIndex} ·{" "}
                                  {officialColDef.label}
                                </p>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* 9. Estado */}
                        <TableCell className="whitespace-nowrap">
                          {row.status === "ACTIVE" ? (
                            <span className="text-xs font-semibold text-emerald-700">
                              Activo
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">
                              Baja definitiva
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Paginación */}
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Mostrando{" "}
                  <strong className="font-mono tabular-nums text-ink">
                    {startIndex}–{endIndex}
                  </strong>{" "}
                  de{" "}
                  <strong className="font-mono tabular-nums text-ink">
                    {filteredPeriods.length}
                  </strong>{" "}
                  períodos
                </span>
                <div className="flex items-center gap-1.5">
                  <span>Filas:</span>
                  <select
                    aria-label="Filas por página"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs tabular-nums text-ink"
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <SiteCorpButton
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Anterior
                </SiteCorpButton>
                <span className="px-2 font-mono text-xs tabular-nums text-muted-foreground">
                  Página {Math.min(page, totalPages)} de {totalPages}
                </span>
                <SiteCorpButton
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Siguiente
                  <ChevronRight className="ml-1 h-4 w-4" />
                </SiteCorpButton>
              </div>
            </div>
          </div>
        )}
      </SiteCorpCard>
    </div>
  )
}

export default EntitySettingsEmploymentRegistry
