import { supabase } from "@/lib/supabase"
import { todayIsoInCuba } from "@/utils/cuba-date"
import {
  documentTypeCodeForContractType,
  fetchGeneratedDocuments,
  generateAddendumDocument,
  generateContractDocument,
} from "@/modules/document-generation"
import { resolveDocumentTemplateVersion } from "@/modules/document-templates"
import type {
  ContractDocumentStatus,
  DocumentAutomationResult,
  PendingContractDocumentRow,
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
 * Además mantiene el estado del documento en el contrato (`PENDIENTE` | `GENERADO` | `ERROR`)
 * para que si el navegador sufre un corte de red o 503 tras crear el contrato, el contrato
 * quede marcado como pendiente/error y pueda generarse con un clic desde el resumen de la
 * entidad o la ficha del trabajador.
 */

export const CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT =
  "sitecorp:contract-document-status-changed"

const contractDocumentStatusStore = new Map<string, PendingContractDocumentRow>()

const notifyContractDocumentStatusChanged = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT))
  }
}

export const setContractDocumentStatus = async (
  contractId: string,
  status: ContractDocumentStatus,
  errorMessage?: string | null,
  meta?: {
    worker_id?: string | null
    worker_name?: string | null
    worker_identification?: string | null
    organization_entity_id?: string | null
    contract_type_name?: string | null
    start_date?: string | null
  }
): Promise<void> => {
  if (!contractId) return
  const existing = contractDocumentStatusStore.get(contractId)
  const nowIso = new Date().toISOString()
  const updated: PendingContractDocumentRow = {
    contract_id: contractId,
    worker_id: meta?.worker_id ?? existing?.worker_id ?? "",
    worker_name: meta?.worker_name ?? existing?.worker_name ?? "Trabajador recién contratado",
    worker_identification: meta?.worker_identification ?? existing?.worker_identification ?? null,
    organization_entity_id: meta?.organization_entity_id ?? existing?.organization_entity_id ?? "",
    contract_type_name: meta?.contract_type_name ?? existing?.contract_type_name ?? null,
    start_date: meta?.start_date ?? existing?.start_date ?? todayIsoInCuba(),
    document_status: status,
    document_error: status === "GENERADO" ? null : (errorMessage ?? null),
    document_status_updated_at: nowIso,
  }
  contractDocumentStatusStore.set(contractId, updated)
  notifyContractDocumentStatusChanged()

  try {
    const rpcResult = supabase.rpc?.("set_contract_document_status", {
      p_contract_id: contractId,
      p_status: status,
      p_error: status === "GENERADO" ? null : (errorMessage ?? null),
    })
    if (rpcResult && typeof (rpcResult as Promise<unknown>).then === "function") {
      await rpcResult
    }
  } catch {
    /* Si falla la red al guardar el estado en el servidor, se conserva en memoria local */
  }
}

export const getContractDocumentStatusSnapshot = (
  contractId: string
): PendingContractDocumentRow | null => {
  return contractDocumentStatusStore.get(contractId) ?? null
}

export const clearContractDocumentStatusStore = (): void => {
  contractDocumentStatusStore.clear()
}

export const fetchPendingContractDocuments = async (
  entityId?: string | null
): Promise<PendingContractDocumentRow[]> => {
  const byId = new Map<string, PendingContractDocumentRow>()

  for (const item of contractDocumentStatusStore.values()) {
    if (item.document_status === "PENDIENTE" || item.document_status === "ERROR") {
      if (!entityId || !item.organization_entity_id || item.organization_entity_id === entityId) {
        byId.set(item.contract_id, item)
      }
    }
  }

  try {
    const fromFn = supabase.from?.("employment_contracts")
    if (fromFn && typeof fromFn.select === "function") {
      let query = fromFn
        .select(
          `id, worker_id, organization_entity_id, start_date, document_status, document_error, document_status_updated_at,
           worker:workers(id, first_name, first_surname, second_surname, identification),
           contract_type:employment_contract_types(name, code)`
        )
        .in("document_status", ["PENDIENTE", "ERROR"])
        .is("end_reason", null)

      if (entityId) {
        query = query.eq("organization_entity_id", entityId)
      }

      const { data, error } = await query
      if (!error && Array.isArray(data)) {
        for (const raw of data as Record<string, unknown>[]) {
          const contractId = String(raw.id || "")
          if (!contractId) continue
          const local = contractDocumentStatusStore.get(contractId)
          if (local?.document_status === "GENERADO") continue

          const workerObj = (Array.isArray(raw.worker) ? raw.worker[0] : raw.worker) as
            | Record<string, unknown>
            | null
            | undefined
          const typeObj = (Array.isArray(raw.contract_type)
            ? raw.contract_type[0]
            : raw.contract_type) as Record<string, unknown> | null | undefined

          const fullName = workerObj
            ? [workerObj.first_name, workerObj.first_surname, workerObj.second_surname]
                .filter(Boolean)
                .join(" ")
                .trim()
            : ""

          const statusRaw = String(raw.document_status || local?.document_status || "PENDIENTE")
          const docStatus: ContractDocumentStatus =
            statusRaw === "ERROR"
              ? "ERROR"
              : statusRaw === "GENERADO"
                ? "GENERADO"
                : "PENDIENTE"

          if (docStatus === "GENERADO") continue

          byId.set(contractId, {
            contract_id: contractId,
            worker_id: String(raw.worker_id || local?.worker_id || ""),
            worker_name: fullName || local?.worker_name || "Trabajador",
            worker_identification:
              (workerObj?.identification ? String(workerObj.identification) : null) ??
              local?.worker_identification ??
              null,
            organization_entity_id: String(
              raw.organization_entity_id || local?.organization_entity_id || entityId || ""
            ),
            contract_type_name:
              (typeObj?.name ? String(typeObj.name) : null) ?? local?.contract_type_name ?? null,
            start_date:
              (raw.start_date ? String(raw.start_date) : null) ?? local?.start_date ?? null,
            document_status: local?.document_status ?? docStatus,
            document_error:
              local?.document_error ?? (raw.document_error ? String(raw.document_error) : null),
            document_status_updated_at: String(
              raw.document_status_updated_at ||
                local?.document_status_updated_at ||
                new Date().toISOString()
            ),
          })
        }
      }
    }
  } catch {
    /* En caso de error de red o entorno de test sin tabla mockeada, devolvemos el estado en memoria */
  }

  return Array.from(byId.values())
}

const todayIso = () => todayIsoInCuba()

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
 * Actualiza además el estado documental del contrato (`PENDIENTE` -> `GENERADO` | `ERROR`).
 */
export const ensureContractDocumentGenerated = async (
  contractId: string
): Promise<DocumentAutomationResult> => {
  await setContractDocumentStatus(contractId, "PENDIENTE", null)
  try {
    const existing = await fetchGeneratedDocuments({ contractId })
    if (existing.length > 0) {
      await setContractDocumentStatus(contractId, "GENERADO", null)
      return { generated: false, skipped: true, result: null }
    }
    const result = await generateContractDocument(contractId)
    if (result.success) {
      await setContractDocumentStatus(contractId, "GENERADO", null)
    } else {
      await setContractDocumentStatus(
        contractId,
        "ERROR",
        result.error || "No se pudo generar el documento contractual automáticamente."
      )
    }
    return { generated: result.success, skipped: false, result }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo generar el documento contractual automáticamente."
    await setContractDocumentStatus(contractId, "ERROR", message)
    throw error
  }
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

