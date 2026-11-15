import { supabase } from "@/lib/supabase"
import { WORKER_DOCUMENTS_BUCKET } from "../domain/entities"
import type { BatchStatus, PendingBatch, PendingBatchItem } from "../domain/entities"
import { record, text } from "./values"

/**
 * Generación documental — LOTES de descarga (infraestructura).
 *
 * Los documentos individuales SIEMPRE viven en el expediente del trabajador
 * (`worker_documents`). Los lotes (`document_batches`) son únicamente agrupaciones para
 * descarga: un ZIP = una entidad + un event_id + un tipo documental.
 *
 * El aislamiento por entidad lo aplica RLS, igual que en el resto del sistema.
 */

/** Lotes documentales visibles dentro del scope de la entidad activa (y RLS). */
export const selectPendingBatches = async (entityId?: string): Promise<PendingBatch[]> => {
  let query = supabase
    .from("document_batches")
    .select(
      `id, event_id, organization_entity_id, document_type_code, label, status,
       expected_count, generated_count, failed_count, zip_path, zip_file_name, created_at,
       event:document_generation_events(effective_date, description),
       entity:organization_entities(name)`
    )

  if (entityId) {
    query = query.eq("organization_entity_id", entityId)
  }

  const { data, error } = await query.order("created_at", { ascending: false })
  if (error) throw error

  return ((data as unknown[]) || []).map((raw) => {
    const row = record(raw)
    const event = record(row.event)
    const entity = record(row.entity)
    return {
      id: String(row.id),
      event_id: String(row.event_id),
      organization_entity_id: String(row.organization_entity_id),
      entity_name: text(entity.name),
      document_type_code: String(row.document_type_code),
      document_type_label: text(row.label) ?? String(row.document_type_code),
      label: text(row.label),
      status: (text(row.status) as BatchStatus) || "GENERATING",
      expected_count: Number(row.expected_count) || 0,
      generated_count: Number(row.generated_count) || 0,
      failed_count: Number(row.failed_count) || 0,
      zip_path: text(row.zip_path),
      zip_file_name: text(row.zip_file_name),
      effective_date: text(event.effective_date),
      created_at: String(row.created_at),
    }
  })
}

/** Detalle de un lote: cada trabajador/documento con su estado, validando la entidad si se indica. */
export const selectBatchItems = async (
  batchId: string,
  entityId?: string
): Promise<PendingBatchItem[]> => {
  let query = supabase
    .from("document_batch_items")
    .select(
      entityId
        ? "id, worker_id, worker_document_id, worker_name, status, error, batch:document_batches!inner(organization_entity_id)"
        : "id, worker_id, worker_document_id, worker_name, status, error"
    )
    .eq("batch_id", batchId)

  if (entityId) {
    query = query.eq("batch.organization_entity_id", entityId)
  }

  const { data, error } = await query.order("worker_name", { ascending: true })
  if (error) throw error
  return ((data as unknown[]) || []).map((raw) => {
    const row = record(raw)
    return {
      id: String(row.id),
      worker_id: String(row.worker_id),
      worker_document_id: text(row.worker_document_id),
      worker_name: text(row.worker_name),
      status: (text(row.status) as "GENERATED" | "ERROR") || "ERROR",
      error: text(row.error),
    }
  })
}

/** Movimientos de nómina de un evento que aún no tienen documento generado (acotados a la entidad si se indica). */
export const selectUngeneratedEventMovements = async (
  eventId: string,
  entityId?: string
): Promise<{ id: string; worker_id: string }[]> => {
  let query = supabase
    .from("worker_payroll_movements")
    .select("id, worker_id, worker_document_id, status")
    .eq("event_id", eventId)
    .or("worker_document_id.is.null,status.neq.GENERATED")

  if (entityId) {
    query = query.eq("organization_entity_id", entityId)
  }

  const { data, error } = await query
  if (error) throw error
  return ((data as unknown[]) || []).map((raw) => {
    const row = record(raw)
    return { id: String(row.id), worker_id: String(row.worker_id) }
  })
}

/** Reconstruye los lotes del evento (el backend aplica la regla > 5 por entidad y tipo). */
export const rpcCreateDocumentBatchesForEvent = async (
  eventId: string,
  entityId?: string
): Promise<number> => {
  const { data, error } = await supabase.rpc(
    "create_document_batches_for_event",
    entityId ? { p_event_id: eventId, p_entity_id: entityId } : { p_event_id: eventId }
  )
  if (error) throw error
  return Number(record(data).batches) || 0
}

/** Empaqueta el ZIP del lote en el backend (Edge Function) y devuelve su registro. */
export const invokeGenerateBatchZip = async (
  batchId: string
): Promise<{ zip_path: string; zip_file_name: string }> => {
  const { data, error } = await supabase.functions.invoke("generate-document-batch-zip", {
    body: { batch_id: batchId },
  })
  if (error) throw error
  const row = record(data)
  if (row.error) throw new Error(String(row.error))
  return { zip_path: String(row.zip_path), zip_file_name: String(row.zip_file_name) }
}

/** Enlace temporal (10 min) para descargar un ZIP privado. */
export const createBatchZipSignedUrl = async (zipPath: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from(WORKER_DOCUMENTS_BUCKET)
    .createSignedUrl(zipPath, 600)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
