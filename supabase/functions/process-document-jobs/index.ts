/**
 * Edge Function: `process-document-jobs`
 *
 * Motor unificado de generación documental en backend (Deno / Supabase Edge Runtime):
 *   1. Reclama trabajos en estado `PENDIENTE` o `ERROR` mediante `public.claim_due_document_generation_jobs`
 *      (incluyendo `requested_by` para preservar la autoría real del documento).
 *   2. Carga el contexto origen y obtiene exactamente los mismos snapshots documentales que
 *      el frontend (`get_contract_document_data`, `get_addendum_document_data`,
 *      `get_resolution_document_data`, `get_payroll_movement_document_data` o `SC_4_04` desde
 *      `worker_vacations` / `worker_medical_certificates` + `position_schedule_segments`).
 *   3. Usa `document_template_version_id` fijada si existe o resuelve la versión vigente mediante
 *      `resolve_document_template_version` y reconcilia el análisis con `DOCUMENT_VARIABLES`.
 *   4. Resuelve todas las variables desde `../_shared/document-resolution.rules.ts`, verifica
 *      las obligatorias con `selectMissingVariableKeys` y renderiza `.docx` / `.xlsx` con el
 *      motor OOXML compartido (`../_shared/ooxml-xml.ts`).
 *   5. Fija la versión en la fuente cuando corresponde (`CONTRACT` / `ADDENDUM`), reserva la
 *      fila en `worker_documents` vía `begin_*` con `p_actor_user_id: job.requested_by`,
 *      sube el binario al bucket privado `"documents"` y completa con `complete_document_generation`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import PizZip from "https://esm.sh/pizzip@3.1.7"
import type { DocumentData } from "../_shared/document-data.ts"
import { resolveAllDocumentVariables } from "../_shared/document-resolution.rules.ts"
import {
  BLOCKED_MESSAGES,
  buildGeneratedDocumentFileName,
  buildMissingVariables,
  buildRenderValues,
  documentTypeCodeForContractType,
  documentTypeLabelFor,
  isSc404IncorporationUndetermined,
  knownVariableKeys,
  parseSc404ExistingId,
  pinsTemplateVersionOnSource,
  reconcileTemplateAnalysisWithCatalog,
  selectMissingVariableKeys,
  type SharedTemplateAnalysis,
} from "../_shared/generation-rules.ts"
import {
  WORD_PART_PATTERN,
  XLSX_PART_PATTERN,
  renderWordPartXml,
  renderXlsxXmlPartDetailed,
} from "../_shared/ooxml-xml.ts"

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type JobKind =
  | "CONTRACT"
  | "ADDENDUM"
  | "RESOLUTION"
  | "PAYROLL_MOVEMENT"
  | "VACATION"
  | "MEDICAL_CERTIFICATE"

interface DocumentJobRow {
  id: string
  organization_entity_id: string
  worker_id: string | null
  kind: JobKind
  source_id: string
  status: string
  attempts: number
  last_error: string | null
  requested_by?: string | null
}

function todayIsoInCuba(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Havana",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now)
    const year = parts.find((p) => p.type === "year")?.value
    const month = parts.find((p) => p.type === "month")?.value
    const day = parts.find((p) => p.type === "day")?.value
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    // Fallback UTC-5
  }
  return new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const formatIsoDisplay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const fullNameOf = (row: {
  first_name?: string | null
  first_surname?: string | null
  second_surname?: string | null
} | null | undefined): string | null => {
  if (!row) return null
  const joined = [row.first_name, row.first_surname, row.second_surname]
    .filter((p) => typeof p === "string" && p.trim() !== "")
    .join(" ")
    .trim()
  return joined === "" ? null : joined
}

const firstRelation = <T>(val: T | T[] | null | undefined): T | null =>
  Array.isArray(val) ? (val[0] ?? null) : (val ?? null)

function renderPackageBytes(
  templateBytes: ArrayBuffer,
  isXlsx: boolean,
  values: Record<string, string>,
  knownKeys: Iterable<string>
): { bytes: Uint8Array; unknownKeys: string[]; leftoverKeys: string[] } {
  const zip = new PizZip(templateBytes)
  const partPattern = isXlsx ? XLSX_PART_PATTERN : WORD_PART_PATTERN
  const xmlPaths = Object.keys(zip.files).filter(
    (name) => partPattern.test(name) && !zip.files[name].dir
  )

  const unknownKeys = new Set<string>()
  const leftoverKeys = new Set<string>()

  for (const path of xmlPaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = file.asText()
    const outcome = isXlsx
      ? renderXlsxXmlPartDetailed(xml, values, { knownKeys })
      : renderWordPartXml(xml, values, { knownKeys })

    outcome.unknownKeys.forEach((k) => unknownKeys.add(k))
    outcome.leftoverKeys.forEach((k) => leftoverKeys.add(k))

    if (outcome.xml !== xml) {
      zip.file(path, outcome.xml)
    }
  }

  return {
    bytes: zip.generate({ type: "uint8array", compression: "DEFLATE" }),
    unknownKeys: [...unknownKeys],
    leftoverKeys: [...leftoverKeys],
  }
}

// deno-lint-ignore no-explicit-any
async function fetchWorkerAssignmentContext(supabase: any, workerId: string, atDate: string) {
  const { data } = await supabase
    .from("worker_position_assignments")
    .select(
      `id, start_date, end_date, is_current,
       position:organization_positions(
         id,
         job:organization_jobs(id, area:organization_areas(name))
       )`
    )
    .eq("worker_id", workerId)
    .order("start_date", { ascending: false })

  const rows = ((data as Array<Record<string, unknown>>) || []).map((a) => ({
    position: firstRelation(a.position as Record<string, unknown> | Record<string, unknown>[] | null),
    start_date: String(a.start_date ?? ""),
    end_date: a.end_date ? String(a.end_date) : null,
    is_current: Boolean(a.is_current),
  }))

  const active =
    rows.find((a) => atDate && a.start_date <= atDate && (!a.end_date || a.end_date >= atDate)) ||
    rows.find((a) => a.is_current) ||
    rows[0] ||
    null

  if (!active?.position) return null
  const job = firstRelation(
    active.position.job as Record<string, unknown> | Record<string, unknown>[] | null
  )
  const area = firstRelation(
    job?.area as Record<string, unknown> | Record<string, unknown>[] | null
  )
  return {
    position_id: (active.position.id as string | null) ?? null,
    area_name: (area?.name as string | null) ?? null,
  }
}

// deno-lint-ignore no-explicit-any
async function computeNextWorkingDay(supabase: any, positionId: string | null, endDateIso: string | null): Promise<string | null> {
  if (!positionId || !endDateIso) return null
  const { data: segments, error } = await supabase
    .from("position_schedule_segments")
    .select("day_of_week")
    .eq("position_id", positionId)

  if (error || !Array.isArray(segments) || segments.length === 0) return null

  const workingDays = new Set<number>(
    segments.map((s: { day_of_week: number }) => Number(s.day_of_week))
  )
  if (workingDays.size === 0) return null

  const cursor = new Date(`${String(endDateIso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(cursor.getTime())) return null

  for (let i = 0; i < 60; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const isoDay = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay()
    if (workingDays.has(isoDay)) {
      return cursor.toISOString().slice(0, 10)
    }
  }
  return null
}

// deno-lint-ignore no-explicit-any
async function loadSourceAndData(supabase: any, job: DocumentJobRow, todayCuba: string): Promise<{
  entityId: string
  workerId: string | null
  referenceDate: string
  documentTypeCode: string | null
  pinnedVersionId: string | null
  formalized: boolean
  documentData: DocumentData
}> {
  if (job.kind === "CONTRACT") {
    const { data: src, error: srcErr } = await supabase
      .from("employment_contracts")
      .select("id, worker_id, organization_entity_id, start_date, signature_date, document_template_version_id, employment_contract_types(code)")
      .eq("id", job.source_id)
      .maybeSingle()
    if (srcErr || !src) throw new Error(srcErr?.message || "Contrato no encontrado")

    const formalized = src.signature_date != null
    if (!formalized) throw new Error(BLOCKED_MESSAGES.NOT_FORMALIZED)

    const typeRel = firstRelation(src.employment_contract_types)
    const contractTypeCode = typeRel?.code ? String(typeRel.code) : null
    const documentTypeCode = documentTypeCodeForContractType(contractTypeCode)
    const referenceDate = src.signature_date || src.start_date || todayCuba

    const { data, error } = await supabase.rpc("get_contract_document_data", {
      p_contract_id: job.source_id,
    })
    if (error || !data) throw new Error(error?.message || "No se pudieron obtener los datos del contrato.")

    return {
      entityId: String(src.organization_entity_id || job.organization_entity_id),
      workerId: String(src.worker_id || job.worker_id || ""),
      referenceDate,
      documentTypeCode,
      pinnedVersionId: src.document_template_version_id ?? null,
      formalized,
      documentData: data as DocumentData,
    }
  }

  if (job.kind === "ADDENDUM") {
    const { data: src, error: srcErr } = await supabase
      .from("contract_addendums")
      .select("id, worker_id, organization_entity_id, effective_date, signature_date, status, document_template_version_id")
      .eq("id", job.source_id)
      .maybeSingle()
    if (srcErr || !src) throw new Error(srcErr?.message || "Anexo no encontrado")

    const formalized = src.status === "FORMALIZED"
    if (!formalized) throw new Error(BLOCKED_MESSAGES.NOT_FORMALIZED)

    const referenceDate = src.signature_date || src.effective_date || todayCuba
    const { data, error } = await supabase.rpc("get_addendum_document_data", {
      p_addendum_id: job.source_id,
    })
    if (error || !data) throw new Error(error?.message || "No se pudieron obtener los datos del anexo.")

    return {
      entityId: String(src.organization_entity_id || job.organization_entity_id),
      workerId: String(src.worker_id || job.worker_id || ""),
      referenceDate,
      documentTypeCode: "EMPLOYMENT_CONTRACT_ADDENDUM",
      pinnedVersionId: src.document_template_version_id ?? null,
      formalized,
      documentData: data as DocumentData,
    }
  }

  if (job.kind === "RESOLUTION") {
    const { data: src, error: srcErr } = await supabase
      .from("worker_resolutions")
      .select("id, worker_id, organization_entity_id, resolution_date, document_template_version_id")
      .eq("id", job.source_id)
      .maybeSingle()
    if (srcErr || !src) throw new Error(srcErr?.message || "Resolución no encontrada")

    const referenceDate = src.resolution_date || todayCuba
    const { data, error } = await supabase.rpc("get_resolution_document_data", {
      p_resolution_id: job.source_id,
    })
    if (error || !data) throw new Error(error?.message || "No se pudieron obtener los datos de la resolución.")

    return {
      entityId: String(src.organization_entity_id || job.organization_entity_id),
      workerId: String(src.worker_id || job.worker_id || ""),
      referenceDate,
      documentTypeCode: "RESOLUTION",
      pinnedVersionId: src.document_template_version_id ?? null,
      formalized: true,
      documentData: data as DocumentData,
    }
  }

  if (job.kind === "PAYROLL_MOVEMENT") {
    const { data: src, error: srcErr } = await supabase
      .from("worker_payroll_movements")
      .select("id, worker_id, organization_entity_id, effective_date, document_template_version_id")
      .eq("id", job.source_id)
      .maybeSingle()
    if (srcErr || !src) throw new Error(srcErr?.message || "Movimiento de Nómina no encontrado")

    const referenceDate = src.effective_date || todayCuba
    const { data, error } = await supabase.rpc("get_payroll_movement_document_data", {
      p_movement_id: job.source_id,
    })
    if (error || !data) {
      throw new Error(error?.message || "No se pudieron obtener los datos del movimiento de nómina.")
    }

    return {
      entityId: String(src.organization_entity_id || job.organization_entity_id),
      workerId: String(src.worker_id || job.worker_id || ""),
      referenceDate,
      documentTypeCode: "PAYROLL_MOVEMENT",
      pinnedVersionId: src.document_template_version_id ?? null,
      formalized: true,
      documentData: data as DocumentData,
    }
  }

  if (job.kind === "VACATION") {
    const { data: vacRow, error: vacErr } = await supabase
      .from("worker_vacations")
      .select(
        `id, worker_id, organization_entity_id, start_date, end_date, natural_days, charged_days, status,
         worker:workers(
           id, first_name, first_surname, second_surname, identification, organization_entity_id,
           entity:organization_entities(id, name, code)
         )`
      )
      .eq("id", job.source_id)
      .maybeSingle()

    if (vacErr || !vacRow) throw new Error(vacErr?.message || "Período de vacaciones no encontrado")
    if (vacRow.status === "CANCELLED") {
      throw new Error("No se puede generar el documento de un período cancelado")
    }

    const worker = firstRelation(vacRow.worker)
    const entity = firstRelation(worker?.entity)
    const assignment = await fetchWorkerAssignmentContext(
      supabase,
      String(vacRow.worker_id),
      String(vacRow.start_date ?? "")
    )
    const incorporationDate = await computeNextWorkingDay(
      supabase,
      assignment?.position_id ?? null,
      vacRow.end_date ?? null
    )

    const documentData: DocumentData = {
      document_type: "SC_4_04",
      origin: {
        source_type: "VACATION",
        source_id: String(vacRow.id),
        start_date: vacRow.start_date ?? null,
        end_date: vacRow.end_date ?? null,
        natural_days: vacRow.natural_days ?? null,
        charged_days: vacRow.charged_days ?? null,
        days: null,
        return_date: null,
        incorporation_date: incorporationDate,
      },
      entity: {
        name: entity?.name ?? null,
        code: entity?.code ?? null,
      },
      worker: {
        full_name: fullNameOf(worker),
        identification: worker?.identification ?? null,
        first_name: worker?.first_name ?? null,
        first_surname: worker?.first_surname ?? null,
        second_surname: worker?.second_surname ?? null,
      },
      area_name: assignment?.area_name ?? null,
      issued_at: todayCuba,
    }

    return {
      entityId: String(vacRow.organization_entity_id || worker?.organization_entity_id || job.organization_entity_id),
      workerId: String(vacRow.worker_id),
      referenceDate: vacRow.start_date || todayCuba,
      documentTypeCode: "SC_4_04",
      pinnedVersionId: null,
      formalized: true,
      documentData,
    }
  }

  // MEDICAL_CERTIFICATE: usar exclusivamente columnas existentes en public.worker_medical_certificates
  const { data: certRow, error: certErr } = await supabase
    .from("worker_medical_certificates")
    .select(
      `id, worker_id, organization_entity_id, start_date, return_date, days, document_id,
       worker:workers(
         id, first_name, first_surname, second_surname, identification, organization_entity_id,
         entity:organization_entities(id, name, code)
       )`
    )
    .eq("id", job.source_id)
    .maybeSingle()

  if (certErr || !certRow) {
    throw new Error(certErr?.message || "Certificado médico no encontrado.")
  }

  const worker = firstRelation(certRow.worker)
  const entity = firstRelation(worker?.entity)
  const assignment = await fetchWorkerAssignmentContext(
    supabase,
    String(certRow.worker_id),
    String(certRow.start_date ?? "")
  )

  const documentData: DocumentData = {
    document_type: "SC_4_04",
    origin: {
      source_type: "MEDICAL_CERTIFICATE",
      source_id: String(certRow.id),
      start_date: certRow.start_date ?? null,
      end_date: null,
      natural_days: null,
      charged_days: null,
      days: certRow.days ?? null,
      return_date: certRow.return_date ?? null,
      incorporation_date: certRow.return_date ?? null,
    },
    entity: {
      name: entity?.name ?? null,
      code: entity?.code ?? null,
    },
    worker: {
      full_name: fullNameOf(worker),
      identification: worker?.identification ?? null,
      first_name: worker?.first_name ?? null,
      first_surname: worker?.first_surname ?? null,
      second_surname: worker?.second_surname ?? null,
    },
    area_name: assignment?.area_name ?? null,
    issued_at: todayCuba,
  }

  return {
    entityId: String(certRow.organization_entity_id || worker?.organization_entity_id || job.organization_entity_id),
    workerId: String(certRow.worker_id),
    referenceDate: certRow.start_date || todayCuba,
    documentTypeCode: "SC_4_04",
    pinnedVersionId: null,
    formalized: true,
    documentData,
  }
}

// deno-lint-ignore no-explicit-any
async function resolveTemplateVersion(supabase: any, input: {
  entityId: string
  documentTypeCode: string | null
  referenceDate: string
  pinnedVersionId: string | null
}) {
  let status: "PINNED" | "RESOLVED" | "NONE" | "AMBIGUOUS" = "NONE"
  let versionId = input.pinnedVersionId

  if (versionId) {
    status = "PINNED"
  } else if (input.documentTypeCode) {
    const { data: resolvedData, error: resolveError } = await supabase.rpc(
      "resolve_document_template_version",
      {
        p_entity_id: input.entityId,
        p_document_type_code: input.documentTypeCode,
        p_reference_date: input.referenceDate,
      }
    )
    if (resolveError) throw new Error(resolveError.message)
    const resolved = Array.isArray(resolvedData) ? resolvedData[0] : resolvedData
    if (resolved?.status === "AMBIGUOUS") {
      return { status: "AMBIGUOUS" as const, version: null, analysis: null }
    }
    if (resolved?.status === "RESOLVED" && resolved.version_id) {
      status = "RESOLVED"
      versionId = String(resolved.version_id)
    }
  }

  if (!versionId) {
    return { status: "NONE" as const, version: null, analysis: null }
  }

  const { data: version, error: versionErr } = await supabase
    .from("document_template_versions")
    .select(
      "id, version_number, status, effective_from, effective_to, configured_file_path, configured_file_format, analysis, document_type_code"
    )
    .eq("id", versionId)
    .maybeSingle()

  if (versionErr) throw new Error(versionErr.message)
  if (!version) {
    return { status: "NONE" as const, version: null, analysis: null }
  }

  const reconciledAnalysis = version.analysis
    ? reconcileTemplateAnalysisWithCatalog(
        version.analysis as SharedTemplateAnalysis,
        version.document_type_code ?? input.documentTypeCode
      )
    : null

  return { status, version, analysis: reconciledAnalysis }
}

// deno-lint-ignore no-explicit-any
async function processSingleJob(supabase: any, job: DocumentJobRow): Promise<{ ok: boolean; status: string; error?: string }> {
  try {
    const todayCuba = todayIsoInCuba()
    const source = await loadSourceAndData(supabase, job, todayCuba)

    const templateResult = await resolveTemplateVersion(supabase, {
      entityId: source.entityId,
      documentTypeCode: source.documentTypeCode,
      referenceDate: source.referenceDate,
      pinnedVersionId: source.pinnedVersionId,
    })

    if (templateResult.status === "NONE" || !templateResult.version) {
      const label = documentTypeLabelFor(source.documentTypeCode)
      const missingMsg = `No hay plantilla activa de ${label} vigente al ${formatIsoDisplay(source.referenceDate)}`
      await supabase.rpc("mark_document_generation_job_result", {
        p_job_id: job.id,
        p_status: "SIN_PLANTILLA",
        p_worker_document_id: null,
        p_error: missingMsg,
      })
      return { ok: false, status: "SIN_PLANTILLA", error: missingMsg }
    }

    if (templateResult.status === "AMBIGUOUS") {
      throw new Error(BLOCKED_MESSAGES.TEMPLATE_AMBIGUOUS)
    }

    const version = templateResult.version
    const configuredFormat = String(version.configured_file_format || "").toUpperCase()
    const isXlsx = configuredFormat === "XLSX"
    const isDocx = configuredFormat === "DOCX"

    if (!version.configured_file_path || (!isDocx && !isXlsx)) {
      throw new Error(BLOCKED_MESSAGES.TEMPLATE_UNUSABLE)
    }
    if (!templateResult.analysis) {
      throw new Error(BLOCKED_MESSAGES.NO_ANALYSIS)
    }

    const requiredVariables = templateResult.analysis.required_variables || []
    const resolved = resolveAllDocumentVariables(source.documentData)
    const incorporationUndetermined = isSc404IncorporationUndetermined(job.kind, source.documentData)
    const missingKeys = selectMissingVariableKeys(
      job.kind,
      requiredVariables,
      resolved.values,
      incorporationUndetermined
    )
    if (missingKeys.length > 0) {
      const missingDetails = buildMissingVariables(missingKeys, incorporationUndetermined)
      throw new Error(
        `${BLOCKED_MESSAGES.MISSING_DATA} (${missingDetails.map((m) => m.label).join(", ")})`
      )
    }

    const { data: templateBlob, error: downloadError } = await supabase.storage
      .from("document-templates")
      .download(version.configured_file_path)

    if (downloadError || !templateBlob) {
      throw new Error(downloadError?.message || "No se pudo descargar el archivo de la plantilla.")
    }

    const templateBytes = await templateBlob.arrayBuffer()
    const renderValues = buildRenderValues(job.kind, resolved.values)
    const rendered = renderPackageBytes(templateBytes, isXlsx, renderValues, knownVariableKeys())

    if (rendered.unknownKeys.length > 0) {
      throw new Error(
        `La plantilla usa variables desconocidas para el sistema: ${rendered.unknownKeys.join(", ")}. Corrija la plantilla antes de generar el documento.`
      )
    }
    if (rendered.leftoverKeys.length > 0) {
      throw new Error(
        `No se pudieron sustituir todas las variables del documento: ${rendered.leftoverKeys.join(", ")}.`
      )
    }

    if (pinsTemplateVersionOnSource(job.kind) && templateResult.status === "RESOLVED") {
      const pinRpc =
        job.kind === "CONTRACT"
          ? "set_contract_document_template_version"
          : "set_addendum_document_template_version"
      const pinParams =
        job.kind === "CONTRACT"
          ? { p_contract_id: job.source_id, p_version_id: version.id }
          : { p_addendum_id: job.source_id, p_version_id: version.id }
      const { error: pinError } = await supabase.rpc(pinRpc, pinParams)
      if (pinError) throw new Error(pinError.message)
    }

    const actorUserId = job.requested_by ?? null
    const beginCall =
      job.kind === "VACATION" || job.kind === "MEDICAL_CERTIFICATE"
        ? await supabase.rpc("begin_sc404_generation", {
            p_source_type: job.kind,
            p_source_id: job.source_id,
            p_template_version_id: version.id,
            p_actor_user_id: actorUserId,
          })
        : job.kind === "RESOLUTION"
          ? await supabase.rpc("begin_resolution_generation", {
              p_resolution_id: job.source_id,
              p_template_version_id: version.id,
              p_actor_user_id: actorUserId,
            })
          : job.kind === "PAYROLL_MOVEMENT"
            ? await supabase.rpc("begin_payroll_movement_generation", {
                p_movement_id: job.source_id,
                p_template_version_id: version.id,
                p_actor_user_id: actorUserId,
              })
            : await supabase.rpc("begin_document_generation", {
                p_employment_contract_id: job.kind === "CONTRACT" ? job.source_id : null,
                p_contract_addendum_id: job.kind === "ADDENDUM" ? job.source_id : null,
                p_template_version_id: version.id,
                p_actor_user_id: actorUserId,
              })

    if (beginCall.error) {
      const existingId = parseSc404ExistingId(beginCall.error.message)
      if (existingId) {
        await supabase.rpc("mark_document_generation_job_result", {
          p_job_id: job.id,
          p_status: "GENERADO",
          p_worker_document_id: existingId,
          p_error: null,
        })
        return { ok: true, status: "GENERADO" }
      }
      throw new Error(beginCall.error.message || "No se pudo reservar la generación del documento.")
    }

    const reservation = beginCall.data as {
      worker_document_id?: string
      storage_path?: string
    } | null
    if (!reservation?.worker_document_id || !reservation?.storage_path) {
      throw new Error("El servidor no devolvió una ruta de almacenamiento válida para el documento.")
    }

    const outputMimeType = isXlsx ? XLSX_MIME : DOCX_MIME
    const outputExtension = isXlsx ? "xlsx" : "docx"
    const fileName = buildGeneratedDocumentFileName(
      job.kind,
      source.documentTypeCode,
      source.documentData.worker.full_name,
      source.referenceDate,
      outputExtension
    )

    let uploaded = false
    try {
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(reservation.storage_path, rendered.bytes, {
          contentType: outputMimeType,
          upsert: false,
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }
      uploaded = true

      const { error: completeError } = await supabase.rpc("complete_document_generation", {
        p_worker_document_id: reservation.worker_document_id,
        p_file_name: fileName,
        p_file_size: rendered.bytes.byteLength,
        p_mime_type: outputMimeType,
        p_actor_user_id: actorUserId,
      })

      if (completeError) {
        throw new Error(completeError.message)
      }
    } catch (uploadOrCompleteErr) {
      const errMsg =
        uploadOrCompleteErr instanceof Error
          ? uploadOrCompleteErr.message
          : "Error al registrar el documento generado."
      if (uploaded) {
        await supabase.storage.from("documents").remove([reservation.storage_path])
      }
      await supabase.rpc("fail_document_generation", {
        p_worker_document_id: reservation.worker_document_id,
        p_reason: errMsg,
      })
      throw uploadOrCompleteErr
    }

    await supabase.rpc("mark_document_generation_job_result", {
      p_job_id: job.id,
      p_status: "GENERADO",
      p_worker_document_id: reservation.worker_document_id,
      p_error: null,
    })

    return { ok: true, status: "GENERADO" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado al generar el documento."
    const isMissingTemplate = /no hay plantilla activa/i.test(message)
    const targetStatus = isMissingTemplate ? "SIN_PLANTILLA" : "ERROR"
    await supabase.rpc("mark_document_generation_job_result", {
      p_job_id: job.id,
      p_status: targetStatus,
      p_worker_document_id: null,
      p_error: message,
    })
    return { ok: false, status: targetStatus, error: message }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let limit = 10
  let sourceId: string | null = null
  let kind: string | null = null

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}))
      if (typeof body?.limit === "number") limit = Math.min(Math.max(body.limit, 1), 50)
      if (typeof body?.source_id === "string") sourceId = body.source_id
      if (typeof body?.kind === "string") kind = body.kind
    }
  } catch {
    // Cuerpo vacío o no JSON: se procesan los trabajos pendientes por defecto
  }

  const { data: claimedJobs, error: claimError } = await supabase.rpc(
    "claim_due_document_generation_jobs",
    {
      p_limit: limit,
      p_source_id: sourceId,
      p_kind: kind,
    }
  )

  if (claimError) {
    return new Response(
      JSON.stringify({ ok: false, error: claimError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const jobs = (claimedJobs as DocumentJobRow[]) || []
  const results = []
  for (const job of jobs) {
    const res = await processSingleJob(supabase, job)
    results.push({ id: job.id, kind: job.kind, source_id: job.source_id, ...res })
  }

  return new Response(
    JSON.stringify({
      ok: true,
      claimed: jobs.length,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})
