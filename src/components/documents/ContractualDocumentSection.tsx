import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { formatTemplateFileSize } from "@/modules/document-templates"
import {
  BLOCKED_MESSAGES,
  documentVariableHint,
  downloadGeneratedDocument,
  fetchGeneratedDocuments,
  formatGenerationMoment,
  generateAddendumDocument,
  generateContractDocument,
  precheckDocumentGeneration,
  type DocumentGenerationPrecheck,
  type DocumentGenerationResult,
  type GeneratedDocumentRow,
  type GenerationDocumentKind,
  type TemplateResolution,
} from "@/modules/document-generation"

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
 * Fase 11B.2 — Sección documental contractual (§61/§62/§63).
 *
 * Muestra el estado del documento generado (Word) del contrato o del anexo y
 * permite generarlo/regenerarlo con la versión de plantilla correcta, validando
 * únicamente las variables que ESA plantilla requiere.
 */
export const ContractualDocumentSection: React.FC<ContractualDocumentSectionProps> = ({
  kind,
  sourceId,
  canManage,
  className,
}) => {
  const [precheck, setPrecheck] = React.useState<DocumentGenerationPrecheck | null>(null)
  const [documents, setDocuments] = React.useState<GeneratedDocumentRow[]>([])
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
      const [context, docs] = await Promise.all([
        precheckDocumentGeneration(kind, sourceId),
        fetchGeneratedDocuments(
          kind === "CONTRACT" ? { contractId: sourceId } : { addendumId: sourceId }
        ),
      ])
      setPrecheck(context)
      setDocuments(docs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudo cargar el estado del documento")
    } finally {
      setLoading(false)
    }
  }, [kind, sourceId])

  React.useEffect(() => {
    void load()
  }, [load])

  const latest = documents.length > 0 ? documents[documents.length - 1] : null

  const handleDownload = async (document: GeneratedDocumentRow) => {
    setBusyDocId(document.id)
    try {
      await downloadGeneratedDocument(document)
    } catch (err) {
      setFailure({ success: false, pdfPath: null, error: err instanceof Error ? err.message : "No se pudo descargar el documento" })
    } finally {
      setBusyDocId(null)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setFailure(null)
    try {
      const result =
        kind === "CONTRACT"
          ? await generateContractDocument(sourceId)
          : await generateAddendumDocument(sourceId)
      if (!result.success) {
        setDialogOpen(false)
        setFailure(result)
      } else {
        setDialogOpen(false)
      }
      await load()
    } catch (err) {
      setDialogOpen(false)
      setFailure({ success: false, pdfPath: null, error: err instanceof Error ? err.message : "No se pudo generar el documento" })
    } finally {
      setGenerating(false)
    }
  }

  const title = kind === "CONTRACT" ? "Documento contractual" : "Documento del anexo"

  if (loading) {
    return (
      <div className={className}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando el estado del documento…
        </p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className={className}>
        <SiteCorpAlert type="danger" title={title}>
          {loadError}
        </SiteCorpAlert>
      </div>
    )
  }

  const template = precheck?.template ?? null

  return (
    <div className={`rounded-xl border border-border bg-muted/10 p-4 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {latest?.generation_number != null && (
          <SiteCorpStatusBadge status="info">Generación {latest.generation_number}</SiteCorpStatusBadge>
        )}
      </div>

      {!latest ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Aún no se ha generado el documento.</p>
          {canManage && (
            <SiteCorpButton
              type="button"
              size="sm"
              className="mt-3"
              onClick={() => {
                setFailure(null)
                setDialogOpen(true)
              }}
            >
              <Sparkles className="mr-2 h-3.5 w-3.5" /> Generar documento
            </SiteCorpButton>
          )}
          {!precheck?.formalized && (
            <p className="mt-2 text-xs text-muted-foreground">
              {kind === "CONTRACT"
                ? "El documento se podrá generar cuando el contrato esté formalizado."
                : "El documento se podrá generar cuando el anexo esté formalizado."}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium text-ink">{precheck?.documentTypeLabel ?? "Documento contractual"}</p>
          <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-1">
              <dt>Plantilla:</dt>
              <dd className="text-ink">
                {latest.template_name || template?.templateName || "Plantilla"}
                {latest.version_number != null ? ` · v${latest.version_number}` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap gap-1">
              <dt>Generado:</dt>
              <dd className="text-ink">{formatGenerationMoment(latest.created_at)}</dd>
            </div>
            <div className="flex flex-wrap gap-1">
              <dt>Archivo:</dt>
              <dd className="text-ink">
                {latest.file_name}
                {latest.file_size ? ` · ${formatTemplateFileSize(latest.file_size)}` : ""}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              size="sm"
              disabled={busyDocId === latest.id}
              onClick={() => handleDownload(latest)}
            >
              <FileText className="mr-2 h-3.5 w-3.5" /> Descargar Word
            </SiteCorpButton>
            {canManage && (
              <SiteCorpButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFailure(null)
                  setDialogOpen(true)
                }}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Regenerar
              </SiteCorpButton>
            )}
          </div>

          {documents.length > 1 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Generaciones anteriores
              </p>
              <ul className="mt-1.5 space-y-1">
                {documents
                  .slice(0, -1)
                  .reverse()
                  .map((document) => (
                    <li key={document.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        Generación {document.generation_number ?? "—"} ·{" "}
                        {formatGenerationMoment(document.created_at)}
                      </span>
                      <button
                        type="button"
                        className="font-medium text-sitecorp-primary hover:underline"
                        onClick={() => handleDownload(document)}
                      >
                        Descargar Word
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Diálogo de precheck (§64) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {latest ? "Regenerar documento contractual" : "Generar documento contractual"}
            </DialogTitle>
            <DialogDescription>
              {latest
                ? "Se volverá a generar el documento con los datos históricos ya fijados."
                : "Se generará el documento Word a partir de la plantilla configurada."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
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
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Variables requeridas</p>
              <p className="text-ink">{precheck?.requiredVariables.length ?? 0}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
              <CheckLine ok={!!template && !!template.versionId && template.versionUsable} label="Plantilla válida" />
              <CheckLine ok={(precheck?.missingVariables.length ?? 1) === 0} label="Datos completos" />
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
                    to={`/entity/${precheck.entityId}/settings/document-templates`}
                    className="mt-2 inline-block font-medium text-sitecorp-primary hover:underline"
                  >
                    Ir a Plantillas de documentos
                  </Link>
                )}
              </SiteCorpAlert>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <SiteCorpButton type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                disabled={generating || !precheck?.ready}
                onClick={handleGenerate}
              >
                {generating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {latest ? "Regenerar" : "Generar"}
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
          {variable.hint && <span className="block text-xs text-muted-foreground">{variable.hint}</span>}
        </li>
      ))}
    </ul>
  </div>
)

export default ContractualDocumentSection
