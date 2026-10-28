import { shouldUploadVerificationDocument } from "../domain/rules"
import {
  deleteCandidateAcademicFormation,
  deleteCandidateAdditionalInfo,
  deleteCandidateDocument,
  deleteCandidateNote,
  deleteCandidateWorkExperience,
  downloadCandidateDocument,
  fetchCandidateExpediente,
  insertCandidateAcademicFormation,
  insertCandidateAdditionalInfo,
  insertCandidateNote,
  insertCandidateWorkExperience,
  saveCandidateLicenseIds,
  updateCandidateExpedienteRow,
  uploadCandidateDocument,
  uploadOrReplaceCandidateVerificationDocument,
} from "../infrastructure/candidate-expediente.repository"
import { saveDownloadedFile } from "../infrastructure/expediente-storage"
import type {
  CandidateAcademicFormationInput,
  CandidateExpediente,
  CandidateExpedienteInput,
  CandidateTextEntryInput,
  CandidateWorkExperienceInput,
} from "../domain/entities"

/**
 * Personas — Casos de uso de escritura del expediente del CANDIDATO (aplicación).
 *
 * Cada operación es una sola transacción lógica: guardar la ficha (datos personales,
 * licencias y documentos verificadores), o añadir/quitar una pieza del expediente
 * (documento, experiencia laboral, formación académica, nota, información adicional).
 *
 * Nada de esto crea identificadores ni personas: se escribe SIEMPRE sobre el UUID del
 * candidato que ya existe, y la comprobación de que la persona sigue siendo candidata la
 * mantiene el backend (RLS y RPC).
 *
 * Los mensajes que ve el usuario los aporta el dominio y los aplica la pantalla antes de
 * llamar aquí; la autoridad final es la base de datos.
 */

export interface CandidateExpedienteUpdateInput {
  candidateId: string
  entityId: string
  data: CandidateExpedienteInput
  drivingLicenseIds: string[]
  hasPreEmploymentCheck: boolean
  preEmploymentCheckFile: File | null
  hasCriminalRecordCheck: boolean
  criminalRecordCheckFile: File | null
}

/**
 * Guarda el expediente del candidato y devuelve la ficha actualizada.
 *
 * Los documentos verificadores siguen su regla de conservación: solo se escriben cuando la
 * casilla está activada y hay archivo nuevo (desmarcar no borra el histórico).
 */
export async function updateCandidateExpediente(
  input: CandidateExpedienteUpdateInput
): Promise<CandidateExpediente> {
  await updateCandidateExpedienteRow(input.candidateId, input.entityId, input.data)

  await saveCandidateLicenseIds(input.candidateId, input.drivingLicenseIds)

  if (
    shouldUploadVerificationDocument(
      input.hasPreEmploymentCheck,
      input.preEmploymentCheckFile
    )
  ) {
    await uploadOrReplaceCandidateVerificationDocument(
      input.candidateId,
      "PRE_EMPLOYMENT_CHECK",
      input.preEmploymentCheckFile
    )
  }

  if (
    shouldUploadVerificationDocument(
      input.hasCriminalRecordCheck,
      input.criminalRecordCheckFile
    )
  ) {
    await uploadOrReplaceCandidateVerificationDocument(
      input.candidateId,
      "CRIMINAL_RECORD",
      input.criminalRecordCheckFile
    )
  }

  return fetchCandidateExpediente(input.entityId, input.candidateId)
}

/** Añade un documento al expediente (archivo nuevo en el Storage privado). */
export async function addCandidateExpedienteDocument(input: {
  candidateId: string
  documentTypeId: string
  file: File
  description: string | null
}): Promise<void> {
  await uploadCandidateDocument(input)
}

/** Elimina un documento del expediente y su archivo. */
export async function removeCandidateExpedienteDocument(documentId: string): Promise<void> {
  await deleteCandidateDocument(documentId)
}

/** Descarga un documento del expediente con su nombre original. */
export async function downloadCandidateExpedienteDocument(input: {
  storagePath: string
  originalFileName: string
}): Promise<void> {
  const blob = await downloadCandidateDocument(input.storagePath)
  saveDownloadedFile(blob, input.originalFileName)
}

export async function addCandidateWorkExperience(
  input: CandidateWorkExperienceInput
): Promise<void> {
  await insertCandidateWorkExperience(input)
}

export async function removeCandidateWorkExperience(id: string): Promise<void> {
  await deleteCandidateWorkExperience(id)
}

export async function addCandidateAcademicFormation(
  input: CandidateAcademicFormationInput
): Promise<void> {
  await insertCandidateAcademicFormation(input)
}

/** Elimina la formación académica y, con ella, el título que tuviera adjunto. */
export async function removeCandidateAcademicFormation(
  id: string,
  document: { id: string; storage_path: string } | null
): Promise<void> {
  await deleteCandidateAcademicFormation(id, document)
}

export async function addCandidateNote(input: CandidateTextEntryInput): Promise<void> {
  await insertCandidateNote(input)
}

export async function removeCandidateNote(id: string): Promise<void> {
  await deleteCandidateNote(id)
}

export async function addCandidateAdditionalInfo(input: CandidateTextEntryInput): Promise<void> {
  await insertCandidateAdditionalInfo(input)
}

export async function removeCandidateAdditionalInfo(id: string): Promise<void> {
  await deleteCandidateAdditionalInfo(id)
}
