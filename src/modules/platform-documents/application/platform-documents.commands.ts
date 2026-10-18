import type { PlatformDocument } from "../domain/entities"
import { validateDocumentName, validateFolderName } from "../domain/rules"
import { validateDocumentFile } from "@/lib/documents"
import {
  createPlatformDocumentSignedUrl,
  deletePlatformDocumentFolder,
  deletePlatformDocumentRow,
  downloadPlatformDocumentObject,
  insertPlatformDocumentFolder,
  insertPlatformDocumentRow,
  platformDocumentStoragePath,
  removePlatformDocumentObject,
  updatePlatformDocumentFolder,
  updatePlatformDocumentRow,
  uploadPlatformDocumentObject,
} from "../infrastructure/platform-documents.repository"

/**
 * Documentos del Super Admin — Comandos (aplicación).
 *
 * Cada operación valida en el dominio ANTES de escribir y deja el sistema sin estados
 * intermedios incoherentes:
 *   · si el archivo se sube pero el registro falla, el objeto se retira (sin huérfanos);
 *   · al eliminar, primero se retira el objeto y después el registro;
 *   · mover un documento sólo cambia su carpeta: el archivo no se reescribe.
 *
 * La autorización real la aplica RLS en el backend: aquí no se decide quién puede entrar.
 */

/** ALTA de una carpeta. */
export async function createPlatformDocumentFolder(name: string): Promise<void> {
  const error = validateFolderName(name)
  if (error) throw new Error(error)

  await insertPlatformDocumentFolder(name.trim())
}

/** RENOMBRADO de una carpeta. */
export async function renamePlatformDocumentFolder(
  folderId: string,
  name: string
): Promise<void> {
  const error = validateFolderName(name)
  if (error) throw new Error(error)

  await updatePlatformDocumentFolder(folderId, name.trim())
}

/**
 * ELIMINACIÓN de una carpeta.
 *
 * Sólo se permite si está VACÍA: el módulo nunca borra documentos en cascada. La regla se
 * comprueba también en el backend (FK sin cascada), así que un intento manipulado falla.
 */
export async function removePlatformDocumentFolder(
  folder: { id: string },
  documentsOfFolder: number
): Promise<void> {
  if (documentsOfFolder > 0) {
    throw new Error("La carpeta no está vacía: mueve o elimina sus documentos antes de borrarla.")
  }

  await deletePlatformDocumentFolder(folder.id)
}

export interface UploadPlatformDocumentInput {
  name: string
  folderId: string | null
  file: File
}

/**
 * SUBIDA de un documento: valida nombre y archivo, sube el objeto y registra los metadatos.
 *
 * Si el registro falla, el objeto recién subido se retira.
 */
export async function uploadPlatformDocument(
  input: UploadPlatformDocumentInput
): Promise<void> {
  const nameError = validateDocumentName(input.name)
  if (nameError) throw new Error(nameError)

  const fileError = validateDocumentFile(input.file)
  if (fileError) throw new Error(fileError)

  const documentId = crypto.randomUUID()
  const storagePath = platformDocumentStoragePath(documentId, input.file.name)

  await uploadPlatformDocumentObject(storagePath, input.file)

  try {
    await insertPlatformDocumentRow({
      id: documentId,
      folderId: input.folderId,
      name: input.name.trim(),
      fileName: input.file.name,
      storagePath,
      mimeType: input.file.type || null,
      fileSize: input.file.size,
    })
  } catch (error) {
    await removePlatformDocumentObject(storagePath)
    throw error
  }
}

/** RENOMBRADO del documento (sólo el nombre visible: el archivo no se toca). */
export async function renamePlatformDocument(
  documentId: string,
  name: string
): Promise<void> {
  const error = validateDocumentName(name)
  if (error) throw new Error(error)

  await updatePlatformDocumentRow(documentId, { name: name.trim() })
}

/** MOVER un documento a otra carpeta (o dejarlo sin carpeta con `null`). */
export async function movePlatformDocument(
  documentId: string,
  folderId: string | null
): Promise<void> {
  await updatePlatformDocumentRow(documentId, { folder_id: folderId })
}

/** URL firmada y temporal para visualizar el documento. */
export async function openPlatformDocument(
  document: Pick<PlatformDocument, "storage_path">
): Promise<string> {
  return createPlatformDocumentSignedUrl(document.storage_path)
}

/** Descarga del archivo: devuelve el contenido para que la presentación lo guarde. */
export async function downloadPlatformDocument(
  document: Pick<PlatformDocument, "storage_path">
): Promise<Blob> {
  return downloadPlatformDocumentObject(document.storage_path)
}

/** ELIMINACIÓN del documento: primero el objeto de Storage y después el registro. */
export async function removePlatformDocument(
  document: Pick<PlatformDocument, "id" | "storage_path">
): Promise<void> {
  await removePlatformDocumentObject(document.storage_path)
  await deletePlatformDocumentRow(document.id)
}
