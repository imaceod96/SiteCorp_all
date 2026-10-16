import {
  documentTypeCodeForContractType,
  fetchGeneratedDocuments,
  generateAddendumDocument,
  generateContractDocument,
} from "@/domains/document-generation"
import { resolveDocumentTemplateVersion } from "@/domains/document-templates"
import type {
  DocumentAutomationResult,
  TemplateAvailability,
  TemplateAvailabilityStatus,
} from "../domain/entities"

/**
 * Contratos y documentos — Automatización documental (infraestructura).
 *
 * Convierte la formalización contractual en UNA operación de negocio: validar la plantilla
 * ANTES de aplicar el cambio y generar el documento inmediatamente después, sin exigir al
 * usuario un paso manual de «Generar documento».
 *
 * Reutiliza el motor documental existente y su idempotencia (`begin_document_generation`):
 * aquí sólo se decide CUÁNDO y si ya existe un documento, para no generar duplicados ante
 * reintentos. Este archivo ya no habla con Supabase: consume los dominios documentales.
 */

const todayIso = () => new Date().toISOString().slice(0, 10)

const resolveTemplateAvailability = async (
  entityId: string,
  documentTypeCode: string | null,
  referenceDate: string | null
): Promise<TemplateAvailability> => {
  if (!entityId || !documentTypeCode) {
    return {
      status: "UNKNOWN",
      documentTypeCode,
      versionId: null,
      versionNumber: null,
      templateName: null,
    }
  }

  // La vigencia la resuelve el dominio de plantillas: aquí no se compone ninguna consulta.
  const resolved = await resolveDocumentTemplateVersion(
    entityId,
    documentTypeCode,
    referenceDate || todayIso()
  )

  const status: TemplateAvailabilityStatus =
    resolved.status === "RESOLVED" ||
    resolved.status === "NONE" ||
    resolved.status === "AMBIGUOUS"
      ? resolved.status
      : "UNKNOWN"

  return {
    status,
    documentTypeCode,
    versionId: resolved.version_id,
    versionNumber: resolved.version_number,
    templateName: resolved.template_name,
  }
}

/** ¿Existe una plantilla activa aplicable para el contrato de ese tipo a esa fecha? */
export const resolveContractTemplateAvailability = (
  entityId: string,
  contractTypeCode: string | null,
  referenceDate: string | null
): Promise<TemplateAvailability> =>
  resolveTemplateAvailability(entityId, documentTypeCodeForContractType(contractTypeCode), referenceDate)

/** ¿Existe una plantilla activa aplicable para el anexo a esa fecha? */
export const resolveAddendumTemplateAvailability = (
  entityId: string,
  referenceDate: string | null
): Promise<TemplateAvailability> =>
  resolveTemplateAvailability(entityId, "EMPLOYMENT_CONTRACT_ADDENDUM", referenceDate)

/**
 * Garantiza que el contrato tenga documento: no genera si ya existe uno completado, de modo
 * que un reintento o un doble clic nunca produzca documentos duplicados.
 */
export const ensureContractDocumentGenerated = async (
  contractId: string
): Promise<DocumentAutomationResult> => {
  const existing = await fetchGeneratedDocuments({ contractId })
  if (existing.length > 0) return { generated: false, skipped: true, result: null }
  const result = await generateContractDocument(contractId)
  return { generated: result.success, skipped: false, result }
}

/** Igual que el contrato, para el anexo. */
export const ensureAddendumDocumentGenerated = async (
  addendumId: string
): Promise<DocumentAutomationResult> => {
  const existing = await fetchGeneratedDocuments({ addendumId })
  if (existing.length > 0) return { generated: false, skipped: true, result: null }
  const result = await generateAddendumDocument(addendumId)
  return { generated: result.success, skipped: false, result }
}
