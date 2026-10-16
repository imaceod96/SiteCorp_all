import * as React from "react"
import {
  deleteWorkerDocument,
  downloadWorkerDocument,
  loadWorkerDocumentsView,
  openWorkerDocument,
  uploadWorkerDocument,
  type DocumentTypeOption,
  type WorkerDocumentContractRef,
  type WorkerDocumentRow,
} from "@/modules/people"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Download, Eye, FileText, Paperclip, Trash2, Upload } from "lucide-react"
import { showError, showSuccess } from "@/utils/toast"
import {
  DOCUMENT_ACCEPT_ATTR,
  formatDocumentDate,
  formatFileSize,
  isViewableDocument,
  validateDocumentFile,
} from "@/lib/documents"

interface WorkerDocumentsTabProps {
  workerId: string
  canManage: boolean
}

/**
 * Pestaña «Documentos» del expediente del trabajador.
 *
 * La pantalla no compone ninguna consulta: pide el expediente documental al caso de uso del
 * dominio Personas (`loadWorkerDocumentsView`) y las escrituras a sus comandos. El catálogo
 * de tipos, los documentos, el autor y el contrato referenciado llegan ya resueltos, y el
 * archivo se sirve con enlace temporal firmado.
 */
export const WorkerDocumentsTab: React.FC<WorkerDocumentsTabProps> = ({ workerId, canManage }) => {
  const [documentTypes, setDocumentTypes] = React.useState<DocumentTypeOption[]>([])
  const [documents, setDocuments] = React.useState<WorkerDocumentRow[]>([])
  const [uploaderNames, setUploaderNames] = React.useState<Record<string, string>>({})
  const [contractsById, setContractsById] = React.useState<Record<string, WorkerDocumentContractRef>>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [selectedType, setSelectedType] = React.useState("")
  const [description, setDescription] = React.useState("")

  const loadDocuments = React.useCallback(async () => {
    if (!workerId) return
    setLoading(true)
    setError(null)
    try {
      const view = await loadWorkerDocumentsView(workerId)
      setDocumentTypes(view.documentTypes)
      setDocuments(view.documents)
      setUploaderNames(view.uploaderNames)
      setContractsById(view.contractsById)
    } catch (err) {
      console.error("Error loading worker documents:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los documentos")
    } finally {
      setLoading(false)
    }
  }, [workerId])

  React.useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const typeName = (id: string) => documentTypes.find((t) => t.id === id)?.name || "—"

  const openUploadDialog = () => {
    setUploadError(null)
    setSelectedFile(null)
    setSelectedType("")
    setDescription("")
    setUploadDialogOpen(true)
  }

  const handleUpload = async () => {
    if (!selectedFile || !selectedType) return

    const validationError = validateDocumentFile(selectedFile)
    if (validationError) {
      setUploadError(validationError)
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      // Subida + registro en una sola operación del dominio (con limpieza del archivo si
      // fallara el registro, para no dejar huérfanos).
      await uploadWorkerDocument({
        workerId,
        documentTypeId: selectedType,
        file: selectedFile,
        description: description.trim() || null,
      })

      setUploadDialogOpen(false)
      setSelectedFile(null)
      setSelectedType("")
      setDescription("")
      await loadDocuments()
      showSuccess("Documento subido correctamente")
    } catch (err) {
      console.error("Error uploading worker document:", err)
      setUploadError(err instanceof Error ? err.message : "Error al subir el documento")
    } finally {
      setUploading(false)
    }
  }

  const handleView = async (doc: WorkerDocumentRow) => {
    setBusyId(doc.id)
    try {
      await openWorkerDocument(doc.storage_path)
    } catch (err) {
      console.error("Error viewing document:", err)
      showError("No se pudo abrir el documento")
    } finally {
      setBusyId(null)
    }
  }

  const handleDownload = async (doc: WorkerDocumentRow) => {
    setBusyId(doc.id)
    try {
      await downloadWorkerDocument({ storagePath: doc.storage_path, fileName: doc.file_name })
    } catch (err) {
      console.error("Error downloading document:", err)
      showError("No se pudo descargar el documento")
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (doc: WorkerDocumentRow) => {
    if (!confirm("¿Está seguro de que desea eliminar este documento? Esta acción no se puede deshacer.")) {
      return
    }
    setBusyId(doc.id)
    try {
      await deleteWorkerDocument(doc)
      await loadDocuments()
      showSuccess("Documento eliminado correctamente")
    } catch (err) {
      console.error("Error deleting worker document:", err)
      showError("No se pudo eliminar el documento")
    } finally {
      setBusyId(null)
    }
  }

  const uploaderLabel = (id: string | null) => {
    if (!id) return "—"
    return uploaderNames[id] || "—"
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Documentos</h3>
          <p className="text-sm text-muted-foreground">
            Expediente documental del trabajador
            {!loading && documents.length > 0 ? ` · ${documents.length} documento(s)` : ""}
          </p>
        </div>
        {canManage && (
          <SiteCorpButton type="button" onClick={openUploadDialog}>
            <Upload className="mr-2 h-4 w-4" /> Añadir documento
          </SiteCorpButton>
        )}
      </div>

      {loading ? (
        <SiteCorpAlert type="info">Cargando documentos...</SiteCorpAlert>
      ) : error ? (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
          <Paperclip className="mb-4 h-12 w-12 text-muted-foreground" />
          <h4 className="mb-1 text-base font-semibold text-ink">
            Este trabajador todavía no tiene documentos.
          </h4>
          <p className="mb-4 text-sm text-muted-foreground text-center max-w-md">
            {canManage
              ? "Añada documentos al expediente de este trabajador."
              : "No se han subido documentos para este trabajador."}
          </p>
          {canManage && (
            <SiteCorpButton type="button" onClick={openUploadDialog}>
              <Upload className="mr-2 h-4 w-4" /> Añadir documento
            </SiteCorpButton>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const viewable = isViewableDocument(doc.mime_type, doc.file_name)
            const contract = doc.employment_contract_id
              ? contractsById[doc.employment_contract_id]
              : null
            const isBusy = busyId === doc.id
            return (
              <SiteCorpCard key={doc.id}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="break-all font-medium text-ink">{doc.file_name}</span>
                      {doc.source === "GENERATED" && (
                        <SiteCorpStatusBadge status="info">Generado</SiteCorpStatusBadge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Tipo: {typeName(doc.document_type_id)}</span>
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>Subido: {formatDocumentDate(doc.created_at)}</span>
                      <span>Por: {uploaderLabel(doc.uploaded_by)}</span>
                    </div>
                    {doc.description && <p className="text-sm text-ink">{doc.description}</p>}
                    {contract && (
                      <p className="text-xs text-muted-foreground">
                        Contrato: {contract.contract_type?.name || "Contrato laboral"} · Inicio:{" "}
                        {formatDocumentDate(contract.start_date)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {viewable && (
                      <SiteCorpButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleView(doc)}
                        aria-label="Ver documento"
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
              </SiteCorpCard>
            )
          })}
        </div>
      )}

      {/* Diálogo de carga */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Añadir documento</DialogTitle>
            <DialogDescription>
              Seleccione el tipo de documento y cargue el archivo al expediente del trabajador.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {uploadError && <SiteCorpAlert type="danger">{uploadError}</SiteCorpAlert>}

            <div className="space-y-2">
              <Label>Tipo de documento *</Label>
              <SiteCorpSelect value={selectedType} onValueChange={setSelectedType}>
                <option value="">Seleccione un tipo</option>
                {documentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="worker-doc-file">Archivo *</Label>
              <input
                type="file"
                id="worker-doc-file"
                accept={DOCUMENT_ACCEPT_ATTR}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-sitecorp-primary file:px-4 file:py-1 file:text-white hover:file:bg-sitecorp-primary-dark"
              />
              <p className="text-xs text-muted-foreground">
                Formatos permitidos: PDF, DOC, DOCX, JPG, JPEG, PNG (máx. 10 MB).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="worker-doc-description">Descripción (opcional)</Label>
              <SiteCorpInput
                id="worker-doc-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción del documento"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setUploadDialogOpen(false)}
              disabled={uploading}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              onClick={handleUpload}
              disabled={uploading || !selectedFile || !selectedType}
            >
              {uploading ? "Subiendo..." : "Subir documento"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WorkerDocumentsTab
