import type { GoverningDocumentsWorkspace } from "../domain/entities"
import {
  selectGoverningDocumentEntity,
  selectGoverningDocuments,
} from "../infrastructure/governing-documents.repository"

/**
 * Estructura organizativa — Casos de uso de los documentos rectores (aplicación).
 *
 * La pantalla de ajustes de la entidad pide aquí lo que necesita y recibe los datos ya
 * compuestos (entidad + documentos): no compone consultas ni conoce el bucket ni la tabla.
 *
 * La autorización NO se decide aquí: la pantalla sigue consultando sus permisos internos
 * (`organization.view` / `organization.manage`) y las políticas de la tabla y del bucket
 * siguen siendo la autoridad.
 */
export async function loadGoverningDocuments(
  entityId: string
): Promise<GoverningDocumentsWorkspace> {
  const [entity, documents] = await Promise.all([
    selectGoverningDocumentEntity(entityId),
    selectGoverningDocuments(entityId),
  ])

  return {
    entity: {
      name: entity?.name || "",
      companyClientId: entity?.tenant_id ?? null,
    },
    documents,
  }
}
