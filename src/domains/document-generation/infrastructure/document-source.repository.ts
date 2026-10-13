import { supabase } from "@/lib/supabase"
import {
  isPayrollMovementKind,
  isResolutionKind,
  isSc404Kind,
  documentTypeCodeForContractType,
} from "../domain/rules"
import type { GenerationDocumentKind, SourceContext } from "../domain/entities"
import { record, text, throwIfError } from "./values"

/**
 * Generación documental — Origen del documento (infraestructura).
 *
 * Único punto que lee la FUENTE de la que se genera: contrato, anexo, período de vacaciones,
 * certificado médico, resolución o movimiento de nómina. De aquí salen el trabajador, la
 * entidad, la fecha de referencia, el tipo documental y la versión de plantilla ya fijada
 * (si existe). Los nombres de las tablas y de las columnas son el CONTRATO del backend.
 *
 * Un origen cancelado (vacaciones) NUNCA se documenta: se rechaza con el mismo mensaje.
 */

export const loadSourceContext = async (
  kind: GenerationDocumentKind,
  sourceId: string
): Promise<SourceContext> => {
  if (isSc404Kind(kind)) {
    return loadSc404SourceContext(kind, sourceId)
  }
  if (isResolutionKind(kind)) {
    const { data, error } = await supabase
      .from("worker_resolutions")
      .select("id, worker_id, organization_entity_id, resolution_date, document_template_version_id")
      .eq("id", sourceId)
      .maybeSingle()
    throwIfError(error)
    const row = record(data)
    if (!row.id) throw new Error("Resolución no encontrada")
    const date = text(row.resolution_date)
    return {
      kind,
      sourceId,
      workerId: String(row.worker_id),
      entityId: String(row.organization_entity_id),
      // Una Resolución es un evento formal: se genera una vez creada.
      formalized: true,
      referenceDate: date ?? new Date().toISOString().slice(0, 10),
      documentTypeCode: "RESOLUTION",
      pinnedVersionId: text(row.document_template_version_id),
    }
  }
  if (isPayrollMovementKind(kind)) {
    const { data, error } = await supabase
      .from("worker_payroll_movements")
      .select("id, worker_id, organization_entity_id, effective_date, document_template_version_id")
      .eq("id", sourceId)
      .maybeSingle()
    throwIfError(error)
    const row = record(data)
    if (!row.id) throw new Error("Movimiento de Nómina no encontrado")
    return {
      kind,
      sourceId,
      workerId: String(row.worker_id),
      entityId: String(row.organization_entity_id),
      // Un Movimiento de Nómina es un evento formal: se genera una vez creado.
      formalized: true,
      referenceDate: text(row.effective_date) ?? new Date().toISOString().slice(0, 10),
      documentTypeCode: "PAYROLL_MOVEMENT",
      pinnedVersionId: text(row.document_template_version_id),
    }
  }

  if (kind === "CONTRACT") {
    const { data, error } = await supabase
      .from("employment_contracts")
      .select(
        "id, worker_id, organization_entity_id, start_date, signature_date, document_template_version_id, contract_type_id, employment_contract_types(code)"
      )
      .eq("id", sourceId)
      .maybeSingle()
    throwIfError(error)
    const row = record(data)
    if (!row.id) throw new Error("Contrato no encontrado")
    const typeCode = text(record(row.employment_contract_types).code)
    return {
      kind,
      sourceId,
      workerId: String(row.worker_id),
      entityId: String(row.organization_entity_id),
      formalized: row.signature_date != null,
      referenceDate:
        text(row.signature_date) ?? text(row.start_date) ?? new Date().toISOString().slice(0, 10),
      documentTypeCode: documentTypeCodeForContractType(typeCode),
      pinnedVersionId: text(row.document_template_version_id),
    }
  }

  const { data, error } = await supabase
    .from("contract_addendums")
    .select(
      "id, worker_id, organization_entity_id, effective_date, signature_date, status, document_template_version_id"
    )
    .eq("id", sourceId)
    .maybeSingle()
  throwIfError(error)
  const row = record(data)
  if (!row.id) throw new Error("Anexo no encontrado")
  return {
    kind,
    sourceId,
    workerId: String(row.worker_id),
    entityId: String(row.organization_entity_id),
    formalized: text(row.status) === "FORMALIZED",
    referenceDate:
      text(row.signature_date) ?? text(row.effective_date) ?? new Date().toISOString().slice(0, 10),
    documentTypeCode: "EMPLOYMENT_CONTRACT_ADDENDUM",
    pinnedVersionId: text(row.document_template_version_id),
  }
}

const loadSc404SourceContext = async (
  kind: "VACATION" | "MEDICAL_CERTIFICATE",
  sourceId: string
): Promise<SourceContext> => {
  if (kind === "VACATION") {
    const { data, error } = await supabase
      .from("worker_vacations")
      .select("id, worker_id, organization_entity_id, start_date, status")
      .eq("id", sourceId)
      .maybeSingle()
    throwIfError(error)
    const row = record(data)
    if (!row.id) throw new Error("Período de vacaciones no encontrado")
    if (text(row.status) === "CANCELLED") {
      throw new Error("No se puede generar el documento de un período cancelado")
    }
    return {
      kind,
      sourceId,
      workerId: String(row.worker_id),
      entityId: String(row.organization_entity_id),
      formalized: true,
      referenceDate: text(row.start_date) ?? new Date().toISOString().slice(0, 10),
      documentTypeCode: "SC_4_04",
      pinnedVersionId: null,
    }
  }

  const { data, error } = await supabase
    .from("worker_medical_certificates")
    .select("id, worker_id, organization_entity_id, start_date")
    .eq("id", sourceId)
    .maybeSingle()
  throwIfError(error)
  const row = record(data)
  if (!row.id) throw new Error("Certificado médico no encontrado")
  return {
    kind,
    sourceId,
    workerId: String(row.worker_id),
    entityId: String(row.organization_entity_id),
    formalized: true,
    referenceDate: text(row.start_date) ?? new Date().toISOString().slice(0, 10),
    documentTypeCode: "SC_4_04",
    pinnedVersionId: null,
  }
}
