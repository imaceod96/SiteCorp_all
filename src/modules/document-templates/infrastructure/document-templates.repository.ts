import { supabase } from "@/lib/supabase"
import type {
  CreateDocumentTemplateInput,
  DocumentTemplate,
  DocumentTemplateAnalysis,
  DocumentTemplateType,
  DocumentTemplateVersion,
  DocumentTemplateVersionDetail,
  DocumentTemplateVersionStatus,
  ResolvedDocumentTemplateVersion,
  TemplateValidation,
} from "../domain/entities"

/**
 * Plantillas documentales — Repositorio de consultas y RPC (infraestructura).
 *
 * Único punto que habla con Supabase para el catálogo de plantillas, sus versiones y su
 * análisis: la presentación y los componentes del módulo no componen consultas.
 *
 * Ninguna decisión de negocio se toma aquí: la base de datos decide qué tipo documental
 * existe, qué variables son válidas y qué versión puede activarse (RPC SECURITY DEFINER con
 * el permiso `organization.manage` de la entidad). Los parámetros y las claves de salida de
 * las RPC son el CONTRATO del backend y no cambian.
 *
 * Los errores se propagan tal cual; la interfaz ya muestra el mensaje del backend.
 */

const throwIfError = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Catálogo de tipos de plantilla activos, en su orden de presentación. */
export const selectDocumentTemplateTypes = async (): Promise<DocumentTemplateType[]> => {
  const { data, error } = await supabase
    .from("document_template_types")
    .select("code, name, description, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order")

  throwIfError(error)
  return (data as DocumentTemplateType[]) || []
}

/**
 * Plantillas de UNA entidad con sus versiones.
 *
 * El aislamiento por entidad lo aplica el filtro por `organization_entity_id` y, por
 * debajo, RLS: nunca se devuelven plantillas de otra entidad.
 */
export const selectEntityDocumentTemplates = async (
  entityId: string
): Promise<DocumentTemplate[]> => {
  const { data, error } = await supabase
    .from("document_templates")
    .select(
      "id, organization_entity_id, document_type_code, name, description, created_at, updated_at, document_template_versions(*)"
    )
    .eq("organization_entity_id", entityId)
    .order("created_at", { ascending: false })

  throwIfError(error)

  return ((data as unknown as (DocumentTemplate & {
    document_template_versions: DocumentTemplateVersion[]
  })[]) || []).map((row) => ({
    id: row.id,
    organization_entity_id: row.organization_entity_id,
    document_type_code: row.document_type_code,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    versions: [...(row.document_template_versions || [])].sort(
      (a, b) => b.version_number - a.version_number
    ),
  }))
}

/** Plantilla concreta con sus versiones (o `null` si no existe o RLS la oculta). */
export const selectDocumentTemplateById = async (
  templateId: string
): Promise<DocumentTemplate | null> => {
  const { data, error } = await supabase
    .from("document_templates")
    .select(
      "id, organization_entity_id, document_type_code, name, description, created_at, updated_at, document_template_versions(*)"
    )
    .eq("id", templateId)
    .maybeSingle()

  throwIfError(error)
  if (!data) return null

  const row = data as unknown as DocumentTemplate & {
    document_template_versions: DocumentTemplateVersion[]
  }

  return {
    id: row.id,
    organization_entity_id: row.organization_entity_id,
    document_type_code: row.document_type_code,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    versions: [...(row.document_template_versions || [])].sort(
      (a, b) => b.version_number - a.version_number
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Lectura de versiones para el MOTOR de generación documental          */
/* ------------------------------------------------------------------ */

/**
 * Columnas de una versión que necesita el motor de generación: su vigencia, su DOCUMENTO
 * CONFIGURADO (con el formato REAL) y el análisis de variables que ESA plantilla exige.
 */
const VERSION_DETAIL_SELECT =
  "id, version_number, status, effective_from, effective_to, configured_file_path, configured_file_format, analysis, document_type_code, document_templates(name)"

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const result = typeof value === "string" ? value.trim() : String(value)
  return result === "" ? null : result
}

const numValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toVersionDetail = (value: unknown): DocumentTemplateVersionDetail => {
  const row = record(value)
  return {
    id: String(row.id),
    version_number: numValue(row.version_number),
    status: (text(row.status) as DocumentTemplateVersionStatus) ?? "DRAFT",
    effective_from: text(row.effective_from),
    effective_to: text(row.effective_to),
    configured_file_path: text(row.configured_file_path),
    configured_file_format: text(row.configured_file_format),
    document_type_code: text(row.document_type_code),
    analysis: (row.analysis as DocumentTemplateAnalysis | null) ?? null,
    template_name: text(record(row.document_templates).name),
  }
}

/** Una versión concreta con su análisis y el nombre de su plantilla (o `null`). */
export const selectDocumentTemplateVersionById = async (
  versionId: string
): Promise<DocumentTemplateVersionDetail | null> => {
  const { data, error } = await supabase
    .from("document_template_versions")
    .select(VERSION_DETAIL_SELECT)
    .eq("id", versionId)
    .maybeSingle()

  throwIfError(error)
  if (!data) return null
  return toVersionDetail(data)
}

/** Varias versiones a la vez (historial de documentos generados), sin anidar consultas. */
export const selectDocumentTemplateVersionsByIds = async (
  versionIds: string[]
): Promise<DocumentTemplateVersionDetail[]> => {
  if (versionIds.length === 0) return []

  const { data, error } = await supabase
    .from("document_template_versions")
    .select(VERSION_DETAIL_SELECT)
    .in("id", versionIds)

  throwIfError(error)
  return ((data as unknown[]) || []).map(toVersionDetail)
}

/**
 * Versión VIGENTE para un tipo documental, una entidad y una fecha de referencia.
 * La decisión es del backend (RPC SECURITY DEFINER, con el permiso de la entidad): aquí sólo
 * se invoca y se tipa. Sus parámetros y sus claves de salida NO cambian.
 */
export const rpcResolveDocumentTemplateVersion = async (input: {
  entityId: string
  documentTypeCode: string
  referenceDate: string
}): Promise<ResolvedDocumentTemplateVersion> => {
  const { data, error } = await supabase.rpc("resolve_document_template_version", {
    p_entity_id: input.entityId,
    p_document_type_code: input.documentTypeCode,
    p_reference_date: input.referenceDate,
  })

  throwIfError(error)
  const row = record(data)
  return {
    status: text(row.status) ?? "NONE",
    version_id: text(row.version_id),
    version_number: numValue(row.version_number),
    template_name: text(row.template_name),
  }
}

/**
 * Claves de variables compatibles con un tipo de plantilla, según el registro central
 * (`document_variables`). Es el catálogo de variables DISPONIBLES, no una lista de
 * variables obligatorias: la plantilla sólo requiere las que contiene su DOCX configurado.
 */
export const selectCompatibleVariableKeys = async (
  templateTypeCode: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("document_variables")
    .select("key")
    .contains("document_types", [templateTypeCode])

  throwIfError(error)
  return ((data as { key: string }[]) || []).map((row) => row.key)
}

/** Alta de la plantilla y de su versión 1 (ambas las crea el backend en una operación). */
export const rpcCreateDocumentTemplate = async ({
  entityId,
  documentTypeCode,
  name,
  description,
  effectiveFrom,
}: CreateDocumentTemplateInput): Promise<{
  template_id: string
  version_id: string
  version_number: number
}> => {
  const { data, error } = await supabase.rpc("create_document_template", {
    p_entity_id: entityId,
    p_document_type_code: documentTypeCode,
    p_name: name,
    p_description: description ?? null,
    p_effective_from: effectiveFrom ?? null,
  })

  throwIfError(error)
  return data as { template_id: string; version_id: string; version_number: number }
}

/** Nueva versión (borrador) de una plantilla existente. */
export const rpcCreateDocumentTemplateVersion = async (
  templateId: string,
  effectiveFrom?: string | null
): Promise<{ version_id: string; version_number: number }> => {
  const { data, error } = await supabase.rpc("create_document_template_version", {
    p_template_id: templateId,
    p_effective_from: effectiveFrom ?? null,
  })

  throwIfError(error)
  return data as { version_id: string; version_number: number }
}

/** Registro del análisis de variables de una versión (lo clasifica el backend). */
export const rpcSaveDocumentTemplateAnalysis = async (
  versionId: string,
  analysis: unknown
): Promise<DocumentTemplateAnalysis> => {
  const { data, error } = await supabase.rpc("save_document_template_analysis", {
    p_version_id: versionId,
    p_analysis: analysis,
  })

  throwIfError(error)
  return data as DocumentTemplateAnalysis
}

/** Validación estructural de una versión (decide el backend; el frontend sólo la muestra). */
export const rpcValidateDocumentTemplateVersion = async (
  versionId: string
): Promise<TemplateValidation> => {
  const { data, error } = await supabase.rpc("validate_document_template_version", {
    p_version_id: versionId,
  })

  throwIfError(error)
  return data as TemplateValidation
}

/** Activación de una versión: cierra la anterior del mismo tipo documental. */
export const rpcActivateDocumentTemplateVersion = async (
  versionId: string
): Promise<{
  status: "ACTIVATED" | "ALREADY_ACTIVE"
  version_id: string
  effective_from: string | null
  deactivated_previous?: {
    version_id: string
    version_number: number
    effective_to: string | null
  }[]
}> => {
  const { data, error } = await supabase.rpc("activate_document_template_version", {
    p_version_id: versionId,
  })

  throwIfError(error)
  return data as {
    status: "ACTIVATED" | "ALREADY_ACTIVE"
    version_id: string
    effective_from: string | null
    deactivated_previous?: {
      version_id: string
      version_number: number
      effective_to: string | null
    }[]
  }
}

/** Desactivación de una versión: se conserva como histórico, nunca se borra. */
export const rpcDeactivateDocumentTemplateVersion = async (
  versionId: string
): Promise<{
  status: "DEACTIVATED" | "ALREADY_INACTIVE"
  version_id: string
  effective_to: string | null
}> => {
  const { data, error } = await supabase.rpc("deactivate_document_template_version", {
    p_version_id: versionId,
  })

  throwIfError(error)
  return data as {
    status: "DEACTIVATED" | "ALREADY_INACTIVE"
    version_id: string
    effective_to: string | null
  }
}
