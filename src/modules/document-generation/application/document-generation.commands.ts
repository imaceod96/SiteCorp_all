import { DOCX_MIME, XLSX_MIME, fetchTemplateFileContent } from "@/modules/document-templates"
import type { Sc404SourceType } from "../domain/document-data"
import {
  blockedMessageFor,
  buildGeneratedDocumentName,
  buildRenderValues,
  knownVariableKeys,
  pinsTemplateVersionOnSource,
} from "../domain/rules"
import type {
  DocumentGenerationPrecheck,
  DocumentGenerationResult,
  GeneratedDocumentRow,
  GenerationDocumentKind,
  GenerationReservation,
} from "../domain/entities"
import { renderDocx } from "../infrastructure/renderers/docx-render"
import { renderXlsxTemplate } from "../infrastructure/renderers/xlsx-render"
import {
  beginGeneration,
  completeGeneration,
  failGeneration,
  pinTemplateVersionOnSource,
} from "../infrastructure/document-generation.repository"
import {
  createGeneratedObjectSignedUrl,
  downloadGeneratedObject,
  removeGeneratedObjects,
  uploadGeneratedObject,
} from "../infrastructure/document-storage.repository"
import { precheckDocumentGeneration } from "./document-generation.queries"

/**
 * Generación documental — Casos de uso de ESCRITURA (aplicación).
 *
 *   PLANTILLA VIGENTE → COPIA + SUSTITUCIÓN → STORAGE → REGISTRO EN EL EXPEDIENTE
 *
 * Reglas del caso de uso (las mismas de la etapa anterior):
 *  - Se genera SIEMPRE sobre una COPIA del documento configurado: el archivo de la plantilla
 *    nunca se modifica.
 *  - Antes de reservar la generación se comprueba todo lo comprobable; una plantilla que exige
 *    variables sin valor no produce documentos a medias.
 *  - Si Storage recibe el archivo pero el registro falla, el huérfano se retira y la reserva se
 *    libera (§55).
 *  - La idempotencia y la numeración de generaciones las decide el backend: aquí no se
 *    duplica ningún documento ya emitido.
 *  - No hay conversor DOCX→PDF disponible: nunca se produce un PDF falso.
 */

const failed = (error: string, extra?: Partial<DocumentGenerationResult>): DocumentGenerationResult => ({
  success: false,
  error,
  pdfPath: null,
  ...extra,
})

const runGeneration = async (
  kind: GenerationDocumentKind,
  sourceId: string
): Promise<DocumentGenerationResult> => {
  let precheck: DocumentGenerationPrecheck
  try {
    precheck = await precheckDocumentGeneration(kind, sourceId)
  } catch (err) {
    return failed(err instanceof Error ? err.message : "No se pudo preparar la generación del documento")
  }

  if (!precheck.ready) {
    if (precheck.blockedReason === "MISSING_DATA") {
      return failed("Faltan datos requeridos por esta plantilla", {
        missingVariables: precheck.missingVariables.map(({ key, label }) => ({ key, label })),
      })
    }
    return failed(blockedMessageFor(precheck.blockedReason))
  }

  const versionId = precheck.template.versionId as string
  const configuredPath = precheck.template.configuredFilePath as string

  // 1) Cargar el DOCUMENTO CONFIGURADO de la plantilla (nunca el original sin configurar).
  let sourceBytes: Uint8Array
  try {
    sourceBytes = await fetchTemplateFileContent(configuredPath)
  } catch (err) {
    return failed(
      err instanceof Error ? err.message : "No se pudo cargar el documento configurado de la plantilla"
    )
  }

  // 2) Sustituir sobre una COPIA (el paquete de origen no se modifica).
  const knownKeys = knownVariableKeys()
  const renderValues = buildRenderValues(kind, precheck.resolvedValues)
  // Selección del renderizador SEGÚN EL FORMATO REAL de la plantilla:
  //    Word (.docx) → motor OOXML existente; Excel (.xlsx) → motor Excel.
  //    Movimiento de Nómina usa plantilla Excel y NUNCA pasa por el motor Word.
  const configuredFormat = (precheck.template.configuredFileFormat ?? "").toUpperCase()
  const isXlsxTemplate = configuredFormat === "XLSX"
  const outputMimeType = isXlsxTemplate ? XLSX_MIME : DOCX_MIME
  const outputExtension = isXlsxTemplate ? "xlsx" : "docx"

  let rendered: {
    bytes: Uint8Array
    unknownKeys: string[]
    leftoverKeys: string[]
  }
  try {
    rendered = isXlsxTemplate
      ? await renderXlsxTemplate(sourceBytes, renderValues, knownKeys)
      : await renderDocx(sourceBytes, renderValues, knownKeys)
  } catch (err) {
    return failed(err instanceof Error ? err.message : "No se pudo procesar el documento de la plantilla")
  }

  if (rendered.unknownKeys.length > 0) {
    return failed(
      `La plantilla usa variables desconocidas para el sistema: ${rendered.unknownKeys.join(", ")}. Corrija la plantilla antes de generar el documento.`
    )
  }
  if (rendered.leftoverKeys.length > 0) {
    return failed(
      `No se pudieron sustituir todas las variables del documento: ${rendered.leftoverKeys.join(", ")}.`
    )
  }

  // 3) Fijar la versión de plantilla en la fuente antes de reservar la generación (§9).
  //    SC-4-04, Resolución y Movimiento de Nómina no fijan versión en su origen: su
  //    trazabilidad vive en worker_documents.document_template_version_id.
  if (pinsTemplateVersionOnSource(kind) && precheck.template.status === "RESOLVED") {
    try {
      await pinTemplateVersionOnSource(kind, sourceId, versionId)
    } catch (err) {
      return failed(err instanceof Error ? err.message : "No se pudo fijar la versión de plantilla")
    }
  }

  // 4) Reservar la generación (idempotencia: una sola en curso por fuente).
  let reservation: GenerationReservation
  try {
    reservation = await beginGeneration(kind, sourceId, versionId)
  } catch (err) {
    return failed(err instanceof Error ? err.message : "No se pudo reservar la generación del documento")
  }

  // 5) Subir el documento final (Word o Excel, según la plantilla) al expediente.
  const outputBlob = new Blob([rendered.bytes], { type: outputMimeType })
  try {
    await uploadGeneratedObject(reservation.storage_path, outputBlob, outputMimeType)
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    await failGeneration(reservation.worker_document_id, message)
    return failed(`No se pudo guardar el documento generado: ${message}`)
  }

  // 6) Registrar el documento con su nombre humano, tamaño y tipo MIME reales.
  const fileName = buildGeneratedDocumentName(
    precheck,
    precheck.template.referenceDate,
    outputExtension
  )
  try {
    await completeGeneration({
      workerDocumentId: reservation.worker_document_id,
      fileName,
      fileSize: rendered.bytes.byteLength,
      mimeType: outputMimeType,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    // Storage recibió el archivo pero la base de datos falló: se retira el huérfano (§55).
    await removeGeneratedObjects([reservation.storage_path])
    await failGeneration(reservation.worker_document_id, message)
    return failed(`No se pudo registrar el documento generado: ${message}`)
  }

  return {
    success: true,
    generationId: reservation.worker_document_id,
    workerDocumentId: reservation.worker_document_id,
    templateVersionId: versionId,
    generationNumber: reservation.generation_number,
    docxPath: reservation.storage_path,
    // PDF: sólo se genera si existe un conversor fiable en el entorno.
    pdfPath: null,
  }
}

export const generateContractDocument = (contractId: string) => runGeneration("CONTRACT", contractId)

export const generateAddendumDocument = (addendumId: string) => runGeneration("ADDENDUM", addendumId)

export const generateSc404Document = (sourceType: Sc404SourceType, sourceId: string) =>
  runGeneration(sourceType, sourceId)

/** Genera el documento de una Resolución (Cargo Especialista Principal). */
export const generateResolutionDocument = (resolutionId: string) =>
  runGeneration("RESOLUTION", resolutionId)

/** Genera el documento de un Movimiento de Nómina (Alta / Reubicación / Baja). */
export const generatePayrollMovementDocument = (movementId: string) =>
  runGeneration("PAYROLL_MOVEMENT", movementId)

/* ------------------------------------------------------------------ */
/* Descarga de documentos generados                                    */
/* ------------------------------------------------------------------ */

/** Enlace temporal de descarga (10 min) de un documento del expediente. */
export const createGeneratedDocumentUrl = async (storagePath: string): Promise<string | null> =>
  createGeneratedObjectSignedUrl(storagePath)

/**
 * Descarga un documento generado, conservando SU nombre humano (el mismo con el que se generó).
 * El archivo vive en un bucket privado: la descarga es siempre temporal y autorizada.
 */
export const downloadGeneratedDocument = async (document: GeneratedDocumentRow): Promise<void> => {
  const data = await downloadGeneratedObject(document.storage_path)

  const url = URL.createObjectURL(data)
  const link = window.document.createElement("a")
  link.href = url
  link.download = document.file_name
  window.document.body.appendChild(link)
  link.click()
  window.document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
