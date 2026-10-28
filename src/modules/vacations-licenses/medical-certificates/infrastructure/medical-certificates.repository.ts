import { supabase } from "@/lib/supabase"
import { selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import type {
  EntityMedicalCertificatesResult,
  WorkerMedicalCertificatesResult,
} from "../domain/entities"
import { validateDocumentFile } from "../domain/rules"

/**
 * Certificados Médicos — Infraestructura (adaptador Supabase).
 *
 * Es el ÚNICO punto del dominio con acceso a Supabase (PostgREST, RPC y Storage).
 *
 * Lectura: SIEMPRE por RPC SECURITY DEFINER (list_worker_medical_certificates /
 * list_entity_medical_certificates), que valida can_access_entity con
 * 'medical_certificates.view' | 'medical_certificates.manage'. Una única
 * consulta devuelve histórico + totales; no hay SELECT directo paralelo.
 *
 * Escritura: storage privado + RPC SECURITY DEFINER con validación backend.
 * Las RPC, sus parámetros, los tipos devueltos, la gestión de errores y las
 * operaciones de lectura/escritura se conservan exactamente como estaban antes
 * de la migración: este bloque no modifica SQL, RPC ni RLS.
 */

const rpcError = (error: { message?: string } | null): never => {
  throw new Error(error?.message || "No se pudo completar la operación de certificado médico.")
}

/**
 * Histórico + totales anuales de UN trabajador (una sola consulta RPC).
 * `year` filtra por año de la fecha de salida; null = todos los años.
 */
export async function fetchWorkerMedicalCertificates(
  workerId: string,
  year?: number | null
): Promise<WorkerMedicalCertificatesResult> {
  const { data, error } = await supabase.rpc("list_worker_medical_certificates", {
    p_worker_id: workerId,
    p_year: year ?? null,
  })

  if (error) rpcError(error)
  return data as WorkerMedicalCertificatesResult
}

/**
 * Listado global + KPIs de la entidad (una sola consulta RPC).
 * Devuelve los certificados de los trabajadores de la entidad con nombre,
 * CI y área, además de total_days / count / worker_count del período.
 */
export async function fetchEntityMedicalCertificates(
  entityId: string,
  year?: number | null
): Promise<EntityMedicalCertificatesResult> {
  const { data, error } = await supabase.rpc("list_entity_medical_certificates", {
    p_entity_id: entityId,
    p_year: year ?? null,
  })

  if (error) rpcError(error)
  return data as EntityMedicalCertificatesResult
}

/** Sube el documento a storage privado y lo registra en worker_documents. */
async function uploadCertificateDocument(workerId: string, file: File): Promise<string> {
  validateDocumentFile(file)

  const fileExt = file.name.split(".").pop()?.toLowerCase() || "file"
  const storagePath = `workers/${workerId}/medical-certificates/${crypto.randomUUID()}.${fileExt}`

  const { error: uploadError } = await supabase.storage
    .from("worker_documents")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    })

  if (uploadError) {
    throw new Error(`Error al subir el documento: ${uploadError.message}`)
  }

  const { data: docData, error: docError } = await supabase
    .from("worker_documents")
    .insert({
      worker_id: workerId,
      document_type_id: "CERTIFICATE",
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size,
      storage_path: storagePath,
      source: "MANUAL",
      uploaded_by: (await supabase.auth.getUser()).data.user?.id || null,
    })
    .select("id")
    .single()

  if (docError) {
    await supabase.storage.from("worker_documents").remove([storagePath])
    throw new Error(`Error al registrar el documento: ${docError.message}`)
  }

  return docData.id
}

/**
 * Registra un certificado médico (documento obligatorio + RPC SECURITY DEFINER).
 */
export async function createMedicalCertificate(params: {
  worker_id: string
  start_date: string
  return_date: string
  days: number
  document: File | null
}): Promise<{ certificate_id: string }> {
  if (!params.start_date || !params.return_date || !params.days) {
    throw new Error(
      "La fecha de salida, la fecha de reincorporación y la cantidad de días son obligatorias."
    )
  }
  if (params.return_date <= params.start_date) {
    throw new Error("La fecha de reincorporación debe ser posterior a la fecha de salida.")
  }
  if (params.days < 1) {
    throw new Error("La cantidad de días debe ser un entero positivo (≥1).")
  }
  if (!params.document) {
    throw new Error("Debes adjuntar el certificado médico.")
  }

  const documentId = await uploadCertificateDocument(params.worker_id, params.document)

  // Obtener el cliente propietario y la entidad del trabajador
  const { data: workerData, error: workerError } = await supabase
    .from("workers")
    .select(selectQuery(`${selectColumn("clientId")}, organization_entity_id`))
    .eq("id", params.worker_id)
    .single()

  if (workerError || !workerData) {
    throw new Error("No se pudo obtener la información del trabajador.")
  }

  // Obtener el usuario actual para created_by
  const { data: { user } } = await supabase.auth.getUser()
  const createdBy = user?.id

  const { data, error } = await supabase.rpc("create_worker_medical_certificate", {
    p_tenant_id: workerData.tenant_id,
    p_organization_entity_id: workerData.organization_entity_id,
    p_worker_id: params.worker_id,
    p_start_date: params.start_date,
    p_return_date: params.return_date,
    p_days: params.days,
    p_document_id: documentId,
    p_created_by: createdBy,
  })

  if (error) rpcError(error)
  return data as { certificate_id: string }
}

/** Actualiza un certificado médico existente (fecha/días o documento). */
export async function updateMedicalCertificate(params: {
  certificate_id: string
  start_date?: string
  return_date?: string
  days?: number
  document?: File | null
}): Promise<void> {
  let documentId: string | null = null
  if (params.document) {
    const { data: certData } = await supabase
      .from("worker_medical_certificates")
      .select("worker_id")
      .eq("id", params.certificate_id)
      .single()

    if (!certData?.worker_id) {
      throw new Error("No se pudo determinar el trabajador del certificado.")
    }

    documentId = await uploadCertificateDocument(certData.worker_id, params.document)
  }

  const { error } = await supabase.rpc("update_worker_medical_certificate", {
    p_certificate_id: params.certificate_id,
    p_start_date: params.start_date || null,
    p_return_date: params.return_date || null,
    p_days: params.days || null,
    p_document_id: documentId,
  })

  if (error) rpcError(error)
}

/** Genera una signed URL de acceso al documento (solo bajo demanda del usuario). */
export async function getCertificateSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("worker_documents")
    .createSignedUrl(storagePath, 3600)

  if (error) {
    console.error("Error generating signed URL:", error)
    return null
  }
  return data?.signedUrl ?? null
}
