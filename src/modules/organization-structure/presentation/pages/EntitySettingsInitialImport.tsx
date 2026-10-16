import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Download, FileSpreadsheet, Loader2, Upload, AlertTriangle, AlertCircle, CheckCircle2, XCircle, ClipboardCheck, UserPlus } from "lucide-react"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { Button } from "@/components/ui/sitecorp-button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MigratedWorkerDialog } from "@/components/migration/MigratedWorkerDialog"
// Todo lo aporta el dominio Personas: el formato del archivo (plantilla oficial y lectura del
// Excel) junto a los casos de uso de la carga inicial (catálogos, validación por fila,
// importación e historial).
import {
  buildWorkerMigrationTemplate,
  downloadWorkerMigrationTemplate,
  importWorkerMigration,
  loadEntityMigrationHistory,
  mapMigrationRows,
  readWorkerMigrationExcel,
  validateWorkerMigration,
  WorkerMigrationTemplateError,
  type MigrationBatchHistory,
  type MigrationPreviewRow,
  type MigrationRow,
} from "@/modules/people"

interface ImportSummary {
  created: number
  complete: number
  incomplete: number
  pending: number
}

/** Error de VALIDACIÓN del archivo mostrado dentro de la sección de carga.
 * Se separa del `error` general (historial / migración) para poder explicar
 * al usuario qué hacer sin exponer detalles técnicos. */
interface ValidationFailure {
  title: string
  message: string
  missingColumns?: string[]
}

/** "identificación, nombre" → "Identificación y Nombre" */
const formatColumnList = (columns: string[]) => {
  const labels = columns.map((column) => column.charAt(0).toUpperCase() + column.slice(1))
  if (labels.length <= 1) return labels[0] || ""
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`
}

const describeValidationFailure = (cause: unknown, phase: "read" | "process"): ValidationFailure => {
  if (cause instanceof WorkerMigrationTemplateError && cause.code === "MISSING_COLUMNS") {
    return {
      title: "Formato de plantilla incorrecto",
      message:
        "El archivo seleccionado no tiene el formato requerido para realizar la carga inicial de trabajadores.\n\n" +
        "Utiliza la plantilla oficial disponible en la parte superior de esta página, completa la información respetando su estructura y vuelve a cargar el archivo.",
      missingColumns: cause.missingColumns,
    }
  }
  if (phase === "read") {
    return {
      title: "No se pudo leer el archivo",
      message:
        "No hemos podido procesar el archivo seleccionado. Comprueba que sea un archivo Excel válido y que utilice la plantilla oficial de carga inicial de trabajadores.",
    }
  }
  return {
    title: "No se pudo validar el archivo",
    message: "No hemos podido validar el archivo en este momento. Inténtalo de nuevo más tarde.",
  }
}

const EntitySettingsInitialImport = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { permissions, loading: permissionLoading } = useEntityPermissions(entityId)
  const canManageWorkers = permissions.includes("workers.manage")
  const allowed = permissions.includes("workers.initial_import") || canManageWorkers
  const [file, setFile] = React.useState<File | null>(null)
  const [rows, setRows] = React.useState<MigrationRow[]>([])
  const [preview, setPreview] = React.useState<MigrationPreviewRow[]>([])
  const [isValidated, setIsValidated] = React.useState(false)
  const [validating, setValidating] = React.useState(false)
  const [history, setHistory] = React.useState<MigrationBatchHistory[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [validationError, setValidationError] = React.useState<ValidationFailure | null>(null)
  const [notice, setNotice] = React.useState("")
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [individualOpen, setIndividualOpen] = React.useState(false)
  const [summary, setSummary] = React.useState<ImportSummary | null>(null)
  // Validación cruzada persona-en-masa (NO bloqueante): identificaciones repetidas
  // que se crearon igualmente y que el usuario debe corregir.
  const [duplicateIdentifications, setDuplicateIdentifications] = React.useState<string[]>([])

  const loadHistory = React.useCallback(async () => {
    if (!entityId) return
    // Caso de uso del dominio Personas: los lotes se agrupan con la misma regla que la
    // vinculación a plantilla (trabajador activo con Assignment vigente = vinculado).
    setHistory(await loadEntityMigrationHistory(entityId))
  }, [entityId])

  React.useEffect(() => {
    if (!allowed) return
    loadHistory().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial."))
  }, [allowed, loadHistory])

  // Al cambiar el archivo se invalida cualquier validación anterior.
  const onSelectFile = (nextFile: File | null) => {
    setFile(nextFile)
    setRows([])
    setPreview([])
    setIsValidated(false)
    setSummary(null)
    setDuplicateIdentifications([])
    setError("")
    setValidationError(null)
    setNotice("")
  }

  const handleDownload = async () => {
    setBusy(true)
    setError("")
    try {
      downloadWorkerMigrationTemplate(await buildWorkerMigrationTemplate())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo generar la plantilla.")
    } finally {
      setBusy(false)
    }
  }

  // VALIDAR: solo lectura/análisis. No crea Workers, Assignments ni documentos.
  const handleValidate = async () => {
    if (!file || !entityId || !allowed || validating) return
    setValidating(true)
    setBusy(true)
    setError("")
    setNotice("")
    setSummary(null)
    setValidationError(null)
    // "read" = leer/parsear el Excel (estructura del archivo).
    // "process" = catálogos + RPC de validación (datos por fila).
    let phase: "read" | "process" = "read"
    try {
      const parsed = await readWorkerMigrationExcel(file)
      phase = "process"
      const mapped = await mapMigrationRows(parsed)
      const checked = await validateWorkerMigration(entityId, mapped)
      setRows(mapped)
      setPreview(checked)
      setIsValidated(true)
    } catch (cause) {
      // El detalle técnico completo queda en consola para diagnóstico.
      console.error("[initial-import] No se pudo validar el archivo", cause)
      setIsValidated(false)
      setRows([])
      setPreview([])
      setValidationError(describeValidationFailure(cause, phase))
    } finally {
      setBusy(false)
      setValidating(false)
    }
  }

  const validCount = preview.filter((row) => row.status === "VALID").length
  const warningCount = preview.filter((row) => row.status === "WARNING").length
  const errorCount = preview.filter((row) => row.status === "ERROR").length
  const importableRows = preview.length - errorCount
  // "Información pendiente" cuenta solo las filas con datos incompletos. Las
  // advertencias por identificación repetida (no bloqueantes) no son datos
  // pendientes: se crean igualmente y se corrigen aparte.
  const incompleteCount = preview.filter((row) => row.messages.some((message) => message.startsWith("Información incompleta"))).length
  // El Preview solo existe tras una validación vigente (se limpia al cambiar de archivo).
  const hasPreview = preview.length > 0
  const canImport = hasPreview && errorCount === 0 && !busy

  // INICIAR MIGRACIÓN: crea Workers reales. Nunca crea Assignments ni documentos.
  const handleStartMigration = async () => {
    if (!entityId || !allowed || !canImport) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const importRows = rows.map((row) => ({ ...row, position_id: undefined, position_code: "" }))
      const result = await importWorkerMigration(entityId, importRows, `MIG-${crypto.randomUUID()}`)
      setSummary({ created: result.imported, complete: result.imported - incompleteCount, incomplete: incompleteCount, pending: result.imported })
      setDuplicateIdentifications(result.duplicate_identifications)
      setConfirmOpen(false)
      setFile(null)
      setRows([])
      setPreview([])
      setIsValidated(false)
      queryClient.invalidateQueries()
      await loadHistory()
    } catch (cause) {
      console.error("[initial-import] La migración no pudo completarse", cause)
      setError(cause instanceof Error ? cause.message : "El backend no pudo completar la migración.")
    } finally {
      setBusy(false)
    }
  }

  if (permissionLoading) return <div className="p-6">Cargando permisos…</div>
  if (!allowed) return <div className="space-y-5 p-6"><SiteCorpPageHeader title="Carga inicial de trabajadores" /><SiteCorpAlert type="warning">No tiene el permiso workers.initial_import ni workers.manage.</SiteCorpAlert></div>

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SiteCorpPageHeader
        title="Carga inicial de trabajadores"
        description="Incorpora trabajadores existentes como Workers. La migración crea solo personas: quedan pendientes de vinculación a plantilla."
        actions={canManageWorkers && (
          <Button variant="outline" onClick={() => setIndividualOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />Migración individual
          </Button>
        )}
      />
      {error && <SiteCorpAlert type="danger" title="Error">{error}</SiteCorpAlert>}
      {notice && <SiteCorpAlert type="success">{notice}</SiteCorpAlert>}

      {summary && (
        <SiteCorpCard className="rounded-2xl border-sitecorp-success/30 bg-sitecorp-success/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-sitecorp-success">Migración completada</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-ink sm:grid-cols-4">
                <div><dt className="text-sitecorp-success">Trabajadores creados</dt><dd className="text-xl font-semibold">{summary.created}</dd></div>
                <div><dt className="text-sitecorp-success">Con información completa</dt><dd className="text-xl font-semibold">{summary.complete}</dd></div>
                <div><dt className="text-sitecorp-success">Con información pendiente</dt><dd className="text-xl font-semibold">{summary.incomplete}</dd></div>
                <div><dt className="text-sitecorp-success">Pendientes de vinculación</dt><dd className="text-xl font-semibold">{summary.pending}</dd></div>
              </dl>
            </div>
            <Button onClick={() => navigate(`/entity/${entityId}/staffing`)}>Ir a Trabajadores</Button>
          </div>
        </SiteCorpCard>
      )}

      {duplicateIdentifications.length > 0 && (
        <SiteCorpAlert type="warning" title="Identificaciones repetidas detectadas">
          <div className="mt-1 space-y-2">
            <p>
              Estas identificaciones están repetidas en el archivo o ya existían en el cliente. La carga se completó:
              las personas se crearon igualmente.
            </p>
            <ul className="list-disc space-y-0.5 pl-5 font-mono text-xs">
              {duplicateIdentifications.map((identification) => (
                <li key={identification}>{identification}</li>
              ))}
            </ul>
            <p className="font-medium text-slate-900">
              Corrija estas identificaciones en los trabajadores creados para que cada persona tenga su carné propio.
            </p>
          </div>
        </SiteCorpAlert>
      )}

      <SiteCorpCard className="rounded-2xl">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl bg-sitecorp-primary/5 p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-sitecorp-primary"><FileSpreadsheet className="h-5 w-5" /></div>
            <h2 className="text-lg font-semibold text-slate-900">1. Descarga la plantilla</h2>
            <p className="mt-1 text-sm text-slate-700">Plantilla simplificada. La fecha de nacimiento no se solicita: se deriva de la identificación cuando es posible.</p>
            {allowed && <Button className="mt-4" onClick={handleDownload} disabled={busy}><Download className="mr-2 h-4 w-4" />Descargar plantilla Excel</Button>}
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-sitecorp-success/10 text-sitecorp-success"><Upload className="h-5 w-5" /></div>
            <h2 className="text-lg font-semibold text-slate-900">2. Cargar y validar archivo</h2>
            <p className="mt-1 text-sm text-slate-600">Archivo .xlsx, máximo 10 MB. Validar solo analiza el archivo: no crea trabajadores.</p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="initial-import-file">Archivo Excel</Label>
              <SiteCorpInput id="initial-import-file" type="file" accept=".xlsx" disabled={busy} onChange={(event) => onSelectFile(event.target.files?.[0] || null)} />
              {file && <p className="text-sm font-medium text-slate-700">{file.name}</p>}
                {file && !isValidated && <p className="text-xs text-sitecorp-warning">Archivo seleccionado. Validación pendiente.</p>}
                {file && isValidated && (
                  <p className={`text-xs ${errorCount > 0 ? "text-sitecorp-danger" : warningCount > 0 ? "text-sitecorp-warning" : "text-sitecorp-success"}`}>
                    {errorCount > 0
                      ? "Archivo validado con errores. Corrige los errores antes de iniciar la migración."
                      : warningCount > 0
                        ? "Archivo validado con advertencias."
                        : "Archivo validado correctamente."}
                  </p>
                )}
                {validationError && (
                  <SiteCorpAlert type="danger" title={validationError.title} className="mt-2">
                    <div className="mt-1 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-danger" />
                        <p className="whitespace-pre-line">{validationError.message}</p>
                      </div>
                      {validationError.missingColumns && validationError.missingColumns.length > 0 && (
                        <p className="text-xs text-sitecorp-danger">
                          Columnas requeridas no encontradas: {formatColumnList(validationError.missingColumns)}.
                        </p>
                      )}
                    </div>
                  </SiteCorpAlert>
                )}
              </div>
              {allowed && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={handleValidate} disabled={!file || busy}>
                    {validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    {validating ? "Validando…" : "Validar"}
                  </Button>
                  <Button onClick={() => setConfirmOpen(true)} disabled={!canImport}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />Iniciar migración
                  </Button>
                </div>
              )}
              {allowed && (
                <p className={`mt-2 text-xs ${canImport ? "text-sitecorp-success" : errorCount > 0 || validationError ? "text-sitecorp-danger" : "text-sitecorp-warning"}`}>
                  {validationError
                    ? "Corrige el archivo o utiliza la plantilla oficial y vuelve a pulsar Validar."
                    : errorCount > 0
                      ? "Corrige los errores detectados antes de iniciar la migración."
                      : hasPreview
                        ? `Se crearán ${importableRows} trabajadores.`
                        : "Valida el archivo antes de iniciar la migración."}
                </p>
              )}
            </div>
        </div>
      </SiteCorpCard>

      {hasPreview && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Total" value={preview.length} tone="neutral" />
          <Summary label="Válidos" value={validCount} tone="valid" />
          <Summary label="Advertencias" value={warningCount} tone="warning" />
          <Summary label="Errores" value={errorCount} tone="error" />
        </div>
        <SiteCorpCard className="rounded-2xl">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Preview de migración</h2>
            <p className="text-sm text-slate-600">Validar no modifica datos. Iniciar migración crea los trabajadores reales (sin vinculación a puestos).</p>
          </div>
          {errorCount > 0
            ? <SiteCorpAlert type="danger">Corrige los errores antes de iniciar la migración. El lote no se ejecutará.</SiteCorpAlert>
            : incompleteCount > 0 && <SiteCorpAlert type="warning">{incompleteCount} trabajadores tienen información pendiente de completar.</SiteCorpAlert>}
          <div className="mt-4 overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Fila</TableHead><TableHead>Identificación</TableHead><TableHead>Trabajador</TableHead><TableHead>Nacimiento</TableHead><TableHead>Incorporación</TableHead><TableHead>Estado y detalle</TableHead></TableRow></TableHeader>
              <TableBody>{preview.map((item, index) => {
                const row = (rows[index] || {}) as MigrationRow
                const status = item.status
                return <TableRow key={index}>
                  <TableCell>{index + 2}</TableCell>
                  <TableCell className="font-mono text-xs">{row.identification}</TableCell>
                  <TableCell>{row.first_name} {row.first_surname} {row.second_surname}</TableCell>
                  <TableCell>{row.birth_date || <span className="text-sitecorp-warning">Pendiente</span>}</TableCell>
                  <TableCell>{row.employment_start_date}</TableCell>
                  <TableCell><div className="flex min-w-56 items-start gap-2">
                    {status === "VALID" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-success" /> : status === "WARNING" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-warning" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-danger" />}
                    <div><Badge variant={status === "ERROR" ? "destructive" : "secondary"}>{status === "VALID" ? "VÁLIDO" : status === "WARNING" ? "ADVERTENCIA" : "ERROR"}</Badge><p className="mt-1 text-xs text-slate-700">{item.messages.join(" · ") || "Se creará como pendiente de vinculación a plantilla."}</p></div>
                  </div></TableCell>
                </TableRow>
              })}</TableBody>
            </Table>
          </div>
        </SiteCorpCard>
      </>}

      <SiteCorpCard className="rounded-2xl">
        <h2 className="text-lg font-semibold text-slate-900">Historial de lotes</h2>
        <p className="mb-4 text-sm text-slate-600">Los registros provienen de los Workers creados por cada lote de migración.</p>
        {history.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay lotes importados.</p> : <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Lote</TableHead><TableHead>Total</TableHead><TableHead>Vinculados</TableHead><TableHead>Pendientes</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{history.map((batch) => <TableRow key={batch.batchId}><TableCell>{batch.migratedAt ? new Date(batch.migratedAt).toLocaleString("es-CU") : "—"}</TableCell><TableCell className="font-mono text-xs">{batch.batchId}</TableCell><TableCell>{batch.total}</TableCell><TableCell>{batch.linked}</TableCell><TableCell>{batch.pending}</TableCell><TableCell><Badge variant="secondary">Importado</Badge></TableCell></TableRow>)}</TableBody></Table></div>}
      </SiteCorpCard>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar migración</DialogTitle>
            <DialogDescription>Se crearán {importableRows} trabajadores en SiteCorp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-slate-700">
            <p>Los trabajadores se crearán inicialmente <strong>sin vinculación a Puestos</strong>.</p>
            {incompleteCount > 0 && <p>{incompleteCount} trabajadores quedarán con información pendiente de completar.</p>}
            <p>Podrás completar sus datos y vincularlos posteriormente desde Trabajadores.</p>
            <p className="font-medium text-slate-900">¿Deseas continuar?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleStartMigration} disabled={busy}>{busy ? "Migrando trabajadores…" : "Iniciar migración"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={individualOpen} onOpenChange={setIndividualOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Migración individual</DialogTitle>
            <DialogDescription>Crea un Worker histórico directamente. Queda sin puesto y sin documentos; podrá vincularlo a la plantilla después.</DialogDescription>
          </DialogHeader>
          <MigratedWorkerDialog
            onCancel={() => setIndividualOpen(false)}
            onSuccess={async () => {
              queryClient.invalidateQueries()
              await loadHistory()
              setIndividualOpen(false)
              setNotice("Trabajador creado correctamente.")
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "neutral" | "valid" | "warning" | "error" }) {
  const colors = { neutral: "text-ink", valid: "text-sitecorp-success", warning: "text-sitecorp-warning", error: "text-sitecorp-danger" }
  return <div className="rounded-2xl border bg-white p-4"><p className={`text-2xl font-semibold ${colors[tone]}`}>{value}</p><p className="text-sm text-slate-600">{label}</p></div>
}

export default EntitySettingsInitialImport
