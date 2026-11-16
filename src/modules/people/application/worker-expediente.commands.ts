import { personRegistrationConflict, shouldUploadVerificationDocument } from "../domain/rules"
import { fetchPersonIdentificationStatus } from "../infrastructure/candidate-registration.repository"
import {
  createWorkerWithPosition,
  registerWorkerContract,
  saveWorkerLicenseIds,
  updateWorkerPersonalData,
  uploadWorkerVerificationDocument,
} from "../infrastructure/worker-expediente.repository"
import type {
  NewWorkerInput,
  WorkerContractFormalizationInput,
  WorkerExpedienteInput,
} from "../domain/entities"

/**
 * Personas — Casos de uso de escritura del expediente del TRABAJADOR (aplicación).
 *
 * Cubren la edición del expediente (datos personales y licencias por separado, porque cada
 * pantalla informa de un fallo parcial a su manera), el alta con puesto y contrato, el
 * registro del contrato y sus documentos verificadores.
 *
 * La generación documental del contrato se encola automáticamente en
 * `public.document_generation_jobs` mediante triggers en el backend y se procesa mediante
 * `process-document-jobs`.
 */

/** Guarda los datos personales del trabajador (nunca toca al candidato). */
export async function saveWorkerExpedientePersonalData(
  workerId: string,
  data: WorkerExpedienteInput
): Promise<void> {
  await updateWorkerPersonalData(workerId, data)
}

/** Reemplazo exacto de las licencias de conducción del trabajador. */
export async function saveWorkerExpedienteLicenseIds(
  workerId: string,
  categoryIds: string[]
): Promise<void> {
  await saveWorkerLicenseIds(workerId, categoryIds)
}

/**
 * Comprueba la unicidad de la identificación dentro del cliente. Devuelve el mensaje que
 * debe ver el usuario o `null` si la identificación está libre.
 */
export async function checkWorkerIdentification(
  entityId: string,
  identification: string
): Promise<string | null> {
  const status = await fetchPersonIdentificationStatus(entityId, identification.trim())
  return personRegistrationConflict(status)
}

/**
 * Alta de un trabajador con su puesto, su contrato, sus licencias y sus documentos
 * verificadores. Devuelve el `worker_id` creado.
 */
export async function createWorkerExpediente(
  input: NewWorkerInput & {
    hasPreEmploymentCheck: boolean
    preEmploymentCheckFile: File | null
    hasCriminalRecordCheck: boolean
    criminalRecordCheckFile: File | null
  }
): Promise<string> {
  const workerId = await createWorkerWithPosition(input)

  const uploads: Promise<void>[] = []
  if (
    shouldUploadVerificationDocument(input.hasPreEmploymentCheck, input.preEmploymentCheckFile)
  ) {
    uploads.push(
      uploadWorkerVerificationDocument(
        workerId,
        "PRE_EMPLOYMENT_CHECK",
        input.preEmploymentCheckFile
      )
    )
  }

  if (
    shouldUploadVerificationDocument(input.hasCriminalRecordCheck, input.criminalRecordCheckFile)
  ) {
    uploads.push(
      uploadWorkerVerificationDocument(
        workerId,
        "CRIMINAL_RECORD",
        input.criminalRecordCheckFile
      )
    )
  }

  if (uploads.length > 0) {
    await Promise.all(uploads)
  }

  return workerId
}

/**
 * Registra el contrato del trabajador; el trigger en PostgreSQL encola automáticamente su
 * generación en `public.document_generation_jobs`.
 */
export async function registerWorkerExpedienteContract(
  input: WorkerContractFormalizationInput
): Promise<string | null> {
  return registerWorkerContract(input)
}
