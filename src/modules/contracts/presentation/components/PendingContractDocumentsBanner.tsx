import * as React from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, FileText, Loader2, RefreshCw, Settings } from "lucide-react"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { formatIsoDateToDisplay } from "@/utils/cuba-date"
import { showError, showSuccess } from "@/utils/toast"
import {
  CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT,
  DOCUMENT_JOB_KIND_LABELS,
  fetchPendingContractDocuments,
  triggerDocumentGenerationJobs,
} from "../../infrastructure/contract-documents.repository"
import type { PendingContractDocumentRow } from "../../domain/entities"

interface PendingContractDocumentsBannerProps {
  entityId: string | null | undefined
  canManage?: boolean
  onResolved?: () => void
}

/**
 * Aviso persistente de documentos pendientes, en curso, sin plantilla o con error de generación
 * leídos directamente de `public.document_generation_jobs` para TODOS los tipos documentales:
 * contratos, anexos, resoluciones, movimientos de nómina, vacaciones y certificados médicos.
 */
export const PendingContractDocumentsBanner: React.FC<PendingContractDocumentsBannerProps> = ({
  entityId,
  canManage = true,
  onResolved,
}) => {
  const [rows, setRows] = React.useState<PendingContractDocumentRow[]>([])
  const [retryingId, setRetryingId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!entityId) {
      setRows([])
      return
    }
    const list = await fetchPendingContractDocuments(entityId)
    setRows(list)
  }, [entityId])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const handler = () => {
      void load()
    }
    window.addEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handler)
    }
  }, [load])

  // Sondeo automático cada 5s mientras existan trabajos en PENDIENTE o GENERANDO
  const hasActiveJobs = React.useMemo(
    () =>
      rows.some(
        (r) => r.document_status === "PENDIENTE" || r.document_status === "GENERANDO"
      ),
    [rows]
  )

  React.useEffect(() => {
    if (!hasActiveJobs || !entityId) return
    const timer = window.setInterval(() => {
      void load()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs, entityId, load])

  const handleRetry = async (row: PendingContractDocumentRow) => {
    const key = row.source_id || row.contract_id
    setRetryingId(key)
    try {
      const outcome = await triggerDocumentGenerationJobs({
        kind: row.kind ?? "CONTRACT",
        sourceId: key,
      })
      if (outcome.ok) {
        showSuccess(`Documento generado correctamente para ${row.worker_name}.`)
        await load()
        onResolved?.()
      } else {
        showError(
          outcome.error ||
            "No se pudo generar el documento en este momento. Puedes volver a intentarlo."
        )
        await load()
      }
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : "Error inesperado al reintentar la generación del documento."
      )
      await load()
    } finally {
      setRetryingId(null)
    }
  }

  if (rows.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Contratos con documento pendiente de generar"
      className="rounded-2xl border border-sitecorp-warning/40 bg-sitecorp-warning/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-sitecorp-warning" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Documentos pendientes de generar ({rows.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Estado en tiempo real de la cola de generación documental (contratos, anexos,
              resoluciones, movimientos de nómina, vacaciones y certificados médicos).
            </p>
          </div>

          <div className="space-y-2">
            {rows.map((row) => {
              const rowKey = row.source_id || row.contract_id
              const isRetrying = retryingId === rowKey
              const isGenerating =
                isRetrying ||
                row.document_status === "PENDIENTE" ||
                row.document_status === "GENERANDO"
              const isMissingTemplate = row.document_status === "SIN_PLANTILLA"
              const kindLabel =
                (row.kind && DOCUMENT_JOB_KIND_LABELS[row.kind]) ||
                row.contract_type_name ||
                "Contrato de trabajo"

              return (
                <div
                  key={`${row.kind ?? "CONTRACT"}:${rowKey}`}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.worker_id ? (
                        <Link
                          to={`/workers/${row.worker_id}?tab=contratacion`}
                          className="text-sm font-medium text-ink hover:text-sitecorp-primary hover:underline"
                        >
                          {row.worker_name}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium text-ink">{row.worker_name}</span>
                      )}
                      {row.worker_identification && (
                        <span className="font-mono text-xs text-muted-foreground">
                          CI: {row.worker_identification}
                        </span>
                      )}
                      <SiteCorpStatusBadge
                        status={
                          row.document_status === "ERROR"
                            ? "danger"
                            : isMissingTemplate
                              ? "warning"
                              : "info"
                        }
                      >
                        {row.document_status === "ERROR"
                          ? "Error al generar"
                          : isMissingTemplate
                            ? "Falta plantilla"
                            : "Generando documento…"}
                      </SiteCorpStatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {kindLabel}
                      {row.start_date
                        ? ` · Inicio: ${formatIsoDateToDisplay(row.start_date)}`
                        : ""}
                    </p>
                    {isMissingTemplate ? (
                      <p className="text-xs text-sitecorp-warning">
                        {row.document_error || `Falta la plantilla de ${kindLabel}.`}{" "}
                        <Link
                          to="/settings/document-templates"
                          className="inline-flex items-center gap-1 font-medium text-sitecorp-primary underline"
                        >
                          <Settings className="h-3 w-3" /> Configurar plantillas documentales
                        </Link>
                      </p>
                    ) : (
                      row.document_error && (
                        <p className="text-xs text-sitecorp-danger">
                          Error: {row.document_error}
                        </p>
                      )
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-2">
                      <SiteCorpButton
                        size="sm"
                        variant="outline"
                        disabled={isRetrying}
                        onClick={() => void handleRetry(row)}
                      >
                        {isGenerating && isRetrying ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Generando documento…
                          </>
                        ) : row.document_status === "ERROR" || isMissingTemplate ? (
                          <>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            Reintentar
                          </>
                        ) : (
                          <>
                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                            Generar documento
                          </>
                        )}
                      </SiteCorpButton>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
