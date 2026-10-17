import { test, expect } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import type {
  AddendumReasonCode,
  AddendumStatus,
} from "../src/domains/contracts/domain/entities"
import {
  ADDENDUM_FIELD_LABELS,
  ADDENDUM_REASON_LABELS,
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  MANUAL_ADDENDUM_REASON_CODES,
  addendumFieldLabel,
  addendumReasonLabel,
} from "../src/domains/contracts/domain/addendum-labels"
import { SALARY_CHANGE_TYPE_LABELS } from "../src/domains/contracts/domain/salary-labels"
import {
  COMPENSATION_COMPONENT_TYPES,
  EMPTY_FORMALIZATION_PENDING,
  buildComponentsPayload,
  componentAmountValue,
  componentTypeLabel,
  componentsTotal,
  hasInvalidComponent,
  newComponentDraft,
  toComponentDrafts,
  type CompensationComponentDraft,
} from "../src/domains/contracts/domain/compensation.rules"
import {
  formatConditionDate,
  formatContractDate,
  formatContractMoney,
} from "../src/domains/contracts/domain/formats"
import { formatContractDate as alertsFormatContractDate } from "../src/domains/contracts/domain/contract-alerts.rules"
import {
  MISSING_ADDENDUM_TEMPLATE_MESSAGE,
  missingContractTemplateMessage,
} from "../src/domains/contracts/domain/automation.messages"
import { PENDING_ADDENDUM_STATUSES, isAddendumPending } from "../src/domains/contracts/domain/rules"

/**
 * NÚCLEO CONTRACTUAL (BLOQUE 9) — anexos, condiciones, automatización e historial salarial.
 *
 * Los cuatro módulos de `src/lib` que repartían estas responsabilidades se trasladaron a las
 * reglas puras del dominio de contratos. Esta prueba fija los contratos que NO pueden cambiar
 * al moverlos: etiquetas y motivos del anexo, estados y vigencias, conceptos retributivos y su
 * payload, formatos (una sola implementación), historial salarial y los textos exactos de la
 * automatización documental.
 *
 * Son contratos de código y de reglas puras con datos simulados en memoria: no hay ninguna
 * escritura ni consulta contra Supabase (la validación funcional de esos flujos requiere la
 * base de datos real y no forma parte de este bloque).
 */

const read = (path: string) => readFileSync(path, "utf8")

const ALL_STATUSES: AddendumStatus[] = [
  "PENDING_TEMPLATE",
  "READY_TO_GENERATE",
  "GENERATED",
  "GENERATION_ERROR",
  "FORMALIZED",
  "CANCELLED",
]

const ALL_REASONS: AddendumReasonCode[] = [
  "POSITION_CHANGE",
  "SALARY_CHANGE",
  "COMPENSATION_CHANGE",
  "PAYMENT_METHOD_CHANGE",
  "WORK_LOCATION_CHANGE",
  "WORK_SCHEDULE_CHANGE",
  "OTHER",
]

const draft = (patch: Partial<CompensationComponentDraft>): CompensationComponentDraft => ({
  key: "fila-1",
  component_type: "ADDITIONAL_PAYMENT",
  description: "",
  amount: "",
  ...patch,
})

/* ------------------------------------------------------------------ */
/* 1. Estados del anexo: etiquetas, colores y vigencias                */
/* ------------------------------------------------------------------ */

test("cada estado del anexo tiene etiqueta y color, sin huecos ni sobrantes", () => {
  expect(Object.keys(ADDENDUM_STATUS_LABELS).sort()).toEqual([...ALL_STATUSES].sort())
  expect(Object.keys(ADDENDUM_STATUS_BADGE).sort()).toEqual([...ALL_STATUSES].sort())

  for (const status of ALL_STATUSES) {
    expect(ADDENDUM_STATUS_LABELS[status], `${status} tiene etiqueta`).toBeTruthy()
    expect(
      ["success", "warning", "danger", "info", "neutral"],
      `${status} tiene color válido`
    ).toContain(ADDENDUM_STATUS_BADGE[status])
  }

  // El sentido de negocio no cambió al mover las etiquetas al dominio.
  expect(ADDENDUM_STATUS_LABELS.PENDING_TEMPLATE).toBe("Pendiente de formalizar")
  expect(ADDENDUM_STATUS_LABELS.FORMALIZED).toBe("Formalizado")
  expect(ADDENDUM_STATUS_BADGE.GENERATION_ERROR).toBe("danger")
  expect(ADDENDUM_STATUS_BADGE.CANCELLED).toBe("neutral")
})

test("los estados que todavía no formalizan el anexo siguen siendo los mismos", () => {
  expect(PENDING_ADDENDUM_STATUSES).toEqual([
    "PENDING_TEMPLATE",
    "READY_TO_GENERATE",
    "GENERATION_ERROR",
  ])

  for (const status of PENDING_ADDENDUM_STATUSES) {
    expect(isAddendumPending(status)).toBe(true)
    expect(ADDENDUM_STATUS_LABELS[status], `${status} es un estado conocido`).toBeTruthy()
  }

  expect(isAddendumPending("FORMALIZED")).toBe(false)
  expect(isAddendumPending("GENERATED")).toBe(false)
  expect(isAddendumPending("CANCELLED")).toBe(false)
})

/* ------------------------------------------------------------------ */
/* 2. Motivos y campos del anexo (textos mostrados al usuario)          */
/* ------------------------------------------------------------------ */

test("los motivos del anexo conservan sus textos y el manual no edita puesto ni escala", () => {
  expect(Object.keys(ADDENDUM_REASON_LABELS).sort()).toEqual([...ALL_REASONS].sort())

  for (const reason of ALL_REASONS) {
    expect(ADDENDUM_REASON_LABELS[reason], `${reason} tiene etiqueta`).toBeTruthy()
  }

  // Un anexo manual nunca cambia el puesto ni el salario de escala: eso lo hacen las
  // transiciones laborales, que sí formalizan su propio anexo.
  expect(MANUAL_ADDENDUM_REASON_CODES).toEqual([
    "COMPENSATION_CHANGE",
    "PAYMENT_METHOD_CHANGE",
    "WORK_LOCATION_CHANGE",
    "WORK_SCHEDULE_CHANGE",
    "OTHER",
  ])
  expect(MANUAL_ADDENDUM_REASON_CODES).not.toContain("POSITION_CHANGE")
  expect(MANUAL_ADDENDUM_REASON_CODES).not.toContain("SALARY_CHANGE")

  for (const code of MANUAL_ADDENDUM_REASON_CODES) {
    expect(ADDENDUM_REASON_LABELS[code], `${code} se puede mostrar en el formulario`).toBeTruthy()
  }

  expect(addendumReasonLabel("POSITION_CHANGE")).toBe("Cambio de puesto")
  expect(addendumReasonLabel(null)).toBe("Modificación contractual")
  expect(addendumReasonLabel(undefined)).toBe("Modificación contractual")
  expect(addendumReasonLabel("MOTIVO_DESCONOCIDO")).toBe("MOTIVO_DESCONOCIDO")
})

test("las etiquetas de los campos del anexo siguen a las del backend", () => {
  expect(ADDENDUM_FIELD_LABELS.SALARY).toBe("Salario de escala")
  expect(ADDENDUM_FIELD_LABELS.WORK_LOCATION).toBe("Lugar de trabajo")
  expect(ADDENDUM_FIELD_LABELS.TOTAL_COMPENSATION).toBe("Total contractual")
  expect(addendumFieldLabel("WEEKLY_HOURS")).toBe("Horas semanales")
  expect(addendumFieldLabel("CAMPO_DESCONOCIDO")).toBe("CAMPO_DESCONOCIDO")
})

/* ------------------------------------------------------------------ */
/* 3. Conceptos retributivos: importes, totales y validación            */
/* ------------------------------------------------------------------ */

test("el importe de un concepto acepta coma decimal y rechaza negativos y texto", () => {
  // Vacío significa 0 y no bloquea el formulario; el backend decide el resto.
  expect(componentAmountValue(draft({ amount: "" }))).toBe(0)
  expect(componentAmountValue(draft({ amount: "   " }))).toBe(0)

  expect(componentAmountValue(draft({ amount: "1500,25" }))).toBe(1500.25)
  expect(componentAmountValue(draft({ amount: "1500.25" }))).toBe(1500.25)
  expect(componentAmountValue(draft({ amount: " 250 " }))).toBe(250)

  expect(componentAmountValue(draft({ amount: "-10" }))).toBeNull()
  expect(componentAmountValue(draft({ amount: "abc" }))).toBeNull()
  expect(componentAmountValue(draft({ amount: "1 500" }))).toBeNull()
})

test("el total de conceptos ignora los importes inválidos (no los suma como cero dudoso)", () => {
  const drafts = [
    draft({ key: "a", description: "Antigüedad", amount: "100" }),
    draft({ key: "b", description: "Nocturnidad", amount: "50,5" }),
    draft({ key: "c", description: "Mal escrito", amount: "-1" }),
    draft({ key: "d", amount: "" }),
  ]

  expect(componentsTotal(drafts)).toBe(150.5)
  expect(hasInvalidComponent(drafts)).toBe(true)

  // Sin filas, no hay total ni error: el contrato puede formalizarse sin conceptos añadidos.
  expect(componentsTotal([])).toBe(0)
  expect(hasInvalidComponent([])).toBe(false)

  expect(hasInvalidComponent([draft({ description: "Antigüedad", amount: "100" })])).toBe(false)
  // Una fila sin descripción es igual de inválida que una con importe erróneo.
  expect(hasInvalidComponent([draft({ description: "  ", amount: "100" })])).toBe(true)
  expect(hasInvalidComponent([draft({ description: "Antigüedad", amount: "abc" })])).toBe(true)
})

test("el payload al backend descarta filas vacías y nunca envía el total", () => {
  const payload = buildComponentsPayload([
    draft({ component_type: "ADDITIONAL_PAYMENT", description: "  Responsabilidad ", amount: "250,5" }),
    draft({ component_type: "OTHER", description: "", amount: "" }),
    draft({ component_type: "ABNORMAL_CONDITIONS", description: "Nocturnidad", amount: "abc" }),
  ])

  expect(payload).toEqual([
    { component_type: "ADDITIONAL_PAYMENT", description: "Responsabilidad", amount: 250.5 },
    { component_type: "ABNORMAL_CONDITIONS", description: "Nocturnidad", amount: 0 },
  ])
  expect(buildComponentsPayload([])).toEqual([])
  expect(JSON.stringify(payload)).not.toMatch(/total/i)
})

test("un concepto persistido vuelve al formulario como fila editable", () => {
  expect(
    toComponentDrafts([
      {
        id: "componente-1",
        component_type: "ADDITIONAL_PAYMENT",
        description: "Antigüedad",
        amount: 400,
        display_order: 1,
      },
      {
        id: "componente-2",
        component_type: "",
        description: "Sin clasificar",
        amount: 10.5,
        display_order: 2,
      },
    ])
  ).toEqual([
    {
      key: "componente-1",
      component_type: "ADDITIONAL_PAYMENT",
      description: "Antigüedad",
      amount: "400",
    },
    {
      key: "componente-2",
      component_type: "OTHER",
      description: "Sin clasificar",
      amount: "10.5",
    },
  ])

  expect(toComponentDrafts([])).toEqual([])
})

test("los tipos de concepto aprobados son los tres del backend y salen vacíos al crear", () => {
  expect(COMPENSATION_COMPONENT_TYPES.map((type) => type.code)).toEqual([
    "ADDITIONAL_PAYMENT",
    "ABNORMAL_CONDITIONS",
    "OTHER",
  ])

  for (const type of COMPENSATION_COMPONENT_TYPES) {
    expect(type.label, `${type.code} tiene título de sección`).toBeTruthy()
    expect(type.hint, `${type.code} tiene texto de ayuda`).toBeTruthy()
    expect(componentTypeLabel(type.code)).toBe(type.label)
  }

  expect(componentTypeLabel("ABNORMAL_CONDITIONS")).toBe("Condiciones laborales anormales")
  expect(componentTypeLabel("DESCONOCIDO")).toBe("DESCONOCIDO")

  const created = newComponentDraft()
  expect(created.component_type).toBe("ADDITIONAL_PAYMENT")
  expect(created.description).toBe("")
  expect(created.amount).toBe("")
  expect(created.key).not.toBe("")
  expect(newComponentDraft("OTHER").component_type).toBe("OTHER")
  // La clave de fila es local (no se persiste) y siempre tiene contenido.
  expect(created.key).toMatch(/^\d+-[a-z0-9]+$/)

  expect(EMPTY_FORMALIZATION_PENDING).toEqual({ blocking: [], warnings: [] })
})

/* ------------------------------------------------------------------ */
/* 4. Formatos: una sola implementación de fecha e importe              */
/* ------------------------------------------------------------------ */

test("la fecha y el importe del contrato tienen una única implementación en el dominio", () => {
  // Las alertas de vencimiento reexportan la misma función: no hay dos copias del formato.
  expect(alertsFormatContractDate).toBe(formatContractDate)
  expect(formatConditionDate).toBe(formatContractDate)
})

test("la fecha laboral se muestra como dd/mm/aaaa y las ausencias como raya", () => {
  expect(formatContractDate("2024-03-05")).toBe("05/03/2024")
  expect(formatConditionDate("2024-03-05")).toBe("05/03/2024")
  expect(formatContractDate(null)).toBe("—")
  expect(formatContractDate(undefined)).toBe("—")
  expect(formatContractDate("")).toBe("—")
  // Un valor que no es una fecha ISO se devuelve tal cual: no se inventa un formato.
  expect(formatContractDate("sin-fecha")).toBe("sin-fecha")
})

test("el importe contractual conserva los dos decimales y la moneda", () => {
  const money = (amount: number) =>
    amount.toLocaleString("es-CU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  expect(formatContractMoney(4000, "CUP")).toBe(`${money(4000)} CUP`)
  expect(formatContractMoney(4000)).toBe(money(4000))
  expect(formatContractMoney(4000, null)).toBe(money(4000))
  expect(formatContractMoney(4000)).toMatch(/00$/)
  expect(formatContractMoney(0, "CUP")).toBe(`${money(0)} CUP`)
  // Un importe nulo nunca se muestra como 0,00: se muestra como ausencia.
  expect(formatContractMoney(null)).toBe("—")
  expect(formatContractMoney(null, "CUP")).toBe("—")
})

/* ------------------------------------------------------------------ */
/* 5. Historial salarial: etiquetas de los cambios                      */
/* ------------------------------------------------------------------ */

test("el historial salarial etiqueta los cinco tipos de cambio de SiteCorp", () => {
  expect(SALARY_CHANGE_TYPE_LABELS).toEqual({
    INITIAL_CONTRACT: "Contrato inicial",
    SALARY_SCALE_CHANGE: "Cambio de escala salarial",
    POSITION_CHANGE: "Cambio de puesto",
    CONTRACT_CHANGE: "Cambio de contrato",
    REINCORPORATION: "Reincorporación",
  })

  for (const [code, label] of Object.entries(SALARY_CHANGE_TYPE_LABELS)) {
    expect(label, `${code} tiene etiqueta`).toBeTruthy()
  }
})

/* ------------------------------------------------------------------ */
/* 6. Automatización documental: textos exactos                         */
/* ------------------------------------------------------------------ */

test("los mensajes de la automatización documental se conservan palabra por palabra", () => {
  expect(missingContractTemplateMessage("Obrero")).toBe(
    "No se puede completar la contratación.\n\nNo existe una plantilla activa para «Obrero». Configura la plantilla documental antes de continuar."
  )
  expect(missingContractTemplateMessage(null)).toBe(
    "No se puede completar la contratación.\n\nNo existe una plantilla activa para este tipo de contrato. Configura la plantilla documental antes de continuar."
  )
  expect(missingContractTemplateMessage("")).toBe(missingContractTemplateMessage(null))
  expect(MISSING_ADDENDUM_TEMPLATE_MESSAGE).toBe(
    "No se puede completar el cambio contractual.\n\nNo existe una plantilla activa de anexo. Configúrela antes de continuar."
  )
})

/* ------------------------------------------------------------------ */
/* 7. Arquitectura: la presentación consume el dominio                  */
/* ------------------------------------------------------------------ */

const CONTRACT_CONSUMERS = [
  "src/modules/contracts/presentation/components/AddendumChangesList.tsx",
  "src/modules/contracts/presentation/components/AddendumDetailDialog.tsx",
  "src/modules/contracts/presentation/components/ContractAddendumsSection.tsx",
  "src/modules/contracts/presentation/components/CreateManualAddendumDialog.tsx",
  "src/modules/contracts/presentation/components/ContractualTimeline.tsx",
  "src/modules/contracts/presentation/components/CurrentContractSummary.tsx",
  "src/modules/contracts/presentation/components/ContractConditionsFields.tsx",
  "src/modules/contracts/presentation/components/ContractFormalizationAlerts.tsx",
  "src/modules/contracts/presentation/components/ContractFormalizationSummary.tsx",
  "src/modules/contracts/presentation/components/ContractRetributionSummary.tsx",
  "src/modules/people/presentation/components/HireCandidateDialog.tsx",
  "src/modules/people/presentation/components/ChangeContractDialog.tsx",
  "src/modules/people/presentation/components/ChangePositionDialog.tsx",
  "src/modules/people/presentation/components/ReincorporateWorkerDialog.tsx",
  "src/modules/people/presentation/components/WorkerForm.tsx",
  "src/modules/people/presentation/pages/WorkerDetail.tsx",
]

test("la presentación del contrato usa el dominio y ya no importa las fachadas retiradas", () => {
  for (const consumer of CONTRACT_CONSUMERS) {
    const source = read(consumer)
    expect(
      source,
      `${consumer} no debe importar módulos legacy de contratos`
    ).not.toMatch(/@\/lib\/(addendums|contract-conditions|contract-automation|worker-salary)/)
  }

  for (const facade of [
    "src/lib/addendums.ts",
    "src/lib/contract-conditions.ts",
    "src/lib/contract-automation.ts",
    "src/lib/worker-salary.ts",
  ]) {
    expect(existsSync(facade), `${facade} se retiró`).toBe(false)
  }
})

test("las reglas puras del contrato no conocen Supabase ni la presentación", () => {
  const domainModules = [
    "addendum-labels.ts",
    "salary-labels.ts",
    "compensation.rules.ts",
    "formats.ts",
    "automation.messages.ts",
    "rules.ts",
    "entities.ts",
    "contract-alerts.rules.ts",
  ].map((name) => `src/domains/contracts/domain/${name}`)

  for (const module of domainModules) {
    const source = read(module)
    expect(source, `${module} no consulta Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${module} no invoca RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${module} no depende de la presentación`).not.toMatch(
      /@\/(components|pages|hooks|contexts)\//
    )
  }
})

test("la automatización del contrato tiene un solo camino y no se duplica en la interfaz", () => {
  const automation = read("src/domains/contracts/infrastructure/contract-documents.repository.ts")

  // Validar la plantilla ANTES de aplicar el cambio sigue siendo responsabilidad del dominio.
  expect(automation).toMatch(/export const resolveContractTemplateAvailability/)
  expect(automation).toMatch(/export const resolveAddendumTemplateAvailability/)
  expect(automation).toMatch(/export const ensureContractDocumentGenerated/)
  expect(automation).toMatch(/export const ensureAddendumDocumentGenerated/)

  // Y la prevención de duplicados vive aquí: si ya hay documento, no se genera otro.
  expect(automation).toMatch(/fetchGeneratedDocuments\(/)
  expect(automation).toMatch(/skipped: true/)
  expect(automation).toMatch(/from "@\/domains\/document-generation"/)
  expect(automation).toMatch(/from "@\/domains\/document-templates"/)

  // Ningún componente de este bloque genera documentos ni resuelve plantillas por su cuenta.
  for (const consumer of CONTRACT_CONSUMERS) {
    const source = read(consumer)
    expect(source, `${consumer} no genera documentos por su cuenta`).not.toMatch(
      /generateContractDocument|generateAddendumDocument|resolveDocumentTemplateVersion\(/
    )
    expect(source, `${consumer} no consulta plantillas por su cuenta`).not.toMatch(
      /document_template|documentTypeCodeForContractType/
    )
  }
})

test("las consultas del contrato acotan siempre por trabajador, contrato o entidad", () => {
  const repositories = [
    "src/domains/contracts/infrastructure/addendums.repository.ts",
    "src/domains/contracts/infrastructure/contract-conditions.repository.ts",
    "src/domains/contracts/infrastructure/salary.repository.ts",
    "src/domains/contracts/infrastructure/contract-alerts.repository.ts",
  ]

  for (const repository of repositories) {
    const source = read(repository)
    expect(source, `${repository} es la frontera de datos del contrato`).toMatch(/@\/lib\/supabase/)
    expect(
      source,
      `${repository} acota por trabajador, contrato o entidad (aislamiento por cliente y entidad)`
    ).toMatch(/worker_id|employment_contract_id|entity_id/)
  }
})

/* ------------------------------------------------------------------ */
/* 8. Composición modular: las acciones laborales viven en Personas     */
/* ------------------------------------------------------------------ */

const LABOR_DIALOGS = [
  "src/modules/people/presentation/components/ChangeContractDialog.tsx",
  "src/modules/people/presentation/components/ChangePositionDialog.tsx",
  "src/modules/people/presentation/components/SeparateWorkerDialog.tsx",
]

test("las acciones laborales viven en Personas y Contratos no las importa", () => {
  for (const dialog of LABOR_DIALOGS) {
    expect(existsSync(dialog), `${dialog} pertenece a Personas`).toBe(true)
  }

  // La página de vencimientos no importa presentación de Personas: recibe los diálogos
  // inyectados por el punto de composición.
  const page = read("src/modules/contracts/presentation/pages/EntityContractAlerts.tsx")
  expect(page, "Contratos no debe importar presentación de Personas").not.toMatch(
    /from "@\/modules\/people/
  )
  expect(page).toMatch(/ChangeContractDialog: React\.ComponentType<ChangeContractDialogProps>/)
  expect(page).toMatch(/SeparateWorkerDialog: React\.ComponentType<SeparateWorkerDialogProps>/)

  // La ficha del trabajador (Personas) sigue abriendo los mismos diálogos.
  const workerDetail = read("src/modules/people/presentation/pages/WorkerDetail.tsx")
  expect(workerDetail).toContain(
    'from "@/modules/people/presentation/components/ChangePositionDialog"'
  )
  expect(workerDetail).toContain(
    'from "@/modules/people/presentation/components/SeparateWorkerDialog"'
  )
  expect(workerDetail).toContain(
    'from "@/modules/people/presentation/components/ChangeContractDialog"'
  )

  // El contrato compartido es neutral: no conoce módulos de negocio.
  const shared = read("src/shared/components/worker-action-contracts.ts")
  expect(shared, "el contrato compartido no debe importar módulos").not.toMatch(
    /from "@\/modules\//
  )
})

test("la ruta de vencimientos conserva su camino e inyecta los diálogos de Personas", () => {
  const app = read("src/App.tsx")

  expect(app).toContain('path="/entity/:entityId/contracts/alerts"')
  expect(app).toContain("ChangeContractDialog={ChangeContractDialog}")
  expect(app).toContain("SeparateWorkerDialog={SeparateWorkerDialog}")
  expect(app).toContain(
    'import ChangeContractDialog from "@/modules/people/presentation/components/ChangeContractDialog"'
  )
  expect(app).toContain(
    'import SeparateWorkerDialog from "@/modules/people/presentation/components/SeparateWorkerDialog"'
  )
})

test("la página abre el diálogo correcto con el trabajador y refresca al guardar", () => {
  const page = read("src/modules/contracts/presentation/pages/EntityContractAlerts.tsx")

  // Permisos: las acciones sólo se ofrecen con `contracts.manage`.
  expect(page).toContain('canManage && row.alert_state !== "NO_END_DATE"')
  // Apertura: cada acción abre su diálogo con el objetivo seleccionado.
  expect(page).toContain("{changeTarget?.contract && (")
  expect(page).toContain("{separationTarget && (")
  // Datos enviados: identificación del trabajador, contrato y situación vigentes.
  expect(page).toContain("workerId={changeTarget.workerId}")
  expect(page).toContain("workerIdentification={changeTarget.identification}")
  expect(page).toContain("current={changeTarget.contract}")
  expect(page).toContain("current={separationTarget.situation}")
  // Cierre: se limpia el objetivo al cerrar el diálogo.
  expect(page).toContain("if (!open) setChangeTarget(null)")
  expect(page).toContain("if (!open) setSeparationTarget(null)")
  // Actualización posterior: ambas acciones invalidan las alertas contractuales.
  expect(page.match(/invalidateContractAlertData\(queryClient\)/g)?.length).toBe(2)
})
