import * as React from "react"
import { templateVersionPeriodLabel } from "@/modules/document-templates/domain/rules"
import type { DocumentTemplateVersion } from "@/modules/document-templates/domain/entities"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CheckCircle2, Eye, FilePlus2, Power, PowerOff } from "lucide-react"

/**
 * Fase 11B.1 — Historial de versiones de la plantilla (§29–§33/§54).
 *
 * Sólo puede existir una versión ACTIVE por entidad y tipo de documento:
 * activar una nueva cierra automáticamente la vigente anterior.
 */

interface Props {
  versions: DocumentTemplateVersion[]
  selectedVersionId: string | null
  canManage: boolean
  busy: boolean
  onSelect: (versionId: string) => void
  onActivate: (version: DocumentTemplateVersion) => void
  onDeactivate: (version: DocumentTemplateVersion) => void
  onCreateVersion: (effectiveFrom: string | null) => void
}

/** Etiqueta corta del formato real del archivo de cada versión (§6/§27). */
const formatShortLabel = (format: string | null): string =>
  format === "DOC"
    ? ".doc (Word 97-2003)"
    : format === "DOCX"
      ? ".docx"
      : format === "XLSX"
        ? ".xlsx (Excel)"
        : "formato desconocido"

const statusBadge = (status: DocumentTemplateVersion["status"]) => {
  if (status === "ACTIVE") return <SiteCorpStatusBadge status="success">Activa</SiteCorpStatusBadge>
  if (status === "INACTIVE") return <SiteCorpStatusBadge status="neutral">Inactiva</SiteCorpStatusBadge>
  return <SiteCorpStatusBadge status="warning">Borrador</SiteCorpStatusBadge>
}

const DocumentTemplateVersionsPanel = ({
  versions,
  selectedVersionId,
  canManage,
  busy,
  onSelect,
  onActivate,
  onDeactivate,
  onCreateVersion,
}: Props) => {
  const [showCreate, setShowCreate] = React.useState(false)
  const [effectiveFrom, setEffectiveFrom] = React.useState("")

  const numbers = versions.map((version) => version.version_number)
  const nextVersionNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1

  const handleCreate = () => {
    onCreateVersion(effectiveFrom || null)
    setShowCreate(false)
    setEffectiveFrom("")
  }

  return (
    <>
      <SiteCorpCard
        title="Versiones"
        description="El contenido vigente se define por versión: las versiones activas y cerradas se conservan como historial."
      >
        <div className="space-y-3">
          {versions.map((version) => {
            const selected = version.id === selectedVersionId
            return (
              <div
                key={version.id}
                className={
                  selected
                    ? "rounded-xl border border-sitecorp-primary/40 bg-sitecorp-primary/5 p-4"
                    : "rounded-xl border border-border bg-white p-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">Versión {version.version_number}</p>
                      {statusBadge(version.status)}
                      {selected && (
                        <SiteCorpStatusBadge status="info">En pantalla</SiteCorpStatusBadge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {templateVersionPeriodLabel(version)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Original: {version.original_file_name || "sin archivo"}
                      {version.original_file_name && version.original_file_format
                        ? ` (${formatShortLabel(version.original_file_format)})`
                        : ""}{" "}
                      · Configurada: {version.configured_file_name || "sin archivo"}
                      {version.configured_file_name && version.configured_file_format
                        ? ` (${formatShortLabel(version.configured_file_format)})`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <SiteCorpButton size="sm" variant="outline" onClick={() => onSelect(version.id)}>
                      <Eye className="mr-1 h-3.5 w-3.5" />
                      Ver
                    </SiteCorpButton>
                    {canManage && version.status !== "ACTIVE" && (
                      <SiteCorpButton size="sm" disabled={busy} onClick={() => onActivate(version)}>
                        <Power className="mr-1 h-3.5 w-3.5" />
                        Activar
                      </SiteCorpButton>
                    )}
                    {canManage && version.status === "ACTIVE" && (
                      <SiteCorpButton
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onDeactivate(version)}
                      >
                        <PowerOff className="mr-1 h-3.5 w-3.5" />
                        Desactivar
                      </SiteCorpButton>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {canManage && (
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Una versión activa es inmutable: los cambios de contenido se hacen en una versión
                nueva.
              </p>
              <SiteCorpButton variant="outline" onClick={() => setShowCreate(true)} disabled={busy}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                Nueva versión
              </SiteCorpButton>
            </div>
          )}
        </div>
      </SiteCorpCard>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus2 className="h-5 w-5 text-sitecorp-primary" />
              Nueva versión de la plantilla
            </DialogTitle>
            <DialogDescription>
              Se creará la versión {nextVersionNumber} en borrador. Al activarla se cerrará la
              versión vigente anterior.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vigente desde</Label>
              <SiteCorpInput
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Si se deja vacía, al activar se tomará la fecha del día.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <SiteCorpButton variant="outline" onClick={() => setShowCreate(false)}>
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton onClick={handleCreate}>Crear versión</SiteCorpButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DocumentTemplateVersionsPanel
