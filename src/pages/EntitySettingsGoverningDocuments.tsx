import * as React from "react"
import { useParams } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectQuery,
} from "@/integrations/supabase/schema-target"
import { useEntityPermissions } from "@/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Download, Eye, FileText, Paperclip, Plus, Trash2 } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import {
  DOCUMENT_ACCEPT_ATTR,
  formatDocumentDate,
  formatFileSize,
  isViewableDocument,
  sanitizeFileName,
  validateDocumentFile,
} from "@/lib/documents"

/**
 * Documentos rectores de una entidad (operativos de la ENTIDAD, no catálogo global).
 * Sólo nombre + archivo: sin versiones, aprobaciones ni clasificación.
 * El archivo vive en el bucket privado `documents` bajo
 * `governing-documents/<organization_entity_id>/<documento_id>/<archivo>`, de modo
 * que las políticas de Storage resuelven la entidad desde la ruta.
 */

const BUCKET = "documents"

interface GoverningDocument {
  id: string
  organization_entity_id: string
  name: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  created_at: string
}

const EntitySettingsGoverningDocuments = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const { permissions, loading: permissionsLoading } = useEntityPermissions(entityId)

  const canView = permissions.includes("organization.view") || permissions.includes("organization.manage")
  const canManage = permissions.includes("organization.manage")

  const [documents, setDocuments] = React.useState<GoverningDocument[]>([])
  const [entityName, setEntityName] = React.useState("")
  // Cliente propietario de la entidad. Se lee de la columna FÍSICA `tenant_id`.
  const [companyClientId, setCompanyClientId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [documentName, setDocumentName] = React.useState("")
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)

  const loadDocuments = React.useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setError(null)
    try {
      const [entityRes, documentsRes] = await Promise.all([
        supabase
          .from("organization_entities")
          .select(selectQuery(`name, ${selectColumn("clientId")}`))
          .eq("id", entityId)
          .maybeSingle(),
        supabase
          .from("governing_documents")
          .select(
            "id, organization_entity_id, name, file_name, storage_path, mime_type, file_size, created_at"
          )
          .eq("organization_entity_id", entityId)
          .order("created_at", { ascending: false }),
      ])
      if (documentsRes.error) throw documentsRes.error

      const entity = entityRes.data as { name: string; tenant_id: string | null } | null
      setEntityName(entity?.name || "")
      setCompanyClientId(entity?.tenant_id ?? null)
      setDocuments((documentsRes.data as GoverningDocument[]) || [])
    } catch (err) {
      console.error("Error loading governing documents:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los documentos rectores")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    if (!entityId || !canView) return
    loadDocuments()
  }, [entityId, canView, loadDocuments])

  const openDialog = () => {
    setFormError(null)
    setDocumentName("")
    setSelectedFile(null)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    if (saving) return
    setDialogOpen(false)
    setFormError(null)
    setDocumentName("")
    setSelectedFile(null)
  }

  const handleSave = async () => {
    if (!entityId) return

    // Ambos campos son obligatorios.
    if (!documentName.trim()) {
      setFormError("El nombre del documento es obligatorio")
      return
    }
    if (!selectedFile) {
      setFormError("Debe seleccionar el archivo del documento")
      return
    }
    const validationError = validateDocumentFile(selectedFile)
    if (validationError) {
      setFormError(validationError)
      return
    }

    setSaving(true)
    setFormError(null)

    const documentId = crypto.randomUUID()
    const storagePath = `governing-documents/${entityId}/${documentId}/${sanitizeFileName(selectedFile.name)}`

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error("Usuario no autenticado")

      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, selectedFile, { cacheControl: "3600", upsert: false })
      if (storageError) throw storageError

      // La clave del insert es el nombre FÍSICO de columna del estado activo.
      const { error: dbError } = await supabase.from("governing_documents").insert({
        id: documentId,
        [columnName("clientId")]: companyClientId,
        organization_entity_id: entityId,
        name: documentName.trim(),
        file_name: selectedFile.name,
        storage_path: storagePath,
        mime_type: selectedFile.type || null,
        file_size: selectedFile.size,
        created_by: userData.user.id,
      })
      if (dbError) {
        // No dejar archivos huérfanos si el registro no se pudo crear.
        await supabase.storage.from(BUCKET).remove([storagePath])
        throw dbError
      }

      setDialogOpen(false)
      setDocumentName("")
      setSelectedFile(null)
      await loadDocuments()
      showSuccess("Documento rector guardado correctamente")
    } catch (err) {
      console.error("Error saving governing document:", err)
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el documento")
    } finally {
      setSaving(false)
    }
  }

  const handleOpen = async (doc: GoverningDocument) => {
    setBusyId(doc.id)
    try {
      const { data, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 60)
      if (signedError) throw signedError
      window.open(data.signedUrl, "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error("Error opening governing document:", err)
      showError("No se pudo abrir el documento")
    } finally {
      setBusyId(null)
    }
  }

  const handleDownload = async (doc: GoverningDocument) => {
    setBusyId(doc.id)
    try {
      const { data, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(doc.storage_path)
      if (downloadError) throw downloadError

      const url = window.URL.createObjectURL(data)
      const link = window.document.createElement("a")
      link.href = url
      link.download = doc.file_name
      window.document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      window.document.body.removeChild(link)
    } catch (err) {
      console.error("Error downloading governing document:", err)
      showError("No se pudo descargar el documento")
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (doc: GoverningDocument) => {
    if (!confirm(`¿Eliminar el documento rector "${doc.name}"? Esta acción no se puede deshacer.`)) {
      return
    }
    setBusyId(doc.id)
    try {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.storage_path])
      if (storageError) throw storageError

      const { error: dbError } = await supabase.from("governing_documents").delete().eq("id", doc.id)
      if (dbError) throw dbError

      await loadDocuments()
      showSuccess("Documento eliminado correctamente")
    } catch (err) {
      console.error("Error deleting governing document:", err)
      showError("No se pudo eliminar el documento")
    } finally {
      setBusyId(null)
    }
  }

  if (permissionsLoading || loading) {
    return <SiteCorpLoading />
  }

  if (!canView) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Documentos rectores"
          description="Documentos rectores de la entidad"
        />
        <SiteCorpAlert type="info">
          No tiene permiso para ver los documentos rectores de esta entidad.
        </SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Documentos rectores"
        description={`Documentos rectores de ${entityName || "esta entidad"}`}
        actions={
          canManage ? (
            <SiteCorpButton onClick={openDialog}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo documento
            </SiteCorpButton>
          ) : undefined
        }
      />

      <SiteCorpCard title="Documentos registrados">
        {error ? (
          <SiteCorpAlert type="danger" title="Error">
            {error}
          </SiteCorpAlert>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
            <Paperclip className="mb-4 h-12 w-12 text-muted-foreground" />
            <h4 className="mb-1 text-base font-semibold text-ink">
              Esta entidad todavía no tiene documentos rectores.
            </h4>
            <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
              {canManage
                ? "Registre los documentos rectores de la entidad indicando su nombre y el archivo correspondiente."
                : "No se han registrado documentos rectores para esta entidad."}
            </p>
            {canManage && (
              <SiteCorpButton onClick={openDialog}>
                <Plus className="mr-2 h-4 w-4" /> Nuevo documento
              </SiteCorpButton>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const viewable = isViewableDocument(doc.mime_type, doc.file_name)
              const isBusy = busyId === doc.id
              return (
                <div
                  key={doc.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-sitecorp-primary" />
                      <span className="break-all text-sm font-medium text-ink">{doc.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="break-all">Archivo: {doc.file_name}</span>
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>Registrado: {formatDocumentDate(doc.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {viewable && (
                      <SiteCorpButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleOpen(doc)}
                        aria-label="Abrir documento"
                      >
                        <Eye className="h-4 w-4" />
                      </SiteCorpButton>
                    )}
                    <SiteCorpButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleDownload(doc)}
                      aria-label="Descargar documento"
                    >
                      <Download className="h-4 w-4" />
                    </SiteCorpButton>
                    {canManage && (
                      <SiteCorpButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleDelete(doc)}
                        aria-label="Eliminar documento"
                      >
                        <Trash2 className="h-4 w-4" />
                      </SiteCorpButton>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SiteCorpCard>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Nuevo documento</DialogTitle>
            <DialogDescription>
              Registre el nombre del documento rector y seleccione el archivo. Ambos campos son
              obligatorios.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

            <div className="space-y-2">
              <Label htmlFor="governing-document-name">Nombre del documento *</Label>
              <SiteCorpInput
                id="governing-document-name"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="Ej.: Reglamento interno del trabajo"
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="governing-document-file">Documento *</Label>
              <input
                type="file"
                id="governing-document-file"
                accept={DOCUMENT_ACCEPT_ATTR}
                disabled={saving}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-sitecorp-primary file:px-4 file:py-1 file:text-white hover:file:bg-sitecorp-primary-dark"
              />
              <p className="text-xs text-muted-foreground">
                Formatos permitidos: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF (máx. 10 MB).
                El archivo se almacena de forma privada.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              onClick={handleSave}
              disabled={saving || !documentName.trim() || !selectedFile}
            >
              {saving ? "Guardando..." : "Guardar"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default EntitySettingsGoverningDocuments
