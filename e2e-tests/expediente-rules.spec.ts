import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  MISSING_REPRESENTATIVE_MESSAGE,
  personRegistrationConflict,
  shouldUploadVerificationDocument,
  specialtyForEducationLevel,
  validateAcademicFormationInput,
  validateCandidateRegistration,
  validateExpedienteText,
  validatePersonProfileFields,
  validateVerificationDocuments,
  validateWorkExperienceInput,
  validateWorkerContractInput,
  validateWorkerPersonalData,
  validateWorkerRegistrationInput,
} from "../src/domains/people/domain/rules"
import type { CandidateRegistrationInput } from "../src/domains/people/domain/entities"

/**
 * EXPEDIENTES DE CANDIDATOS Y TRABAJADORES — reglas compartidas.
 *
 * Las cuatro pantallas del expediente (ficha y formulario de candidato, ficha y formulario
 * de trabajador) ya no validan ni consultan por su cuenta: las comprobaciones viven en el
 * dominio Personas y las lecturas/escrituras en sus casos de uso. Aquí se comprueba que el
 * criterio y los MENSAJES siguen siendo exactamente los de siempre (no hay regresión de
 * comportamiento) y que ninguna de las cuatro pantallas consulta Supabase directamente.
 */

const FILE = "documento.pdf"
const attachment = { name: FILE } as unknown as File

const candidateBase: CandidateRegistrationInput = {
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

const withCandidate = (changes: Partial<CandidateRegistrationInput>): CandidateRegistrationInput => ({
  ...candidateBase,
  ...changes,
})

test("la ficha del candidato conserva los datos personales indispensables al editarse", () => {
  expect(validateCandidateRegistration(withCandidate({}))).toBeNull()

  expect(validateCandidateRegistration(withCandidate({ birth_date: "" }))).toBe(
    "La fecha de nacimiento es obligatoria"
  )
  expect(validateCandidateRegistration(withCandidate({ profession_or_trade: "  " }))).toBe(
    "La profesión u oficio es obligatoria"
  )
  expect(validateCandidateRegistration(withCandidate({ address: "" }))).toBe(
    "La dirección particular es obligatoria"
  )
  expect(validateCandidateRegistration(withCandidate({ province: "" }))).toBe(
    "La provincia es obligatoria"
  )
  expect(validateCandidateRegistration(withCandidate({ municipality: "" }))).toBe(
    "El municipio es obligatorio"
  )
})

test("un documento verificador ya registrado satisface la obligatoriedad del archivo", () => {
  const checked = {
    has_pre_employment_check: true,
    has_criminal_record_check: true,
  }

  // Casilla activada sin archivo nuevo y sin documento registrado: el archivo se exige.
  expect(validateVerificationDocuments({ ...checked, pre_employment_check_file: null, criminal_record_check_file: null })).toBe(
    "Debe seleccionar el documento de Chequeo Preempleo"
  )
  expect(
    validateVerificationDocuments({
      has_pre_employment_check: false,
      has_criminal_record_check: true,
      pre_employment_check_file: null,
      criminal_record_check_file: null,
    })
  ).toBe("Debe seleccionar el documento de Antecedentes Penales")

  // Documento ya registrado en el expediente: no hace falta volver a adjuntarlo.
  expect(
    validateVerificationDocuments({
      ...checked,
      pre_employment_check_file: null,
      criminal_record_check_file: null,
      pre_employment_check_present: true,
      criminal_record_check_present: true,
    })
  ).toBeNull()

  // La misma regla, aplicada desde la ficha del candidato.
  expect(
    validateCandidateRegistration(
      withCandidate({
        ...checked,
        pre_employment_check_present: true,
        criminal_record_check_present: true,
      })
    )
  ).toBeNull()
})

test("los documentos verificadores nunca se borran al desmarcar su casilla", () => {
  // Desmarcar no elimina el documento histórico: no se escribe nada.
  expect(shouldUploadVerificationDocument(false, attachment)).toBe(false)
  // Marcado sin archivo nuevo: se conserva el documento existente.
  expect(shouldUploadVerificationDocument(true, null)).toBe(false)
  // Marcado con archivo nuevo: se sube (o reemplaza) el documento.
  expect(shouldUploadVerificationDocument(true, attachment)).toBe(true)
})

test("la especialidad solo se conserva en los niveles educacionales que la exigen", () => {
  expect(specialtyForEducationLevel("Superior", "  Informática  ")).toBe("Informática")
  expect(specialtyForEducationLevel("Técnico Medio", "Contabilidad")).toBe("Contabilidad")
  expect(specialtyForEducationLevel("Primaria", "Contabilidad")).toBeNull()
  expect(specialtyForEducationLevel("", "Contabilidad")).toBeNull()
})

test("los datos personales del expediente laboral son los que exige el contrato", () => {
  expect(
    validatePersonProfileFields({
      birth_date: "1990-01-01",
      profession_or_trade: "Contadora",
      address: "Calle 1 #2",
      province: "La Habana",
      municipality: "Playa",
    })
  ).toBeNull()

  expect(
    validatePersonProfileFields({
      birth_date: "",
      profession_or_trade: "Contadora",
      address: "Calle 1 #2",
      province: "La Habana",
      municipality: "Playa",
    })
  ).toBe("La fecha de nacimiento es obligatoria")
  expect(
    validatePersonProfileFields({
      birth_date: "1990-01-01",
      profession_or_trade: "",
      address: "Calle 1 #2",
      province: "La Habana",
      municipality: "Playa",
    })
  ).toBe("La profesión u oficio es obligatoria")
  expect(
    validatePersonProfileFields({
      birth_date: "1990-01-01",
      profession_or_trade: "Contadora",
      address: "Calle 1 #2",
      province: "La Habana",
      municipality: "",
    })
  ).toBe("El municipio es obligatorio")
})

const workerBase = {
  first_name: "Juan",
  first_surname: "Pérez",
  identification: "90010112345",
  birth_date: "1990-01-01",
  profession_or_trade: "Contador",
  address: "Calle 1 #2",
  province: "La Habana",
  municipality: "Playa",
  education_level_id: "e-1",
  education_level_name: "Primaria",
  specialty: "",
  hire_date: "2024-01-01",
}

test("el alta y la edición del trabajador comparten los mismos mensajes", () => {
  expect(validateWorkerPersonalData(workerBase)).toBeNull()

  expect(validateWorkerPersonalData({ ...workerBase, first_surname: " " })).toBe(
    "El nombre y el primer apellido son obligatorios"
  )
  expect(validateWorkerPersonalData({ ...workerBase, identification: "" })).toBe(
    "El carné de identidad es obligatorio"
  )
  // El formato del carné lo aporta el kernel compartido y se comprueba en su posición.
  expect(
    validateWorkerPersonalData(
      { ...workerBase, birth_date: "" },
      "El número de identificación debe contener exactamente 11 dígitos."
    )
  ).toBe("El número de identificación debe contener exactamente 11 dígitos.")
  expect(validateWorkerPersonalData({ ...workerBase, birth_date: "" })).toBe(
    "La fecha de nacimiento es obligatoria"
  )
  expect(
    validateWorkerPersonalData({
      ...workerBase,
      education_level_name: "Superior",
      specialty: "",
    })
  ).toBe("La especialidad es obligatoria para Superior")
  expect(validateWorkerPersonalData({ ...workerBase, hire_date: "" })).toBe(
    "La fecha de incorporación es obligatoria"
  )
})

const registrationBase = {
  positionId: "p-1",
  positionAvailable: true,
  contractTypeId: "ct-1",
  isDetermined: false,
  contractStartDate: "2024-01-01",
  contractEndDate: "",
  signatureDate: "2024-01-01",
  signaturePlace: "La Habana",
  paymentMethodId: "pm-1",
  hasInvalidComponents: false,
  blocking: [] as string[],
  representativeAssignmentId: "rep-1",
}

test("el alta de un trabajador exige puesto disponible y condiciones formalizadas", () => {
  expect(validateWorkerRegistrationInput(registrationBase)).toBeNull()

  expect(validateWorkerRegistrationInput({ ...registrationBase, positionId: "" })).toBe(
    "El puesto es obligatorio"
  )
  expect(
    validateWorkerRegistrationInput({ ...registrationBase, positionAvailable: false })
  ).toBe("El puesto seleccionado ya no tiene plazas disponibles. Selecciona otro puesto.")
  expect(validateWorkerRegistrationInput({ ...registrationBase, contractTypeId: "" })).toBe(
    "Debes seleccionar un tipo de contrato"
  )
  expect(
    validateWorkerRegistrationInput({ ...registrationBase, isDetermined: true })
  ).toBe("El contrato por tiempo determinado requiere una fecha de fin")
  expect(
    validateWorkerRegistrationInput({
      ...registrationBase,
      contractEndDate: "2023-12-31",
    })
  ).toBe("La fecha de fin del contrato debe ser posterior a su inicio")
  expect(validateWorkerRegistrationInput({ ...registrationBase, signatureDate: "" })).toBe(
    "La fecha de firma del contrato es obligatoria"
  )
  expect(validateWorkerRegistrationInput({ ...registrationBase, signaturePlace: " " })).toBe(
    "El lugar de firma es obligatorio"
  )
  expect(validateWorkerRegistrationInput({ ...registrationBase, paymentMethodId: "" })).toBe(
    "Selecciona la forma de pago"
  )
  expect(
    validateWorkerRegistrationInput({ ...registrationBase, hasInvalidComponents: true })
  ).toBe(
    "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)"
  )
  expect(
    validateWorkerRegistrationInput({ ...registrationBase, blocking: ["Sexo", "Estado civil"] })
  ).toBe(
    "No se puede completar la formalización del contrato. Datos pendientes: Sexo · Estado civil"
  )
  expect(
    validateWorkerRegistrationInput({ ...registrationBase, representativeAssignmentId: null })
  ).toBe(MISSING_REPRESENTATIVE_MESSAGE)
})

test("el registro del contrato desde el expediente usa los mensajes de su pantalla", () => {
  const base = {
    contractTypeId: "ct-1",
    startDate: "2024-01-01",
    hireDate: "2024-01-01",
    isDetermined: false,
    endDate: "",
    signatureDate: "2024-01-01",
    signaturePlace: "La Habana",
    paymentMethodId: "pm-1",
    hasInvalidComponents: false,
    blocking: [] as string[],
    representativeAssignmentId: "rep-1",
  }

  expect(validateWorkerContractInput(base)).toBeNull()

  expect(validateWorkerContractInput({ ...base, contractTypeId: "" })).toBe(
    "Selecciona un tipo de contrato"
  )
  expect(validateWorkerContractInput({ ...base, startDate: "" })).toBe(
    "La fecha de inicio del contrato es obligatoria"
  )
  expect(validateWorkerContractInput({ ...base, isDetermined: true })).toBe(
    "El contrato por tiempo determinado requiere una fecha de fin"
  )
  expect(validateWorkerContractInput({ ...base, endDate: "2023-12-31" })).toBe(
    "La fecha de fin debe ser posterior al inicio"
  )
  expect(validateWorkerContractInput({ ...base, signatureDate: "" })).toBe(
    "La fecha de firma del contrato es obligatoria"
  )
  expect(validateWorkerContractInput({ ...base, signaturePlace: "" })).toBe(
    "El lugar de firma es obligatorio"
  )
  expect(validateWorkerContractInput({ ...base, paymentMethodId: "" })).toBe(
    "Selecciona la forma de pago"
  )
  expect(validateWorkerContractInput({ ...base, hasInvalidComponents: true })).toBe(
    "Revisa los conceptos retributivos: cada uno necesita descripción e importe válido (mayor o igual que 0)"
  )
  expect(validateWorkerContractInput({ ...base, blocking: ["Profesión u oficio"] })).toBe(
    "No se puede completar la formalización del contrato. Datos pendientes: Profesión u oficio"
  )
  expect(validateWorkerContractInput({ ...base, representativeAssignmentId: null })).toBe(
    MISSING_REPRESENTATIVE_MESSAGE
  )
})

test("las secciones del expediente validan sus propios datos", () => {
  // Experiencia laboral declarada por la persona.
  const experience = {
    jobTitle: "Contadora",
    companyName: "Empresa X",
    startDate: "2020-01-01",
    endDate: "",
    isCurrent: false,
  }
  expect(validateWorkExperienceInput(experience)).toBe("Indique la fecha de fin o marque «Puesto actual»")
  expect(validateWorkExperienceInput({ ...experience, isCurrent: true, endDate: "" })).toBeNull()
  expect(validateWorkExperienceInput({ ...experience, jobTitle: " " })).toBe(
    "El puesto de trabajo es obligatorio"
  )
  expect(validateWorkExperienceInput({ ...experience, companyName: "" })).toBe(
    "La empresa u organización es obligatoria"
  )
  expect(validateWorkExperienceInput({ ...experience, startDate: "" })).toBe(
    "La fecha de inicio es obligatoria"
  )
  expect(
    validateWorkExperienceInput({ ...experience, endDate: "2019-12-31" })
  ).toBe("La fecha de fin no puede ser anterior a la fecha de inicio")

  // Formación académica con su título adjunto opcional.
  const formation = { programName: "Licenciatura en Contabilidad", startDate: "2010-09-01", endDate: "", isStudying: false }
  expect(validateAcademicFormationInput(formation)).toBe(
    "Indique la fecha de fin o marque «Estudios en curso»"
  )
  expect(validateAcademicFormationInput({ ...formation, isStudying: true })).toBeNull()
  expect(validateAcademicFormationInput({ ...formation, programName: "" })).toBe(
    "Indique qué estudió (carrera o programa)"
  )
  expect(validateAcademicFormationInput({ ...formation, startDate: "" })).toBe(
    "La fecha de inicio es obligatoria"
  )
  expect(validateAcademicFormationInput({ ...formation, endDate: "2009-01-01" })).toBe(
    "La fecha de fin no puede ser anterior a la fecha de inicio"
  )

  // Notas e información adicional: el texto es obligatorio.
  expect(validateExpedienteText("   ", "El texto de la nota es obligatorio")).toBe(
    "El texto de la nota es obligatorio"
  )
  expect(validateExpedienteText("Nota", "El texto de la nota es obligatorio")).toBeNull()
  expect(validateExpedienteText("", "El texto de la información es obligatorio")).toBe(
    "El texto de la información es obligatorio"
  )
})

test("la unicidad de la persona sigue resolviéndose con el mismo criterio", () => {
  expect(personRegistrationConflict({ worker_id: "w-1", worker_status: "active" })).toBe(
    "Esta persona ya está registrada como trabajador. Solo puede actualizar su información."
  )
  expect(personRegistrationConflict({ worker_id: "w-1", worker_status: "inactive" })).toBe(
    "Esta persona ya existe y actualmente se encuentra en Reingresos. Debe utilizar el expediente existente."
  )
  expect(personRegistrationConflict({ candidate_count: 1 })).toBe(
    "Ya existe una persona con este número de identificación. Solo puede actualizar su información."
  )
  expect(personRegistrationConflict({ candidate_count: 0 })).toBeNull()
})

test("ninguna de las cuatro pantallas del expediente consulta Supabase directamente", () => {
  const screens = [
    "src/pages/CandidateDetail.tsx",
    "src/components/candidates/CandidateForm.tsx",
    "src/modules/people/presentation/pages/WorkerDetail.tsx",
    "src/components/workers/WorkerForm.tsx",
  ]

  for (const screen of screens) {
    const source = readFileSync(screen, "utf8")
    // Sin cliente de Supabase, sin RPC y sin Storage en la presentación.
    expect(source, `${screen} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${screen} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${screen} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    // El expediente se pide a los casos de uso del dominio Personas.
    expect(source, `${screen} debe consumir el dominio Personas`).toMatch(/@\/domains\/people/)
  }
})
