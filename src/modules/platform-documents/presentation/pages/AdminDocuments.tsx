import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
  createPlatformDocumentFolder,
  countDocumentsInFolder,
  documentNameFromFileName,
  downloadPlatformDocument,
  filterPlatformDocuments,
  loadPlatformDocumentsWorkspace,
  movePlatformDocument,
  openPlatformDocument,
  removePlatformDocument,
  removePlatformDocumentFolder,
  renamePlatformDocument,
  renamePlatformDocumentFolder,
  uploadPlatformDocument,
  validateDocumentName,
  validateFolderName,
  type PlatformDocument,
  type PlatformDocumentFolder,
} from "@/modules/platform-documents"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpTable } from "@/shared/components/ui/sitecorp-table"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog"
import { showError, showSuccess } from "@/utils/toast"
import {
  DOCUMENT_ACCEPT_ATTR,
  formatDocumentDate,
  formatFileSize,
  isViewableDocument,
} from "@/lib/documents"
import {
  Download,
  Eye,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Inbox,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react"

/**
 * Documentos del Super Admin (alcance GLOBAL de SiteCorp).
 *
 * Organiza los documentos globales en carpetas de UN solo nivel. No tiene relación con los
 * documentos de una entidad, de un trabajador o de un candidato: ni las tablas ni el bucket
 * se comparten.
 *
 * La pantalla no habla con Supabase ni con Storage: pide los datos al módulo
 * (`@/modules/platform-documents`) y valida con las reglas del dominio. La autorización real
 * la aplica RLS en el backend; aquí sólo se evita mostrar una pantalla inútil.
 */

/** Valor centinela: Radix no admite `""` como valor de una opción. */
const NO_FOLDER_VALUE = "__none__"

type FolderFilter = "all" | "none" | string

const AdminDocuments = () => {
  const { isPlatformSuperAdmin } = useAuth()

  const [folders, setFolders] = React.useState<PlatformDocumentFolder[]>([])
  const [documents, setDocuments] = React.useState<PlatformDocument[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [activeFolder, setActiveFolder] = React.useState<FolderFilter>("all")
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // Carpeta: alta y renombrado comparten formulario.
  const [folderDialog, setFolderDialog] = React.useState<{
    open: boolean
    folderId: string | null
    name: string
    saving: boolean
    error: string | null
  }>({ open: false, folderId: null, name: "", saving: false, error: null })

  // Subida de documento.
  const [uploadDialog, setUploadDialog] = React.useState<{
    open: boolean
    name: string
    folderId: string
    file: File | null
    saving: boolean
    error: string | null
  }>({ open: false, name: "", folderId: NO_FOLDER_VALUE, file: null, saving: false, error: null })

  // Renombrado de documento.
  const [renameDialog, setRenameDialog] = React.useState<{
    open: boolean
    document: PlatformDocument | null
    name: string
    saving: boolean
    error: string | null
  }>({ open: false, document: null, name: "", saving: false, error: null })

  // Mover documento de carpeta.
  const [moveDialog, setMoveDialog] = React.useState<{
    open: boolean
    document: PlatformDocument | null
    folderId: string
    saving: boolean
    error: string | null
  }>({ open: false, document: null, folderId: NO_FOLDER_VALUE, saving: false, error: null })

  const [documentToDelete, setDocumentToDelete] = React.useState<PlatformDocument | null>(null)
  const [folderToDelete, setFolderToDelete] = React.useState<PlatformDocumentFolder | null>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const workspace = await loadPlatformDocumentsWorkspace()
      setFolders(workspace.folders)
      setDocuments(workspace.documents)
    } catch (err) {
      console.error("Error loading platform documents:", err)
      setError("No se pudieron cargar los documentos. Inténtalo de nuevo.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!isPlatformSuperAdmin) {
      setLoading(false)
      return
    }
    void reload()
  }, [isPlatformSuperAdmin, reload])

  // Cuando se elimina la carpeta activa, la vista vuelve a "Todos".
  React.useEffect(() => {
    if (activeFolder === "all" || activeFolder === "none") return
    if (!folders.some((folder) => folder.id === activeFolder)) setActiveFolder("all")
  }, [folders, activeFolder])

  const visibleDocuments = React.useMemo(() => {
    const byFolder =
      activeFolder === "all"
        ? documents
        : activeFolder === "none"
          ? documents.filter((document) => !document.folder_id)
          : documents.filter((document) => document.folder_id === activeFolder)

    return filterPlatformDocuments(byFolder, search)
  }, [documents, activeFolder, search])

  const unsortedCount = documents.filter((document) => !document.folder_id).length

  /* --------------------------- Carpetas --------------------------- */

  const openCreateFolder = () => {
    setFolderDialog({ open: true, folderId: null, name: "", saving: false, error: null })
  }

  const openRenameFolder = (folder: PlatformDocumentFolder) => {
    setFolderDialog({
      open: true,
      folderId: folder.id,
      name: folder.name,
      saving: false,
      error: null,
    })
  }

  const saveFolder = async () => {
    const validationError = validateFolderName(folderDialog.name)
    if (validationError) {
      setFolderDialog((state) => ({ ...state, error: validationError }))
      return
    }

    setFolderDialog((state) => ({ ...state, saving: true, error: null }))
    try {
      if (folderDialog.folderId) {
        await renamePlatformDocumentFolder(folderDialog.folderId, folderDialog.name)
        showSuccess("Carpeta renombrada correctamente")
      } else {
        await createPlatformDocumentFolder(folderDialog.name)
        showSuccess("Carpeta creada correctamente")
      }

      setFolderDialog({ open: false, folderId: null, name: "", saving: false, error: null })
      await reload()
    } catch (err) {
      setFolderDialog((state) => ({
        ...state,
        saving: false,
        error: err instanceof Error ? err.message : "No se pudo guardar la carpeta",
      }))
    }
  }

  const confirmDeleteFolder = async () => {
    const folder = folderToDelete
    if (!folder) return

    setBusyId(folder.id)
    try {
      await removePlatformDocumentFolder(folder, countDocumentsInFolder(documents, folder.id))
      setFolderToDelete(null)
      await reload()
      showSuccess("Carpeta eliminada correctamente")
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudo eliminar la carpeta")
    } finally {
      setBusyId(null)
    }
  }

  /* -------------------------- Documentos -------------------------- */

  const openUpload = () => {
    setUploadDialog({
      open: true,
      name: "",
      folderId:
        activeFolder === "all" || activeFolder === "none" ? NO_FOLDER_VALUE : activeFolder,
      file: null,
      saving: false,
      error: null,
    })
  }

  const handleFileSelected = (file: File | null) => {
    setUploadDialog((state) => ({
      ...state,
      file,
      name: state.name || (file ? documentNameFromFileName(file.name) : ""),
      error: null,
    }))
  }

  const saveUpload = async () => {
    const { name, file, folderId } = uploadDialog

    const nameError = validateDocumentName(name)
    if (nameError) {
      setUploadDialog((state) => ({ ...state, error: nameError }))
      return
    }
    if (!file) {
      setUploadDialog((state) => ({ ...state, error: "Selecciona el archivo del documento." }))
      return
    }

    setUploadDialog((state) => ({ ...state, saving: true, error: null }))
    try {
      await uploadPlatformDocument({
        name,
        folderId: folderId === NO_FOLDER_VALUE ? null : folderId,
        file,
      })

      setUploadDialog({
        open: false,
        name: "",
        folderId: NO_FOLDER_VALUE,
        file: null,
        saving: false,
        error: null,
      })
      await reload()
      showSuccess("Documento subido correctamente")
    } catch (err) {
      setUploadDialog((state) => ({
        ...state,
        saving: false,
        error: err instanceof Error ? err.message : "No se pudo subir el documento",
      }))
    }
  }

  const openRenameDocument = (document: PlatformDocument) => {
    setRenameDialog({
      open: true,
      document,
      name: document.name,
      saving: false,
      error: null,
    })
  }

  const saveRenameDocument = async () => {
    const document = renameDialog.document
    if (!document) return

    const validationError = validateDocumentName(renameDialog.name)
    if (validationError) {
      setRenameDialog((state) => ({ ...state, error: validationError }))
      return
    }

    setRenameDialog((state) => ({ ...state, saving: true, error: null }))
    try {
      await renamePlatformDocument(document.id, renameDialog.name)
      setRenameDialog({ open: false, document: null, name: "", saving: false, error: null })
      await reload()
      showSuccess("Documento renombrado correctamente")
    } catch (err) {
      setRenameDialog((state) => ({
        ...state,
        saving: false,
        error: err instanceof Error ? err.message : "No se pudo renombrar el documento",
      }))
    }
  }

  const openMoveDocument = (document: PlatformDocument) => {
    setMoveDialog({
      open: true,
      document,
      folderId: document.folder_id || NO_FOLDER_VALUE,
      saving: false,
      error: null,
    })
  }

  const saveMoveDocument = async () => {
    const document = moveDialog.document
    if (!document) return

    setMoveDialog((state) => ({ ...state, saving: true, error: null }))
    try {
      await movePlatformDocument(
        document.id,
        moveDialog.folderId === NO_FOLDER_VALUE ? null : moveDialog.folderId
      )
      setMoveDialog({
        open: false,
        document: null,
        folderId: NO_FOLDER_VALUE,
        saving: false,
        error: null,
      })
      await reload()
      showSuccess("Documento movido correctamente")
    } catch (err) {
      setMoveDialog((state) => ({
        ...state,
        saving: false,
        error: err instanceof Error ? err.message : "No se pudo mover el documento",
      }))
    }
  }

  const handleOpen = async (document: PlatformDocument) => {
    setBusyId(document.id)
    try {
      const signedUrl = await openPlatformDocument(document)
      window.open(signedUrl, "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error("Error opening platform document:", err)
      showError("No se pudo abrir el documento")
    } finally {
      setBusyId(null)
    }
  }

  const handleDownload = async (document: PlatformDocument) => {
    setBusyId(document.id)
    try {
      const blob = await downloadPlatformDocument(document)
      const url = window.URL.createObjectURL(blob)
      const link = window.document.createElement("a")
      link.href = url
      link.download = document.file_name
      window.document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      window.document.body.removeChild(link)
    } catch (err) {
      console.error("Error downloading platform document:", err)
      showError("No se pudo descargar el documento")
    } finally {
      setBusyId(null)
    }
  }

  const confirmDeleteDocument = async () => {
    const document = documentToDelete
    if (!document) return

    setBusyId(document.id)
    try {
      await removePlatformDocument(document)
      setDocumentToDelete(null)
      await reload()
      showSuccess("Documento eliminado correctamente")
    } catch (err) {
      console.error("Error deleting platform document:", err)
      showError("No se pudo eliminar el documento")
    } finally {
      setBusyId(null)
    }
  }

  /* ------------------------------ Vista --------------------------- */

  if (!isPlatformSuperAdmin) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Documentos"
          description="Documentos globales de SiteCorp"
        />
        <SiteCorpAlert type="warning" title="Acceso restringido">
          Este módulo está reservado a los usuarios autorizados del Super Admin global de
          SiteCorp.
        </SiteCorpAlert>
      </div>
    )
  }

  if (loading) return <SiteCorpLoading />

  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]))

  const rows = visibleDocuments.map((document) => ({
    document: (
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-sitecorp-primary" />
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{document.name}</p>
          <p className="truncate text-xs text-muted-foreground">{document.file_name}</p>
        </div>
      </div>
    ),
    folder: document.folder_id ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sitecorp-primary/10 px-2.5 py-1 text-xs font-medium text-sitecorp-primary">
        <Folder className="h-3.5 w-3.5" />
        {folderNameById.get(document.folder_id) || "Carpeta"}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <Inbox className="h-3.5 w-3.5" />
        Sin carpeta
      </span>
    ),
    size: <span className="text-sm text-muted-foreground">{formatFileSize(document.file_size)}</span>,
    date: (
      <span className="text-sm text-muted-foreground">
        {formatDocumentDate(document.created_at)}
      </span>
    ),
    actions: (
      <div className="flex items-center justify-end gap-1">
        {isViewableDocument(document.mime_type, document.file_name) && (
          <SiteCorpButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={busyId === document.id}
            onClick={() => handleOpen(document)}
            aria-label={`Visualizar ${document.name}`}
          >
            <Eye className="h-4 w-4" />
          </SiteCorpButton>
        )}
        <SiteCorpButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busyId === document.id}
          onClick={() => handleDownload(document)}
          aria-label={`Descargar ${document.name}`}
        >
          <Download className="h-4 w-4" />
        </SiteCorpButton>
        <SiteCorpButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busyId === document.id}
          onClick={() => openRenameDocument(document)}
          aria-label={`Renombrar ${document.name}`}
        >
          <Pencil className="h-4 w-4" />
        </SiteCorpButton>
        <SiteCorpButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busyId === document.id}
          onClick={() => openMoveDocument(document)}
          aria-label={`Mover ${document.name}`}
        >
          <FolderInput className="h-4 w-4" />
        </SiteCorpButton>
        <SiteCorpButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busyId === document.id}
          onClick={() => setDocumentToDelete(document)}
          aria-label={`Eliminar ${document.name}`}
        >
          <Trash2 className="h-4 w-4 text-sitecorp-danger" />
        </SiteCorpButton>
      </div>
    ),
  }))

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Documentos"
        description="Carpetas y documentos globales de SiteCorp"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SiteCorpButton variant="outline" onClick={openCreateFolder}>
              <FolderPlus className="mr-2 h-4 w-4" /> Nueva carpeta
            </SiteCorpButton>
            <SiteCorpButton onClick={openUpload}>
              <Upload className="mr-2 h-4 w-4" /> Subir documento
            </SiteCorpButton>
          </div>
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      )}

      {/* Carpetas: navegación de un solo nivel */}
      <SiteCorpCard title="Carpetas">
        {folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10">
            <FolderPlus className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-ink">Todavía no hay carpetas</p>
            <p className="mt-1 max-w-md text-center text-xs text-muted-foreground">
              Crea una carpeta para organizar los documentos globales. Los documentos que no
              estén en ninguna carpeta seguirán visibles en «Sin carpeta».
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => {
              const count = countDocumentsInFolder(documents, folder.id)
              const active = activeFolder === folder.id
              return (
                <div
                  key={folder.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    active
                      ? "border-sitecorp-primary/40 bg-sitecorp-primary/5"
                      : "border-border bg-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFolder(active ? "all" : folder.id)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="rounded-lg bg-sitecorp-primary/10 p-2 text-sitecorp-primary">
                      <Folder className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {folder.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {count === 1 ? "1 documento" : `${count} documentos`}
                      </span>
                    </span>
                  </button>

                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
                    <SiteCorpButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openRenameFolder(folder)}
                      aria-label={`Renombrar carpeta ${folder.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </SiteCorpButton>
                    <SiteCorpButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={count > 0 || busyId === folder.id}
                      title={
                        count > 0
                          ? "Sólo se pueden eliminar carpetas vacías"
                          : "Eliminar carpeta"
                      }
                      onClick={() => setFolderToDelete(folder)}
                      aria-label={`Eliminar carpeta ${folder.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-sitecorp-danger" />
                    </SiteCorpButton>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SiteCorpCard>

      {/* Documentos */}
      <SiteCorpCard title={activeFolder === "all" ? "Todos los documentos" : "Documentos"}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <SiteCorpInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre"
              className="pl-9"
              aria-label="Buscar documentos por nombre"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveFolder("all")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFolder === "all"
                ? "bg-sitecorp-primary text-white"
                : "bg-muted text-ink hover:bg-muted/70"
            }`}
          >
            Todos ({documents.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveFolder("none")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFolder === "none"
                ? "bg-sitecorp-primary text-white"
                : "bg-muted text-ink hover:bg-muted/70"
            }`}
          >
            Sin carpeta ({unsortedCount})
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setActiveFolder(folder.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFolder === folder.id
                  ? "bg-sitecorp-primary text-white"
                  : "bg-muted text-ink hover:bg-muted/70"
              }`}
            >
              {folder.name}
            </button>
          ))}
          </div>
        </div>

        {visibleDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-ink">
              {search.trim() ? "Ningún documento coincide con la búsqueda" : "No hay documentos aquí"}
            </p>
            <p className="mt-1 max-w-md text-center text-xs text-muted-foreground">
              {search.trim()
                ? "Prueba con otro nombre o limpia la búsqueda."
                : "Sube un documento para empezar a organizar la documentación global."}
            </p>
          </div>
        ) : (
          <SiteCorpTable
            columns={[
              { header: "Documento", accessor: "document" },
              { header: "Carpeta", accessor: "folder" },
              { header: "Tamaño", accessor: "size" },
              { header: "Registrado", accessor: "date" },
              { header: "", accessor: "actions" },
            ]}
            data={rows}
          />
        )}
      </SiteCorpCard>

      {/* Alta / renombrado de carpeta */}
      <Dialog
        open={folderDialog.open}
        onOpenChange={(open) =>
          setFolderDialog((state) => ({ ...state, open, error: open ? state.error : null }))
        }
      >
        <DialogContent className="sm:max-w-[460px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{folderDialog.folderId ? "Renombrar carpeta" : "Nueva carpeta"}</DialogTitle>
            <DialogDescription>
              Las carpetas tienen un solo nivel: no se admiten subcarpetas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {folderDialog.error && <SiteCorpAlert type="danger">{folderDialog.error}</SiteCorpAlert>}
            <SiteCorpInput
              value={folderDialog.name}
              onChange={(event) =>
                setFolderDialog((state) => ({ ...state, name: event.target.value, error: null }))
              }
              placeholder="Ej.: Contratos marco"
              disabled={folderDialog.saving}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setFolderDialog((state) => ({ ...state, open: false }))}
              disabled={folderDialog.saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton type="button" onClick={saveFolder} disabled={folderDialog.saving}>
              {folderDialog.saving ? "Guardando..." : "Guardar"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Subida de documento */}
      <Dialog
        open={uploadDialog.open}
        onOpenChange={(open) =>
          setUploadDialog((state) => ({ ...state, open, error: open ? state.error : null }))
        }
      >
        <DialogContent className="sm:max-w-[520px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Subir documento</DialogTitle>
            <DialogDescription>
              El archivo se guarda en un bucket privado y sólo es accesible desde este módulo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {uploadDialog.error && <SiteCorpAlert type="danger">{uploadDialog.error}</SiteCorpAlert>}

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink" htmlFor="platform-document-name">
                Nombre del documento *
              </label>
              <SiteCorpInput
                id="platform-document-name"
                value={uploadDialog.name}
                onChange={(event) =>
                  setUploadDialog((state) => ({ ...state, name: event.target.value, error: null }))
                }
                placeholder="Ej.: Política de privacidad"
                disabled={uploadDialog.saving}
              />
            </div>

            <SiteCorpSelect
              label="Carpeta"
              value={uploadDialog.folderId}
              onValueChange={(value) =>
                setUploadDialog((state) => ({ ...state, folderId: value }))
              }
              disabled={uploadDialog.saving}
            >
              <option value={NO_FOLDER_VALUE}>Sin carpeta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </SiteCorpSelect>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink" htmlFor="platform-document-file">
                Archivo *
              </label>
              <input
                type="file"
                id="platform-document-file"
                accept={DOCUMENT_ACCEPT_ATTR}
                disabled={uploadDialog.saving}
                onChange={(event) => handleFileSelected(event.target.files?.[0] || null)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-sitecorp-primary file:px-4 file:py-1 file:text-white hover:file:bg-sitecorp-primary-dark"
              />
              <p className="text-xs text-muted-foreground">
                Formatos permitidos: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF (máx. 10 MB).
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setUploadDialog((state) => ({ ...state, open: false }))}
              disabled={uploadDialog.saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              onClick={saveUpload}
              disabled={uploadDialog.saving || !uploadDialog.file}
            >
              {uploadDialog.saving ? "Subiendo..." : "Subir documento"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Renombrar documento */}
      <Dialog
        open={renameDialog.open}
        onOpenChange={(open) =>
          setRenameDialog((state) => ({ ...state, open, error: open ? state.error : null }))
        }
      >
        <DialogContent className="sm:max-w-[460px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Renombrar documento</DialogTitle>
            <DialogDescription>
              Cambia el nombre visible. El archivo original no se modifica.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {renameDialog.error && <SiteCorpAlert type="danger">{renameDialog.error}</SiteCorpAlert>}
            <SiteCorpInput
              value={renameDialog.name}
              onChange={(event) =>
                setRenameDialog((state) => ({ ...state, name: event.target.value, error: null }))
              }
              disabled={renameDialog.saving}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setRenameDialog((state) => ({ ...state, open: false }))}
              disabled={renameDialog.saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton type="button" onClick={saveRenameDocument} disabled={renameDialog.saving}>
              {renameDialog.saving ? "Guardando..." : "Guardar"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mover documento */}
      <Dialog
        open={moveDialog.open}
        onOpenChange={(open) =>
          setMoveDialog((state) => ({ ...state, open, error: open ? state.error : null }))
        }
      >
        <DialogContent className="sm:max-w-[460px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Mover documento</DialogTitle>
            <DialogDescription>
              Elige la carpeta de destino. El archivo no se vuelve a subir.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {moveDialog.error && <SiteCorpAlert type="danger">{moveDialog.error}</SiteCorpAlert>}
            <SiteCorpSelect
              label="Carpeta de destino"
              value={moveDialog.folderId}
              onValueChange={(value) => setMoveDialog((state) => ({ ...state, folderId: value }))}
              disabled={moveDialog.saving}
            >
              <option value={NO_FOLDER_VALUE}>Sin carpeta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </SiteCorpSelect>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setMoveDialog((state) => ({ ...state, open: false }))}
              disabled={moveDialog.saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton type="button" onClick={saveMoveDocument} disabled={moveDialog.saving}>
              {moveDialog.saving ? "Moviendo..." : "Mover"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Eliminar documento */}
      <AlertDialog
        open={!!documentToDelete}
        onOpenChange={(open) => !open && setDocumentToDelete(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará «{documentToDelete?.name}» junto con su archivo almacenado. Esta acción
              no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteDocument()
              }}
              disabled={!!busyId}
              className="bg-sitecorp-danger text-white hover:bg-sitecorp-danger/90"
            >
              {busyId ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Eliminar carpeta */}
      <AlertDialog open={!!folderToDelete} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la carpeta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la carpeta vacía «{folderToDelete?.name}». Los documentos no se borran
              nunca en cascada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteFolder()
              }}
              disabled={!!busyId}
              className="bg-sitecorp-danger text-white hover:bg-sitecorp-danger/90"
            >
              {busyId ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default AdminDocuments
