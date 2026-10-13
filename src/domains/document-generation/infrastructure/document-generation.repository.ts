import { supabase } from "@/lib/supabase"
import type {
  GeneratedDocumentRecord,
  GenerationDocumentKind,
  GenerationReservation,
} from "../domain/entities"
import { record, num, text, throwIfError } from "./values"

/**
 * Generación documental — RPC y registro de las generaciones (infraestructura).
 *
 * Único punto que invoca las RPC del ciclo de generación y que lee el expediente
 * (`worker_documents`). Los nombres de las RPC, sus parámetros y sus claves de salida son el
 * CONTRATO del backend y NO cambian: la idempotencia (una sola generación en curso por fuente)
 * y la numeración de generaciones las decide la base de datos.
 */

/**
 * Fija la versión de plantilla en la fuente antes de reservar la generación (§9).
 * Sólo aplica a contrato y anexo: el SC-4-04, la Resolución y el Movimiento de Nómina no fijan
 * versión en su origen (su trazabilidad vive en `worker_documents`).
 */
export const pinTemplateVersionOnSource = async (
  kind: GenerationDocumentKind,
  sourceId: string,
  versionId: string
): Promise<void> => {
  const rpc =
    kind === "CONTRACT" ? "set_contract_document_template_version" : "set_addendum_document_template_version"
  const params =
    kind === "CONTRACT"
      ? { p_contract_id: sourceId, p_version_id: versionId }
      : { p_addendum_id: sourceId, p_version_id: versionId }
  const { error } = await supabase.rpc(rpc, params)
  throwIfError(error)
}

/**
 * Reserva la generación (idempotencia: una sola en curso por fuente) y devuelve la ruta exacta
 * que el backend asigna al documento. Registra la versión de plantilla usada como trazabilidad.
 */
export const beginGeneration = async (
  kind: GenerationDocumentKind,
  sourceId: string,
  versionId: string
): Promise<GenerationReservation> => {
  const { data, error } = kind === "VACATION" || kind === "MEDICAL_CERTIFICATE"
    ? await supabase.rpc("begin_sc404_generation", {
        p_source_type: kind,
        p_source_id: sourceId,
        p_template_version_id: versionId,
      })
    : kind === "RESOLUTION"
      ? await supabase.rpc("begin_resolution_generation", {
          p_resolution_id: sourceId,
          p_template_version_id: versionId,
        })
      : kind === "PAYROLL_MOVEMENT"
        ? await supabase.rpc("begin_payroll_movement_generation", {
            p_movement_id: sourceId,
            p_template_version_id: versionId,
          })
        : await supabase.rpc("begin_document_generation", {
          p_employment_contract_id: kind === "CONTRACT" ? sourceId : null,
          p_contract_addendum_id: kind === "ADDENDUM" ? sourceId : null,
          p_template_version_id: versionId,
        })
  throwIfError(error)
  const row = record(data)
  return {
    worker_document_id: String(row.worker_document_id),
    generation_number: num(row.generation_number) ?? 1,
    storage_path: String(row.storage_path),
  }
}

/** Registra el documento generado con su nombre humano, tamaño y tipo MIME reales. */
export const completeGeneration = async (input: {
  workerDocumentId: string
  fileName: string
  fileSize: number
  mimeType: string
}): Promise<void> => {
  const { error } = await supabase.rpc("complete_document_generation", {
    p_worker_document_id: input.workerDocumentId,
    p_file_name: input.fileName,
    p_file_size: input.fileSize,
    p_mime_type: input.mimeType,
  })
  throwIfError(error)
}

/**
 * Libera la reserva indicando el motivo real del fallo.
 * El resultado se ignora deliberadamente: si fallar falla, prevalece el error original.
 */
export const failGeneration = async (
  workerDocumentId: string,
  reason: string
): Promise<void> => {
  await supabase.rpc("fail_document_generation", {
    p_worker_document_id: workerDocumentId,
    p_reason: reason,
  })
}

/**
 * Documentos generados y completados de un origen (historial, en orden de generación).
 * El aislamiento lo aplican el filtro y, por debajo, RLS.
 */
export const selectGeneratedDocuments = async (source: {
  contractId?: string
  addendumId?: string
  vacationId?: string
  certificateId?: string
  resolutionId?: string
  movementId?: string
}): Promise<GeneratedDocumentRecord[]> => {
  let query = supabase
    .from("worker_documents")
    .select(
      "id, worker_id, file_name, storage_path, file_size, mime_type, generation_number, created_at, document_template_version_id"
    )
    .eq("source", "GENERATED")
    .eq("generation_status", "COMPLETED")
    .order("generation_number", { ascending: true })

  if (source.contractId) {
    query = query.eq("employment_contract_id", source.contractId)
  } else if (source.addendumId) {
    query = query.eq("contract_addendum_id", source.addendumId)
  } else if (source.vacationId) {
    query = query.eq("document_source_type", "VACATION").eq("document_source_id", source.vacationId)
  } else if (source.certificateId) {
    query = query
      .eq("document_source_type", "MEDICAL_CERTIFICATE")
      .eq("document_source_id", source.certificateId)
  } else if (source.resolutionId) {
    query = query.eq("document_source_type", "RESOLUTION").eq("document_source_id", source.resolutionId)
  } else if (source.movementId) {
    query = query
      .eq("document_source_type", "PAYROLL_MOVEMENT")
      .eq("document_source_id", source.movementId)
  }

  const { data, error } = await query
  throwIfError(error)

  return ((data as unknown[]) || []).map((raw) => {
    const row = record(raw)
    return {
      id: String(row.id),
      worker_id: String(row.worker_id),
      file_name: String(row.file_name),
      storage_path: String(row.storage_path),
      file_size: num(row.file_size),
      mime_type: text(row.mime_type),
      generation_number: num(row.generation_number),
      created_at: String(row.created_at),
      document_template_version_id: text(row.document_template_version_id),
    }
  })
}
