import type { GoverningDocument, SaveGoverningDocumentInput } from "../domain/entities"
import {
  createGoverningDocumentSignedUrl,
  deleteGoverningDocumentRow,
  downloadGoverningDocumentObject,
  governingDocumentStoragePath,
  insertGoverningDocumentRow,
  removeGoverningDocumentObject,
  uploadGoverningDocumentObject,
} from "../infrastructure/governing-documents.repository"

/**
 * Estructura organizativa — Comandos de los documentos rectores (aplicación).
 *
 * Alta, apertura, descarga y borrado con los MISMOS efectos que la pantalla original:
 *   · el identificador del documento y la ruta de Storage se generan igual;
 *   · si el registro no se puede crear, el archivo subido se retira (sin huérfanos);
 *   · el borrado retira primero el objeto y después el registro.
 *
 * La validación del nombre y del archivo —y los permisos— siguen siendo los mismos: la
 * pantalla valida con la utilidad compartida del sistema documental y el backend autoriza.
 */

/**
 * ALTA de un documento rector: sube el archivo y registra sus metadatos.
 *
 * Propaga el error del backend. Si falla el registro, limpia el objeto recién subido para no
 * dejar archivos huérfanos.
 */
export async function saveGoverningDocument(input: SaveGoverningDocumentInput): Promise<void> {
  const documentId = crypto.randomUUID()
  const storagePath = governingDocumentStoragePath(
    input.entityId,
    documentId,
    input.file.name
  )

  await uploadGoverningDocumentObject(storagePath, input.file)

  try {
    await insertGoverningDocumentRow({
      id: documentId,
      companyClientId: input.companyClientId,
      entityId: input.entityId,
      name: input.name.trim(),
      fileName: input.file.name,
      storagePath,
      mimeType: input.file.type || null,
      fileSize: input.file.size,
      createdBy: input.createdBy,
    })
  } catch (error) {
    await removeGoverningDocumentObject(storagePath)
    throw error
  }
}

/** URL firmada y temporal para abrir el documento (la abre la presentación). */
export async function openGoverningDocument(
  document: Pick<GoverningDocument, "storage_path">
): Promise<string> {
  return createGoverningDocumentSignedUrl(document.storage_path)
}

/** Descarga del archivo: devuelve el contenido para que la presentación lo guarde. */
export async function downloadGoverningDocument(
  document: Pick<GoverningDocument, "storage_path">
): Promise<Blob> {
  return downloadGoverningDocumentObject(document.storage_path)
}

/** ELIMINACIÓN del documento: primero el objeto de Storage y después el registro. */
export async function removeGoverningDocument(
  document: Pick<GoverningDocument, "id" | "storage_path">
): Promise<void> {
  await removeGoverningDocumentObject(document.storage_path)
  await deleteGoverningDocumentRow(document.id)
}
