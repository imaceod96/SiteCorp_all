import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { loadEntityPermissionSafe } from "@/modules/access-control"
import { fetchEntityName } from "@/modules/organization-structure"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { showSuccess, showError } from "@/utils/toast"
import {
  createDocumentTemplateVersion,
  deactivateTemplateVersion,
  fetchDocumentTemplateTypes,
  fetchDocumentTemplates,
  formatDocumentDate,
  getTemplateFileUrl,
  templateVersionPeriodLabel,
  type DocumentTemplate,
  type DocumentTemplateVersion,
  type DocumentTemplateType,
} from "@/modules/document-templates"
import CreateDocumentTemplateDialog from "@/components/document-templates/CreateDocumentTemplateDialog"
import { FileText, Plus, ArrowRight, Download, FilePlus2, PowerOff } from "lucide-react"

/**
 * Fase 11B.1 — Listado de plantillas documentales de la entidad (§49/§50/§51).
 */

const EntitySettingsDocumentTemplates = () => {
  const { entityId: routeEntityId } = useParams<{ entityId: string }>()
  const { currentEntity } = useCurrentEntity()
  const entityId = routeEntityId || currentEntity?.id || ""
  const navigate = useNavigate()

  const [loading, setLoading] = React.useState(true)
  const [notAllowed, setNotAllowed] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [entityName, setEntityName] = React.useState("")
  const [types, setTypes] = React.useState<DocumentTemplateType[]>([])
  const [templates, setTemplates] = React.useState<DocumentTemplate[]>([])
  const [showCreate, setShowCreate] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [busyLabel, setBusyLabel] = React.useState<string | null>(null)

  const busy = busyLabel !== null

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setNotAllowed("No se pudo determinar la entidad.")
      setLoading(false)
      return
    }

    setLoading(true)
    setNotAllowed(null)
    setLoadError(null)

    try {
      // Los permisos se preguntan al dominio de control de acceso (un fallo de la
      // comprobación no habilita nada y no tumba la pantalla) y el nombre de la entidad al
      // de estructura organizativa: la pantalla no compone consultas.
      const [canView, canManageTemplates, name] = await Promise.all([
        loadEntityPermissionSafe(entityId, "document_templates.view"),
        loadEntityPermissionSafe(entityId, "document_templates.manage"),
        fetchEntityName(entityId),
      ])

      if (!canView && !canManageTemplates) {
        setNotAllowed("No tiene permiso para consultar las plantillas documentales de esta entidad.")
        return
      }

      setCanManage(canManageTemplates)
      setEntityName(name)

      const [catalog, loadedTemplates] = await Promise.all([
        fetchDocumentTemplateTypes(),
        fetchDocumentTemplates(entityId),
      ])
      setTypes(catalog)
      setTemplates(loadedTemplates)
    } catch (err) {
      console.error("Error loading document templates:", err)
      setLoadError(
        err instanceof Error ? err.message : "No se pudieron cargar las plantillas documentales."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const handleDownload = async (template: DocumentTemplate) => {
    const version =
      template.versions.find((item) => item.status === "ACTIVE") ?? template.versions[0]
    const path = version?.configured_file_path || version?.original_file_path
    if (!path) {
      showError("Esta plantilla todavía no tiene documentos cargados.")
      return
    }
    const url = await getTemplateFileUrl(path)
    if (!url) {
      showError("No se pudo generar el enlace de descarga.")
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleDeactivate = async (version: DocumentTemplateVersion) => {
    try {
      setBusyLabel("Desactivando la versión activa…")
      await deactivateTemplateVersion(version.id)
      showSuccess("Versión desactivada. Se conserva como histórico.")
      setBusyLabel(null)
      await loadData()
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo desactivar la versión.")
    }
  }

  const handleCreateVersion = async (template: DocumentTemplate) => {
    try {
      setBusyLabel("Creando la nueva versión…")
      const created = await createDocumentTemplateVersion(template.id, null)
      showSuccess(`Versión ${created.version_number} creada como borrador.`)
      setBusyLabel(null)
      navigate(`/entity/${entityId}/settings/document-templates/${template.id}`)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo crear la versión.")
    }
  }

  const header = (
    <SiteCorpPageHeader
      title="Plantillas documentales"
      description={`Plantillas Word (.doc y .docx) de los documentos contractuales de ${
        entityName || "la entidad"
      }`}
    />
  )

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        {header}
        <SiteCorpLoading rows={5} />
      </div>
    )
  }

  if (notAllowed) {
    return (
      <div className="space-y-6 p-6">
        {header}
        <SiteCorpAlert type="danger">{notAllowed}</SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {header}

      {busyLabel && <SiteCorpAlert type="info">{busyLabel}</SiteCorpAlert>}
      {loadError && <SiteCorpAlert type="danger">{loadError}</SiteCorpAlert>}

      {templates.length === 0 ? (
        <SiteCorpCard>
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-ink">
              Aún no hay plantillas documentales configuradas.
            </p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
              Suba los modelos oficiales utilizados por esta entidad para preparar la generación
              automática de contratos y anexos.
            </p>
            {canManage && (
              <div className="mt-5 flex justify-center">
                <SiteCorpButton onClick={() => setShowCreate(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear primera plantilla
                </SiteCorpButton>
              </div>
            )}
          </div>
        </SiteCorpCard>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {templates.length} plantilla(s) configurada(s) · máximo una versión activa por tipo de
            documento.
          </p>
          {canManage && (
            <SiteCorpButton onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva plantilla
            </SiteCorpButton>
          )}
        </div>
      )}

      {types.map((type) => {
        const group = templates.filter((template) => template.document_type_code === type.code)
        if (group.length === 0) return null
        return (
          <SiteCorpCard key={type.code} title={type.name} description={type.description || undefined}>
            <div className="space-y-3">
              {group.map((template) => {
                const active = template.versions.find((version) => version.status === "ACTIVE")
                const drafts = template.versions.filter((version) => version.status === "DRAFT").length
                const lastChange = template.versions.reduce(
                  (latest, version) => (version.updated_at > latest ? version.updated_at : latest),
                  template.updated_at
                )
                return (
                  <div
                    key={template.id}
                    className="rounded-xl border border-border bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-ink">{template.name}</p>
                          {active ? (
                            <SiteCorpStatusBadge status="success">
                              Activa · v{active.version_number}
                            </SiteCorpStatusBadge>
                          ) : (
                            <SiteCorpStatusBadge status="warning">Sin versión activa</SiteCorpStatusBadge>
                          )}
                          {drafts > 0 && (
                            <SiteCorpStatusBadge status="info">{drafts} borrador(es)</SiteCorpStatusBadge>
                          )}
                        </div>
                        {template.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Estado: {active ? "vigente" : "sin vigencia"}</span>
                          <span>
                            Vigencia: {active ? templateVersionPeriodLabel(active) : "—"}
                          </span>
                          <span>Última modificación: {formatDocumentDate(lastChange) || "—"}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(`/entity/${entityId}/settings/document-templates/${template.id}`)
                          }
                        >
                          Abrir
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </SiteCorpButton>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleDownload(template)}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" />
                          Descargar
                        </SiteCorpButton>
                        {canManage && (
                          <SiteCorpButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => handleCreateVersion(template)}
                          >
                            <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                            Nueva versión
                          </SiteCorpButton>
                        )}
                        {canManage && active && (
                          <SiteCorpButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => handleDeactivate(active)}
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
            </div>
          </SiteCorpCard>
        )
      })}

      <CreateDocumentTemplateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        entityId={entityId}
        onCreated={async (createdTemplateId) => {
          navigate(`/entity/${entityId}/settings/document-templates/${createdTemplateId}`)
        }}
      />
    </div>
  )
}

export default EntitySettingsDocumentTemplates
