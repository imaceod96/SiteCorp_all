import { personRegistrationConflict, shouldUploadVerificationDocument } from "../domain/rules"
import { fetchPersonIdentificationStatus } from "../infrastructure/candidate-registration.repository"
import { ensureContractDocument } from "../infrastructure/transition-documents"
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
 * UNICIDAD DE PERSONA (§27–§33): el alta comprueba en el backend
 * (`person_identification_status`) que la identificación no pertenezca ya a un Candidato, a
 * un Trabajador o a un Reingreso del cliente; la regla que traduce el resultado en mensaje
 * es del dominio (`personRegistrationConflict`). Nunca se crea una segunda persona ni un
 * identificador nuevo: si la persona existe, se usa su expediente.
 *
 * Las comprobaciones que ya hacía la pantalla (permiso, formato del carné, condiciones del
 * contrato) se aplican antes de llamar aquí con las reglas del dominio.
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

  if (
    shouldUploadVerificationDocument(input.hasPreEmploymentCheck, input.preEmploymentCheckFile)
  ) {
    await uploadWorkerVerificationDocument(workerId, "PRE_EMPLOYMENT_CHECK", input.preEmploymentCheckFile)
  }
  if (
    shouldUploadVerificationDocument(input.hasCriminalRecordCheck, input.criminalRecordCheckFile)
  ) {
    await uploadWorkerVerificationDocument(workerId, "CRIMINAL_RECORD", input.criminalRecordCheckFile)
  }

  return workerId
}

/**
 * Registra el contrato del trabajador y genera su documento automático. La generación del
 * documento nunca interrumpe la operación: si falla, el contrato ya está registrado y su
 * documento puede regenerarse.
 */
export async function registerWorkerExpedienteContract(
  input: WorkerContractFormalizationInput
): Promise<string | null> {
  const contractId = await registerWorkerContract(input)

  if (contractId) {
    const warning = await ensureContractDocument(contractId)
    if (warning) console.warn("[people] documento del contrato no generado", warning)
  }

  return contractId
}
