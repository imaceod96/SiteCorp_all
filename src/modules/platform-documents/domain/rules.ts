import type { PlatformDocument, PlatformDocumentFolder } from "./entities"

/**
 * Documentos del Super Admin — Reglas de dominio (puras).
 *
 * No consultan Supabase ni conocen el formulario: validan nombres, filtran y describen.
 * La validación del ARCHIVO (formato y tamaño) se reutiliza del sistema documental
 * compartido (`@/lib/documents`): no se duplica aquí.
 */

export const FOLDER_NAME_MAX_LENGTH = 80
export const DOCUMENT_NAME_MAX_LENGTH = 120

/** Nombre de carpeta válido, o el mensaje que explica por qué no lo es. */
export function validateFolderName(name: string): string | null {
  const value = name.trim()
  if (!value) return "El nombre de la carpeta es obligatorio."
  if (value.length > FOLDER_NAME_MAX_LENGTH) {
    return `El nombre de la carpeta no puede superar ${FOLDER_NAME_MAX_LENGTH} caracteres.`
  }
  return null
}

/** Nombre visible del documento válido, o el mensaje que explica por qué no lo es. */
export function validateDocumentName(name: string): string | null {
  const value = name.trim()
  if (!value) return "El nombre del documento es obligatorio."
  if (value.length > DOCUMENT_NAME_MAX_LENGTH) {
    return `El nombre del documento no puede superar ${DOCUMENT_NAME_MAX_LENGTH} caracteres.`
  }
  return null
}

/** Nombre de archivo sin extensión, útil para proponer el nombre del documento. */
export function documentNameFromFileName(fileName: string): string {
  const index = fileName.lastIndexOf(".")
  const base = index > 0 ? fileName.slice(0, index) : fileName
  return base.trim() || fileName
}

/** Búsqueda por nombre de documento (y nombre de archivo), sin distinguir mayúsculas. */
export function filterPlatformDocuments(
  documents: PlatformDocument[],
  query: string
): PlatformDocument[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return documents
  return documents.filter(
    (document) =>
      document.name.toLowerCase().includes(needle) ||
      document.file_name.toLowerCase().includes(needle)
  )
}

/** Número de documentos que hay en una carpeta. */
export function countDocumentsInFolder(
  documents: PlatformDocument[],
  folderId: string
): number {
  return documents.filter((document) => document.folder_id === folderId).length
}

/** Documentos que todavía no pertenecen a ninguna carpeta. */
export function unsortedDocuments(documents: PlatformDocument[]): PlatformDocument[] {
  return documents.filter((document) => !document.folder_id)
}

/** Carpeta de un documento, o `null` si no está clasificado. */
export function folderOfDocument(
  document: PlatformDocument,
  folders: PlatformDocumentFolder[]
): PlatformDocumentFolder | null {
  if (!document.folder_id) return null
  return folders.find((folder) => folder.id === document.folder_id) || null
}

/**
 * Una carpeta sólo se puede eliminar si está VACÍA (regla del módulo: no se borra en
 * cascada ningún documento y las subcarpetas todavía no existen).
 */
export function canDeleteFolder(
  documents: PlatformDocument[],
  folderId: string
): boolean {
  return countDocumentsInFolder(documents, folderId) === 0
}
