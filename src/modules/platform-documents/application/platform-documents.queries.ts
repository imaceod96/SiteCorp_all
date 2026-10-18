import {
  selectPlatformDocumentFolders,
  selectPlatformDocuments,
} from "../infrastructure/platform-documents.repository"
import type { PlatformDocumentsWorkspace } from "../domain/entities"

/**
 * Documentos del Super Admin — Casos de uso de lectura (aplicación).
 *
 * La pantalla pide aquí lo que necesita y recibe los datos ya compuestos: no compone
 * consultas ni conoce las tablas.
 */

/**
 * Carpetas y documentos globales en una sola carga.
 *
 * Un documento sin carpeta (`folder_id` nulo) es un documento VÁLIDO: el módulo lo muestra
 * aparte, nunca lo oculta ni lo borra.
 */
export async function loadPlatformDocumentsWorkspace(): Promise<PlatformDocumentsWorkspace> {
  const [folders, documents] = await Promise.all([
    selectPlatformDocumentFolders(),
    selectPlatformDocuments(),
  ])

  return { folders, documents }
}
