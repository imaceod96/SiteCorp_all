import * as React from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, FileSignature, Loader2, Sparkles } from "lucide-react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { showError, showSuccess } from "@/utils/toast"
import {
  CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT,
  ensureContractDocumentGenerated,
  fetchPendingContractDocuments,
} from "../../infrastructure/contract-documents.repository"
import type { PendingContractDocumentRow } from "../../domain/entities"

interface PendingContractDocumentsBannerProps {
  entityId: string
}

export const PendingContractDocumentsBanner: React.FC<
  PendingContractDocumentsBannerProps
> = ({ entityId }) => {
  const [rows, setRows] = React.useState<PendingContractDocumentRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [generatingId, setGeneratingId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const pending = await fetchPendingContractDocuments(entityId || null)
      setRows(pending)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const handleChanged = () => {
      void refresh()
    }
    window.addEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handleChanged)
    }
  }, [refresh])

  const handleGenerateOne = async (row: PendingContractDocumentRow) => {
    setGeneratingId(row.contract_id)
    try {
      const outcome = await ensureContractDocumentGenerated(row.contract_id)
      if (outcome.generated || outcome.skipped) {
        showSuccess("Documento contractual generado correctamente.")
      } else {
        showError(
          outcome.result?.error ||
            "No se pudo generar el documento contractual. Revisa las variables o la conexión."
        )
      }
      await refresh()
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "No se pudo generar el documento contractual."
      )
      await refresh()
    } finally {
      setGeneratingId(null)
    }
  }

  if (loading || rows.length === 0) {
    return null
  }

  const count = rows.length
  const label = count === 1 ? "contrato" : "contratos"

  return (
    <SiteCorpCard className="rounded-2xl border-sitecorp-warning/40 bg-sitecorp-warning/5">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sitecorp-warning/15 p-2.5 text-sitecorp-warning">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">
                Contratos con documento pendiente de generar
              </h3>
              <span className="font-mono text-xs font-semibold tabular-nums text-amber-800">
                · {count} {label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              El contrato ya quedó formalizado en el servidor, pero su documento Word quedó pendiente
              o sufrió un corte de conexión durante la generación. Puedes generarlo ahora con un clic.
            </p>
          </div>
        </div>

        <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-white/80 px-3">
          {rows.map((row) => {
            const busy = generatingId === row.contract_id
            return (
              <div
                key={row.contract_id}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.worker_id ? (
                      <Link
                        to={`/workers/${row.worker_id}`}
                        className="text-sm font-medium text-sitecorp-primary hover:underline"
                      >
                        {row.worker_name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-ink">{row.worker_name}</span>
                    )}
                    <SiteCorpStatusBadge
                      status={row.document_status === "ERROR" ? "danger" : "warning"}
                    >
                      {row.document_status}
                    </SiteCorpStatusBadge>
                    {row.contract_type_name && (
                      <span className="text-xs text-muted-foreground">
                        · {row.contract_type_name}
                      </span>
                    )}
                  </div>
                  {row.document_error && (
                    <p className="text-xs text-sitecorp-danger">{row.document_error}</p>
                  )}
                </div>

                <div className="shrink-0">
                  <SiteCorpButton
                    type="button"
                    size="sm"
                    disabled={busy || generatingId !== null}
                    onClick={() => void handleGenerateOne(row)}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Generando…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        Generar documento
                      </>
                    )}
                  </SiteCorpButton>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </SiteCorpCard>
  )
}
