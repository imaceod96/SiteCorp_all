import { resolveAllDocumentVariables } from "../domain/document-resolution.rules"
import {
  fetchDocumentTemplateVersionsByIds,
} from "@/domains/document-templates"
import type { DocumentData, Sc404SourceType } from "../domain/document-data"
import {
  buildMissingVariables,
  documentTypeLabelFor,
  isPayrollMovementKind,
  isResolutionKind,
  isSc404IncorporationUndetermined,
  isSc404Kind,
  resolveBlockedReason,
  selectMissingVariableKeys,
} from "../domain/rules"
import type {
  DocumentGenerationPrecheck,
  GeneratedDocumentRow,
  GenerationDocumentKind,
  SourceContext,
  TemplateResolution,
  TemplateResolutionStatus,
} from "../domain/entities"
import { loadSourceContext } from "../infrastructure/document-source.repository"
import {
  getAddendumDocumentData,
  getContractDocumentData,
  getPayrollMovementDocumentData,
  getResolutionDocumentData,
  getSc404DocumentData,
} from "../infrastructure/document-data.repository"
import {
  loadTemplateVersionForGeneration,
  resolveTemplateVersionByDate,
} from "../infrastructure/document-template-version.repository"
import { selectGeneratedDocuments } from "../infrastructure/document-generation.repository"

/**
 * Generación documental — Casos de uso de LECTURA (aplicación).
 *
 *  - ¿Puede generarse el documento de este origen y con qué plantilla? (precheck §64)
 *  - ¿Qué documentos se han generado ya? (historial y trazabilidad)
 *
 * Ninguna consulta se compone aquí: el origen, los datos, la plantilla y el historial se piden
 * a la infraestructura del dominio, y el catálogo de plantillas a su propio dominio. Las
 * decisiones (qué falta, qué bloquea, qué etiqueta y qué mensaje se muestran) son reglas puras.
 */

const missingTemplate = (
  referenceDate: string,
  documentTypeCode: string
): TemplateResolution => ({
  status: "NONE",
  versionId: null,
  versionNumber: null,
  versionStatus: null,
  versionUsable: false,
  templateName: null,
  effectiveFrom: null,
  effectiveTo: null,
  configuredFilePath: null,
  configuredFileFormat: null,
  referenceDate,
  documentTypeCode,
})

/**
 * Resolución de la versión de plantilla con la que se generaría el documento.
 *
 * Orden EXACTO de la etapa anterior:
 *  1. Si la fuente ya tiene una versión FIJADA, se usa esa SIEMPRE (aunque exista una más nueva).
 *  2. Si el origen no tiene tipo documental, no hay plantilla aplicable.
 *  3. En otro caso decide el backend por vigencia: una versión, ninguna o varias (ambiguo).
 */
export const resolveTemplateVersionForDocument = async (
  context: SourceContext
): Promise<{ template: TemplateResolution; requiredVariables: string[]; analysisPresent: boolean }> => {
  if (context.pinnedVersionId) {
    const pinned = await loadTemplateVersionForGeneration(context.pinnedVersionId)
    return {
      template: { ...pinned.template, referenceDate: context.referenceDate, status: "PINNED" },
      requiredVariables: pinned.requiredVariables,
      analysisPresent: pinned.analysisPresent,
    }
  }

  if (!context.documentTypeCode) {
    return {
      template: missingTemplate(context.referenceDate, ""),
      requiredVariables: [],
      analysisPresent: false,
    }
  }

  const resolved = await resolveTemplateVersionByDate({
    entityId: context.entityId,
    documentTypeCode: context.documentTypeCode,
    referenceDate: context.referenceDate,
  })
  const status = resolved.status as TemplateResolutionStatus

  if (status === "RESOLVED" && resolved.version_id) {
    const loaded = await loadTemplateVersionForGeneration(String(resolved.version_id))
    return {
      template: {
        ...loaded.template,
        status: "RESOLVED",
        referenceDate: context.referenceDate,
        templateName: loaded.template.templateName ?? resolved.template_name,
      },
      requiredVariables: loaded.requiredVariables,
      analysisPresent: loaded.analysisPresent,
    }
  }

  return {
    template: {
      ...missingTemplate(context.referenceDate, context.documentTypeCode),
      status: status === "AMBIGUOUS" ? "AMBIGUOUS" : "NONE",
    },
    requiredVariables: [],
    analysisPresent: false,
  }
}

/**
 * Diagnóstico previo a generar el documento de cualquier origen.
 *
 * Nunca se inventan datos: se resuelven los valores reales del origen y se contrastan con las
 * variables que ESA plantilla exige. El resultado incluye los valores ya resueltos para que la
 * generación no vuelva a resolverlos.
 */
export const precheckDocumentGeneration = async (
  kind: GenerationDocumentKind,
  sourceId: string
): Promise<DocumentGenerationPrecheck> => {
  const context = await loadSourceContext(kind, sourceId)
  const { template, requiredVariables, analysisPresent } = await resolveTemplateVersionForDocument(context)

  const documentData: DocumentData = isSc404Kind(kind)
    ? await getSc404DocumentData(kind, sourceId)
    : isResolutionKind(kind)
      ? await getResolutionDocumentData(sourceId)
      : isPayrollMovementKind(kind)
        ? await getPayrollMovementDocumentData(sourceId)
        : kind === "CONTRACT"
          ? await getContractDocumentData(sourceId)
          : await getAddendumDocumentData(sourceId)

  const resolved = resolveAllDocumentVariables(documentData)
  const incorporationUndetermined = isSc404IncorporationUndetermined(kind, documentData)
  const missingVariables = buildMissingVariables(
    selectMissingVariableKeys(kind, requiredVariables, resolved.values, incorporationUndetermined),
    incorporationUndetermined
  )

  const blockedReason = resolveBlockedReason({
    formalized: context.formalized,
    template,
    analysisPresent,
    missingCount: missingVariables.length,
  })

  return {
    kind,
    sourceId,
    workerId: context.workerId,
    entityId: context.entityId,
    formalized: context.formalized,
    documentTypeLabel: documentTypeLabelFor(template.documentTypeCode),
    template,
    requiredVariables,
    missingVariables,
    ready: blockedReason === null,
    blockedReason,
    resolvedValues: resolved.values,
    documentData,
  }
}

export const precheckContractDocument = (contractId: string) =>
  precheckDocumentGeneration("CONTRACT", contractId)

export const precheckAddendumDocument = (addendumId: string) =>
  precheckDocumentGeneration("ADDENDUM", addendumId)

export const precheckSc404Document = (sourceType: Sc404SourceType, sourceId: string) =>
  precheckDocumentGeneration(sourceType, sourceId)

export const precheckResolutionDocument = (resolutionId: string) =>
  precheckDocumentGeneration("RESOLUTION", resolutionId)

export const precheckPayrollMovementDocument = (movementId: string) =>
  precheckDocumentGeneration("PAYROLL_MOVEMENT", movementId)

/**
 * Historial de documentos generados de un origen, con la plantilla y la versión con las que se
 * generó cada uno. La trazabilidad viene del propio documento (`worker_documents`), no del
 * estado vivo de la plantilla: una versión posterior no reescribe el pasado.
 */
export const fetchGeneratedDocuments = async (source: {
  contractId?: string
  addendumId?: string
  vacationId?: string
  certificateId?: string
  resolutionId?: string
  movementId?: string
}): Promise<GeneratedDocumentRow[]> => {
  const records = await selectGeneratedDocuments(source)

  const versionIds = Array.from(
    new Set(
      records
        .map((record) => record.document_template_version_id)
        .filter((id): id is string => !!id)
    )
  )
  const versions = await fetchDocumentTemplateVersionsByIds(versionIds)
  const byVersionId = new Map(versions.map((version) => [version.id, version]))

  return records.map((record) => {
    const versionId = record.document_template_version_id
    const version = versionId ? byVersionId.get(versionId) : undefined
    return {
      ...record,
      version_number: versionId ? version?.version_number ?? null : null,
      template_name: versionId ? version?.template_name ?? null : null,
    }
  })
}
