import * as React from "react"
import { useNavigate, useParams, Link } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import {
  ALTAS_BAJAS_FOOTNOTE_TEXT,
  ALTAS_BAJAS_REASON_COLUMNS,
  downloadAltasBajasRegistryExcel,
  formatAltaDisplay,
  formatShortDate,
  loadEntityAltasBajasRegistry,
  saveAltasBajasAltaNumber,
  type AltasBajasRegistryRow,
} from "@/modules/people"
import { showError, showSuccess } from "@/utils/toast"
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react"

const EntitySettingsAltasBajasRegistry: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()

  const [rows, setRows] = React.useState<AltasBajasRegistryRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [authorized, setAuthorized] = React.useState(true)
  const [canManage, setCanManage] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "SEPARATED">("ALL")

  // Estado para edición en línea del No. de alta en la Columna 4
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null)
  const [draftAltaNumber, setDraftAltaNumber] = React.useState("")
  const [savingRowId, setSavingRowId] = React.useState<string | null>(null)

  const loadRegistry = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setError(null)
    try {
      const view = await loadEntityAltasBajasRegistry(entityId)
      setAuthorized(view.authorized)
      setCanManage(view.canManage)
      setRows(view.rows)
    } catch (err) {
      console.error("Error loading Altas y Bajas registry:", err)
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el Registro de Altas y Bajas de la entidad."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    void loadRegistry()
  }, [loadRegistry])

  const startEditingAltaNumber = (row: AltasBajasRegistryRow) => {
    setEditingRowId(row.id)
    setDraftAltaNumber(row.altaNumber ?? "")
  }

  const cancelEditingAltaNumber = () => {
    setEditingRowId(null)
    setDraftAltaNumber("")
  }

  const handleSaveAltaNumber = async (row: AltasBajasRegistryRow) => {
    const cleanNumber = draftAltaNumber.trim() || null
    setSavingRowId(row.id)
    try {
      await saveAltasBajasAltaNumber({
        workerId: row.workerId,
        altaDate: row.altaDate,
        altaNumber: cleanNumber,
        assignmentId: row.assignmentId,
      })

      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? {
                ...item,
                altaNumber: cleanNumber,
                altaDisplay: formatAltaDisplay(item.altaDate, cleanNumber),
              }
            : item
        )
      )
      setEditingRowId(null)
      setDraftAltaNumber("")
      showSuccess(
        cleanNumber
          ? `Número de alta (${cleanNumber}) guardado correctamente.`
          : "Número de alta actualizado."
      )
    } catch (err) {
      console.error("Error saving alta number:", err)
      showError("No se pudo guardar el número de alta.")
    } finally {
      setSavingRowId(null)
    }
  }

  const filteredRows = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false
      if (!query) return true
      const haystack = [
        row.identification,
        row.fullName,
        row.address,
        row.altaDisplay,
        row.altaNumber,
        row.sourceOfOrigin,
        row.bajaDisplay,
        row.bajaReasonDetail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [rows, search, statusFilter])

  const stats = React.useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.status === "ACTIVE").length
    const separated = rows.filter((r) => r.status === "SEPARATED").length
    const reentries = rows.filter((r) => r.isReentryPeriod).length
    return { total, active, separated, reentries }
  }, [rows])

  const handleExportExcel = async () => {
    setExporting(true)
    try {
      await downloadAltasBajasRegistryExcel({
        entityName: currentEntity?.name || null,
        rows: filteredRows,
      })
      showSuccess("Registro de Altas y Bajas descargado en formato Excel (.xlsx).")
    } catch (err) {
      console.error("Error exporting Altas y Bajas Excel:", err)
      showError("No se pudo generar el archivo Excel del registro.")
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <SiteCorpLoading label="Cargando Registro de Altas y Bajas…" />
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="space-y-4 p-6">
        <SiteCorpButton
          variant="outline"
          size="sm"
          onClick={() => navigate(`/entity/${entityId}/settings`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Ajustes
        </SiteCorpButton>
        <SiteCorpAlert type="warning" title="Acceso restringido">
          No tiene permisos para consultar el Registro de Altas y Bajas de esta entidad.
        </SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SiteCorpButton
            variant="outline"
            size="sm"
            onClick={() => navigate(`/entity/${entityId}/settings`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Ajustes
          </SiteCorpButton>
          <SiteCorpPageHeader
            title="Registro de Altas y Bajas"
            description={`Modelo oficial b) Registro de Altas y Bajas · ${currentEntity?.name || "Entidad"}`}
          />
        </div>

        <div className="flex items-center gap-2">
          <SiteCorpButton
            variant="outline"
            size="sm"
            onClick={() => void loadRegistry()}
            disabled={loading || exporting}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </SiteCorpButton>
          <SiteCorpButton
            size="sm"
            onClick={handleExportExcel}
            disabled={exporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Generando Excel…" : "Descargar Excel (.xlsx)"}
          </SiteCorpButton>
        </div>
      </div>

      {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

      {/* Resumen de indicadores del registro */}
      <div className="grid gap-3 sm:grid-cols-4">
        <SiteCorpCard className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Total de entradas (Altas)</p>
          <p className="mt-1 text-2xl font-bold text-ink">{stats.total}</p>
        </SiteCorpCard>
        <SiteCorpCard className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Períodos activos</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{stats.active}</p>
        </SiteCorpCard>
        <SiteCorpCard className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Bajas registradas</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{stats.separated}</p>
        </SiteCorpCard>
        <SiteCorpCard className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Entradas por reingreso</p>
          <p className="mt-1 text-2xl font-bold text-sitecorp-primary">{stats.reentries}</p>
        </SiteCorpCard>
      </div>

      {/* Filtros de búsqueda */}
      <SiteCorpCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <SiteCorpInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por No. Carné, nombre, dirección particular, fecha, No. de alta o procedencia…"
              className="pl-9"
            />
          </div>
          <div className="w-full sm:w-56">
            <SiteCorpSelect
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val as "ALL" | "ACTIVE" | "SEPARATED")}
            >
              <option value="ALL">Todos los registros ({rows.length})</option>
              <option value="ACTIVE">Solo activos ({stats.active})</option>
              <option value="SEPARATED">Solo bajas ({stats.separated})</option>
            </SiteCorpSelect>
          </div>
        </div>
      </SiteCorpCard>

      {/* Tabla oficial: b) Registro de Altas y Bajas (Columnas 1 a 17 de izquierda a derecha) */}
      <SiteCorpCard className="overflow-hidden p-0">
        <div className="border-b border-border bg-slate-50/80 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-sitecorp-primary" />
            <h2 className="text-sm font-bold text-slate-900">
              b) Registro de Altas y Bajas.
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Mostrando {filteredRows.length} de {rows.length} entrada(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs text-slate-900">
            <thead>
              {/* Nivel 1 de cabecera */}
              <tr className="bg-slate-100 text-slate-900">
                <th
                  rowSpan={2}
                  className="border border-slate-400 px-2 py-2 text-center font-semibold align-middle w-10"
                >
                  No.
                </th>
                <th
                  rowSpan={2}
                  className="border border-slate-400 px-3 py-2 text-center font-semibold align-middle min-w-[210px]"
                >
                  No. Carné y Nombre del trabajador
                </th>
                <th
                  rowSpan={2}
                  className="border border-slate-400 px-3 py-2 text-center font-semibold align-middle min-w-[230px]"
                >
                  Dirección particular del trabajador
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-400 px-3 py-2 text-center font-semibold align-middle"
                >
                  Altas
                </th>
                <th
                  rowSpan={2}
                  className="border border-slate-400 px-2.5 py-2 text-center font-semibold align-middle min-w-[120px]"
                >
                  Fecha y No. de baja
                </th>
                <th
                  colSpan={11}
                  className="border border-slate-400 px-3 py-2 text-center font-semibold align-middle"
                >
                  Motivo de la baja
                </th>
              </tr>

              {/* Nivel 2 de cabecera */}
              <tr className="bg-slate-100 text-slate-900">
                <th className="border border-slate-400 px-2.5 py-2 text-center font-semibold align-middle min-w-[155px]">
                  Fecha y No. de alta
                </th>
                <th className="border border-slate-400 px-2.5 py-2 text-center font-semibold align-middle min-w-[160px]">
                  Fuente de procedencia
                </th>
                {ALTAS_BAJAS_REASON_COLUMNS.map((col) => (
                  <th
                    key={col.code}
                    className="border border-slate-400 px-1 py-2 text-center font-semibold align-middle h-36 w-9 min-w-[36px]"
                    title={`${col.columnNumber}. ${col.label}`}
                  >
                    <div className="mx-auto flex h-full items-center justify-center [writing-mode:vertical-rl] rotate-180 leading-tight">
                      {col.label}
                    </div>
                  </th>
                ))}
              </tr>

              {/* Nivel 3: Numeración de columnas 1 a 17 de izquierda a derecha */}
              <tr className="bg-slate-200/80 text-slate-900 font-bold">
                {Array.from({ length: 17 }, (_, idx) => idx + 1).map((colNum) => (
                  <th
                    key={colNum}
                    className="border border-slate-400 px-1.5 py-1 text-center text-[11px] font-bold"
                  >
                    {colNum}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={17}
                    className="border border-slate-300 px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No se encontraron registros de altas o bajas con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const isEditingThisRow = editingRowId === row.id
                  const isSavingThisRow = savingRowId === row.id
                  const formattedIncorporationDate = formatShortDate(row.altaDate)

                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50/90 transition-colors"
                    >
                      {/* Columna 1: No. */}
                      <td className="border border-slate-300 px-2 py-2 text-center font-semibold text-slate-800">
                        {idx + 1}
                      </td>

                      {/* Columna 2: No. Carné y Nombre */}
                      <td className="border border-slate-300 px-3 py-2 align-middle">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {row.identification}
                          </span>
                          <Link
                            to={`/entity/${entityId}/workers/${row.workerId}`}
                            className="text-xs font-medium text-sitecorp-primary hover:underline"
                          >
                            {row.fullName}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            {row.isInitialMigration && (
                              <span className="inline-block w-fit rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                Migración inicial
                              </span>
                            )}
                            {row.isReentryPeriod && (
                              <span className="inline-block w-fit rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                Reingreso
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Columna 3: Dirección particular del trabajador */}
                      <td className="border border-slate-300 px-3 py-2 align-middle text-slate-700">
                        {row.address}
                      </td>

                      {/* Columna 4: Fecha y No. de alta (con edición de No. de alta) */}
                      <td className="border border-slate-300 px-2.5 py-2 text-center align-middle font-medium text-slate-900">
                        {isEditingThisRow ? (
                          <div className="flex flex-col items-center gap-1.5 min-w-[140px]">
                            <span className="text-[11px] font-semibold text-slate-700">
                              Fecha: {formattedIncorporationDate || "—"}
                            </span>
                            <div className="flex items-center gap-1 w-full">
                              <input
                                type="text"
                                value={draftAltaNumber}
                                onChange={(e) => setDraftAltaNumber(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault()
                                    void handleSaveAltaNumber(row)
                                  } else if (e.key === "Escape") {
                                    cancelEditingAltaNumber()
                                  }
                                }}
                                placeholder="No. de alta"
                                autoFocus
                                disabled={isSavingThisRow}
                                className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-sitecorp-primary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveAltaNumber(row)}
                                disabled={isSavingThisRow}
                                title="Guardar No. de alta"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-sitecorp-primary text-white hover:opacity-90 disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingAltaNumber}
                                disabled={isSavingThisRow}
                                title="Cancelar"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex flex-col items-center justify-center gap-1">
                            <div className="flex items-center justify-center gap-1.5">
                              <span>{row.altaDisplay || "—"}</span>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => startEditingAltaNumber(row)}
                                  title="Editar No. de alta"
                                  className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition-colors"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {canManage && row.isInitialMigration && !row.altaNumber && (
                              <button
                                type="button"
                                onClick={() => startEditingAltaNumber(row)}
                                className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-sitecorp-primary hover:border-sitecorp-primary hover:bg-blue-50/50 transition-colors"
                              >
                                <Pencil className="h-2.5 w-2.5" />
                                Añadir No. de alta
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Columna 5: Fuente de procedencia */}
                      <td className="border border-slate-300 px-2.5 py-2 align-middle text-slate-800">
                        {row.sourceOfOrigin || "—"}
                      </td>

                      {/* Columna 6: Fecha y No. de baja */}
                      <td className="border border-slate-300 px-2.5 py-2 text-center align-middle font-medium text-slate-900">
                        {row.bajaDisplay || ""}
                      </td>

                      {/* Columnas 7 a 17: Motivo de la baja (marcado con X) */}
                      {ALTAS_BAJAS_REASON_COLUMNS.map((col) => {
                        const isMarked =
                          row.status === "SEPARATED" && row.bajaReasonColumn === col.code
                        const showCustomDetail =
                          isMarked &&
                          col.code === "OTRAS" &&
                          row.bajaReasonDetail &&
                          row.bajaReasonDetail.toLowerCase() !== "otras"

                        return (
                          <td
                            key={col.code}
                            className="border border-slate-300 px-1 py-2 text-center align-middle font-bold text-slate-900"
                            title={
                              isMarked
                                ? row.bajaReasonDetail
                                  ? `${col.label}: ${row.bajaReasonDetail}`
                                  : col.label
                                : undefined
                            }
                          >
                            {isMarked ? (
                              <div className="flex flex-col items-center justify-center">
                                <span className="text-sm font-extrabold text-slate-900">X</span>
                                {showCustomDetail && (
                                  <span className="mt-0.5 max-w-[90px] truncate text-[10px] font-normal text-slate-600">
                                    {row.bajaReasonDetail}
                                  </span>
                                )}
                              </div>
                            ) : (
                              ""
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Nota oficial al pie del documento */}
        <div className="border-t border-border bg-slate-50/70 px-5 py-3 text-xs text-slate-600 italic">
          {ALTAS_BAJAS_FOOTNOTE_TEXT}
        </div>
      </SiteCorpCard>
    </div>
  )
}

export default EntitySettingsAltasBajasRegistry
