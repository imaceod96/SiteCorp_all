import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import { PENDING_ADDENDUM_STATUSES, isAddendumPending } from "../src/domains/contracts/domain/rules"

/**
 * INTEGRACIÓN DEL EXPEDIENTE — pestañas, contratos y documentos, diálogos laborales y alta de
 * candidatos.
 *
 * Comprueba dos cosas que no se ven en pantalla pero deciden si la arquitectura se mantiene:
 *   1. El criterio de negocio de los anexos pendientes no cambia al moverlo al contexto de
 *      contratos.
 *   2. Ningún componente de este bloque (pestañas del trabajador, anexos y contratos,
 *      diálogos laborales y listado de candidatos) habla con Supabase: todo pasa por los
 *      casos de uso de su dominio. Los servicios de contratos y de salario tampoco.
 *
 * Las importaciones son deliberadamente profundas (`domain/…`): las reglas son puras y no
 * arrastran el cliente de Supabase, igual que en el resto de pruebas del expediente.
 */

const read = (path: string) => readFileSync(path, "utf8")

test("los estados de un anexo pendiente se resuelven con la misma regla", () => {
  expect(PENDING_ADDENDUM_STATUSES).toEqual([
    "PENDING_TEMPLATE",
    "READY_TO_GENERATE",
    "GENERATION_ERROR",
  ])

  // Pendiente de formalizar: el anexo todavía no forma parte de las condiciones vigentes.
  expect(isAddendumPending("PENDING_TEMPLATE")).toBe(true)
  expect(isAddendumPending("READY_TO_GENERATE")).toBe(true)
  expect(isAddendumPending("GENERATION_ERROR")).toBe(true)

  // Formalizado, generado o cancelado: ya no se cuenta como pendiente.
  expect(isAddendumPending("FORMALIZED")).toBe(false)
  expect(isAddendumPending("GENERATED")).toBe(false)
  expect(isAddendumPending("CANCELLED")).toBe(false)
})

test("el contexto de contratos concentra las consultas del contrato, del anexo y del salario", () => {
  const repositories = [
    "src/domains/contracts/infrastructure/addendums.repository.ts",
    "src/domains/contracts/infrastructure/contract-conditions.repository.ts",
    "src/domains/contracts/infrastructure/salary.repository.ts",
  ]

  for (const repository of repositories) {
    const source = read(repository)
    expect(source, `${repository} es la frontera de Supabase`).toMatch(/@\/lib\/supabase/)
  }

  // La automatización documental del contrato ya no es una frontera de Supabase: la vigencia de
  // la plantilla la resuelve el dominio de plantillas y la generación, el motor documental.
  const contractDocuments = read(
    "src/domains/contracts/infrastructure/contract-documents.repository.ts"
  )
  expect(contractDocuments).not.toMatch(/@\/lib\/supabase/)
  expect(contractDocuments).toMatch(/from "@\/domains\/document-generation"/)
  expect(contractDocuments).toMatch(/from "@\/domains\/document-templates"/)
  expect(contractDocuments).toMatch(/resolveDocumentTemplateVersion\(/)

  // Los casos de uso de la aplicación no hablan con Supabase ni con el motor documental.
  const useCases = [
    "src/domains/contracts/application/addendums.queries.ts",
    "src/domains/contracts/application/addendums.commands.ts",
    "src/domains/contracts/application/contract-conditions.queries.ts",
    "src/domains/contracts/application/salary.queries.ts",
    "src/domains/contracts/application/salary.commands.ts",
  ]

  for (const useCase of useCases) {
    const source = read(useCase)
    expect(source, `${useCase} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${useCase} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${useCase} no debe usar Storage`).not.toMatch(/supabase\.storage/)
  }

  // La interfaz pública del contexto expone lo que consumen las pantallas y los diálogos.
  const index = read("src/domains/contracts/index.ts")
  for (const symbol of [
    "fetchWorkerAddendums",
    "fetchAddendumPending",
    "fetchWorkerContractualConditions",
    "createManualAddendum",
    "formalizeAddendum",
    "cancelAddendum",
    "fetchPaymentMethods",
    "fetchContractFormalizationPending",
    "fetchComponentsByContract",
    "fetchContractConditions",
    "fetchWorkerSalaryHistory",
    "previewSalaryChange",
    "fetchSalaryChangeImpact",
    "applySalaryChange",
    "finalizeSalaryChangeEvent",
    "resolveContractTemplateAvailability",
    "resolveAddendumTemplateAvailability",
    "ensureContractDocumentGenerated",
    "ensureAddendumDocumentGenerated",
  ]) {
    expect(index, `el contexto de contratos debe exportar ${symbol}`).toContain(symbol)
  }
})

test("los servicios de contratos y de salario ya no consultan Supabase", () => {
  const services = [
    "src/lib/addendums.ts",
    "src/lib/contract-conditions.ts",
    "src/lib/contract-automation.ts",
    "src/lib/worker-salary.ts",
  ]

  for (const service of services) {
    const source = read(service)
    expect(source, `${service} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${service} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
  }
})

test("las pestañas del trabajador y los diálogos laborales consumen sus dominios", () => {
  const peopleScreens = [
    "src/components/workers/WorkerDocumentsTab.tsx",
    "src/components/medical-certificates/MedicalCertificateFormDialog.tsx",
    "src/components/migration/MigratedWorkerDialog.tsx",
    "src/components/workers/SeparateWorkerDialog.tsx",
    "src/components/workers/ChangePositionDialog.tsx",
    "src/components/workers/ChangeContractDialog.tsx",
    "src/components/workers/ReincorporateWorkerDialog.tsx",
  ]

  for (const screen of peopleScreens) {
    const source = read(screen)
    expect(source, `${screen} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${screen} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${screen} no debe usar Storage`).not.toMatch(/supabase\.storage/)
  }

  const contractsScreens = [
    "src/components/addendums/ContractAddendumsSection.tsx",
    "src/components/addendums/AddendumDetailDialog.tsx",
    "src/components/addendums/CreateManualAddendumDialog.tsx",
    "src/components/contracts/ContractFormalizationAlerts.tsx",
    "src/components/salary/ReviewSalaryChangeDialog.tsx",
  ]

  for (const screen of contractsScreens) {
    const source = read(screen)
    expect(source, `${screen} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${screen} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${screen} debe consumir el contexto de contratos`).toMatch(
      /@\/domains\/contracts/
    )
  }

  // Las dos pestañas ya migradas siguen consumiendo sus propios dominios.
  expect(read("src/components/vacations/WorkerVacationsTab.tsx")).toMatch(
    /@\/domains\/vacations-licenses/
  )
  expect(read("src/components/worker/WorkerMedicalCertificatesTab.tsx")).toMatch(
    /@\/domains\/vacations-licenses/
  )
})

test("la pestaña de documentos resuelve su expediente con el dominio Personas", () => {
  const tab = read("src/components/workers/WorkerDocumentsTab.tsx")
  expect(tab).toMatch(/@\/domains\/people/)
  expect(tab).toMatch(/loadWorkerDocumentsView/)
  expect(tab).toMatch(/uploadWorkerDocument/)
  expect(tab).toMatch(/deleteWorkerDocument/)
  expect(tab).not.toMatch(/worker_documents/)
  expect(tab).not.toMatch(/crypto\.randomUUID/)

  const commands = read("src/domains/people/application/worker-documents.commands.ts")
  expect(commands).toMatch(/EXPEDIENTE_SIGNED_URL_TTL/)
  expect(commands).not.toMatch(/@\/lib\/supabase/)

  const repository = read("src/domains/people/infrastructure/worker-expediente.repository.ts")
  expect(repository, "worker_documents se consulta en un único repositorio").toMatch(
    /"worker_documents"/
  )
  expect(repository).toMatch(/sanitizeFileName/)
})

test("el listado de candidatos y la ficha de edición comparten un único formulario", () => {
  const list = read("src/pages/EntityCandidates.tsx")
  expect(list).toMatch(/components\/candidates\/CandidateForm/)
  expect(list).toMatch(/mode="create"/)
  // Sin formulario paralelo: no hay estado de formulario ni datos vacíos propios del listado.
  expect(list).not.toMatch(/emptyFormData/)
  expect(list).not.toMatch(/CandidateFormData/)
  expect(list).not.toMatch(/candidateRequiresSpecialty/)

  const form = read("src/components/candidates/CandidateForm.tsx")
  expect(form, "el alta la resuelve el caso de uso del dominio").toMatch(/registerCandidate/)
  expect(form, "la edición la resuelve el caso de uso del dominio").toMatch(
    /updateCandidateExpediente/
  )
  expect(form, "las reglas del alta las aporta el dominio").toMatch(/validateCandidateRegistration/)
  expect(form, "la especialidad depende del nivel educacional (regla del dominio)").toMatch(
    /candidateRequiresSpecialty/
  )
  expect(form, "el documento disciplinario viaja con el alta").toMatch(/disciplinary_document/)
})
