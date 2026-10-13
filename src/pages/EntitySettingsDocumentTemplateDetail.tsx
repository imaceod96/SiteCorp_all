import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { loadEntityPermissionSafe } from "@/domains/access-control"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { showSuccess, showError } from "@/utils/toast"
import {
  activateTemplateVersion,
  createDocumentTemplateVersion,
  deactivateTemplateVersion,
  describeTemplateFileProblem,
  fetchDocumentTemplate,
  fetchDocumentTemplateTypes,
  reanalyzeTemplateFile,
  registerTemplateFile,
  validateTemplateVersion,
  type DocumentTemplate,
  type DocumentTemplateVersion,
  type TemplateValidation,
} from "@/domains/document-templates"
import DocumentTemplateFilesPanel from "@/components/document-templates/DocumentTemplateFilesPanel"
import DocumentTemplateValidationPanel from "@/components/document-templates/DocumentTemplateValidationPanel"
import DocumentTemplateVersionsPanel from "@/components/document-templates/DocumentTemplateVersionsPanel"
import DocumentTemplateVariablesPanel from "@/components/document-templates/DocumentTemplateVariablesPanel"
import { ArrowLeft, ListChecks } from "lucide-react"

/**
 * Fase 11B.1 — Detalle de una plantilla documental: archivos, análisis,
 * validación estructural, versionado y variables disponibles (§30/§53/§77).
 */

const EntitySettingsDocumentTemplateDetail = () => {
  const { entityId: routeEntityId, templateId } = useParams<{
    entityId: string
    templateId: string
  }>()
  const { currentEntity } = useCurrentEntity()
  const entityId = routeEntityId || currentEntity?.id || ""
  const navigate = useNavigate()

  const [loading, setLoading] = React.useState(true)
  const [notAllowed, setNotAllowed] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [template, setTemplate] = React.useState<DocumentTemplate | null>(null)
  const [typeName, setTypeName] = React.useState("")
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null)
  const [validation, setValidation] = React.useState<TemplateValidation | null>(null)
  const [validationLoading, setValidationLoading] = React.useState(false)
  const [busyLabel, setBusyLabel] = React.useState<string | null>(null)

  const busy = busyLabel !== null

  const selectedVersion: DocumentTemplateVersion | null =
    template?.versions.find((version) => version.id === selectedVersionId) ??
    template?.versions[0] ??
    null

  const loadValidation = React.useCallback(async (versionId: string | null) => {
    if (!versionId) {
      setValidation(null)
      return
    }
    setValidationLoading(true)
    try {
      const result = await validateTemplateVersion(versionId)
      setValidation(result)
    } catch (err) {
      console.error("Error validating template version:", err)
      setValidation(null)
    } finally {
      setValidationLoading(false)
    }
  }, [])

  const reload = React.useCallback(
    async (preferredVersionId?: string | null) => {
      if (!templateId) return
      const fresh = await fetchDocumentTemplate(templateId)
      setTemplate(fresh)

      const versions = fresh?.versions ?? []
      const nextId =
        (preferredVersionId && versions.some((version) => version.id === preferredVersionId)
          ? preferredVersionId
          : null) ??
        versions.find((version) => version.status === "ACTIVE")?.id ??
        versions[0]?.id ??
        null

      setSelectedVersionId(nextId)
      await loadValidation(nextId)
    },
    [loadValidation, templateId]
  )

  const initialLoad = React.useCallback(async () => {
    if (!entityId || !templateId) {
      setNotAllowed("No se pudo determinar la entidad o la plantilla.")
      setLoading(false)
      return
    }

    setLoading(true)
    setNotAllowed(null)

    try {
      // Los permisos se preguntan al dominio de control de acceso: un fallo de la
      // comprobación no habilita nada.
      const [canView, canManageTemplates] = await Promise.all([
        loadEntityPermissionSafe(entityId, "document_templates.view"),
        loadEntityPermissionSafe(entityId, "document_templates.manage"),
      ])

      if (!canView && !canManageTemplates) {
        setNotAllowed("No tiene permiso para consultar esta plantilla documental.")
        return
      }

      setCanManage(canManageTemplates)

      const fresh = await fetchDocumentTemplate(templateId)
      if (!fresh || fresh.organization_entity_id !== entityId) {
        setNotAllowed("La plantilla no existe o no pertenece a esta entidad.")
        return
      }

      setTemplate(fresh)

      const versions = fresh.versions
      const nextId =
        versions.find((version) => version.status === "ACTIVE")?.id ?? versions[0]?.id ?? null
      setSelectedVersionId(nextId)

      const types = await fetchDocumentTemplateTypes()
      setTypeName(
        types.find((type) => type.code === fresh.document_type_code)?.name ||
          fresh.document_type_code
      )

      await loadValidation(nextId)
    } catch (err) {
      console.error("Error loading document template:", err)
      setNotAllowed(err instanceof Error ? err.message : "No se pudo cargar la plantilla documental.")
    } finally {
      setLoading(false)
    }
  }, [entityId, loadValidation, templateId])

  React.useEffect(() => {
    initialLoad()
  }, [initialLoad])

  const handleSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId)
    loadValidation(versionId)
  }

  const handleUpload = async (file: File, kind: "ORIGINAL" | "CONFIGURED") => {
    if (!selectedVersion || !templateId) return

    const problem = await describeTemplateFileProblem(file)
    if (problem) {
      showError(problem)
      return
    }

    try {
      setBusyLabel("Subiendo el documento…")
      const registered = await registerTemplateFile({
        entityId,
        templateId,
        version: selectedVersion,
        kind,
        file,
      })

      setBusyLabel(registered.format === "DOC" ? "Identificando el documento…" : "Analizando el contenido…")
      if (registered.format === "DOC") {
        showError(
          "El documento .doc se cargó y se conservará intacto, pero no puede prepararse para el análisis de variables. Cárguelo en formato .docx para poder analizarlo y activar la plantilla."
        )
      } else if (registered.analysis?.valid_docx) {
        showSuccess(
          kind === "CONFIGURED"
            ? "Documento configurado cargado y analizado."
            : "Documento original cargado y analizado."
        )
      } else {
        showError("El archivo se cargó, pero no es un paquete OOXML válido (.docx o .xlsx).")
      }

      setBusyLabel(null)
      await reload(selectedVersion.id)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo procesar el archivo.")
    }
  }

  const handleReanalyze = async () => {
    if (!selectedVersion) return
    const isConfigured = Boolean(selectedVersion.configured_file_path)
    const path = selectedVersion.configured_file_path || selectedVersion.original_file_path
    if (!path) {
      showError("La versión no tiene ningún documento para analizar.")
      return
    }
    try {
      setBusyLabel("Analizando el contenido…")
      const result = await reanalyzeTemplateFile({
        version: selectedVersion,
        kind: isConfigured ? "CONFIGURED" : "ORIGINAL",
        filePath: path,
      })
      if (!result.supported) {
        showError(
          result.issue ||
            "El documento no puede analizarse: sustitúyalo por un documento en formato .docx o .xlsx."
        )
      } else {
        showSuccess("Análisis actualizado.")
      }
      setBusyLabel(null)
      await reload(selectedVersion.id)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo analizar el documento.")
    }
  }

  const handleActivate = async (version: DocumentTemplateVersion) => {
    try {
      setBusyLabel(`Activando la versión ${version.version_number}…`)
      const result = await activateTemplateVersion(version.id)
      const closed = result.deactivated_previous?.length
        ? ` Se cerró la versión anterior (${result.deactivated_previous
            .map((item) => `v${item.version_number}`)
            .join(", ")}).`
        : ""
      showSuccess(`Versión ${version.version_number} activada.${closed}`)
      setBusyLabel(null)
      await reload(version.id)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo activar la versión.")
    }
  }

  const handleDeactivate = async (version: DocumentTemplateVersion) => {
    try {
      setBusyLabel("Desactivando la versión…")
      await deactivateTemplateVersion(version.id)
      showSuccess(
        "La versión quedó inactiva y se conserva como histórico. La entidad no tiene plantilla vigente de este tipo."
      )
      setBusyLabel(null)
      await reload(version.id)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo desactivar la versión.")
    }
  }

  const handleCreateVersion = async (effectiveFrom: string | null) => {
    if (!templateId) return
    try {
      setBusyLabel("Creando la nueva versión…")
      const created = await createDocumentTemplateVersion(templateId, effectiveFrom)
      showSuccess(`Versión ${created.version_number} creada como borrador.`)
      setBusyLabel(null)
      await reload(created.version_id)
    } catch (err) {
      setBusyLabel(null)
      showError(err instanceof Error ? err.message : "No se pudo crear la versión.")
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Plantilla documental" description="Cargando plantilla…" />
        <SiteCorpLoading rows={6} />
      </div>
    )
  }

  if (notAllowed || !template) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Plantilla documental" description="Detalle de la plantilla" />
        <SiteCorpAlert type="danger">
          {notAllowed || "No se pudo cargar la plantilla documental."}
        </SiteCorpAlert>
        <SiteCorpButton
          variant="outline"
          onClick={() => navigate(`/entity/${entityId}/settings/document-templates`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver al listado
        </SiteCorpButton>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title={template.name}
        description={typeName || template.document_type_code}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SiteCorpButton
          variant="outline"
          size="sm"
          onClick={() => navigate(`/entity/${entityId}/settings/document-templates`)}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Volver al listado
        </SiteCorpButton>
        <SiteCorpStatusBadge status="neutral">{template.versions.length} versión(es)</SiteCorpStatusBadge>
        {selectedVersion && (
          <SiteCorpStatusBadge
            status={
              selectedVersion.status === "ACTIVE"
                ? "success"
                : selectedVersion.status === "DRAFT"
                  ? "warning"
                  : "neutral"
            }
          >
            {selectedVersion.status === "ACTIVE"
              ? "Versión activa"
              : selectedVersion.status === "DRAFT"
                ? "Borrador"
                : "Inactiva"}
          </SiteCorpStatusBadge>
        )}
      </div>

      {busyLabel && <SiteCorpAlert type="info">{busyLabel}</SiteCorpAlert>}

      {!canManage && (
        <SiteCorpAlert type="info">
          Sólo los usuarios autorizados para configurar la organización pueden modificar las
          plantillas de esta entidad.
        </SiteCorpAlert>
      )}

      <SiteCorpCard title="Cómo configurar la plantilla" description="El documento no se redacta en SiteCorp: se prepara en Word.">
        <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Descargue el documento original de esta versión.</li>
          <li>Ábralo en Word.</li>
          <li>Identifique únicamente los datos que cambian en cada contrato (nombres, fechas, importes…).</li>
          <li>Copie desde el catálogo inferior las variables correspondientes.</li>
          <li>Sustituya esos datos por los marcadores, por ejemplo:</li>
        </ol>
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">
            <span className="font-medium text-ink">Antes:</span> D. Juan Pérez García, trabajador con
            CI 90010112345
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-ink">Después:</span> D.{" "}
            <code className="font-mono text-ink">{"{{worker.full_name}}"}</code>, trabajador con CI{" "}
            <code className="font-mono text-ink">{"{{worker.identification}}"}</code>
          </p>
        </div>
        <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-muted-foreground" start={6}>
          <li>Guarde el documento como DOCX conservando todo el formato legal y de firma.</li>
          <li>Súbalo como documento configurado y analícelo: la plantilla quedará lista para activar.</li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Formatos admitidos: .doc y .docx. El archivo siempre se conserva en su formato original,
          pero el análisis automático de variables requiere un documento .docx: si guarda el
          configurado como .doc, SiteCorp lo almacenará, informará de su estado y no permitirá
          activar la plantilla hasta disponer de una versión analizable.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Sólo se exigen las variables que el documento configurado contiene realmente.
        </div>
      </SiteCorpCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {selectedVersion ? (
            <DocumentTemplateFilesPanel
              version={selectedVersion}
              canManage={canManage}
              busy={busy}
              onUpload={handleUpload}
              onReanalyze={handleReanalyze}
            />
          ) : (
            <SiteCorpAlert type="warning" title="Sin versiones">
              Esta plantilla no tiene versiones registradas. Cree una nueva versión para continuar.
            </SiteCorpAlert>
          )}

          <DocumentTemplateValidationPanel validation={validation} loading={validationLoading} />
        </div>

        <div className="space-y-4">
          <DocumentTemplateVersionsPanel
            versions={template.versions}
            selectedVersionId={selectedVersionId}
            canManage={canManage}
            busy={busy}
            onSelect={handleSelectVersion}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
            onCreateVersion={handleCreateVersion}
          />
        </div>
      </div>

      <DocumentTemplateVariablesPanel
        templateTypeCode={template.document_type_code}
        usedVariables={validation?.recognized ?? []}
      />
    </div>
  )
}

export default EntitySettingsDocumentTemplateDetail
