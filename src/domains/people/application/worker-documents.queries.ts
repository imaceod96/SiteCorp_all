import {
  fetchContractReferences,
  fetchDocumentTypeOptions,
  fetchUploaderDisplayNames,
  fetchWorkerDocumentRows,
} from "../infrastructure/worker-expediente.repository"
import type { WorkerDocumentsView } from "../domain/entities"

/**
 * Personas — Casos de uso de lectura del expediente documental del TRABAJADOR (aplicación).
 *
 * La pestaña «Documentos» recibe en una sola lectura el catálogo de tipos, los documentos del
 * trabajador y los dos adornos que necesita para pintar (autor y contrato referenciado).
 *
 * Política de errores, idéntica a la que ya tenía la pantalla:
 *   · Las lecturas que determinan lo que se ve (tipos y documentos) PROPAGAN el error.
 *   · Las auxiliares (autor y contrato) son tolerantes: su fallo no vacía el expediente.
 */

export async function loadWorkerDocumentsView(workerId: string): Promise<WorkerDocumentsView> {
  const [documentTypes, documents] = await Promise.all([
    fetchDocumentTypeOptions(),
    fetchWorkerDocumentRows(workerId),
  ])

  const [uploaderNames, contractsById] = await Promise.all([
    fetchUploaderDisplayNames(
      documents.map((document) => document.uploaded_by).filter((id): id is string => !!id)
    ),
    fetchContractReferences(
      documents
        .map((document) => document.employment_contract_id)
        .filter((id): id is string => !!id)
    ),
  ])

  return { documentTypes, documents, uploaderNames, contractsById }
}
