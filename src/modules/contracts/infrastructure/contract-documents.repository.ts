import { supabase } from "@/lib/supabase"
import { todayIsoInCuba } from "@/utils/cuba-date"
import {
  documentTypeCodeForContractType,
  fetchGeneratedDocuments,
  generateSc404Document,
} from "@/modules/document-generation"
import { resolveDocumentTemplateVersion } from "@/modules/document-templates"
import type {
  ContractDocumentStatus,
  DocumentAutomationResult,
  DocumentGenerationJobKind,
  PendingContractDocumentRow,
  TemplateAvailability,
  TemplateAvailabilityStatus,
} from "../domain/entities"

/**
 * Contratos y documentos — Cola y estado de generación documental en el backend (infraestructura).
 *
 * Toda la cola y el estado documental viven en `public.document_generation_jobs` en PostgreSQL
 * (nunca en memoria del navegador). Los triggers de base de datos encolan automáticamente cada
 * contrato firmado, anexo formalizado, resolución, movimiento de nómina, período de vacaciones y
 * certificado médico, y la Edge Function `process-document-jobs` los procesa en segundo plano.
 */

export const CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT = "sitecorp:contract-document-status-changed"

export interface DocumentGenerationJobRecord {
  id: string
  organization_entity_id: string
  worker_id: string | null
  kind: DocumentGenerationJobKind
  source_id: string
  status: ContractDocumentStatus
  attempts: number
  last_error: string | null
  next_attempt_at: string
  worker_document_id: string | null
  created_at: string
  updated_at: string
}

export const DOCUMENT_JOB_KIND_LABELS: Record<DocumentGenerationJobKind, string> = {
  CONTRACT: "Contrato de trabajo",
  ADDENDUM: "Anexo contractual",
  RESOLUTION: "Resolución",
  PAYROLL_MOVEMENT: "Movimiento de nómina",
  VACATION: "Vacaciones (SC-4-04)",
  MEDICAL_CERTIFICATE: "Certificado médico (SC-4-04)",
}

const notifyDocumentStatusListeners = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONTRACT_DOCUMENT_STATUS_CHANGED_EVENT))
  }
}

export const clearContractDocumentStatusStore = (): void => {
  // Mantenido por compatibilidad de firma; el estado reside íntegramente en `public.document_generation_jobs`.
}

export const getContractDocumentStatusSnapshot = (
  _contractId: string
): PendingContractDocumentRow | null => null

/** Consulta el trabajo de generación documental en `public.document_generation_jobs`. */
export const fetchDocumentGenerationJob = async (
  kind: DocumentGenerationJobKind,
  sourceId: string
): Promise<DocumentGenerationJobRecord | null> => {
  if (!sourceId) return null
  try {
    const { data, error } = await supabase
      .from("document_generation_jobs")
      .select(
        "id, organization_entity_id, worker_id, kind, source_id, status, attempts, last_error, next_attempt_at, worker_document_id, created_at, updated_at"
      )
      .eq("kind", kind)
      .eq("source_id", sourceId)
      .maybeSingle()

    if (error || !data) return null
    return data as DocumentGenerationJobRecord
  } catch {
    return null
  }
}

/**
 * Encola o fuerza el reintento de un trabajo en `public.document_generation_jobs`.
 */
export const enqueueDocumentGenerationJob = async (
  kind: DocumentGenerationJobKind,
  sourceId: string,
  forceRetry = false
): Promise<{ jobId: string | null; status: ContractDocumentStatus }> => {
  if (!sourceId) return { jobId: null, status: "PENDIENTE" }
  try {
    const { data, error } = await supabase.rpc("enqueue_document_generation_job", {
      p_kind: kind,
      p_source_id: sourceId,
      p_force_retry: forceRetry,
    })
    if (error) {
      throw new Error(error.message)
    }
    const payload = (data as { job_id?: string; status?: ContractDocumentStatus } | null) ?? null
    notifyDocumentStatusListeners()
    return {
      jobId: payload?.job_id ?? null,
      status: payload?.status ?? "PENDIENTE",
    }
  } catch {
    return { jobId: null, status: "PENDIENTE" }
  }
}

/**
 * Invoca la Edge Function `process-document-jobs` para procesar inmediatamente la cola
 * en el backend. Nunca recurre a generación en el navegador.
 */
export const triggerDocumentGenerationJobs = async (options?: {
  kind?: DocumentGenerationJobKind
  sourceId?: string
}): Promise<{ ok: boolean; status?: ContractDocumentStatus; error?: string }> => {
  try {
    if (options?.kind && options?.sourceId) {
      await enqueueDocumentGenerationJob(options.kind, options.sourceId, true)
    }

    const invokePromise = supabase.functions?.invoke
      ? supabase.functions.invoke("process-document-jobs", {
          body: {
            limit: options?.sourceId ? 1 : 10,
            kind: options?.kind ?? null,
            source_id: options?.sourceId ?? null,
          },
        })
      : Promise.resolve({
          data: null,
          error: new Error("El servicio de generación documental del servidor no está disponible."),
        })

    const { data, error } = await invokePromise
    if (error) {
      const errMsg = error.message || "Error invocando la generación documental en el servidor."
      if (options?.kind === "CONTRACT" && options?.sourceId) {
        await setContractDocumentStatus(options.sourceId, "ERROR", errMsg)
      }
      notifyDocumentStatusListeners()
      return { ok: false, status: "ERROR", error: errMsg }
    }

    if (data && (data as { ok?: boolean }).ok && (data as { claimed?: number }).claimed) {
      const first = Array.isArray((data as { results?: unknown[] }).results)
        ? ((data as { results: { status?: ContractDocumentStatus; error?: string }[] }).results[0] ??
          null)
        : null
      const status = first?.status ?? "GENERADO"
      const ok = status === "GENERADO"
      if (options?.kind === "CONTRACT" && options?.sourceId) {
        await setContractDocumentStatus(
          options.sourceId,
          ok ? "GENERADO" : "ERROR",
          ok ? null : (first?.error ?? "No se pudo generar el documento.")
        )
      }
      notifyDocumentStatusListeners()
      return {
        ok,
        status,
        error: first?.error,
      }
    }

    if (options?.kind && options?.sourceId) {
      const job = await fetchDocumentGenerationJob(options.kind, options.sourceId)
      if (job?.status === "GENERADO") {
        if (options.kind === "CONTRACT") {
          await setContractDocumentStatus(options.sourceId, "GENERADO", null)
        }
        notifyDocumentStatusListeners()
        return { ok: true, status: "GENERADO" }
      }
      if (job?.status === "SIN_PLANTILLA" || job?.status === "ERROR") {
        const errMsg = job.last_error || "No se pudo generar el documento en el servidor."
        if (options.kind === "CONTRACT") {
          await setContractDocumentStatus(options.sourceId, "ERROR", errMsg)
        }
        notifyDocumentStatusListeners()
        return { ok: false, status: job.status, error: errMsg }
      }
      const errMsg =
        "El servidor no pudo procesar el documento inmediatamente. Quedó en cola para reintento."
      notifyDocumentStatusListeners()
      return { ok: false, status: job?.status ?? "PENDIENTE", error: errMsg }
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al procesar la cola documental."
    if (options?.kind === "CONTRACT" && options?.sourceId) {
      await setContractDocumentStatus(options.sourceId, "ERROR", message)
    }
    notifyDocumentStatusListeners()
    return { ok: false, status: "ERROR", error: message }
  }
}

export const setContractDocumentStatus = async (
  contractId: string,
  status: ContractDocumentStatus,
  error?: string | null,
  _meta?: {
    worker_id?: string | null
    worker_name?: string | null
    worker_identification?: string | null
    organization_entity_id?: string | null
    contract_type_name?: string | null
    start_date?: string | null
  }
): Promise<void> => {
  if (!contractId) return
  try {
    const mappedStatus =
      status === "GENERADO"
        ? "GENERADO"
        : status === "PENDIENTE" || status === "GENERANDO"
          ? "PENDIENTE"
          : "ERROR"
    const rpcResult = supabase.rpc?.("set_contract_document_status", {
      p_contract_id: contractId,
      p_status: mappedStatus,
      p_error: mappedStatus === "GENERADO" ? null : (error ?? null),
    })
    if (rpcResult && typeof (rpcResult as unknown as PromiseLike<unknown>).then === "function") {
      await rpcResult
    }
  } catch {
    // El estado autoritativo reside en `public.document_generation_jobs`
  } finally {
    notifyDocumentStatusListeners()
  }
}

/**
 * Consulta todos los trabajos documentales pendientes, generando, sin plantilla o con error
 * de una entidad en `public.document_generation_jobs` (cubre los 6 tipos de documento).
 */
export const fetchPendingContractDocuments = async (
  entityId?: string | null
): Promise<PendingContractDocumentRow[]> => {
  if (!entityId) return []

  try {
    const fromJobs = supabase.from?.("document_generation_jobs")
    if (!fromJobs || typeof fromJobs.select !== "function") return []

    const { data, error } = await fromJobs
      .select(
        "id, organization_entity_id, worker_id, kind, source_id, status, attempts, last_error, worker_document_id, updated_at"
      )
      .eq("organization_entity_id", entityId)
      .in("status", ["PENDIENTE", "GENERANDO", "ERROR", "SIN_PLANTILLA"])
      .order("updated_at", { ascending: false })

    if (error || !Array.isArray(data) || data.length === 0) return []

    type JobRow = {
      id: string
      organization_entity_id: string
      worker_id: string | null
      kind: DocumentGenerationJobKind
      source_id: string
      status: ContractDocumentStatus
      attempts: number
      last_error: string | null
      worker_document_id: string | null
      updated_at: string
      worker?: {
        id: string
        first_name: string
        first_surname: string
        second_surname: string | null
        identification: string | null
      } | null
    }

    const jobs = data as unknown as JobRow[]
    const missingWorkerIds = Array.from(
      new Set(
        jobs
          .filter((row) => !row.worker && !!row.worker_id)
          .map((row) => row.worker_id as string)
      )
    )

    const workerMap = new Map<
      string,
      {
        id: string
        first_name: string
        first_surname: string
        second_surname: string | null
        identification: string | null
      }
    >()

    if (missingWorkerIds.length > 0) {
      const fromWorkers = supabase.from?.("workers")
      if (fromWorkers && typeof fromWorkers.select === "function") {
        const { data: workersData } = await fromWorkers
          .select("id, first_name, first_surname, second_surname, identification")
          .in("id", missingWorkerIds)

        if (Array.isArray(workersData)) {
          for (const w of workersData as {
            id: string
            first_name: string
            first_surname: string
            second_surname: string | null
            identification: string | null
          }[]) {
            workerMap.set(w.id, w)
          }
        }
      }
    }

    return jobs.map((row) => {
      const w = row.worker ?? (row.worker_id ? workerMap.get(row.worker_id) ?? null : null)
      const fullName = w
        ? [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")
        : "Trabajador"
      return {
        job_id: row.id,
        kind: row.kind,
        source_id: row.source_id,
        contract_id: row.source_id,
        worker_id: row.worker_id ?? w?.id ?? "",
        worker_name: fullName,
        worker_identification: w?.identification ?? null,
        organization_entity_id: row.organization_entity_id,
        contract_type_name: DOCUMENT_JOB_KIND_LABELS[row.kind] ?? row.kind,
        start_date: null,
        document_status: row.status,
        document_error: row.last_error ?? null,
        document_status_updated_at: row.updated_at,
        attempts: row.attempts,
        worker_document_id: row.worker_document_id,
      }
    })
  } catch {
    return []
  }
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
  resolveTemplateAvailability(
    entityId,
    documentTypeCodeForContractType(contractTypeCode),
    referenceDate
  )

/** ¿Existe una plantilla activa aplicable para el anexo a esa fecha? */
export const resolveAddendumTemplateAvailability = (
  entityId: string,
  referenceDate: string | null
): Promise<TemplateAvailability> =>
  resolveTemplateAvailability(entityId, "EMPLOYMENT_CONTRACT_ADDENDUM", referenceDate)

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

    const outcome = await triggerDocumentGenerationJobs({
      kind: "CONTRACT",
      sourceId: contractId,
    })
    if (outcome.ok) {
      await setContractDocumentStatus(contractId, "GENERADO", null)
    } else {
      await setContractDocumentStatus(
        contractId,
        "ERROR",
        outcome.error || "No se pudo generar el documento contractual automáticamente."
      )
    }
    return {
      generated: outcome.ok,
      skipped: false,
      result: {
        success: outcome.ok,
        pdfPath: null,
        error: outcome.error ?? null,
      },
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar el documento contractual automáticamente."
    await setContractDocumentStatus(contractId, "ERROR", message)
    throw err
  }
}

export const ensureAddendumDocumentGenerated = async (
  addendumId: string
): Promise<DocumentAutomationResult> => {
  try {
    const existing = await fetchGeneratedDocuments({ addendumId })
    if (existing.length > 0) {
      await enqueueDocumentGenerationJob("ADDENDUM", addendumId, false)
      return { generated: false, skipped: true, result: null }
    }

    const outcome = await triggerDocumentGenerationJobs({
      kind: "ADDENDUM",
      sourceId: addendumId,
    })
    return {
      generated: outcome.ok,
      skipped: false,
      result: {
        success: outcome.ok,
        pdfPath: null,
        error: outcome.error ?? null,
      },
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar el documento del anexo automáticamente."
    return {
      generated: false,
      skipped: false,
      result: { success: false, pdfPath: null, error: message },
    }
  }
}

export const ensureResolutionDocumentQueued = async (
  resolutionId: string
): Promise<DocumentAutomationResult> => {
  try {
    const existing = await fetchGeneratedDocuments({ resolutionId })
    if (existing.length > 0) {
      await enqueueDocumentGenerationJob("RESOLUTION", resolutionId, false)
      return { generated: false, skipped: true, result: null }
    }
    const outcome = await triggerDocumentGenerationJobs({
      kind: "RESOLUTION",
      sourceId: resolutionId,
    })
    return {
      generated: outcome.ok,
      skipped: false,
      result: { success: outcome.ok, pdfPath: null, error: outcome.error ?? null },
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar la Resolución automáticamente."
    return {
      generated: false,
      skipped: false,
      result: { success: false, pdfPath: null, error: message },
    }
  }
}

export const ensurePayrollMovementDocumentQueued = async (
  movementId: string
): Promise<DocumentAutomationResult> => {
  try {
    const existing = await fetchGeneratedDocuments({ movementId })
    if (existing.length > 0) {
      await enqueueDocumentGenerationJob("PAYROLL_MOVEMENT", movementId, false)
      return { generated: false, skipped: true, result: null }
    }
    const outcome = await triggerDocumentGenerationJobs({
      kind: "PAYROLL_MOVEMENT",
      sourceId: movementId,
    })
    return {
      generated: outcome.ok,
      skipped: false,
      result: { success: outcome.ok, pdfPath: null, error: outcome.error ?? null },
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar el documento del movimiento de nómina."
    return {
      generated: false,
      skipped: false,
      result: { success: false, pdfPath: null, error: message },
    }
  }
}

export const ensureSc404DocumentQueued = async (params: {
  vacationId?: string | null
  medicalCertificateId?: string | null
}): Promise<DocumentAutomationResult> => {
  const kind: DocumentGenerationJobKind = params.vacationId ? "VACATION" : "MEDICAL_CERTIFICATE"
  const sourceId = (params.vacationId ?? params.medicalCertificateId) || ""
  if (!sourceId) {
    return { generated: false, skipped: true, result: null }
  }
  try {
    const existing = await fetchGeneratedDocuments(
      params.vacationId ? { vacationId: params.vacationId } : { certificateId: params.medicalCertificateId! }
    )
    if (existing.length > 0) {
      await enqueueDocumentGenerationJob(kind, sourceId, false)
      return { generated: false, skipped: true, result: null }
    }
    const outcome = await triggerDocumentGenerationJobs({ kind, sourceId })
    if (outcome.ok) {
      return {
        generated: true,
        skipped: false,
        result: { success: true, pdfPath: null, error: null },
      }
    }

    const fallback = await generateSc404Document(kind, sourceId)
    if (fallback.success) {
      await enqueueDocumentGenerationJob(kind, sourceId, false)
      notifyDocumentStatusListeners()
      return {
        generated: true,
        skipped: false,
        result: fallback,
      }
    }

    return {
      generated: false,
      skipped: false,
      result: {
        success: false,
        pdfPath: null,
        error: fallback.error ?? outcome.error ?? null,
      },
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar el modelo SC-4-04 automáticamente."
    return {
      generated: false,
      skipped: false,
      result: { success: false, pdfPath: null, error: message },
    }
  }
}
