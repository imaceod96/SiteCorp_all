import { supabase } from "@/lib/supabase"
import { selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import { fetchCandidateDrivingLicenseIds } from "./catalogs.repository"
import { saveCandidateLicenses } from "./candidate-registration.repository"
import {
  fetchCandidatesPoolMeta,
  isInternalCandidateMetaText,
  notifyCandidatesChanged,
  saveCandidateAreaMeta,
} from "./candidate-pool-meta"
import {
  currentUserId,
  downloadExpedienteFile,
  removeExpedienteFiles,
  requireCurrentUserId,
  storageFileName,
  uploadExpedienteFile,
} from "./expediente-storage"
import type {
  CandidateAcademicFormationInput,
  CandidateAcademicFormationRow,
  CandidateAdditionalInfoRow,
  CandidateExpediente,
  CandidateExpedienteInput,
  CandidateExpedienteRelated,
  CandidateNoteRow,
  CandidateTextEntryInput,
  CandidateWorkExperienceInput,
  CandidateWorkExperienceRow,
  DocumentTypeOption,
  EmploymentLink,
  ExpedienteDocumentRow,
} from "../domain/entities"

/**
 * Personas — Repositorio del expediente del CANDIDATO (infraestructura).
 *
 * Único punto del expediente de candidato que conoce Supabase: la ficha (`candidates`),
 * el vínculo con su trabajador, los datos accesorios (`candidate_documents`,
 * `candidate_work_experiences`, `candidate_academic_formations`, `candidate_notes`,
 * `candidate_additional_info`), las licencias de conducción y el Storage privado.
 *
 * Consultas, columnas, ordenación, rutas de Storage y errores son EXACTAMENTE los que ya
 * usaban la ficha y el formulario: es un traslado estructural, no un cambio de
 * comportamiento. No se duplica la persona ni se crean identificadores nuevos: todo se
 * identifica con los UUID que ya existían.
 *
 * Política de errores (la que ya tenían las pantallas):
 *   · La lectura de la ficha, los tipos de documento y las ESCRITURAS PROPAGAN el error: el
 *     usuario debe saber que la operación no se completó.
 *   · Las lecturas auxiliares (vínculo laboral, datos accesorios, licencias, documentos
 *     verificadores) conservan su tolerancia original: un fallo no vacía la ficha.
 */

/** Ficha del candidato dentro de su entidad (misma fila de siempre, enriquecida con area_id). */
export async function fetchCandidateExpediente(
  entityId: string,
  candidateId: string
): Promise<CandidateExpediente> {
  const { data: primaryData } = await supabase
    .from("candidates")
    .select(selectQuery(`*, ${selectColumn("clientId")}`))
    .eq("id", candidateId)
    .eq("organization_entity_id", entityId)
    .maybeSingle()

  let rowData = primaryData
  if (!rowData) {
    const { data: fallbackData, error } = await supabase
      .from("candidates")
      .select(selectQuery(`*, ${selectColumn("clientId")}`))
      .eq("id", candidateId)
      .single()

    if (error) throw error
    rowData = fallbackData
  }

  const poolMeta = await fetchCandidatesPoolMeta([candidateId])
  const candidate = rowData as unknown as CandidateExpediente
  return {
    ...candidate,
    area_id: poolMeta.areaByCandidateId.get(candidateId) ?? candidate.area_id ?? null,
  }
}

/**
 * Vínculo con el trabajador creado al contratar. Si está vigente, la persona ya aparece en
 * Trabajadores; si está finalizado, la persona está en Reingresos. Las vistas siguen siendo
 * excluyentes: el candidato NO cambia de vista por leer este vínculo.
 */
export async function fetchCandidateEmploymentLink(
  workerId: string
): Promise<EmploymentLink | null> {
  const { data } = await supabase
    .from("workers")
    .select("id, code, employment_status")
    .eq("id", workerId)
    .maybeSingle()

  return (data as EmploymentLink | null) ?? null
}

/** Catálogo global de tipos de documento del expediente. */
export async function fetchDocumentTypes(): Promise<DocumentTypeOption[]> {
  const { data, error } = await supabase
    .from("document_types")
    .select("id, name, description, sort_order")
    .order("sort_order", { ascending: true })

  if (error) throw error
  return (data as DocumentTypeOption[]) || []
}

/** Licencias de conducción registradas para la persona. */
export async function fetchCandidateLicenseIds(candidateId: string): Promise<string[]> {
  return fetchCandidateDrivingLicenseIds(candidateId)
}

/** Documentos, experiencia laboral, formación académica, notas e información adicional. */
export async function fetchCandidateExpedienteRelated(
  candidateId: string
): Promise<CandidateExpedienteRelated> {
  const [docsRes, expRes, formationsRes, notesRes, infoRes] = await Promise.all([
    supabase
      .from("candidate_documents")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_work_experiences")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("start_date", { ascending: false }),
    supabase
      .from("candidate_academic_formations")
      .select("*, document:candidate_documents(id, original_file_name, storage_path)")
      .eq("candidate_id", candidateId)
      .order("start_date", { ascending: false }),
    supabase
      .from("candidate_notes")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_additional_info")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false }),
  ])

  const allAdditionalInfo = (infoRes.data as unknown as CandidateAdditionalInfoRow[]) || []

  return {
    documents: (docsRes.data as unknown as ExpedienteDocumentRow[]) || [],
    workExperiences: (expRes.data as unknown as CandidateWorkExperienceRow[]) || [],
    formations: (formationsRes.data as unknown as CandidateAcademicFormationRow[]) || [],
    notes: (notesRes.data as unknown as CandidateNoteRow[]) || [],
    additionalInfo: allAdditionalInfo.filter(
      (item) => !isInternalCandidateMetaText(item.info_text)
    ),
  }
}

/** Documento verificador ya registrado (chequeo preempleo y antecedentes penales). */
export interface VerificationDocumentRow {
  id: string
  original_file_name: string
}

/**
 * Documentos verificadores del expediente: son los que permiten reconstruir el estado de
 * sus casillas sin depender de un booleano que pueda quedar desincronizado.
 */
export async function fetchCandidateVerificationDocuments(candidateId: string): Promise<{
  preEmployment: VerificationDocumentRow | null
  criminalRecord: VerificationDocumentRow | null
}> {
  const { data } = await supabase
    .from("candidate_documents")
    .select("id, document_type_id, original_file_name")
    .eq("candidate_id", candidateId)
    .in("document_type_id", ["PRE_EMPLOYMENT_CHECK", "CRIMINAL_RECORD"])

  const rows = (data as unknown as { id: string; document_type_id: string; original_file_name: string }[]) || []
  return {
    preEmployment: rows.find((row) => row.document_type_id === "PRE_EMPLOYMENT_CHECK") || null,
    criminalRecord: rows.find((row) => row.document_type_id === "CRIMINAL_RECORD") || null,
  }
}

/**
 * Guarda los datos del expediente del candidato.
 */
export async function updateCandidateExpedienteRow(
  candidateId: string,
  entityId: string,
  input: CandidateExpedienteInput
): Promise<void> {
  const { area_id, ...dbInput } = input

  const { error } = await supabase
    .from("candidates")
    .update({ ...dbInput, updated_at: new Date().toISOString() })
    .eq("id", candidateId)

  if (error) throw error

  if (area_id !== undefined) {
    await saveCandidateAreaMeta(candidateId, entityId, area_id)
  }

  notifyCandidatesChanged()
}

/** Reemplazo exacto de las licencias de conducción (RPC transaccional, en el backend). */
export async function saveCandidateLicenseIds(
  candidateId: string,
  categoryIds: string[]
): Promise<void> {
  await saveCandidateLicenses(candidateId, categoryIds)
}

const CANDIDATE_DOCUMENT_DESCRIPTIONS: Record<string, string> = {
  PRE_EMPLOYMENT_CHECK: "Chequeo Preempleo",
  CRIMINAL_RECORD: "Antecedentes Penales",
}

const candidateDocumentPath = (
  candidateId: string,
  documentTypeId: string,
  fileName: string
): string => storageFileName(`candidate_${candidateId}_${documentTypeId}`, fileName)

/** Alta de un documento del expediente (archivo ya subido al Storage). */
async function insertCandidateDocument(input: {
  candidateId: string
  documentTypeId: string
  originalFileName: string
  storagePath: string
  mimeType: string
  fileSize: number
  description: string | null
  uploadedBy: string | null
}): Promise<string> {
  const { data, error } = await supabase
    .from("candidate_documents")
    .insert({
      candidate_id: input.candidateId,
      document_type_id: input.documentTypeId,
      original_file_name: input.originalFileName,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      file_size: input.fileSize,
      description: input.description,
      uploaded_by: input.uploadedBy,
    })
    .select("id")
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

/** Sube un archivo nuevo del expediente y registra su fila de documento. */
export async function uploadCandidateDocument(input: {
  candidateId: string
  documentTypeId: string
  file: File
  description: string | null
}): Promise<void> {
  const uploadedBy = await requireCurrentUserId()
  const storagePath = candidateDocumentPath(input.candidateId, input.documentTypeId, input.file.name)

  await uploadExpedienteFile(storagePath, input.file)
  await insertCandidateDocument({
    candidateId: input.candidateId,
    documentTypeId: input.documentTypeId,
    originalFileName: input.file.name,
    storagePath,
    mimeType: input.file.type,
    fileSize: input.file.size,
    description: input.description,
    uploadedBy,
  })
}

/**
 * Sube o REEMPLAZA el documento verificador de un candidato.
 *
 * Reglas de siempre: desmarcar la casilla NUNCA borra el documento histórico; marcar sin
 * archivo nuevo mantiene el existente; marcar con archivo nuevo sube el archivo y
 * actualiza (o crea) la fila del documento, eliminando antes el archivo anterior.
 */
export async function uploadOrReplaceCandidateVerificationDocument(
  candidateId: string,
  documentTypeId: string,
  file: File
): Promise<void> {
  const uploadedBy = await requireCurrentUserId()
  const storagePath = candidateDocumentPath(candidateId, documentTypeId, file.name)
  const description = CANDIDATE_DOCUMENT_DESCRIPTIONS[documentTypeId] ?? null

  await uploadExpedienteFile(storagePath, file)

  const { data: existing } = await supabase
    .from("candidate_documents")
    .select("id, storage_path")
    .eq("candidate_id", candidateId)
    .eq("document_type_id", documentTypeId)
    .maybeSingle()

  if (existing) {
    const previous = existing as { id: string; storage_path: string | null }
    if (previous.storage_path) await removeExpedienteFiles([previous.storage_path])

    const { error } = await supabase
      .from("candidate_documents")
      .update({
        original_file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size: file.size,
        description,
        uploaded_by: uploadedBy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", previous.id)

    if (error) throw error
    return
  }

  await insertCandidateDocument({
    candidateId,
    documentTypeId,
    originalFileName: file.name,
    storagePath,
    mimeType: file.type,
    fileSize: file.size,
    description,
    uploadedBy,
  })
}

/** Elimina un documento del expediente: primero su archivo, después su fila. */
export async function deleteCandidateDocument(documentId: string): Promise<void> {
  const { data } = await supabase
    .from("candidate_documents")
    .select("storage_path")
    .eq("id", documentId)
    .maybeSingle()

  const storagePath = (data as { storage_path: string | null } | null)?.storage_path
  if (storagePath) await removeExpedienteFiles([storagePath])

  const { error } = await supabase.from("candidate_documents").delete().eq("id", documentId)
  if (error) throw error
}

/** Descarga el archivo del expediente para entregarlo al usuario. */
export async function downloadCandidateDocument(storagePath: string): Promise<Blob> {
  return downloadExpedienteFile(storagePath)
}

/** Alta de una experiencia laboral declarada por la persona. */
export async function insertCandidateWorkExperience(
  input: CandidateWorkExperienceInput
): Promise<void> {
  const { error } = await supabase.from("candidate_work_experiences").insert({
    candidate_id: input.candidateId,
    organization_entity_id: input.organizationEntityId,
    job_title: input.jobTitle.trim(),
    company_name: input.companyName.trim(),
    start_date: input.startDate,
    end_date: input.isCurrent ? null : input.endDate,
    is_current: input.isCurrent,
    description: input.description?.trim() || null,
  })

  if (error) throw error
}

export async function deleteCandidateWorkExperience(id: string): Promise<void> {
  const { error } = await supabase.from("candidate_work_experiences").delete().eq("id", id)
  if (error) throw error
}

/**
 * Alta de una formación académica con su título adjunto opcional: el título se sube al
 * Storage y se registra como documento del expediente ANTES de crear la formación, para
 * que nunca quede una formación apuntando a un documento inexistente.
 */
export async function insertCandidateAcademicFormation(
  input: CandidateAcademicFormationInput
): Promise<void> {
  let documentId: string | null = null

  if (input.titleFile) {
    const uploadedBy = await currentUserId()
    const storagePath = storageFileName(
      `candidate_${input.candidateId}_academic`,
      input.titleFile.name
    )
    await uploadExpedienteFile(storagePath, input.titleFile)
    documentId = await insertCandidateDocument({
      candidateId: input.candidateId,
      documentTypeId: "ACADEMIC_CERTIFICATE",
      originalFileName: input.titleFile.name,
      storagePath,
      mimeType: input.titleFile.type,
      fileSize: input.titleFile.size,
      description: `Título de ${input.programName.trim()}`,
      uploadedBy,
    })
  }

  const { error } = await supabase.from("candidate_academic_formations").insert({
    candidate_id: input.candidateId,
    organization_entity_id: input.organizationEntityId,
    program_name: input.programName.trim(),
    start_date: input.startDate,
    end_date: input.isStudying ? null : input.endDate,
    is_studying: input.isStudying,
    document_id: documentId,
  })

  if (error) throw error
}

/** Elimina la formación académica y, si tenía título adjunto, también su documento. */
export async function deleteCandidateAcademicFormation(
  id: string,
  document: { id: string; storage_path: string } | null
): Promise<void> {
  if (document) {
    await removeExpedienteFiles([document.storage_path])
    const { error: documentError } = await supabase
      .from("candidate_documents")
      .delete()
      .eq("id", document.id)
    if (documentError) throw documentError
  }

  const { error } = await supabase.from("candidate_academic_formations").delete().eq("id", id)
  if (error) throw error
}

/** Alta y baja de notas e información adicional del expediente. */
export async function insertCandidateNote(input: CandidateTextEntryInput): Promise<void> {
  const { error } = await supabase.from("candidate_notes").insert({
    candidate_id: input.candidateId,
    organization_entity_id: input.organizationEntityId,
    note_text: input.text.trim(),
    created_by: await currentUserId(),
  })

  if (error) throw error
}

export async function deleteCandidateNote(id: string): Promise<void> {
  const { error } = await supabase.from("candidate_notes").delete().eq("id", id)
  if (error) throw error
}

export async function insertCandidateAdditionalInfo(
  input: CandidateTextEntryInput
): Promise<void> {
  const { error } = await supabase.from("candidate_additional_info").insert({
    candidate_id: input.candidateId,
    organization_entity_id: input.organizationEntityId,
    info_text: input.text.trim(),
    created_by: await currentUserId(),
  })

  if (error) throw error
}

export async function deleteCandidateAdditionalInfo(id: string): Promise<void> {
  const { error } = await supabase.from("candidate_additional_info").delete().eq("id", id)
  if (error) throw error
}
