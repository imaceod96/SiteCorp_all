import { describe, expect, it } from "vitest"
import {
  DOCUMENT_VARIABLES,
  type DocumentTypeCode,
} from "../domain/document-variables"
import {
  reconcileTemplateAnalysisWithCatalog,
  reconcileTemplateValidationWithCatalog,
  templatePlaceholderExamplesForType,
} from "../domain/rules"
import type { DocumentTemplateAnalysis, TemplateValidation } from "../domain/entities"
import { resolveDocumentVariable } from "@/modules/document-generation/domain/document-resolution.rules"
import type { ResolutionDocumentData } from "@/modules/document-generation/domain/document-data"

const visibleVariablesForType = (docType: DocumentTypeCode) =>
  DOCUMENT_VARIABLES.filter(
    (def) =>
      def.documentTypes.includes(docType) && !def.catalogHiddenFor?.includes(docType)
  )

describe("QA Manual de Gestor v2.4.0 — Plantillas Documentales y Catálogo de Variables", () => {
  it("C2: reconoce las 45 variables visibles del catálogo de Contrato de Trabajo y reconcilia respuestas desactualizadas del backend", () => {
    const contractVars = visibleVariablesForType("CONTRACT")
    expect(contractVars).toHaveLength(45)

    const allOccurrences = contractVars.map((v) => ({
      key: v.key,
      count: 1,
      split_runs: 0,
    }))

    // Simulamos que el RPC de BD (antes de la migración) devolvió solo 4 reconocidas y 41 como "unknown_variables"
    const staleBackendAnalysis: DocumentTemplateAnalysis = {
      analyzed_at: "2026-01-01T00:00:00Z",
      file_path: "entity/qa/templates/t-1/v1/CONFIGURED.docx",
      file_kind: "CONFIGURED",
      file_name: "Contrato_Determinado.docx",
      file_sha256: "abc123",
      valid_docx: true,
      zip_signature_ok: true,
      has_document_xml: true,
      scanned_parts: ["word/document.xml"],
      paragraphs_scanned: 20,
      occurrences: allOccurrences,
      recognized: allOccurrences.slice(0, 4),
      required_variables: allOccurrences.slice(0, 4).map((item) => item.key),
      unknown_variables: allOccurrences.slice(4).map((item) => ({ key: item.key, count: item.count })),
      incompatible_variables: [],
      malformed_placeholders: [],
      split_run_placeholders: 0,
      warnings: ["El documento no contiene marcadores dinámicos {{variable}}."],
    }

    const reconciledAnalysis = reconcileTemplateAnalysisWithCatalog(
      staleBackendAnalysis,
      "CONTRACT"
    )
    expect(reconciledAnalysis.recognized).toHaveLength(45)
    expect(reconciledAnalysis.unknown_variables).toHaveLength(0)
    expect(reconciledAnalysis.incompatible_variables).toHaveLength(0)

    const staleValidation: TemplateValidation = {
      version_id: "v-1",
      template_id: "t-1",
      document_type_code: "CONTRACT",
      version_number: 1,
      status: "DRAFT",
      effective_from: null,
      effective_to: null,
      original_file_name: "Contrato_Original.docx",
      original_file_format: "DOCX",
      original_mime_type: null,
      configured_file_name: "Contrato_Determinado.docx",
      configured_file_format: "DOCX",
      configured_mime_type: null,
      analysis_issue: null,
      analyzed_file_path: "entity/qa/templates/t-1/v1/CONFIGURED.docx",
      ready: false,
      checks: {
        original_file_present: true,
        configured_file_present: true,
        configured_format_analyzable: true,
        analysis_present: true,
        analysis_matches_configured: true,
        valid_docx: true,
        no_unknown_variables: false,
        no_incompatible_variables: true,
        no_malformed_placeholders: true,
        has_placeholders: true,
        effective_dates_coherent: true,
        no_simultaneous_active: true,
      },
      analysis: staleBackendAnalysis,
      variables_found: 45,
      variables_valid: 4,
      variables_unknown: 41,
      variables_incompatible: 0,
      occurrences_total: 45,
      occurrences_invalid: 41,
      required_variables: allOccurrences.slice(0, 4).map((item) => item.key),
      recognized: allOccurrences.slice(0, 4),
      unknown_variables: allOccurrences.slice(4).map((item) => ({ key: item.key, count: item.count })),
      incompatible_variables: [],
      malformed_placeholders: [],
      warnings: [],
    }

    const reconciledValidation = reconcileTemplateValidationWithCatalog(staleValidation)
    expect(reconciledValidation.ready).toBe(true)
    expect(reconciledValidation.variables_valid).toBe(45)
    expect(reconciledValidation.variables_unknown).toBe(0)
    expect(reconciledValidation.unknown_variables).toHaveLength(0)
    expect(reconciledValidation.required_variables).toHaveLength(45)
  })

  it("G1 y G2: worker.full_name se acepta como alias retrocompatible en los 5 tipos y los ejemplos usan el prefijo propio de cada tipo", () => {
    const workerFullName = DOCUMENT_VARIABLES.find((v) => v.key === "worker.full_name")
    expect(workerFullName).toBeDefined()
    expect(workerFullName?.documentTypes).toEqual([
      "CONTRACT",
      "ADDENDUM",
      "SC_4_04",
      "RESOLUTION",
      "PAYROLL_MOVEMENT",
    ])

    // En ningún tipo aparece duplicado en el catálogo visible
    for (const code of [
      "CONTRACT",
      "ADDENDUM",
      "SC_4_04",
      "RESOLUTION",
      "PAYROLL_MOVEMENT",
    ] as const) {
      const visibleKeys = visibleVariablesForType(code).map((v) => v.key)
      expect(visibleKeys).not.toContain("worker.full_name")
    }

    // Pero si el backend devuelve worker.full_name como incompatible o desconocida en cualquiera de los 5 tipos, la reconciliación lo reconoce como válida
    for (const code of [
      "CONTRACT",
      "ADDENDUM",
      "SC_4_04",
      "RESOLUTION",
      "PAYROLL_MOVEMENT",
    ] as const) {
      const analysisWithAlias: DocumentTemplateAnalysis = {
        analyzed_at: "2026-01-01T00:00:00Z",
        file_path: "entity/qa/templates/t-1/v1/CONFIGURED.docx",
        file_kind: "CONFIGURED",
        file_name: "Plantilla.docx",
        file_sha256: "abc123",
        valid_docx: true,
        zip_signature_ok: true,
        has_document_xml: true,
        scanned_parts: ["word/document.xml"],
        paragraphs_scanned: 5,
        occurrences: [{ key: "worker.full_name", count: 1, split_runs: 0 }],
        recognized: [],
        required_variables: [],
        unknown_variables: [],
        incompatible_variables: [
          {
            key: "worker.full_name",
            label: "Trabajador · Nombre completo",
            count: 1,
          },
        ],
        malformed_placeholders: [],
        split_run_placeholders: 0,
        warnings: [],
      }
      const reconciled = reconcileTemplateAnalysisWithCatalog(analysisWithAlias, code)
      expect(reconciled.recognized.map((r) => r.key)).toContain("worker.full_name")
      expect(reconciled.incompatible_variables).toHaveLength(0)
    }

    // Y se resuelve también en RESOLUTION
    const resSnapshot: ResolutionDocumentData = {
      document_type: "RESOLUTION",
      resolution_id: "res-1",
      entity: {
        name: "Empresa QA",
        municipality: "Plaza",
        revolution_year: "Año 68 de la Revolución",
      },
      parent_company: {
        name: "Grupo QA",
      },
      representative: {
        name: "María López",
        position: "Directora General",
      },
      worker: {
        full_name: "Juan Pérez García",
        identification: "90010112345",
      },
      job: {
        name: "Especialista Principal",
        salary_group_sequence: 2,
        salary_amount: 5200,
        currency_code: "CUP",
        work_content: "Funciones técnicas",
      },
      resolution: {
        date: "2026-01-15",
      },
    }
    const resolved = resolveDocumentVariable(resSnapshot, "worker.full_name")
    expect(resolved).toEqual({
      status: "value",
      value: "Juan Pérez García",
    })

    // G2: ejemplos de marcador por tipo documental
    expect(templatePlaceholderExamplesForType("CONTRACT")).toMatchObject({
      primary: "{{c.nom}}",
      secondary: "{{c.ci}}",
    })
    expect(templatePlaceholderExamplesForType("RESOLUTION")).toMatchObject({
      primary: "{{r.nom}}",
      secondary: "{{r.car}}",
    })
  })

  it("M16: las descripciones del catálogo de variables no exponen nombres de tablas ni columnas técnicas en inglés", () => {
    const forbiddenTokens = [
      "organization_entities",
      "start_date",
      "end_date",
      "return_date",
      "ledger",
    ]
    for (const variable of DOCUMENT_VARIABLES) {
      for (const token of forbiddenTokens) {
        expect(variable.description).not.toContain(token)
      }
    }
  })

  it("M17, V1–V6 y D8: mantiene política de no eliminación de plantillas, excluye variables descartadas y documenta flujos de Prenómina y SST en Manual v2.4.0", async () => {
    const { MANUAL_SECTIONS } = await import("@/modules/user-manual/domain/manual-data")

    // V1–V6 descartadas por decisión de negocio
    const discardedKeys = ["c.res_r", "a.res_r", "c.est_civ", "c.cta_ban", "c.pru_txt", "c.h_ent", "c.h_sal", "c.sal_let", "r.sal_let"]
    for (const key of discardedKeys) {
      expect(DOCUMENT_VARIABLES.find((v) => v.key === key)).toBeUndefined()
    }

    // M17: documentada la regla de no eliminación física en plantillas documentales
    const templatesSection = MANUAL_SECTIONS.find((s) => s.id === "admin-setup-templates")
    expect(templatesSection).toBeDefined()
    expect(
      templatesSection?.businessRules.some((r) =>
        r.includes("nunca se eliminan físicamente")
      )
    ).toBe(true)

    // D8: flujos completos de cierre de Prenómina y SST (IPERC, EMO, investigación de incidentes)
    const payrollSection = MANUAL_SECTIONS.find((s) => s.id === "entity-payroll-preparation")
    const sstSection = MANUAL_SECTIONS.find((s) => s.id === "entity-sst")
    expect(payrollSection?.workflows.length).toBeGreaterThanOrEqual(2)
    expect(
      payrollSection?.workflows.some((w) => w.title.includes("cierre contable"))
    ).toBe(true)
    expect(sstSection?.workflows.length).toBeGreaterThanOrEqual(2)
    expect(
      sstSection?.workflows.some((w) => w.title.includes("IPERC"))
    ).toBe(true)
  })
})
