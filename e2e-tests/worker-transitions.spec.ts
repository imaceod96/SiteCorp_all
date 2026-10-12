import { test, expect } from "@playwright/test"
import {
  TRANSITION_EFFECTS,
  TRANSITION_MOVEMENT_DOCUMENT,
  buildEmploymentIndex,
  formatReadinessMessage,
  isActiveWorker,
  isPendingCandidate,
  isReentryWorker,
  isSpecialDocumentRole,
  requiresResolution,
  validateContractChangeInput,
  validateHireInput,
  validatePositionChangeInput,
  validateReincorporationInput,
  validateSeparationInput,
} from "../src/domains/people/domain/rules"
import type {
  ContractFormalizationInput,
  PeopleView,
  ReadinessResult,
  WorkerTransitionKind,
} from "../src/domains/people/domain/entities"

/**
 * CONTRATACIÓN Y TRANSICIONES LABORALES — cinco flujos.
 *
 * Comprueba la lógica del dominio que gobierna las operaciones del bloque, sin tocar
 * datos reales ni Supabase:
 *
 *   1. Contratar candidato            → Candidatos  → Trabajadores
 *   2. Dar de baja al trabajador      → Trabajadores → Reingresos
 *   3. Recontratar antiguo trabajador → Reingresos → Trabajadores
 *   4. Reubicar trabajador            → sigue en Trabajadores (nueva asignación)
 *   5. Cambiar tipo de contrato       → sigue en Trabajadores (contrato nuevo)
 *
 * La simulación usa las MISMAS tablas de efecto (`TRANSITION_EFFECTS`) y los MISMOS
 * predicados de clasificación que la aplicación (`isPendingCandidate`, `isActiveWorker`,
 * `isReentryWorker`), y comprueba además que ninguna operación pierde personas,
 * contratos ni asignaciones (reglas 6 y 7 del enunciado).
 *
 * El dominio no importa `@/lib/*` ni Supabase, por eso puede verificarse en aislamiento.
 */

// ---------------------------------------------------------------------------
// Simulación en memoria de las filas que tocan las transiciones
// ---------------------------------------------------------------------------

interface SimAssignment {
  workerId: string
  positionId: string
  current: boolean
}

interface SimContract {
  contractId: string
  current: boolean
}

interface SimPerson {
  identification: string
  /** Fila de candidato (puede quedar de un alta anterior). */
  candidate: { worker_id: string | null } | null
  workerIds: string[]
  employmentStatus: string | null
  assignments: SimAssignment[]
  contracts: SimContract[]
}

const NEW_PERSON: SimPerson = {
  identification: "CI-NUEVO",
  candidate: { worker_id: null },
  workerIds: [],
  employmentStatus: null,
  assignments: [],
  contracts: [],
}

const clone = (person: SimPerson): SimPerson => ({
  ...person,
  candidate: person.candidate ? { ...person.candidate } : null,
  workerIds: [...person.workerIds],
  assignments: person.assignments.map((a) => ({ ...a })),
  contracts: person.contracts.map((c) => ({ ...c })),
})

/**
 * Aplica el efecto de una transición sobre la persona. La identidad de persona
 * (cliente + identificación) es única: las operaciones NUNCA crean otra persona, solo
 * abren o cierran períodos.
 */
const applyTransition = (
  input: SimPerson,
  kind: WorkerTransitionKind,
  workerId: string
): SimPerson => {
  const person = clone(input)
  const effect = TRANSITION_EFFECTS[kind]

  if (kind === "hire" || kind === "reincorporation") {
    if (!person.workerIds.includes(workerId)) person.workerIds.push(workerId)
    person.employmentStatus = "active"
    if (person.candidate) person.candidate.worker_id = workerId
    person.assignments = person.assignments.map((a) => ({ ...a, current: false }))
    person.contracts = person.contracts.map((c) => ({ ...c, current: false }))
    if (effect.assignment === "created") {
      person.assignments.push({ workerId, positionId: "pos-nueva", current: true })
    }
    if (effect.contract === "created") {
      person.contracts.push({ contractId: `c-${person.contracts.length + 1}`, current: true })
    }
    return person
  }

  if (kind === "separation") {
    person.employmentStatus = "inactive"
    person.assignments = person.assignments.map((a) => ({ ...a, current: false }))
    person.contracts = person.contracts.map((c) => ({ ...c, current: false }))
    return person
  }

  if (kind === "position_change") {
    person.assignments = person.assignments.map((a) => ({ ...a, current: false }))
    person.assignments.push({ workerId, positionId: "pos-reubicado", current: true })
    return person
  }

  // contract_change
  person.contracts = person.contracts.map((c) => ({ ...c, current: false }))
  person.contracts.push({ contractId: `c-${person.contracts.length + 1}`, current: true })
  return person
}

/** Vistas operativas en las que aparece la persona (predicados reales del dominio). */
const viewsOf = (person: SimPerson): PeopleView[] => {
  const index = buildEmploymentIndex(
    person.workerIds.map(() => ({
      identification: person.identification,
      employment_status: person.employmentStatus,
    }))
  )
  const views = new Set<PeopleView>()
  if (person.candidate && isPendingCandidate(person.candidate, index)) views.add("candidates")
  if (person.workerIds.length > 0) {
    const worker = { identification: person.identification, employment_status: person.employmentStatus }
    if (isActiveWorker(worker)) views.add("workers")
    else if (isReentryWorker(worker, index)) views.add("reentries")
  }
  return Array.from(views)
}

test("1. contratar candidato: pasa a Trabajadores con asignación y contrato", () => {
  const candidate = clone(NEW_PERSON)
  expect(viewsOf(candidate)).toEqual(["candidates"])

  const hired = applyTransition(candidate, "hire", "w-1")
  expect(viewsOf(hired)).toEqual(["workers"])
  expect(hired.assignments.filter((a) => a.current)).toHaveLength(1)
  expect(hired.contracts.filter((c) => c.current)).toHaveLength(1)
  expect(hired.candidate?.worker_id).toBe("w-1")
  // La identidad de persona NO se duplica: la fila de candidato se vincula al trabajador.
  expect(hired.workerIds).toEqual(["w-1"])
})

test("2. dar de baja: pasa a Reingresos y conserva el historial", () => {
  const hired = applyTransition(clone(NEW_PERSON), "hire", "w-1")
  const separated = applyTransition(hired, "separation", "w-1")

  expect(viewsOf(separated)).toEqual(["reentries"])
  // No se pierde nada: asignación y contrato siguen en el expediente, ya cerrados.
  expect(separated.assignments).toHaveLength(hired.assignments.length)
  expect(separated.contracts).toHaveLength(hired.contracts.length)
  expect(separated.assignments.some((a) => a.current)).toBe(false)
  expect(separated.contracts.some((c) => c.current)).toBe(false)
})

test("3. recontratar antiguo trabajador: vuelve a Trabajadores sin duplicar la persona", () => {
  const hired = applyTransition(clone(NEW_PERSON), "hire", "w-1")
  const separated = applyTransition(hired, "separation", "w-1")
  expect(viewsOf(separated)).toEqual(["reentries"])

  const reincorporated = applyTransition(separated, "reincorporation", "w-1")

  expect(viewsOf(reincorporated)).toEqual(["workers"])
  // Un solo expediente de trabajador y el período anterior intacto.
  expect(reincorporated.workerIds).toEqual(["w-1"])
  expect(reincorporated.assignments.length).toBe(separated.assignments.length + 1)
  expect(reincorporated.contracts.length).toBe(separated.contracts.length + 1)
  expect(reincorporated.assignments.filter((a) => a.current)).toHaveLength(1)
})

test("4. reubicar trabajador: sigue en Trabajadores y conserva contratos y trayectoria", () => {
  const hired = applyTransition(clone(NEW_PERSON), "hire", "w-1")
  const moved = applyTransition(hired, "position_change", "w-1")

  expect(viewsOf(moved)).toEqual(["workers"])
  // Asignación nueva vigente y la anterior conservada (cerrada).
  expect(moved.assignments).toHaveLength(hired.assignments.length + 1)
  expect(moved.assignments.filter((a) => a.current)).toHaveLength(1)
  // Cambiar de puesto NO toca el contrato: mismo número de contratos.
  expect(moved.contracts).toEqual(hired.contracts)
})

test("5. cambiar de contrato: sigue en Trabajadores y conserva el contrato anterior", () => {
  const hired = applyTransition(clone(NEW_PERSON), "hire", "w-1")
  const changed = applyTransition(hired, "contract_change", "w-1")

  expect(viewsOf(changed)).toEqual(["workers"])
  expect(changed.contracts).toHaveLength(hired.contracts.length + 1)
  expect(changed.contracts.filter((c) => c.current)).toHaveLength(1)
  // Cambiar de contrato NO toca la asignación de puesto.
  expect(changed.assignments).toEqual(hired.assignments)
})

test("la tabla de efectos mantiene a la persona en una sola vista", () => {
  const asCandidate = clone(NEW_PERSON)
  const asWorker = applyTransition(asCandidate, "hire", "w-1")
  const asReentry = applyTransition(asWorker, "separation", "w-1")

  expect(TRANSITION_EFFECTS.hire.view).toBe("workers")
  expect(TRANSITION_EFFECTS.separation.view).toBe("reentries")
  expect(TRANSITION_EFFECTS.reincorporation.view).toBe("workers")
  expect(TRANSITION_EFFECTS.position_change.view).toBe("workers")
  expect(TRANSITION_EFFECTS.contract_change.view).toBe("workers")

  // Ninguna operación deja a la persona en dos vistas a la vez.
  ;[asCandidate, asWorker, asReentry].forEach((person) => {
    expect(viewsOf(person).length).toBeLessThanOrEqual(1)
  })
  // Y el historial siempre se conserva.
  Object.values(TRANSITION_EFFECTS).forEach((effect) => {
    expect(effect.preservesHistory).toBe(true)
  })
})

test("el movimiento de nómina documentado es el que corresponde a cada operación", () => {
  expect(TRANSITION_MOVEMENT_DOCUMENT.hire).toBe("ALTA")
  expect(TRANSITION_MOVEMENT_DOCUMENT.separation).toBe("BAJA")
  expect(TRANSITION_MOVEMENT_DOCUMENT.position_change).toBe("REUBICACION")
  // La reincorporación y el cambio de contrato se documentan con contrato/Resolución.
  expect(TRANSITION_MOVEMENT_DOCUMENT.reincorporation).toBeNull()
  expect(TRANSITION_MOVEMENT_DOCUMENT.contract_change).toBeNull()
})

test("el Cargo decide el documento: Resolución solo para Especialista Principal", () => {
  expect(requiresResolution({ is_cuadro: true, is_principal_specialist: false })).toBe(false)
  expect(requiresResolution({ is_cuadro: false, is_principal_specialist: true })).toBe(true)
  expect(requiresResolution({})).toBe(false)

  expect(isSpecialDocumentRole({ is_cuadro: true })).toBe(true)
  expect(isSpecialDocumentRole({ is_principal_specialist: true })).toBe(true)
  expect(isSpecialDocumentRole({})).toBe(false)
})

// ---------------------------------------------------------------------------
// Validaciones previas (mensajes que ve el usuario, en su orden)
// ---------------------------------------------------------------------------

const FORMALIZATION: ContractFormalizationInput = {
  representativeAssignmentId: "rep-1",
  signatureDate: "2026-03-01",
  signaturePlace: "La Habana",
  paymentMethodId: "pm-1",
  paymentScheduleText: "",
  hasInvalidComponents: false,
  blocking: [],
}

const READY: ReadinessResult = { ready: true, missing: [] }

const hireInput = (overrides: Partial<Parameters<typeof validateHireInput>[0]> = {}) => ({
  hasCandidate: true,
  positionId: "pos-1",
  hireDate: "2026-03-01",
  resolutionDocument: false,
  skipsContractTerms: false,
  contractTypeId: "ct-1",
  signatureDate: "2026-03-01",
  formalization: FORMALIZATION,
  readiness: READY,
  templateBlockedMessage: null,
  isDetermined: false,
  contractStartDate: "",
  contractEndDate: "",
  ...overrides,
})

test("contratación: sin datos obligatorios no se lanza la operación", () => {
  expect(validateHireInput(hireInput())).toBeNull()
  expect(validateHireInput(hireInput({ hasCandidate: false }))).toBe(
    "Selecciona la persona a contratar."
  )
  expect(validateHireInput(hireInput({ positionId: "" }))).toBe("Selecciona un puesto.")
  expect(validateHireInput(hireInput({ hireDate: "" }))).toBe(
    "La fecha de incorporación es obligatoria."
  )
  expect(validateHireInput(hireInput({ contractTypeId: "" }))).toBe(
    "Selecciona un tipo de contrato."
  )
  expect(validateHireInput(hireInput({ signatureDate: "" }))).toBe(
    "La fecha de firma del contrato es obligatoria."
  )
  expect(
    validateHireInput(hireInput({ formalization: { ...FORMALIZATION, signaturePlace: " " } }))
  ).toBe("El lugar de firma es obligatorio.")
  expect(
    validateHireInput(hireInput({ formalization: { ...FORMALIZATION, paymentMethodId: "" } }))
  ).toBe("Selecciona la forma de pago.")
  expect(
    validateHireInput(
      hireInput({ formalization: { ...FORMALIZATION, hasInvalidComponents: true } })
    )
  ).toContain("Revisa los conceptos retributivos")
  expect(
    validateHireInput(
      hireInput({
        formalization: { ...FORMALIZATION, blocking: ["Fecha de nacimiento"] },
      })
    )
  ).toBe(
    "No se puede completar la formalización del contrato. Datos pendientes: Fecha de nacimiento"
  )
  expect(
    validateHireInput(
      hireInput({ formalization: { ...FORMALIZATION, representativeAssignmentId: null } })
    )
  ).toContain("No existe ningún representante autorizado configurado")
})

test("contratación: la preparación contractual y la plantilla bloquean el alta", () => {
  const notReady: ReadinessResult = {
    ready: false,
    missing: [
      { code: "ci", label: "Carné de identidad", source: null, sourceId: null, section: "Candidato" },
    ],
  }
  expect(validateHireInput(hireInput({ readiness: notReady }))).toContain(
    "No se puede realizar la contratación."
  )
  expect(
    validateHireInput(hireInput({ templateBlockedMessage: "No hay plantilla para este contrato." }))
  ).toBe("No hay plantilla para este contrato.")
})

test("contratación: la vigencia del contrato por tiempo determinado", () => {
  expect(
    validateHireInput(hireInput({ isDetermined: true, contractEndDate: "" }))
  ).toBe("El contrato por tiempo determinado requiere una fecha final.")
  expect(
    validateHireInput(
      hireInput({ isDetermined: true, contractEndDate: "2026-02-01", contractStartDate: "2026-03-01" })
    )
  ).toBe("La fecha final del contrato debe ser posterior a su inicio.")
})

test("contratación por Resolución: no se exigen las condiciones del contrato", () => {
  // Cargo Especialista Principal: la Resolución sustituye al contrato.
  expect(
    validateHireInput(
      hireInput({
        resolutionDocument: true,
        contractTypeId: "",
        signatureDate: "",
        formalization: {
          ...FORMALIZATION,
          representativeAssignmentId: null,
          signaturePlace: "",
          paymentMethodId: "",
        },
      })
    )
  ).toBeNull()
})

test("Cargo Cuadro: no exige tipo de contrato ni plantilla, pero sí las condiciones", () => {
  expect(
    validateHireInput(hireInput({ skipsContractTerms: true, contractTypeId: "", signatureDate: "" }))
  ).toBeNull()
  expect(
    validateHireInput(
      hireInput({
        skipsContractTerms: true,
        contractTypeId: "",
        signatureDate: "",
        formalization: { ...FORMALIZATION, signaturePlace: "" },
      })
    )
  ).toBe("El lugar de firma es obligatorio.")
})

const reincorporationInput = (
  overrides: Partial<Parameters<typeof validateReincorporationInput>[0]> = {}
) => ({
  positionId: "pos-1",
  reincorporationDate: "2026-03-01",
  resolutionDocument: false,
  contractTypeId: "ct-1",
  signatureDate: "2026-03-01",
  formalization: FORMALIZATION,
  isDetermined: false,
  contractStartDate: "",
  contractEndDate: "",
  ...overrides,
})

test("reincorporación: exige puesto, fecha, contrato y condiciones", () => {
  expect(validateReincorporationInput(reincorporationInput())).toBeNull()
  expect(validateReincorporationInput(reincorporationInput({ positionId: "" }))).toBe(
    "Selecciona un nuevo puesto."
  )
  expect(validateReincorporationInput(reincorporationInput({ reincorporationDate: "" }))).toBe(
    "La fecha de reincorporación es obligatoria."
  )
  expect(
    validateReincorporationInput(reincorporationInput({ resolutionDocument: true, contractTypeId: "" }))
  ).toBeNull()
  expect(validateReincorporationInput(reincorporationInput({ contractTypeId: "" }))).toBe(
    "Selecciona un tipo de contrato."
  )
  expect(
    validateReincorporationInput(
      reincorporationInput({ isDetermined: true, contractEndDate: "" })
    )
  ).toBe("El contrato por tiempo determinado requiere una fecha de fin.")
  expect(
    validateReincorporationInput(
      reincorporationInput({
        isDetermined: true,
        contractStartDate: "2026-03-01",
        contractEndDate: "2026-01-01",
      })
    )
  ).toBe("La fecha de fin del contrato debe ser posterior a su inicio.")
  expect(
    validateReincorporationInput(
      reincorporationInput({
        formalization: { ...FORMALIZATION, representativeAssignmentId: null },
      })
    )
  ).toBe("No hay representantes configurados para la fecha de firma seleccionada.")
})

test("baja: fecha efectiva, motivo y no anterior al inicio del puesto actual", () => {
  expect(
    validateSeparationInput({
      effectiveDate: "2026-03-10",
      currentPositionStartDate: "2026-01-01",
      separationReasonId: "reason-1",
    })
  ).toBeNull()
  expect(
    validateSeparationInput({
      effectiveDate: "",
      currentPositionStartDate: null,
      separationReasonId: "reason-1",
    })
  ).toBe("La fecha efectiva de baja es obligatoria.")
  expect(
    validateSeparationInput({
      effectiveDate: "2025-12-31",
      currentPositionStartDate: "2026-01-01",
      separationReasonId: "reason-1",
    })
  ).toBe("La fecha de baja no puede ser anterior al inicio del puesto actual.")
  expect(
    validateSeparationInput({
      effectiveDate: "2026-03-10",
      currentPositionStartDate: "2026-01-01",
      separationReasonId: "",
    })
  ).toBe("Selecciona un motivo de baja.")
})

const contractChangeInput = (
  overrides: Partial<Parameters<typeof validateContractChangeInput>[0]> = {}
) => ({
  newContractTypeId: "ct-2",
  effectiveDate: "2026-04-01",
  currentContractStartDate: "2026-01-01",
  isDetermined: false,
  newEndDate: "",
  signatureDate: "2026-04-01",
  formalization: FORMALIZATION,
  ...overrides,
})

test("cambio de contrato: vigencia del contrato nuevo y condiciones formalizadas", () => {
  expect(validateContractChangeInput(contractChangeInput())).toBeNull()
  expect(validateContractChangeInput(contractChangeInput({ newContractTypeId: "" }))).toBe(
    "Selecciona el nuevo tipo de contrato."
  )
  expect(validateContractChangeInput(contractChangeInput({ effectiveDate: "" }))).toBe(
    "La fecha efectiva es obligatoria."
  )
  expect(validateContractChangeInput(contractChangeInput({ effectiveDate: "2026-01-01" }))).toBe(
    "La fecha efectiva debe ser posterior al inicio del contrato vigente."
  )
  expect(
    validateContractChangeInput(contractChangeInput({ isDetermined: true, newEndDate: "" }))
  ).toBe("El contrato por tiempo determinado requiere una fecha de finalización.")
  expect(
    validateContractChangeInput(
      contractChangeInput({ isDetermined: true, newEndDate: "2026-03-01" })
    )
  ).toBe("La fecha de finalización debe ser posterior a la fecha efectiva.")
  expect(validateContractChangeInput(contractChangeInput({ signatureDate: "" }))).toBe(
    "La fecha de firma del contrato es obligatoria."
  )
  expect(
    validateContractChangeInput(
      contractChangeInput({
        formalization: { ...FORMALIZATION, representativeAssignmentId: null },
      })
    )
  ).toBe("No hay representantes configurados para la fecha de firma seleccionada.")
  // El contrato anterior se conserva: nada en la validación lo elimina.
  expect(
    validateContractChangeInput(
      contractChangeInput({ isDetermined: true, newEndDate: "2026-05-01" })
    )
  ).toBeNull()
})

const positionChangeInput = (
  overrides: Partial<Parameters<typeof validatePositionChangeInput>[0]> = {}
) => ({
  newPositionId: "pos-2",
  effectiveDate: "2026-04-01",
  currentPositionStartDate: "2026-01-01",
  addendum: {
    create: false,
    formalize: false,
    previewLoading: false,
    signatureDate: "",
    signaturePlace: "",
    representativeAssignmentId: null,
    templateBlockedMessage: null,
  },
  ...overrides,
})

test("reubicación: exige puesto destino y fecha posterior al puesto actual", () => {
  expect(validatePositionChangeInput(positionChangeInput())).toBeNull()
  expect(validatePositionChangeInput(positionChangeInput({ newPositionId: "" }))).toBe(
    "Selecciona un nuevo puesto."
  )
  expect(validatePositionChangeInput(positionChangeInput({ effectiveDate: "" }))).toBe(
    "La fecha efectiva es obligatoria."
  )
  expect(
    validatePositionChangeInput(positionChangeInput({ effectiveDate: "2026-01-01" }))
  ).toBe("La fecha efectiva debe ser posterior al inicio del puesto actual.")
  expect(
    validatePositionChangeInput(
      positionChangeInput({ addendum: { ...positionChangeInput().addendum, previewLoading: true } })
    )
  ).toBe("Espere a que se calculen las diferencias contractuales.")
})

test("reubicación con anexo: el anexo formalizado exige firma, lugar, representante y plantilla", () => {
  const createAddendum = {
    ...positionChangeInput().addendum,
    create: true,
    formalize: true,
  }

  // Sin formalizar no se exige nada del anexo.
  expect(
    validatePositionChangeInput(
      positionChangeInput({ addendum: { ...createAddendum, formalize: false } })
    )
  ).toBeNull()

  expect(validatePositionChangeInput(positionChangeInput({ addendum: createAddendum }))).toBe(
    "La fecha de firma es obligatoria para formalizar el anexo."
  )
  expect(
    validatePositionChangeInput(
      positionChangeInput({
        addendum: { ...createAddendum, signatureDate: "2026-04-01" },
      })
    )
  ).toBe("El lugar de firma es obligatorio para formalizar el anexo.")
  expect(
    validatePositionChangeInput(
      positionChangeInput({
        addendum: {
          ...createAddendum,
          signatureDate: "2026-04-01",
          signaturePlace: "La Habana",
        },
      })
    )
  ).toBe("Seleccione el representante vigente en la fecha de firma del anexo.")
  expect(
    validatePositionChangeInput(
      positionChangeInput({
        addendum: {
          ...createAddendum,
          signatureDate: "2026-04-01",
          signaturePlace: "La Habana",
          representativeAssignmentId: "rep-1",
          templateBlockedMessage: "No hay plantilla de anexo vigente.",
        },
      })
    )
  ).toBe("No hay plantilla de anexo vigente.")
  expect(
    validatePositionChangeInput(
      positionChangeInput({
        addendum: {
          ...createAddendum,
          signatureDate: "2026-04-01",
          signaturePlace: "La Habana",
          representativeAssignmentId: "rep-1",
        },
      })
    )
  ).toBeNull()
})

// ---------------------------------------------------------------------------
// Mensaje humano de la preparación contractual
// ---------------------------------------------------------------------------

test("el mensaje de preparación agrupa por sección, sin repetir y en orden", () => {
  const message = formatReadinessMessage({
    ready: false,
    missing: [
      { code: "rep", label: "Representante vigente", source: null, sourceId: null, section: "Representante" },
      { code: "ci", label: "Carné de identidad", source: null, sourceId: null, section: "Candidato" },
      { code: "ci2", label: "Carné de identidad", source: null, sourceId: null, section: "Candidato" },
      { code: "dir", label: "Dirección", source: null, sourceId: null, section: "Candidato" },
    ],
  })

  expect(message).toContain("No se puede realizar la contratación.")
  // Sección de datos personales primero (orden canónico) con sus datos, sin duplicados.
  expect(message).toContain("Datos personales\n• Carné de identidad\n• Dirección")
  expect(message).toContain("Representante\n• Representante vigente")
  expect(message.split("Carné de identidad")).toHaveLength(2)
  expect(message.indexOf("Datos personales")).toBeLessThan(message.indexOf("Representante"))
})

test("sin datos faltantes no hay mensaje de bloqueo", () => {
  expect(formatReadinessMessage(READY)).toBe("")
  expect(formatReadinessMessage(null)).toBe("")
})
