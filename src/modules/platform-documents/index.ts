/**
 * Documentos del Super Admin — API pública del módulo.
 *
 *   domain/          → entidades y reglas puras (nombres, filtros, carpeta vacía)
 *   infrastructure/  → único acceso a las tablas y al bucket privado
 *   application/     → casos de uso de lectura y comandos
 *   presentation/    → pantalla del Super Admin global
 *
 * No comparte tablas ni bucket con los documentos de entidades, trabajadores o candidatos.
 */

export type {
  PlatformDocument,
  PlatformDocumentFolder,
  PlatformDocumentsWorkspace,
} from "./domain/entities"

export {
  DOCUMENT_NAME_MAX_LENGTH,
  FOLDER_NAME_MAX_LENGTH,
  canDeleteFolder,
  countDocumentsInFolder,
  documentNameFromFileName,
  filterPlatformDocuments,
  folderOfDocument,
  unsortedDocuments,
  validateDocumentName,
  validateFolderName,
} from "./domain/rules"

export { loadPlatformDocumentsWorkspace } from "./application/platform-documents.queries"

export type { UploadPlatformDocumentInput } from "./application/platform-documents.commands"
export {
  createPlatformDocumentFolder,
  downloadPlatformDocument,
  movePlatformDocument,
  openPlatformDocument,
  removePlatformDocument,
  removePlatformDocumentFolder,
  renamePlatformDocument,
  renamePlatformDocumentFolder,
  uploadPlatformDocument,
} from "./application/platform-documents.commands"
