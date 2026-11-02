import { supabase } from "@/lib/supabase"
import { saveCandidateDrivingLicenseIds } from "./catalogs.repository"
import { columnName, selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import {
  notifyCandidatesChanged,
  saveCandidateAreaMeta,
  saveCandidateEntitiesMeta,
} from "./candidate-pool-meta"
import type { PersonIdentificationStatus } from "../domain/entities"

/**
 * Personas — Repositorio del alta de candidatos (infraestructura).
 *
 * Escritura: comprobación de identidad en el backend, inserción de la fila de
 * candidato, licencias de conducción y documentos verificadores en el Storage privado.
 *
 * Nombres de RPC, parámetros, consultas, rutas de Storage, tratamiento de errores y
 * firmas son EXACTAMENTE los que ya usaba el formulario de candidatos: es un traslado
 * estructural, no un cambio de comportamiento.
 */

/** Ruta de Storage del documento de un candidato (carpeta del propio candidato). */
const candidateDocumentPath = (candidateId: string, documentTypeId: string, fileName: string): string => {
  const fileExt = fileName.split(".").pop() || "pdf"
  return `candidates/${candidateId}/${documentTypeId}_${Date.now()}.${fileExt}`
}

/**
 * Estado de identificación de la persona en el cliente. La comprobación se resuelve en
 * el backend (misma autoridad que RLS) y también está protegida por constraints y
 * triggers, de modo que el frontend no decide por su cuenta.
 */
export async function fetchPersonIdentificationStatus(
  entityId: string,
  identification: string
): Promise<PersonIdentificationStatus> {
  const { data, error } = await supabase.rpc("person_identification_status", {
    p_entity_id: entityId,
    p_identification: identification,
  })
  if (error) throw error
  return (data || {}) as PersonIdentificationStatus
}

/** Fila de `candidates` a insertar (ya normalizada por el caso de uso). */
export interface NewCandidateRecord {
  companyClientId: string | null | undefined
  entityId: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  birth_date: string | null
  gender_id: string | null
  marital_status_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  municipality: string | null
  province: string | null
  education_level_id: string | null
  specialty: string | null
  area_id?: string | null
  unassignedInPool?: boolean
  has_masters_degree: boolean
  has_doctorate_degree: boolean
  profession_or_trade: string | null
  skin_color_id: string | null
  political_affiliation: string | null
  is_retired_or_rehired: boolean
  has_disciplinary_measures: boolean
}

/** Inserta el candidato y devuelve su identificador (UUID conservado, sin duplicar). */
export async function insertCandidate(record: NewCandidateRecord): Promise<string> {
  let resolvedClientId = record.companyClientId
  if (!resolvedClientId && record.entityId) {
    const { data: entRow } = await supabase
      .from("organization_entities")
      .select(selectQuery(`id, ${selectColumn("clientId")}`))
      .eq("id", record.entityId)
      .maybeSingle()
    resolvedClientId = (entRow as { tenant_id?: string | null } | null)?.tenant_id ?? null
  }

  const payload: Record<string, unknown> = {
    [columnName("clientId")]: resolvedClientId,
    organization_entity_id: record.entityId,
    first_name: record.first_name,
    first_surname: record.first_surname,
    second_surname: record.second_surname,
    identification: record.identification,
    birth_date: record.birth_date,
    gender_id: record.gender_id,
    marital_status_id: record.marital_status_id,
    phone: record.phone,
    email: record.email,
    address: record.address,
    municipality: record.municipality,
    province: record.province,
    education_level_id: record.education_level_id,
    specialty: record.specialty,
    has_masters_degree: record.has_masters_degree,
    has_doctorate_degree: record.has_doctorate_degree,
    profession_or_trade: record.profession_or_trade,
    skin_color_id: record.skin_color_id,
    political_affiliation: record.political_affiliation,
    is_retired_or_rehired: record.is_retired_or_rehired,
    has_disciplinary_measures: record.has_disciplinary_measures,
    status: "active" as const,
  }

  const { data, error } = await supabase.from("candidates").insert(payload).select("id").single()
  if (error) throw error
  const candidateId = (data as { id: string }).id

  if (record.area_id) {
    await saveCandidateAreaMeta(candidateId, record.entityId, record.area_id)
  }

  if (record.unassignedInPool) {
    await saveCandidateEntitiesMeta(candidateId, record.entityId, [])
  }

  notifyCandidatesChanged()
  return candidateId
}

/** Reemplazo exacto (atómico, en el backend) de las licencias de conducción. */
export async function saveCandidateLicenses(
  candidateId: string,
  categoryIds: string[]
): Promise<void> {
  await saveCandidateDrivingLicenseIds(candidateId, categoryIds)
}

/**
 * Sube un documento verificador (Chequeo Preempleo / Antecedentes Penales) al Storage
 * privado y lo registra en `candidate_documents`. Se invoca DESPUÉS de crear el
 * candidato, cuando ya existe `candidate_id` (nunca un documento huérfano).
 */
export async function uploadCandidateVerificationDocument(
  candidateId: string,
  documentTypeId: string,
  file: File,
  description: string
): Promise<void> {
  const storagePath = candidateDocumentPath(candidateId, documentTypeId, file.name)

  const { error: uploadError } = await supabase.storage.from("documents").upload(storagePath, file)
  if (uploadError) throw uploadError

  const { error: docError } = await supabase.from("candidate_documents").insert({
    candidate_id: candidateId,
    document_type_id: documentTypeId,
    original_file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    description,
    uploaded_by: (await supabase.auth.getUser()).data.user?.id,
  })
  if (docError) throw docError
}

/** Documento disciplinario adjuntado durante el alta del candidato. */
export async function uploadCandidateDisciplinaryDocument(
  candidateId: string,
  file: File
): Promise<void> {
  const storagePath = candidateDocumentPath(candidateId, "disciplinary", file.name)

  const { error: uploadError } = await supabase.storage.from("documents").upload(storagePath, file)
  if (uploadError) throw uploadError

  const { error: docError } = await supabase.from("candidate_documents").insert({
    candidate_id: candidateId,
    document_type_id: "DISCIPLINARY_DOCUMENT",
    original_file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    description: "Documento disciplinario subido durante la creación del candidato",
    uploaded_by: (await supabase.auth.getUser()).data.user?.id,
  })
  if (docError) throw docError
}
