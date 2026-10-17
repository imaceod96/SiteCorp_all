import { test, expect } from "@playwright/test"
import {
  candidateRequiresSpecialty,
  convertDisplayDateToISO,
  missingPersonProfileFields,
  personFullName,
  personRegistrationConflict,
  validateCandidateRegistration,
} from "../src/modules/people/domain/rules"
import type {
  CandidateRegistrationInput,
  PersonDirectoryWorker,
} from "../src/modules/people/domain/entities"

/**
 * ALTA DE PERSONAS — precondiciones y unicidad de identidad.
 *
 * El formulario de candidatos ya no valida por su cuenta: las reglas viven en el
 * dominio (`src/modules/people/domain/rules.ts`, sin dependencias) y la unicidad la
 * resuelve el backend (`person_identification_status`). Aquí se comprueba que el
 * criterio y los mensajes son los de siempre, para que la vista siga mostrando lo mismo.
 */

const base: CandidateRegistrationInput = {
  first_name: "Ana",
  first_surname: "Pérez",
  second_surname: "Gómez",
  identification: "90010112345",
  birth_date: "01/01/1990",
  gender_id: "g-1",
  marital_status_id: "m-1",
  skin_color_id: "s-1",
  education_level_id: "e-1",
  education_level_name: "Primaria",
  specialty: "",
  phone: "55555555",
  email: "ana@ejemplo.cu",
  address: "Calle 1 #2",
  municipality: "Plaza de la Revolución",
  province: "La Habana",
  profession_or_trade: "Contadora",
  political_affiliation: "pcc",
  has_masters_degree: false,
  has_doctorate_degree: false,
  is_retired_or_rehired: "no",
  has_disciplinary_measures: false,
  driving_license_ids: [],
  has_pre_employment_check: false,
  has_criminal_record_check: false,
  pre_employment_check_file: null,
  criminal_record_check_file: null,
  disciplinary_document: null,
}

const withInput = (changes: Partial<CandidateRegistrationInput>): CandidateRegistrationInput => ({
  ...base,
  ...changes,
})

/** Documento ya seleccionado en el formulario: el dominio solo comprueba su presencia. */
const attachment = { name: "documento.pdf" } as unknown as File

test("el alta exige los datos personales indispensables", () => {
  expect(validateCandidateRegistration(withInput({}))).toBeNull()

  expect(validateCandidateRegistration(withInput({ first_name: "   " }))).toBe(
    "El nombre es obligatorio"
  )
  expect(validateCandidateRegistration(withInput({ first_surname: "" }))).toBe(
    "El primer apellido es obligatorio"
  )
  expect(validateCandidateRegistration(withInput({ identification: " " }))).toBe(
    "La identificación es obligatoria"
  )

  // El formato del carnet lo aporta el kernel compartido (`@/utils/ci`): el caso de uso
  // lo entrega al dominio para que se compruebe en su posición original.
  const identificationFormatError = "El número de identificación debe contener exactamente 11 dígitos."
  expect(validateCandidateRegistration(withInput({}), identificationFormatError)).toBe(
    identificationFormatError
  )

  expect(validateCandidateRegistration(withInput({ birth_date: "" }))).toBe(
    "La fecha de nacimiento es obligatoria"
  )
  expect(validateCandidateRegistration(withInput({ profession_or_trade: "" }))).toBe(
    "La profesión u oficio es obligatoria"
  )
  expect(validateCandidateRegistration(withInput({ address: "" }))).toBe(
    "La dirección particular es obligatoria"
  )
  expect(validateCandidateRegistration(withInput({ province: "" }))).toBe(
    "La provincia es obligatoria"
  )
  expect(validateCandidateRegistration(withInput({ municipality: "" }))).toBe(
    "El municipio es obligatorio"
  )
  expect(validateCandidateRegistration(withInput({ email: "correo-invalido" }))).toBe(
    "El formato del email no es válido"
  )
  expect(validateCandidateRegistration(withInput({ birth_date: "31-12-1990" }))).toBe(
    "El formato de la fecha de nacimiento no es válido (dd/mm/aaaa)"
  )
})

test("la especialidad se exige solo en los niveles que la requieren", () => {
  expect(candidateRequiresSpecialty("Superior")).toBe(true)
  expect(candidateRequiresSpecialty("Técnico Medio")).toBe(true)
  expect(candidateRequiresSpecialty("Obrero Calificado")).toBe(true)
  expect(candidateRequiresSpecialty("Primaria")).toBe(false)
  expect(candidateRequiresSpecialty(null)).toBe(false)

  const superior = withInput({
    education_level_id: "e-sup",
    education_level_name: "Superior",
    specialty: "",
  })
  expect(validateCandidateRegistration(superior)).toBe("La especialidad es obligatoria para Superior")
  expect(validateCandidateRegistration({ ...superior, specialty: "Informática" })).toBeNull()

  const primaria = withInput({ education_level_name: "Primaria", specialty: "" })
  expect(validateCandidateRegistration(primaria)).toBeNull()
})

test("los documentos verificadores son obligatorios mientras su casilla esté activa", () => {
  expect(validateCandidateRegistration(withInput({ has_pre_employment_check: true }))).toBe(
    "Debe seleccionar el documento de Chequeo Preempleo"
  )
  expect(
    validateCandidateRegistration(
      withInput({ has_pre_employment_check: true, pre_employment_check_file: attachment })
    )
  ).toBeNull()

  expect(validateCandidateRegistration(withInput({ has_criminal_record_check: true }))).toBe(
    "Debe seleccionar el documento de Antecedentes Penales"
  )
  expect(
    validateCandidateRegistration(
      withInput({ has_criminal_record_check: true, criminal_record_check_file: attachment })
    )
  ).toBeNull()
})

test("una persona solo se registra como candidata si su identidad está libre", () => {
  expect(personRegistrationConflict({})).toBeNull()
  expect(personRegistrationConflict({ candidate_count: 0 })).toBeNull()

  expect(personRegistrationConflict({ worker_id: "w-1", worker_status: "active" })).toBe(
    "Esta persona ya está registrada como trabajador. Solo puede actualizar su información."
  )
  expect(personRegistrationConflict({ worker_id: "w-1", worker_status: "inactive" })).toBe(
    "Esta persona ya existe y actualmente se encuentra en Reingresos. Debe utilizar el expediente existente."
  )
  expect(personRegistrationConflict({ candidate_count: 1 })).toBe(
    "Ya existe una persona con este número de identificación. Solo puede actualizar su información."
  )
})

test("la fecha de nacimiento se convierte al formato de la base de datos", () => {
  expect(convertDisplayDateToISO("01/01/1990")).toBe("1990-01-01")
  expect(convertDisplayDateToISO("1990-12-31")).toBe("1990-12-31")
  expect(convertDisplayDateToISO("1990/12/31")).toBeNull()
  expect(convertDisplayDateToISO("")).toBeNull()
})

test("la ficha de la persona se describe con las mismas reglas en toda la vista", () => {
  expect(personFullName({ first_name: "Ana", first_surname: "Pérez", second_surname: null })).toBe(
    "Ana Pérez"
  )
  expect(
    personFullName({ first_name: "Ana", first_surname: "Pérez", second_surname: "Gómez" })
  ).toBe("Ana Pérez Gómez")

  const completa = {
    birth_date: "1990-01-01",
    gender_id: "g-1",
    marital_status_id: "m-1",
    skin_color_id: "s-1",
    address: "Calle 1 #2",
    employment_start_date: "2020-01-01",
  } as unknown as PersonDirectoryWorker

  expect(missingPersonProfileFields(completa)).toEqual([])
  expect(missingPersonProfileFields({ ...completa, gender_id: null })).toEqual(["sexo"])
})
