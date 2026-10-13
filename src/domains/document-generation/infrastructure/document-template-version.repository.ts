import {
  fetchDocumentTemplateVersion,
  resolveDocumentTemplateVersion,
} from "@/domains/document-templates"
import type {
  DocumentTemplateVersionDetail,
  ResolvedDocumentTemplateVersion,
} from "@/domains/document-templates"
import type { TemplateResolution } from "../domain/entities"

/**
 * Generación documental — Versión de plantilla (infraestructura, capa anticorrupción).
 *
 * El motor NO consulta el catálogo de plantillas por su cuenta: las plantillas, sus versiones y
 * sus vigencias se piden SIEMPRE al dominio `document-templates`, que es su dueño. Aquí sólo se
 * TRADUCE ese contrato al que el motor necesita, sin alterar ninguna decisión del backend.
 */

export interface LoadedTemplateVersion {
  template: TemplateResolution
  requiredVariables: string[]
  analysisPresent: boolean
}

/**
 * Traduce una versión (o su ausencia) al contrato del motor.
 *
 * El documento configurado debe ser un paquete OOXML analizable: Word (.docx) o Excel (.xlsx,
 * sólo Movimiento de Nómina). Una versión invisible por RLS se comporta igual que una
 * inexistente: no se inventa plantilla ni variables.
 */
const toTemplateResolution = (version: DocumentTemplateVersionDetail | null): LoadedTemplateVersion => {
  const format = version?.configured_file_format ?? null
  const configuredFilePath = version?.configured_file_path ?? null
  const analysis = version?.analysis ?? null
  const required = analysis && Array.isArray(analysis.required_variables)
    ? analysis.required_variables.map((value) => String(value))
    : []

  return {
    template: {
      status: "PINNED",
      versionId: version?.id ?? null,
      versionNumber: version?.version_number ?? null,
      versionStatus: version?.status ?? null,
      versionUsable: (format === "DOCX" || format === "XLSX") && configuredFilePath != null,
      templateName: version?.template_name ?? null,
      effectiveFrom: version?.effective_from ?? null,
      effectiveTo: version?.effective_to ?? null,
      configuredFilePath,
      configuredFileFormat: format,
      // Lo completa el caso de uso con la fecha de referencia del origen.
      referenceDate: "",
      documentTypeCode: version?.document_type_code ?? "",
    },
    requiredVariables: required,
    analysisPresent: analysis != null && required.length > 0,
  }
}

/** Versión concreta ya FIJADA en la fuente (las regeneraciones usan siempre esta versión). */
export const loadTemplateVersionForGeneration = async (
  versionId: string
): Promise<LoadedTemplateVersion> => toTemplateResolution(await fetchDocumentTemplateVersion(versionId))

/** Versión VIGENTE para un tipo documental y una entidad en la fecha de referencia. */
export const resolveTemplateVersionByDate = async (input: {
  entityId: string
  documentTypeCode: string
  referenceDate: string
}): Promise<ResolvedDocumentTemplateVersion> =>
  resolveDocumentTemplateVersion(input.entityId, input.documentTypeCode, input.referenceDate)
