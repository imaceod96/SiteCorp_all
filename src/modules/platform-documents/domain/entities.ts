/**
 * Documentos del Super Admin — Entidades de dominio.
 *
 * Este módulo gestiona los documentos GLOBALES de SiteCorp (carpetas de un solo nivel).
 * No tiene nada que ver con los documentos de una entidad, de un trabajador o de un
 * candidato: no comparte tabla ni bucket con ellos.
 */

/** Carpeta de primer nivel. Las subcarpetas no existen todavía. */
export interface PlatformDocumentFolder {
  id: string
  name: string
  created_at: string
  updated_at: string
}

/** Documento global: metadatos del registro; el archivo vive en Storage. */
export interface PlatformDocument {
  id: string
  /** Carpeta a la que pertenece, o `null` si todavía no está clasificado. */
  folder_id: string | null
  name: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  created_at: string
  updated_at: string
}

/** Carga completa de la pantalla: carpetas y documentos globales. */
export interface PlatformDocumentsWorkspace {
  folders: PlatformDocumentFolder[]
  documents: PlatformDocument[]
}
