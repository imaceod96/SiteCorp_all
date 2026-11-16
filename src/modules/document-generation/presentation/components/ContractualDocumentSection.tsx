import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { formatTemplateFileSize } from "@/modules/document-templates"
import {
  BLOCKED_MESSAGES,
  documentVariableHint,
  formatGenerationMoment,
} from "@/modules/document-generation/domain/rules"
import {
  fetchGeneratedDocuments,
  precheckDocumentGeneration,
} from "@/modules/document-generation/application/document-generation.queries"
import { downloadGeneratedDocument } from "@/modules/document-generation/application/document-generation.commands"
import {
  CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT,
  fetchDocumentGenerationJob,
  setContractDocumentStatus,
  triggerDocumentGenerationJobs,
  type DocumentGenerationJobRecord,
} from "@/modules/contracts/infrastructure/contract-documents.repository"
import type {
  DocumentGenerationPrecheck,
  DocumentGenerationResult,
  GeneratedDocumentRow,
  GenerationDocumentKind,
  TemplateResolution,
} from "@/modules/document-generation/domain/entities"

interface ContractualDocumentSectionProps {
  kind: GenerationDocumentKind
  sourceId: string
  canManage: boolean
  className?: string
}

const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  PINNED: "Versión fijada al documento",
  RESOLVED: "Versión aplicable según la fecha",
  NONE: "Sin plantilla aplicable",
  AMBIGUOUS: "Varias versiones aplicables",
}

const templateHeadline = (template: TemplateResolution): string => {
  const name = template.templateName || "Plantilla"
  return template.versionNumber != null ? `${name} · v${template.versionNumber}` : name
}

/**
 * Fase 11B.2 — Sección documental contractual (§61/§62/§63) con estado de cola en backend.
 *
 * Muestra el estado del documento en `public.document_generation_jobs`
 * (`PENDIENTE` | `GENERANDO` | `SIN_PLANTILLA` | `ERROR` | `GENERADO`) y permite
 * generarlo/regenerarlo o reintentar desde la cola.
 */
export const ContractualDocumentSection: React.FC<ContractualDocumentSectionProps> = ({
  kind,
  sourceId,
  canManage,
  className,
}) => {
  const [precheck, setPrecheck] = React.useState<DocumentGenerationPrecheck | null>(null)
  const [documents, setDocuments] = React.useState<GeneratedDocumentRow[]>([])
  const [jobRecord, setJobRecord] = React.useState<DocumentGenerationJobRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [failure, setFailure] = React.useState<DocumentGenerationResult | null>(null)
  const [busyDocId, setBusyDocId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [context, docs, job] = await Promise.all([
        precheckDocumentGeneration(kind, sourceId),
        fetchGeneratedDocuments(
          kind === "CONTRACT" ? { contractId: sourceId } : { addendumId: sourceId }
        ),
        fetchDocumentGenerationJob(kind, sourceId),
      ])
      setPrecheck(context)
      setDocuments(docs)
      setJobRecord(job)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar el estado del documento")
    } finally {
      setLoading(false)
    }
  }, [kind, sourceId])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const handler = () => {
      void load()
    }
    window.addEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT, handler)
  }, [load])

  const latest = documents.length > 0 ? documents[documents.length - 1] : null

  const isCuadroContract = React.useMemo(() => {
    if (kind !== "CONTRACT") return false
    const category = String(
      (precheck?.documentData as { job?: { occupational_category?: string | null } } | null)?.job
        ?.occupational_category || ""
    )
      .trim()
      .toUpperCase()
    return category === "CUADRO"
  }, [kind, precheck])

  const handleDownload = async (document: GeneratedDocumentRow) => {
    setBusyDocId(document.id)
    try {
      await downloadGeneratedDocument(document)
    } catch (err) {
      setFailure({
        success: false,
        pdfPath: null,
        error: err instanceof Error ? err.message : "No se pudo descargar el documento",
      })
    } finally {
      setBusyDocId(null)
    }
  }

  const handleGenerate = React.useCallback(async () => {
    setGenerating(true)
    setFailure(null)
    try {
      const queueRes = await triggerDocumentGenerationJobs({ kind, sourceId })
      if (queueRes.ok) {
        if (kind === "CONTRACT") {
          await setContractDocumentStatus(sourceId, "GENERADO", null)
        }
        setDialogOpen(false)
        await load()
        return
      }

      const errMsg = queueRes.error || "No se pudo generar el documento en el servidor."
      if (kind === "CONTRACT") {
        await setContractDocumentStatus(sourceId, "ERROR", errMsg)
      }
      setDialogOpen(false)
      setFailure({ success: false, pdfPath: null, error: errMsg })
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo generar el documento"
      if (kind === "CONTRACT") {
        await setContractDocumentStatus(sourceId, "ERROR", msg)
      }
      setDialogOpen(false)
      setFailure({ success: false, pdfPath: null, error: msg })
    } finally {
      setGenerating(false)
    }
  }, [kind, sourceId, load])

  const template = precheck?.template ?? null
  const jobStatus = jobRecord?.status ?? null

  return (
    <div className={className}>
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-sitecorp-primary" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {kind === "CONTRACT" ? "Documento del contrato" : "Documento del anexo"}
            </h4>
          </div>

          {!loading && !isCuadroContract && (
            <div className="flex items-center gap-2">
              {latest ? (
                <SiteCorpStatusBadge status="success">Generado</SiteCorpStatusBadge>
              ) : jobStatus === "PENDIENTE" || jobStatus === "GENERANDO" || generating ? (
                <SiteCorpStatusBadge status="info">Generando documento…</SiteCorpStatusBadge>
              ) : jobStatus === "SIN_PLANTILLA" || template?.status === "NONE" ? (
                <SiteCorpStatusBadge status="warning">Sin plantilla activa</SiteCorpStatusBadge>
              ) : jobStatus === "ERROR" ? (
                <SiteCorpStatusBadge status="danger">Error al generar</SiteCorpStatusBadge>
              ) : (
                <SiteCorpStatusBadge status="warning">Pendiente</SiteCorpStatusBadge>
              )}

              {canManage && (
                <SiteCorpButton
                  type="button"
                  size="sm"
                  variant={latest ? "outline" : "default"}
                  disabled={generating}
                  onClick={() => setDialogOpen(true)}
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Generando…
                    </>
                  ) : latest ? (
                    <>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Regenerar documento
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Generar documento
                    </>
                  )}
                </SiteCorpButton>
              )}
            </div>
          )}
        </div>

        {loadError && (
          <SiteCorpAlert type="danger" className="mt-3">
            {loadError}
          </SiteCorpAlert>
        )}

        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">Comprobando estado del documento…</p>
        ) : isCuadroContract ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Este cargo corresponde a un Cuadro: no requiere generación de contrato laboral.
          </p>
        ) : latest ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
            <div className="space-y-0.5">
              <p className="font-medium text-ink">{latest.file_name}</p>
              <p className="text-muted-foreground">
                Generado el {formatGenerationMoment(latest.created_at)}
                {latest.file_size != null
                  ? ` · ${formatTemplateFileSize(latest.file_size)}`
                  : ""}
              </p>
            </div>
            <SiteCorpButton
              type="button"
              size="sm"
              variant="outline"
              disabled={busyDocId === latest.id}
              onClick={() => handleDownload(latest)}
            >
              {busyDocId === latest.id ? "Descargando…" : "Descargar"}
            </SiteCorpButton>
          </div>
        ) : jobStatus === "SIN_PLANTILLA" || template?.status === "NONE" ? (
          <SiteCorpAlert type="warning" className="mt-3" title="Falta plantilla activa para este tipo de documento">
            <p className="text-xs">
              Configure y active una plantilla aplicable para que el documento pueda generarse automáticamente.
            </p>
            <Link
              to="/settings/document-templates"
              className="mt-1.5 inline-block text-xs font-semibold text-sitecorp-primary hover:underline"
            >
              Ir a Plantillas de documentos
            </Link>
          </SiteCorpAlert>
        ) : jobStatus === "ERROR" ? (
          <SiteCorpAlert type="danger" className="mt-3" title="No se pudo generar automáticamente">
            <p className="text-xs">
              {jobRecord?.last_error || "Ocurrió un error al procesar el documento en la cola."}
            </p>
            {canManage && (
              <SiteCorpButton
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={generating}
                onClick={handleGenerate}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Reintentar
              </SiteCorpButton>
            )}
          </SiteCorpAlert>
        ) : jobStatus === "PENDIENTE" || jobStatus === "GENERANDO" ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-3 py-2 text-xs text-sitecorp-primary">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generando documento en la cola del servidor…
            </span>
            {canManage && (
              <SiteCorpButton
                type="button"
                size="sm"
                variant="outline"
                disabled={generating}
                onClick={handleGenerate}
              >
                Procesar ahora
              </SiteCorpButton>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            El documento se encola automáticamente al formalizar y puede regenerarse en cualquier momento.
          </p>
        )}
      </div>

      {/* Diálogo de generación/regeneración */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {latest ? "Regenerar documento" : "Generar documento"}
            </DialogTitle>
            <DialogDescription>
              Se validará la plantilla aplicable y los datos requeridos del expediente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Plantilla</p>
              <p className="text-ink">
                {template && template.versionId ? templateHeadline(template) : "—"}
              </p>
              {template?.versionStatus && (
                <p className="text-xs text-muted-foreground">
                  {TEMPLATE_STATUS_LABEL[template.status] ?? ""}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Variables requeridas
              </p>
              <p className="text-ink">{precheck?.requiredVariables.length ?? 0}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
              <CheckLine
                ok={!!template && !!template.versionId && template.versionUsable}
                label="Plantilla válida"
              />
              <CheckLine
                ok={(precheck?.missingVariables.length ?? 1) === 0}
                label="Datos completos"
              />
              <CheckLine
                ok={!!precheck?.formalized}
                label={kind === "CONTRACT" ? "Contrato formalizado" : "Anexo formalizado"}
              />
            </div>

            {precheck && !precheck.ready && (
              <SiteCorpAlert type="warning" title="No se puede generar todavía">
                {precheck.blockedReason === "MISSING_DATA" ? (
                  <MissingVariableList precheck={precheck} />
                ) : (
                  <p>{BLOCKED_MESSAGES[precheck.blockedReason ?? "TEMPLATE_NONE"]}</p>
                )}
                {precheck.blockedReason === "TEMPLATE_NONE" && (
                  <Link
                    to="/settings/document-templates"
                    className="mt-2 inline-block font-medium text-sitecorp-primary hover:underline"
                  >
                    Ir a Plantillas de documentos
                  </Link>
                )}
              </SiteCorpAlert>
            )}

            {generating && (
              <div className="flex items-center gap-2 rounded-lg border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-3 py-2 text-xs font-medium text-sitecorp-primary">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Procesando generación documental en el servidor…</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <SiteCorpButton
                type="button"
                variant="outline"
                disabled={generating}
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                disabled={generating || !precheck?.ready}
                onClick={handleGenerate}
              >
                {generating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {generating ? "Generando…" : latest ? "Regenerar" : "Generar"}
              </SiteCorpButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error de generación (§20/§53/§65) */}
      <Dialog open={failure !== null} onOpenChange={(open) => !open && setFailure(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>No se puede generar el documento</DialogTitle>
          </DialogHeader>
          {failure?.missingVariables && failure.missingVariables.length > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Faltan datos requeridos por esta plantilla:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-ink">
                {failure.missingVariables.map((variable) => (
                  <li key={variable.key}>
                    {variable.label}
                    <span className="ml-1 text-xs text-muted-foreground">({variable.key})</span>
                    {documentVariableHint(variable.key) && (
                      <span className="block text-xs text-muted-foreground">
                        → {documentVariableHint(variable.key)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Corrija la información antes de generar el documento.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink">{failure?.error}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const CheckLine: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <p className={`flex items-center gap-2 text-sm ${ok ? "text-ink" : "text-muted-foreground"}`}>
    <span aria-hidden className={ok ? "text-sitecorp-success" : "text-sitecorp-warning"}>
      {ok ? "✓" : "✗"}
    </span>
    {label}
  </p>
)

const MissingVariableList: React.FC<{ precheck: DocumentGenerationPrecheck }> = ({ precheck }) => (
  <div className="space-y-2">
    <p>Información pendiente:</p>
    <ul className="list-disc space-y-1 pl-5">
      {precheck.missingVariables.map((variable) => (
        <li key={variable.key}>
          {variable.label}
          {variable.hint && (
            <span className="block text-xs text-muted-foreground">{variable.hint}</span>
          )}
        </li>
      ))}
    </ul>
  </div>
)

export default ContractualDocumentSection
