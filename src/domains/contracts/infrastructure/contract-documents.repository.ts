import { supabase } from "@/lib/supabase"
import {
  documentTypeCodeForContractType,
  fetchGeneratedDocuments,
  generateAddendumDocument,
  generateContractDocument,
} from "@/domains/document-generation"
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
 * reintentos. Es la única parte del contexto que habla con el motor documental (`@/lib`).
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

  const { data, error } = await supabase.rpc("resolve_document_template_version", {
    p_entity_id: entityId,
    p_document_type_code: documentTypeCode,
    p_reference_date: referenceDate || todayIso(),
  })
  if (error) throw error

  const row = (data as Record<string, unknown> | null) || {}
  const rawStatus = row.status != null ? String(row.status) : "NONE"
  const status: TemplateAvailabilityStatus =
    rawStatus === "RESOLVED" || rawStatus === "NONE" || rawStatus === "AMBIGUOUS"
      ? rawStatus
      : "UNKNOWN"

  return {
    status,
    documentTypeCode,
    versionId: row.version_id != null ? String(row.version_id) : null,
    versionNumber: row.version_number != null ? Number(row.version_number) : null,
    templateName: row.template_name != null ? String(row.template_name) : null,
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
