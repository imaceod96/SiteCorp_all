import { IDENTIFICATION_ERROR_MESSAGE, isValidIdentification } from "@/utils/ci"
import {
  PeopleRuleError,
  candidateRequiresSpecialty,
  convertDisplayDateToISO,
  personRegistrationConflict,
  validateCandidateRegistration,
} from "../domain/rules"
import {
  fetchPersonIdentificationStatus,
  insertCandidate,
  saveCandidateLicenses,
  uploadCandidateDisciplinaryDocument,
  uploadCandidateVerificationDocument,
} from "../infrastructure/candidate-registration.repository"
import type { CandidateRegistrationInput } from "../domain/entities"

/**
 * Personas — Casos de uso de escritura (aplicación).
 *
 * ALTA DE UNA PERSONA COMO CANDIDATA. Orden de operaciones (el mismo de siempre):
 *   1. Precondiciones del dominio (reglas puras) + formato del carnet del kernel
 *      compartido → `PeopleRuleError` con el mensaje que se muestra al usuario.
 *   2. Unicidad de identidad resuelta por el BACKEND (`person_identification_status`):
 *      el frontend no decide si una persona ya existe.
 *   3. Inserción de la fila del candidato (UUID nuevo, nunca se duplica una persona).
 *   4. Licencias de conducción (reemplazo atómico en el backend).
 *   5. Documentos verificadores y disciplinario en el Storage. Un fallo aquí NO revierte
 *      el alta ya creada: se avisa por consola, porque el expediente ya existe.
 */

export interface RegisterCandidateCommand {
  entityId: string
  /** Cliente de la entidad: el UUID del compañero (`company_clients.id`). */
  companyClientId: string | null | undefined
  registration: CandidateRegistrationInput
  /** Si se registra desde la Bolsa Global sin entidad inicial asignada. */
  unassignedInPool?: boolean
}

export async function registerCandidate(
  command: RegisterCandidateCommand
): Promise<{ candidateId: string }> {
  const { entityId, companyClientId, registration, unassignedInPool } = command

  // El formato del carnet de identidad es un objeto de valor del kernel compartido
  // (`@/utils/ci`): se aporta al dominio en vez de duplicar la regla de 11 dígitos.
  const identificationFormatError = isValidIdentification(registration.identification)
    ? null
    : IDENTIFICATION_ERROR_MESSAGE

  const validationError = validateCandidateRegistration(
    registration,
    identificationFormatError
  )
  if (validationError) throw new PeopleRuleError(validationError)

  const identification = registration.identification.trim()
  const status = await fetchPersonIdentificationStatus(entityId, identification)
  const conflict = personRegistrationConflict(status)
  if (conflict) throw new PeopleRuleError(conflict)

  const requiresSpecialty = candidateRequiresSpecialty(registration.education_level_name)

  const candidateId = await insertCandidate({
    companyClientId,
    entityId,
    first_name: registration.first_name.trim(),
    first_surname: registration.first_surname.trim(),
    second_surname: registration.second_surname.trim() || null,
    identification,
    birth_date: convertDisplayDateToISO(registration.birth_date),
    gender_id: registration.gender_id || null,
    marital_status_id: registration.marital_status_id || null,
    phone: registration.phone.trim() || null,
    email: registration.email.trim() || null,
    address: registration.address.trim() || null,
    municipality: registration.municipality.trim() || null,
    province: registration.province.trim() || null,
    education_level_id: registration.education_level_id || null,
    specialty: requiresSpecialty ? registration.specialty.trim() || null : null,
    area_id: registration.area_id || null,
    unassignedInPool,
    has_masters_degree: registration.has_masters_degree,
    has_doctorate_degree: registration.has_doctorate_degree,
    profession_or_trade: registration.profession_or_trade.trim() || null,
    skin_color_id: registration.skin_color_id || null,
    political_affiliation: registration.political_affiliation || null,
    is_retired_or_rehired: registration.is_retired_or_rehired === "yes",
    has_disciplinary_measures: registration.has_disciplinary_measures,
  })

  await saveCandidateLicenses(candidateId, registration.driving_license_ids)

  if (registration.disciplinary_document) {
    try {
      await uploadCandidateDisciplinaryDocument(candidateId, registration.disciplinary_document)
    } catch (error) {
      console.error("Error saving disciplinary document reference:", error)
    }
  }

  if (registration.has_pre_employment_check && registration.pre_employment_check_file) {
    try {
      await uploadCandidateVerificationDocument(
        candidateId,
        "PRE_EMPLOYMENT_CHECK",
        registration.pre_employment_check_file,
        "Chequeo Preempleo"
      )
    } catch (error) {
      console.error("Error saving pre-employment check document:", error)
    }
  }

  if (registration.has_criminal_record_check && registration.criminal_record_check_file) {
    try {
      await uploadCandidateVerificationDocument(
        candidateId,
        "CRIMINAL_RECORD",
        registration.criminal_record_check_file,
        "Antecedentes Penales"
      )
    } catch (error) {
      console.error("Error saving criminal record document:", error)
    }
  }

  return { candidateId }
}
