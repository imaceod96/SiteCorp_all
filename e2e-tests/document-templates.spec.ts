import { test, expect } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import {
  inspectTemplateFile,
  documentTypeCodeForTemplateType,
  formatTemplateFileSize,
  templateAcceptForType,
  templateFileFormatLabel,
  templateVersionPeriodLabel,
  TEMPLATE_TYPE_USES_XLSX,
} from "../src/modules/document-templates/domain/rules"
import {
  MAX_TEMPLATE_FILE_BYTES,
  UNSUPPORTED_WORD_FILE_MESSAGE,
} from "../src/modules/document-templates/domain/entities"
import type { DocumentTemplateVersion } from "../src/modules/document-templates/domain/entities"

/**
 * ADMINISTRACIÓN DE PLANTILLAS DOCUMENTALES — reglas puras y frontera del dominio.
 *
 * Comprueba, SIN subir archivos ni escribir en la base de datos, lo que decide si la
 * migración de este bloque se mantiene:
 *   1. Detección del formato REAL de un documento (por firma, no por su nombre), límites y
 *      atributos de admisión por tipo documental.
 *   2. Etiquetas y periodos de vigencia de las versiones (borrador, vigente, cerrada).
 *   3. Que la administración de plantillas vive en UN dominio y que las pantallas y los
 *      componentes migrados ya no consultan Supabase ni la fachada legacy.
 *   4. Que la fachada legacy se retiró (limpieza controlada) y que el dominio es el ÚNICO
 *      punto de entrada para resolver versiones de plantilla.
 *
 * Las importaciones profundas traen reglas PURAS: no arrastran el cliente de Supabase.
 * Las pruebas funcionales reales del módulo son las de la pantalla (Playwright sobre la
 * aplicación en marcha); aquí se verifican reglas y contratos.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Archivo mínimo con lo único que la inspección usa: nombre, tamaño y primeros bytes. */
const fileLike = (name: string, bytes: number[], size = bytes.length): File =>
  ({
    name,
    size,
    slice: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }),
  }) as unknown as File

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]

// ---------------------------------------------------------------------------
// 1. Formato real, límites y admisión por tipo documental
// ---------------------------------------------------------------------------

test("el formato del documento se decide por su firma, no por su extensión", async () => {
  const doc = await inspectTemplateFile(fileLike("modelo.doc", OLE2))
  expect(doc.format).toBe("DOC")
  expect(doc.extension).toBe("doc")
  expect(doc.problem).toBeNull()

  const docx = await inspectTemplateFile(fileLike("modelo.docx", ZIP))
  expect(docx.format).toBe("DOCX")
  expect(docx.extension).toBe("docx")

  // Paquete OOXML declarado como Excel: es la hoja de Movimiento de Nómina.
  const xlsx = await inspectTemplateFile(fileLike("movimiento.xlsx", ZIP))
  expect(xlsx.format).toBe("XLSX")

  // Un PDF renombrado a .docx NO se acepta: la firma manda.
  const fake = await inspectTemplateFile(fileLike("modelo.docx", PDF))
  expect(fake.format).toBe("UNSUPPORTED")
  expect(fake.problem).toBe(UNSUPPORTED_WORD_FILE_MESSAGE)
})

test("los límites de tamaño y los formatos admitidos por tipo se conservan", async () => {
  const vacio = await inspectTemplateFile(fileLike("vacio.docx", []))
  expect(vacio.problem).toBe("El archivo está vacío.")

  const grande = await inspectTemplateFile(
    fileLike("grande.docx", ZIP, MAX_TEMPLATE_FILE_BYTES + 1)
  )
  expect(grande.problem).toBe("El archivo supera el límite permitido de 10 MB.")

  // Sólo Movimiento de Nómina usa plantilla Excel; el resto, documentos Word.
  expect(TEMPLATE_TYPE_USES_XLSX("PAYROLL_MOVEMENT")).toBe(true)
  expect(TEMPLATE_TYPE_USES_XLSX("RESOLUTION")).toBe(false)
  expect(TEMPLATE_TYPE_USES_XLSX(null)).toBe(false)

  expect(templateAcceptForType("PAYROLL_MOVEMENT")).toContain(".xlsx")
  expect(templateAcceptForType("PAYROLL_MOVEMENT")).not.toContain(".docx")
  expect(templateAcceptForType("EMPLOYMENT_CONTRACT_DETERMINED")).toContain(".docx")

  // Cada tipo de plantilla pertenece a un tipo documental del registro central.
  expect(documentTypeCodeForTemplateType("EMPLOYMENT_CONTRACT_ADDENDUM")).toBe("ADDENDUM")
  expect(documentTypeCodeForTemplateType("SC_4_04")).toBe("SC_4_04")
  expect(documentTypeCodeForTemplateType("RESOLUTION")).toBe("RESOLUTION")
  expect(documentTypeCodeForTemplateType("PAYROLL_MOVEMENT")).toBe("PAYROLL_MOVEMENT")
  expect(documentTypeCodeForTemplateType("EMPLOYMENT_CONTRACT_DETERMINED")).toBe("CONTRACT")

  expect(templateFileFormatLabel("DOC")).toBe("Word 97-2003 (.doc)")
  expect(templateFileFormatLabel("DOCX")).toBe("Word (.docx)")
  expect(templateFileFormatLabel("XLSX")).toBe("Excel (.xlsx)")
  expect(templateFileFormatLabel(null)).toBe("Formato no identificado")

  expect(formatTemplateFileSize(null)).toBe("—")
  expect(formatTemplateFileSize(2048)).toBe("2 KB")
  expect(formatTemplateFileSize(1024 * 1024 * 3)).toBe("3.0 MB")
})

// ---------------------------------------------------------------------------
// 2. Versiones y vigencias
// ---------------------------------------------------------------------------

test("las versiones conservan su estado y su vigencia legible", () => {
  const version = (
    over: Partial<Pick<DocumentTemplateVersion, "effective_from" | "effective_to" | "status">>
  ) =>
    templateVersionPeriodLabel({
      effective_from: null,
      effective_to: null,
      status: "DRAFT",
      ...over,
    })

  expect(version({})).toBe("Sin vigencia (borrador)")
  expect(version({ status: "ACTIVE" })).toBe("Vigente sin fecha de inicio")
  expect(version({ status: "ACTIVE", effective_from: "2026-03-01" })).toBe(
    "Desde 01/03/2026 · vigente"
  )
  expect(
    version({ status: "INACTIVE", effective_from: "2024-01-15", effective_to: "2025-12-31" })
  ).toBe("Del 15/01/2024 al 31/12/2025")
})

// ---------------------------------------------------------------------------
// 3. La administración de plantillas vive en un solo dominio
// ---------------------------------------------------------------------------

test("el catálogo, las versiones y los archivos viven sólo en el dominio de plantillas", () => {
  const repository = read(
    "src/modules/document-templates/infrastructure/document-templates.repository.ts"
  )
  expect(repository).toMatch(/@\/lib\/supabase/)
  expect(repository).toMatch(/\.from\("document_templates"\)/)
  expect(repository).toMatch(/\.from\("document_template_types"\)/)
  expect(repository).toMatch(/\.from\("document_variables"\)/)
  // Los RPC del backend conservan su nombre y sus parámetros.
  expect(repository).toMatch(/\.rpc\("create_document_template", \{/)
  expect(repository).toMatch(/p_entity_id: entityId/)
  expect(repository).toMatch(/p_document_type_code: documentTypeCode/)
  expect(repository).toMatch(/\.rpc\("create_document_template_version", \{/)
  expect(repository).toMatch(/p_template_id: templateId/)
  expect(repository).toMatch(/\.rpc\("save_document_template_analysis", \{/)
  expect(repository).toMatch(/\.rpc\("validate_document_template_version", \{/)
  expect(repository).toMatch(/\.rpc\("activate_document_template_version", \{/)
  expect(repository).toMatch(/\.rpc\("deactivate_document_template_version", \{/)
  // El aislamiento por entidad se filtra por la columna real de la versión.
  expect(repository).toMatch(/\.eq\("organization_entity_id", entityId\)/)

  const files = read(
    "src/modules/document-templates/infrastructure/document-template-files.repository.ts"
  )
  expect(files).toMatch(/@\/lib\/supabase/)
  expect(files).toMatch(/storage/)
  expect(files).toMatch(/\.from\(DOCUMENT_TEMPLATES_BUCKET\)/)
  expect(files).toMatch(/\.rpc\("set_document_template_version_file", \{/)
  expect(files).toMatch(/p_file_kind: input.kind/)
  expect(files).toMatch(/p_analysis_issue: input.analysisIssue/)
  expect(files).toMatch(/functions\.invoke\("analyze-document-template", \{/)
  expect(files).toMatch(/body: \{ file_path: filePath \}/)

  // El análisis y la validación los decide el backend: el dominio sólo los registra.
  const commands = read(
    "src/modules/document-templates/application/document-templates.commands.ts"
  )
  expect(commands).not.toMatch(/@\/lib\/supabase/)
  expect(commands).toMatch(/registerTemplateFile/)
  expect(commands).toMatch(/reanalyzeTemplateFile/)
  expect(commands).toMatch(/describeTemplateFileProblem|inspectTemplateFile/)
  expect(commands).toMatch(/removeTemplateObjects\(\[path\]\)/)
})

test("las pantallas y los componentes migrados ya no consultan Supabase", () => {
  const presentation = [
    "src/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplates.tsx",
    "src/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplateDetail.tsx",
    "src/modules/document-templates/presentation/components/CreateDocumentTemplateDialog.tsx",
    "src/modules/document-templates/presentation/components/DocumentTemplateFilesPanel.tsx",
    "src/modules/document-templates/presentation/components/DocumentTemplateValidationPanel.tsx",
    "src/modules/document-templates/presentation/components/DocumentTemplateVariablesPanel.tsx",
    "src/modules/document-templates/presentation/components/DocumentTemplateVersionsPanel.tsx",
  ]

  for (const file of presentation) {
    const source = read(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar la fachada legacy`).not.toMatch(/@\/lib\/document-templates/)
    expect(source, `${file} no debe resolver nomenclatura`).not.toMatch(/schema-target/)
    expect(source, `${file} debe consumir el dominio de plantillas`).toMatch(
      /@\/(domains|modules)\/document-templates/
    )
  }

  // Los permisos se preguntan al dominio de control de acceso y el nombre de la entidad al
  // de estructura organizativa: la pantalla no compone consultas.
  const list = read("src/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplates.tsx")
  expect(list).toMatch(/loadEntityPermissionSafe\(entityId, "document_templates.view"\)/)
  expect(list).toMatch(/loadEntityPermissionSafe\(entityId, "document_templates.manage"\)/)
  expect(list).toMatch(/fetchEntityName\(entityId\)/)
  expect(list).toMatch(/fetchDocumentTemplates\(entityId\)/)

  const detail = read("src/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplateDetail.tsx")
  expect(detail).toMatch(/validateTemplateVersion/)
  expect(detail).toMatch(/activateTemplateVersion/)
  expect(detail).toMatch(/reanalyzeTemplateFile/)
  expect(detail).toMatch(/registerTemplateFile/)
})

test("la fachada legacy se retiró: el dominio es el único punto de entrada", () => {
  // Limpieza controlada: se eliminó cuando el último consumidor migró al dominio.
  expect(existsSync("src/lib/document-templates.ts")).toBe(false)
  expect(existsSync("src/lib/document-generation.ts")).toBe(false)

  // Y los consumidores reales piden aquí las plantillas, sus versiones y su vigencia.
  for (const file of [
    "src/modules/document-generation/infrastructure/document-template-version.repository.ts",
    "src/modules/document-generation/application/document-generation.commands.ts",
    "src/modules/contracts/infrastructure/contract-documents.repository.ts",
    "src/modules/resolutions/infrastructure/resolutions.repository.ts",
    "src/modules/document-generation/presentation/components/ContractualDocumentSection.tsx",
  ]) {
    expect(read(file), `${file} debe consumir el módulo de plantillas`).toMatch(
      /from "@\/modules\/document-templates"/
    )
  }
})

test("el motor documental consume el dominio de plantillas, no la fachada", () => {
  // El motor vive en su propio dominio y pide ahí las plantillas y sus versiones.
  const adapter = read(
    "src/modules/document-generation/infrastructure/document-template-version.repository.ts"
  )
  expect(adapter).toMatch(/from "@\/modules\/document-templates"/)
  expect(adapter).not.toMatch(/@\/lib\/document-templates/)

  const commands = read(
    "src/modules/document-generation/application/document-generation.commands.ts"
  )
  expect(commands).toMatch(/from "@\/modules\/document-templates"/)

  // La sección contractual del expediente también consume el dominio directamente.
  expect(
    read("src/modules/document-generation/presentation/components/ContractualDocumentSection.tsx")
  ).toMatch(/from "@\/modules\/document-templates"/)
})

test("el dominio de plantillas no depende de otros dominios ni de la presentación", () => {
  const domainFiles = [
    "src/modules/document-templates/index.ts",
    "src/modules/document-templates/domain/entities.ts",
    "src/modules/document-templates/domain/rules.ts",
    "src/modules/document-templates/application/document-templates.queries.ts",
    "src/modules/document-templates/application/document-templates.commands.ts",
    "src/modules/document-templates/infrastructure/document-templates.repository.ts",
    "src/modules/document-templates/infrastructure/document-template-files.repository.ts",
  ]

  for (const file of domainFiles) {
    const source = read(file)
    expect(source, `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/(domains|modules)\/(?!document-templates)/
    )
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
  }
})
