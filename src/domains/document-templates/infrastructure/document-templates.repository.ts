import { supabase } from "@/lib/supabase"
import type {
  CreateDocumentTemplateInput,
  DocumentTemplate,
  DocumentTemplateAnalysis,
  DocumentTemplateType,
  DocumentTemplateVersion,
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
