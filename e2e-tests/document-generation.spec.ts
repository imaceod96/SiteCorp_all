import { test, expect } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import JSZip from "jszip"
import ExcelJS from "exceljs"
import {
  BLOCKED_MESSAGES,
  DOCUMENT_TYPE_LABELS,
  blockedMessageFor,
  buildGeneratedDocumentName,
  buildRenderValues,
  documentTypeCodeForContractType,
  documentVariableHint,
  formatBatchMoment,
  formatGenerationMoment,
  parseSc404ExistingId,
  SC404_ALREADY_EXISTS_PREFIX,
  selectMissingVariableKeys,
  resolveBlockedReason,
} from "../src/domains/document-generation/domain/rules"
import { WORKER_DOCUMENTS_BUCKET } from "../src/domains/document-generation/domain/entities"
import type {
  DocumentGenerationPrecheck,
  GenerationDocumentKind,
  TemplateResolution,
} from "../src/domains/document-generation/domain/entities"
import { DOCUMENT_VARIABLES } from "../src/domains/document-templates/domain/document-variables"
import { renderDocx } from "../src/domains/document-generation/infrastructure/renderers/docx-render"
import { renderXlsxTemplate } from "../src/domains/document-generation/infrastructure/renderers/xlsx-render"

/**
 * MOTOR DE GENERACIÓN DOCUMENTAL — reglas, renderizadores y frontera del dominio.
 *
 * Comprueba, SIN escribir en la base de datos ni publicar documentos reales, lo que decide si la
 * migración de este bloque se mantiene:
 *   1. El nombre humano del archivo generado, por tipo documental.
 *   2. La sustitución de variables sobre una COPIA (Word y Excel), con los mismos avisos de
 *      variables desconocidas y residuales.
 *   3. El prefill del SC-4-04 y las variables que bloquean la generación según el tipo.
 *   4. El orden de los motivos de bloqueo y los mensajes exactos que ve el usuario.
 *   5. Que el motor vive en UN dominio, que la presentación ya no consulta Supabase y que las
 *      RPC, sus parámetros, los buckets y las rutas del Storage no cambian.
 *
 * Distinción explícita: aquí se verifican REGLAS, CONTRATOS y RENDERIZADO en memoria. La
 * generación real contra la base de datos no se ejecuta en estas pruebas.
 */

const read = (path: string) => readFileSync(path, "utf8")

/**
 * Código sin comentarios.
 * Las comprobaciones de frontera miran lo que el módulo HACE: los ejemplos de importación que
 * aparecen en la documentación no deben confundirse con dependencias reales.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

/** Todos los módulos de `src`: permite comprobar la frontera sin enumerar archivos a mano. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : []
  )

/* ------------------------------------------------------------------ */
/* Utilidades                                                        */
/* ------------------------------------------------------------------ */

const template = (over: Partial<TemplateResolution> = {}): TemplateResolution => ({
  status: "RESOLVED",
  versionId: "v-1",
  versionNumber: 1,
  versionStatus: "ACTIVE",
  versionUsable: true,
  templateName: "Plantilla",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  configuredFilePath: "entity/e1/templates/t1/v1/configured.docx",
  configuredFileFormat: "DOCX",
  referenceDate: "2026-03-01",
  documentTypeCode: "EMPLOYMENT_CONTRACT_DETERMINED",
  ...over,
})

const precheck = (
  kind: GenerationDocumentKind,
  over: Partial<DocumentGenerationPrecheck> = {}
): DocumentGenerationPrecheck => ({
  kind,
  sourceId: "s-1",
  workerId: "w-1",
  entityId: "e-1",
  formalized: true,
  documentTypeLabel: "Documento",
  template: template(),
  requiredVariables: [],
  missingVariables: [],
  ready: true,
  blockedReason: null,
  resolvedValues: {},
  documentData: {
    document_type: "SC_4_04",
    worker: { full_name: "Juan Pérez Gómez" },
  } as unknown as DocumentGenerationPrecheck["documentData"],
  ...over,
})

/** DOCX mínimo: basta `word/document.xml`, que es la parte que el motor analiza. */
const docxWith = async (body: string): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document><w:body><w:p>${body}</w:p></w:body></w:document>`
  )
  return zip.generateAsync({ type: "uint8array" })
}

const documentXmlOf = async (bytes: Uint8Array): Promise<string> => {
  const zip = await JSZip.loadAsync(bytes)
  return zip.file("word/document.xml")!.async("string")
}

/** Copia exacta del contenido como ArrayBuffer (ExcelJS no acepta la vista del Uint8Array). */
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/* ------------------------------------------------------------------ */
/* 1. Nombre humano del archivo (§37)                                  */
/* ------------------------------------------------------------------ */

test("el nombre del archivo generado conserva el criterio de cada tipo documental", () => {
  const date = "2026-03-01"

  expect(buildGeneratedDocumentName(precheck("CONTRACT"), date)).toBe(
    "Contrato_Determinado_Juan_Perez_Gomez_2026-03-01.docx"
  )
  expect(
    buildGeneratedDocumentName(
      precheck("CONTRACT", { template: template({ documentTypeCode: "EMPLOYMENT_CONTRACT_INDETERMINED" }) }),
      date
    )
  ).toBe("Contrato_Indeterminado_Juan_Perez_Gomez_2026-03-01.docx")
  expect(buildGeneratedDocumentName(precheck("ADDENDUM"), date)).toBe(
    "Anexo_Contrato_Juan_Perez_Gomez_2026-03-01.docx"
  )
  expect(buildGeneratedDocumentName(precheck("RESOLUTION"), date)).toBe(
    "Resolucion_Juan_Perez_Gomez_2026-03-01.docx"
  )
  // El Movimiento de Nómina se genera en Excel: la extensión real acompaña al nombre.
  expect(buildGeneratedDocumentName(precheck("PAYROLL_MOVEMENT"), date, "xlsx")).toBe(
    "Juan_Perez_Gomez_Movimiento_Nomina_2026-03-01.xlsx"
  )
  expect(buildGeneratedDocumentName(precheck("VACATION"), date)).toBe(
    "Modelo_SC_4_04_Vacaciones_Juan_Perez_Gomez_2026-03-01.docx"
  )
  expect(buildGeneratedDocumentName(precheck("MEDICAL_CERTIFICATE"), date)).toBe(
    "Modelo_SC_4_04_Certificados_Licencia_Juan_Perez_Gomez_2026-03-01.docx"
  )

  // El nombre que recibe un contrato sin tipo reconocido no inventa una palabra.
  expect(
    buildGeneratedDocumentName(precheck("CONTRACT", { template: template({ documentTypeCode: "OTRO" }) }), date)
  ).toBe("Contrato_Juan_Perez_Gomez_2026-03-01.docx")
})

/* ------------------------------------------------------------------ */
/* 2. Sustitución de variables sobre una COPIA                        */
/* ------------------------------------------------------------------ */

test("Word sustituye variables sobre una copia y avisa de las desconocidas o residuales", async () => {
  const source = await docxWith("<w:t>Hola {{worker.full_name}} — {{desconocida.key}}</w:t>")

  const rendered = await renderDocx(
    source,
    { "worker.full_name": "Juan Pérez Gómez" },
    ["worker.full_name"]
  )

  const xml = await documentXmlOf(rendered.bytes)
  expect(xml).toContain("Hola Juan Pérez Gómez —")
  expect(rendered.replacedKeys).toEqual(["worker.full_name"])
  expect(rendered.replacedCount).toBe(1)
  // Una variable que el sistema no conoce queda tal cual y se informa (nunca se borra en silencio).
  expect(rendered.unknownKeys).toEqual(["desconocida.key"])
  expect(rendered.leftoverKeys).toEqual(["desconocida.key"])

  // El paquete de ORIGEN no se modifica: la generación nunca toca la plantilla.
  const sourceXml = await documentXmlOf(source)
  expect(sourceXml).toContain("{{worker.full_name}}")
})

test("una variable conocida sin valor queda como residual y bloquea el documento", async () => {
  const source = await docxWith("<w:t>{{worker.address}}</w:t>")
  const rendered = await renderDocx(source, {}, ["worker.address"])

  expect(rendered.replacedCount).toBe(0)
  expect(rendered.leftoverKeys).toEqual(["worker.address"])
  expect(await documentXmlOf(rendered.bytes)).toContain("{{worker.address}}")
})

test("Excel sustituye marcadores sin alterar la estructura del libro", async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Movimiento")
  sheet.getCell("A1").value = "Trabajador:"
  sheet.getCell("B1").value = "{{m.nom}} {{m.ap1}}"
  sheet.getCell("A2").value = "Importe"
  sheet.getCell("B2").value = 1234
  const input = new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)

  const rendered = await renderXlsxTemplate(input, { "m.nom": "Juan", "m.ap1": "Pérez" }, [
    "m.nom",
    "m.ap1",
  ])

  const result = new ExcelJS.Workbook()
  await result.xlsx.load(asArrayBuffer(rendered.bytes))
  const renderedSheet = result.getWorksheet("Movimiento")!
  expect(renderedSheet.getCell("B1").value).toBe("Juan Pérez")
  // Los textos fijos y los valores no marcados se conservan intactos.
  expect(renderedSheet.getCell("A1").value).toBe("Trabajador:")
  expect(renderedSheet.getCell("A2").value).toBe("Importe")
  expect(renderedSheet.getCell("B2").value).toBe(1234)
  expect(rendered.replacedKeys.sort()).toEqual(["m.ap1", "m.nom"])
  expect(rendered.parts).toEqual(["Movimiento"])
  expect(rendered.leftoverKeys).toEqual([])
})

test("Excel informa de los marcadores que no puede sustituir", async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Hoja")
  sheet.getCell("A1").value = "{{m.nom}} {{otra.key}}"
  const input = new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)

  const rendered = await renderXlsxTemplate(input, {}, ["m.nom"])

  expect(rendered.replacedCount).toBe(0)
  expect(rendered.unknownKeys.sort()).toEqual(["m.nom", "otra.key"])
  expect(rendered.leftoverKeys.sort()).toEqual(["m.nom", "otra.key"])
})

/* ------------------------------------------------------------------ */
/* 3. Variables: prefill del SC-4-04 y variables que bloquean          */
/* ------------------------------------------------------------------ */

test("el prefill del SC-4-04 deja vacías las variables del ámbito y respeta las resueltas", () => {
  const sc404Keys = DOCUMENT_VARIABLES.filter((definition) =>
    definition.documentTypes.includes("SC_4_04")
  ).map((definition) => definition.key)
  expect(sc404Keys.length).toBeGreaterThan(0)

  const values = buildRenderValues("VACATION", { "sc404.dias": "12", "worker.address": "Calle 1" })

  // Toda variable del ámbito parte de cadena vacía (nunca «null» ni un marcador residual)…
  for (const key of sc404Keys) {
    if (key === "sc404.dias") continue
    expect(values[key], `${key} no debe quedar sin prefijar`).toBe("")
  }
  // …y lo resuelto de verdad se impone al prefill.
  expect(values["sc404.dias"]).toBe("12")
  expect(values["worker.address"]).toBe("Calle 1")

  // Fuera del ámbito SC-4-04 no se prefija nada.
  const outside = DOCUMENT_VARIABLES.find(
    (definition) =>
      !definition.documentTypes.includes("SC_4_04") &&
      !["sc404.dias", "worker.address"].includes(definition.key)
  )!
  expect(values[outside.key]).toBeUndefined()

  // Los documentos contractuales sustituyen exactamente lo resuelto.
  const contractValues = { "entity.name": "Empresa" }
  expect(buildRenderValues("CONTRACT", contractValues)).toEqual(contractValues)
})

test("las variables que bloquean dependen del tipo documental", () => {
  // Contrato y anexo: cualquier variable requerida sin valor bloquea.
  expect(
    selectMissingVariableKeys("CONTRACT", ["entity.name", "worker.address"], { "entity.name": "" }, false)
  ).toEqual(["worker.address"])

  // SC-4-04 (§26): sólo los datos nucleares del modelo bloquean.
  expect(
    selectMissingVariableKeys(
      "VACATION",
      ["entity.name", "worker.full_name", "worker.address", "vacaciones.reincorporacion"],
      {},
      false
    )
  ).toEqual(["entity.name", "worker.full_name"])
  // §16 Fase 24: si no puede determinarse la incorporación, sus variables también bloquean.
  expect(
    selectMissingVariableKeys("VACATION", ["vacaciones.reincorporacion"], {}, true)
  ).toEqual(["vacaciones.reincorporacion"])

  // Movimiento de Nómina (§46): los vacíos legítimos NO bloquean; sólo los datos nucleares.
  expect(
    selectMissingVariableKeys(
      "PAYROLL_MOVEMENT",
      ["m.exp", "m.nom", "m.ap1", "m.area", "m.salario"],
      {},
      false
    )
  ).toEqual(["m.exp", "m.nom", "m.ap1"])
})

/* ------------------------------------------------------------------ */
/* 4. Bloqueos y mensajes                                              */
/* ------------------------------------------------------------------ */

test("el motivo de bloqueo sigue el orden de siempre", () => {
  const base = { formalized: true, template: template(), analysisPresent: true, missingCount: 0 }

  expect(resolveBlockedReason({ ...base, formalized: false })).toBe("NOT_FORMALIZED")
  expect(resolveBlockedReason({ ...base, template: template({ status: "NONE" }) })).toBe("TEMPLATE_NONE")
  expect(resolveBlockedReason({ ...base, template: template({ status: "AMBIGUOUS" }) })).toBe(
    "TEMPLATE_AMBIGUOUS"
  )
  expect(resolveBlockedReason({ ...base, template: template({ versionId: null }) })).toBe("TEMPLATE_NONE")
  expect(resolveBlockedReason({ ...base, template: template({ versionUsable: false }) })).toBe(
    "TEMPLATE_UNUSABLE"
  )
  expect(resolveBlockedReason({ ...base, analysisPresent: false })).toBe("NO_ANALYSIS")
  expect(resolveBlockedReason({ ...base, missingCount: 2 })).toBe("MISSING_DATA")
  expect(resolveBlockedReason(base)).toBeNull()
})

test("los mensajes y las etiquetas que ve el usuario no cambian", () => {
  expect(BLOCKED_MESSAGES.NOT_FORMALIZED).toBe(
    "Solo se puede generar el documento de un contrato o anexo formalizado."
  )
  expect(BLOCKED_MESSAGES.TEMPLATE_NONE).toBe(
    "No existe una versión de plantilla aplicable a la fecha de este documento."
  )
  expect(BLOCKED_MESSAGES.TEMPLATE_AMBIGUOUS).toBe(
    "Existe más de una versión de plantilla aplicable a la fecha de este documento. Revise la vigencia de las plantillas."
  )
  expect(BLOCKED_MESSAGES.TEMPLATE_UNUSABLE).toBe(
    "La versión de plantilla aplicable no tiene un documento configurado en un formato analizable (.docx o .xlsx)."
  )
  expect(BLOCKED_MESSAGES.NO_ANALYSIS).toBe(
    "La versión de plantilla aplicable no tiene un análisis de variables válido."
  )
  expect(BLOCKED_MESSAGES.MISSING_DATA).toBe("Faltan datos requeridos por esta plantilla.")
  // Un motivo desconocido jamás se muestra en crudo.
  expect(blockedMessageFor(null)).toBe(BLOCKED_MESSAGES.TEMPLATE_NONE)

  expect(DOCUMENT_TYPE_LABELS.EMPLOYMENT_CONTRACT_DETERMINED).toBe(
    "Contrato de Trabajo por Tiempo Determinado"
  )
  expect(DOCUMENT_TYPE_LABELS.EMPLOYMENT_CONTRACT_ADDENDUM).toBe("Anexo al Contrato de Trabajo")
  expect(DOCUMENT_TYPE_LABELS.SC_4_04).toBe(
    "Modelo SC-4-04 — Notificación de Vacaciones, Deducciones, Licencias y Subsidios"
  )
  expect(DOCUMENT_TYPE_LABELS.RESOLUTION).toBe("Resolución — Especialista Principal")
  expect(DOCUMENT_TYPE_LABELS.PAYROLL_MOVEMENT).toBe("Movimiento de Nómina")

  // Ayuda de corrección por variable (§66) y tipo documental por tipo de contrato.
  expect(documentVariableHint("worker.address")).toBe("Datos personales del trabajador")
  expect(documentVariableHint("representative.name")).toBe(
    "Datos contractuales de la entidad (representantes)"
  )
  expect(documentVariableHint("no.existe")).toBeNull()

  expect(documentTypeCodeForContractType("DETERMINADO")).toBe("EMPLOYMENT_CONTRACT_DETERMINED")
  expect(documentTypeCodeForContractType("INDETERMINADO")).toBe("EMPLOYMENT_CONTRACT_INDETERMINED")
  expect(documentTypeCodeForContractType(null)).toBeNull()
})

test("la idempotencia del SC-4-04 y las fechas legibles conservan su formato", () => {
  expect(SC404_ALREADY_EXISTS_PREFIX).toBe("SC404_ALREADY_EXISTS|")
  expect(parseSc404ExistingId("SC404_ALREADY_EXISTS|doc-1")).toBe("doc-1")
  expect(parseSc404ExistingId("otro error")).toBeNull()
  expect(parseSc404ExistingId(undefined)).toBeNull()

  expect(formatGenerationMoment("2026-03-01T09:05:00Z")).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
  expect(formatGenerationMoment("no-es-una-fecha")).toBe("—")
  expect(formatBatchMoment("2026-03-01T09:05:00Z")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  expect(formatBatchMoment("no-es-una-fecha")).toBe("—")
})

/* ------------------------------------------------------------------ */
/* 5. Frontera del dominio, RPC y Storage                              */
/* ------------------------------------------------------------------ */

test("el motor vive en un solo dominio y la presentación ya no consulta Supabase", () => {
  const presentation = [
    "src/components/documents/ContractualDocumentSection.tsx",
    "src/modules/document-generation/presentation/pages/EntityPendingDocuments.tsx",
    "src/hooks/use-sc404.ts",
    "src/components/salary/ReviewSalaryChangeDialog.tsx",
  ]

  for (const file of presentation) {
    const source = code(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    expect(source, `${file} debe consumir el dominio de generación`).toMatch(
      /@\/domains\/document-generation/
    )
    // La fachada legacy ya no la usa la presentación.
    expect(source, `${file} no debe usar la fachada legacy`).not.toMatch(
      /@\/lib\/document-(generation|batches)/
    )
  }

  // El acceso a datos del motor vive en su infraestructura, y sólo ahí.
  const infrastructure = [
    "src/domains/document-generation/infrastructure/document-source.repository.ts",
    "src/domains/document-generation/infrastructure/document-data.repository.ts",
    "src/domains/document-generation/infrastructure/document-generation.repository.ts",
    "src/domains/document-generation/infrastructure/document-storage.repository.ts",
    "src/domains/document-generation/infrastructure/document-batches.repository.ts",
  ]
  for (const file of infrastructure) {
    expect(code(file), `${file} debe concentrar el acceso a Supabase`).toMatch(/@\/lib\/supabase/)
  }

  // La aplicación y el dominio son puros: no hablan con Supabase.
  const pure = [
    "src/domains/document-generation/domain/entities.ts",
    "src/domains/document-generation/domain/rules.ts",
    "src/domains/document-generation/application/document-generation.queries.ts",
    "src/domains/document-generation/application/document-generation.commands.ts",
    "src/domains/document-generation/application/document-batches.queries.ts",
    "src/domains/document-generation/application/document-batches.commands.ts",
  ]
  for (const file of pure) {
    expect(code(file), `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
  }
})

test("el motor no depende de la presentación ni repite el catálogo de plantillas", () => {
  const files = [
    "src/domains/document-generation/index.ts",
    "src/domains/document-generation/domain/entities.ts",
    "src/domains/document-generation/domain/rules.ts",
    "src/domains/document-generation/application/document-generation.queries.ts",
    "src/domains/document-generation/application/document-generation.commands.ts",
    "src/domains/document-generation/application/document-batches.queries.ts",
    "src/domains/document-generation/application/document-batches.commands.ts",
    "src/domains/document-generation/infrastructure/document-source.repository.ts",
    "src/domains/document-generation/infrastructure/document-data.repository.ts",
    "src/domains/document-generation/infrastructure/document-template-version.repository.ts",
    "src/domains/document-generation/infrastructure/document-generation.repository.ts",
    "src/domains/document-generation/infrastructure/document-storage.repository.ts",
    "src/domains/document-generation/infrastructure/document-batches.repository.ts",
  ]

  for (const file of files) {
    const source = code(file)
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
    // Sólo se admiten los dominios de los que depende de verdad: plantillas y estructura.
    expect(source, `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/domains\/(?!document-templates|organization-structure)/
    )
  }

  // Las plantillas y sus versiones se piden al dominio que las administra: no se consultan aquí.
  const templateAdapter = code(
    "src/domains/document-generation/infrastructure/document-template-version.repository.ts"
  )
  expect(templateAdapter).toMatch(/@\/domains\/document-templates/)
  expect(templateAdapter).not.toMatch(/document_template_versions/)

  // Y el dominio de plantillas NO depende del motor: la dependencia va en un solo sentido.
  const templatesDomain = [
    "src/domains/document-templates/index.ts",
    "src/domains/document-templates/application/document-templates.queries.ts",
    "src/domains/document-templates/infrastructure/document-templates.repository.ts",
    "src/domains/document-templates/infrastructure/document-template-files.repository.ts",
  ]
  for (const file of templatesDomain) {
    expect(code(file), `${file} no debe depender del motor`).not.toMatch(
      /from "@\/domains\/document-generation/
    )
  }
})

test("las RPC, sus parámetros y el Storage del expediente no cambian", () => {
  const generation = code(
    "src/domains/document-generation/infrastructure/document-generation.repository.ts"
  )
  // Fijar la versión en la fuente: contrato y anexo, con sus parámetros exactos.
  expect(generation).toMatch(/set_contract_document_template_version/)
  expect(generation).toMatch(/set_addendum_document_template_version/)
  expect(generation).toMatch(/p_contract_id: sourceId, p_version_id: versionId/)
  expect(generation).toMatch(/p_addendum_id: sourceId, p_version_id: versionId/)
  expect(generation).toMatch(/\.rpc\("begin_document_generation", \{/)
  expect(generation).toMatch(/p_employment_contract_id: kind === "CONTRACT" \? sourceId : null/)
  expect(generation).toMatch(/p_contract_addendum_id: kind === "ADDENDUM" \? sourceId : null/)
  expect(generation).toMatch(/p_template_version_id: versionId/)
  expect(generation).toMatch(/\.rpc\("begin_sc404_generation", \{/)
  expect(generation).toMatch(/p_source_type: kind/)
  expect(generation).toMatch(/p_source_id: sourceId/)
  expect(generation).toMatch(/\.rpc\("begin_resolution_generation", \{/)
  expect(generation).toMatch(/p_resolution_id: sourceId/)
  expect(generation).toMatch(/\.rpc\("begin_payroll_movement_generation", \{/)
  expect(generation).toMatch(/p_movement_id: sourceId/)
  expect(generation).toMatch(/\.rpc\("complete_document_generation", \{/)
  expect(generation).toMatch(/p_worker_document_id: input.workerDocumentId/)
  expect(generation).toMatch(/p_file_name: input.fileName/)
  expect(generation).toMatch(/p_file_size: input.fileSize/)
  expect(generation).toMatch(/p_mime_type: input.mimeType/)
  expect(generation).toMatch(/\.rpc\("fail_document_generation", \{/)
  expect(generation).toMatch(/p_reason: reason/)
  // El historial sigue leyendo el expediente con los mismos filtros.
  expect(generation).toMatch(/\.from\("worker_documents"\)/)
  expect(generation).toMatch(/\.eq\("source", "GENERATED"\)/)
  expect(generation).toMatch(/\.eq\("generation_status", "COMPLETED"\)/)
  expect(generation).toMatch(/\{ ascending: true \}/)

  const data = code("src/domains/document-generation/infrastructure/document-data.repository.ts")
  expect(data).toMatch(/\.rpc\("get_contract_document_data", \{/)
  expect(data).toMatch(/p_contract_id: contractId/)
  expect(data).toMatch(/\.rpc\("get_addendum_document_data", \{/)
  expect(data).toMatch(/p_addendum_id: addendumId/)
  expect(data).toMatch(/\.rpc\("get_resolution_document_data", \{/)
  expect(data).toMatch(/p_resolution_id: resolutionId/)
  expect(data).toMatch(/\.rpc\("get_payroll_movement_document_data", \{/)
  expect(data).toMatch(/p_movement_id: movementId/)
  expect(data).toMatch(/\.rpc\("validate_contract_document_data", \{/)
  expect(data).toMatch(/\.rpc\("validate_addendum_document_data", \{/)
  // El SC-4-04 se resuelve desde la relación REAL del trabajador y el horario de su Puesto.
  expect(data).toMatch(/worker:workers\(/)
  expect(data).toMatch(/worker_position_assignments/)
  expect(data).toMatch(/fetchPositionScheduleSegments/)

  const batches = code(
    "src/domains/document-generation/infrastructure/document-batches.repository.ts"
  )
  expect(batches).toMatch(/\.from\("document_batches"\)/)
  expect(batches).toMatch(/\.from\("document_batch_items"\)/)
  expect(batches).toMatch(/\.rpc\("create_document_batches_for_event", \{/)
  expect(batches).toMatch(/p_event_id: eventId/)
  expect(batches).toMatch(/functions\.invoke\("generate-document-batch-zip", \{/)
  expect(batches).toMatch(/body: \{ batch_id: batchId \}/)

  // Buckets, rutas y enlaces temporales: los mismos de siempre.
  expect(WORKER_DOCUMENTS_BUCKET).toBe("documents")
  const storage = code(
    "src/domains/document-generation/infrastructure/document-storage.repository.ts"
  )
  expect(storage).toMatch(/\.from\(WORKER_DOCUMENTS_BUCKET\)/)
  expect(storage).toMatch(/upsert: false/)
  expect(storage).toMatch(/createSignedUrl\(path, expiresInSeconds\)/)
  expect(storage).toMatch(/expiresInSeconds = 600/)
  expect(batches).toMatch(/createSignedUrl\(zipPath, 600\)/)

  // El documento configurado se lee del bucket de plantillas a través de su dominio.
  const templatesFiles = code(
    "src/domains/document-templates/infrastructure/document-template-files.repository.ts"
  )
  expect(templatesFiles).toMatch(/\.from\(DOCUMENT_TEMPLATES_BUCKET\)/)
  expect(templatesFiles).toMatch(/\.download\(path\)/)
  expect(templatesFiles).toMatch(/new Error\("La plantilla no tiene un documento configurado válido"\)/)
})

test("la limpieza controlada retiró las fachadas sin consumidores", () => {
  // Se eliminaron cuando el último consumidor migró a su dominio: no quedaba ninguno pendiente.
  for (const facade of [
    "src/lib/document-generation.ts",
    "src/lib/document-templates.ts",
    "src/lib/document-batches.ts",
    "src/lib/payroll-movements.ts",
  ]) {
    expect(existsSync(facade), `${facade} no debe seguir existiendo`).toBe(false)
  }

  // Ningún módulo puede quedarse importando un módulo puente que ya no existe.
  const retired = /from "@\/lib\/(document-generation|document-templates|document-batches|payroll-movements)"/
  const offenders = sourceFiles("src").filter((file) => retired.test(code(file)))
  expect(offenders, "ningún módulo debe importar una fachada retirada").toEqual([])

  // El contrato público que SÍ se sigue usando se conserva intacto, ya en su dominio:
  // los snapshots documentales en generación y el catálogo de variables en plantillas.
  for (const kept of [
    "src/domains/document-generation/domain/document-data.ts",
    "src/domains/document-generation/domain/document-resolution.rules.ts",
    "src/domains/document-templates/domain/document-variables.ts",
    "src/lib/supabase.ts",
  ]) {
    expect(existsSync(kept), `${kept} se conserva`).toBe(true)
  }
})
