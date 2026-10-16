/**
 * Documentos pendientes (bandeja documental de la ENTIDAD).
 *
 * "Documentos generados por movimientos masivos disponibles para descarga."
 *
 * Un LOTE (document_batches) agrupa documentos YA generados de un mismo evento,
 * una misma entidad y un mismo tipo documental, para descargarlos en un único ZIP.
 * Los documentos individuales viven en el expediente del trabajador: el ZIP es
 * sólo una facilidad de descarga.
 */

import * as React from "react"
import { useParams } from "react-router-dom"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  createBatchZipUrl,
  fetchBatchItems,
  fetchPendingBatches,
  formatBatchMoment,
  generateEventMovementDocuments,
  rebuildEventBatches,
  requestBatchZip,
  type PendingBatch,
  type PendingBatchItem,
  DOCUMENT_TYPE_LABELS,
} from "@/modules/document-generation"
import { showError, showSuccess } from "@/utils/toast"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react"

const statusMeta = (status: PendingBatch["status"]) => {
  if (status === "READY") return { badge: "success" as const, label: "Listo" }
  if (status === "ERRORS") return { badge: "danger" as const, label: "Con errores" }
  return { badge: "info" as const, label: "Generando" }
}

const EntityPendingDocuments = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const { has, loading: permissionsLoading } = useEntityPermissions(entityId)
  const canView = has(["workers.view", "workers.manage"])
  const canManage = has(["workers.manage"])

  const [batches, setBatches] = React.useState<PendingBatch[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const [detail, setDetail] = React.useState<PendingBatch | null>(null)
  const [items, setItems] = React.useState<PendingBatchItem[]>([])
  const [itemsLoading, setItemsLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setBatches(await fetchPendingBatches())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los lotes documentales")
    } finally {
      setLoading(false)
    }
  }, [canView])

  React.useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (batch: PendingBatch) => {
    setDetail(batch)
    setItems([])
    setItemsLoading(true)
    try {
      setItems(await fetchBatchItems(batch.id))
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudo cargar el detalle del lote")
    } finally {
      setItemsLoading(false)
    }
  }

  const handleGenerate = async (batch: PendingBatch) => {
    setBusy(batch.id)
    try {
      const result = await generateEventMovementDocuments(batch.event_id)
      await rebuildEventBatches(batch.event_id)
      await load()
      if (result.failed > 0) {
        showError(`${result.generated} de ${result.generated + result.failed} documentos generados · ${result.failed} error(es).`)
      } else {
        showSuccess(`Se generaron ${result.generated} documento(s).`)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudieron generar los documentos")
    } finally {
      setBusy(null)
    }
  }

  const handleCreateZip = async (batch: PendingBatch) => {
    setBusy(batch.id)
    try {
      await requestBatchZip(batch.id)
      await load()
      showSuccess("ZIP generado. Ya puede descargarlo.")
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudo generar el ZIP")
    } finally {
      setBusy(null)
    }
  }

  const handleDownloadZip = async (batch: PendingBatch) => {
    if (!batch.zip_path) return
    setBusy(batch.id)
    try {
      const url = await createBatchZipUrl(batch.zip_path)
      if (!url) throw new Error("No se pudo preparar la descarga")
      window.open(url, "_blank", "noopener")
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudo descargar el ZIP")
    } finally {
      setBusy(null)
    }
  }

  if (permissionsLoading || loading) {
    return <SiteCorpLoading rows={4} />
  }

  if (!canView) {
    return (
      <div className="space-y-6">
        <SiteCorpPageHeader title="Documentos pendientes" />
        <SiteCorpAlert type="warning">
          No tiene permiso para ver los documentos de esta entidad.
        </SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SiteCorpPageHeader
        title="Documentos pendientes"
        description="Documentos generados por movimientos masivos disponibles para descarga."
      />

      {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

      {batches.length === 0 ? (
        <SiteCorpCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <FileArchive className="h-10 w-10 text-sitecorp-primary/50" />
            <p className="text-sm font-medium text-ink">No hay lotes documentales pendientes.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Cuando un cambio masivo (por ejemplo, un cambio salarial) afecte a más de 5
              trabajadores de esta entidad, aquí aparecerá el lote listo para descargar.
            </p>
          </div>
        </SiteCorpCard>
      ) : (
        <SiteCorpCard>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Movimiento</th>
                  <th className="px-3 py-2">Tipo documental</th>
                  <th className="px-3 py-2">Entidad</th>
                  <th className="px-3 py-2 text-right">Documentos</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const meta = statusMeta(batch.status)
                  const isBusy = busy === batch.id
                  return (
                    <tr key={batch.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatBatchMoment(batch.created_at)}
                      </td>
                      <td className="px-3 py-2 text-ink">{batch.label || "—"}</td>
                      <td className="px-3 py-2">
                        {DOCUMENT_TYPE_LABELS[batch.document_type_code] || batch.document_type_code}
                      </td>
                      <td className="px-3 py-2 text-ink">{batch.entity_name || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {batch.failed_count > 0 ? (
                          <span className="text-sitecorp-danger">
                            {batch.generated_count} de {batch.expected_count} · {batch.failed_count} error(es)
                          </span>
                        ) : (
                          <span>
                            {batch.expected_count} documento(s)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <SiteCorpStatusBadge status={meta.badge}>{meta.label}</SiteCorpStatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <SiteCorpButton
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => void openDetail(batch)}
                          >
                            <FileText className="mr-1.5 h-3.5 w-3.5" /> Detalle
                          </SiteCorpButton>
                          {canManage && batch.failed_count > 0 && (
                            <SiteCorpButton
                              variant="outline"
                              size="sm"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleGenerate(batch)}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Reintentar
                            </SiteCorpButton>
                          )}
                          {canManage && !batch.zip_path && batch.generated_count > 0 && (
                            <SiteCorpButton
                              size="sm"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCreateZip(batch)}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileArchive className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Crear ZIP
                            </SiteCorpButton>
                          )}
                          {batch.zip_path && (
                            <SiteCorpButton
                              size="sm"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDownloadZip(batch)}
                            >
                              <Download className="mr-1.5 h-3.5 w-3.5" /> Descargar ZIP
                            </SiteCorpButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SiteCorpCard>
      )}

      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{detail?.label || "Detalle del lote"}</DialogTitle>
            <DialogDescription>
              {detail ? DOCUMENT_TYPE_LABELS[detail.document_type_code] || detail.document_type_code : ""}
            </DialogDescription>
          </DialogHeader>

          {detail && detail.failed_count > 0 && (
            <SiteCorpAlert type="warning">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {detail.generated_count} de {detail.expected_count} generados · {detail.failed_count} error(es).
              </span>
            </SiteCorpAlert>
          )}

          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Cargando documentos…</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  {item.status === "GENERATED" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-sitecorp-success" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-sitecorp-danger" />
                  )}
                  <span className="text-ink">{item.worker_name || "—"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.status === "GENERATED" ? "generado" : item.error || "error"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default EntityPendingDocuments
