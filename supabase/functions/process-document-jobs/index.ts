/**
 * Edge Function: `process-document-jobs`
 *
 * Procesa la cola `public.document_generation_jobs` en el backend (Deno / Supabase Edge Runtime):
 *   1. Reclama trabajos en estado `PENDIENTE` o `ERROR` (con `attempts < 5` y `next_attempt_at <= now()`)
 *      mediante `public.claim_due_document_generation_jobs`, marcándolos como `GENERANDO`.
 *   2. Obtiene los datos estructurados del origen (`CONTRACT`, `ADDENDUM`, `RESOLUTION`,
 *      `PAYROLL_MOVEMENT`, `VACATION`, `MEDICAL_CERTIFICATE`).
 *   3. Resuelve la versión activa de la plantilla con `resolve_document_template_version`.
 *      Si no existe plantilla activa para la fecha de referencia, marca el trabajo como
 *      `SIN_PLANTILLA` con el mensaje `"No hay plantilla activa de <tipo> vigente al <fecha>"`.
 *   4. Descarga el binario `.docx` / `.xlsx` desde el bucket `"document-templates"`,
 *      sustituye las variables `{{clave}}` (respetando saltos de párrafo y partidas fragmentadas
 *      de Word/Excel), reserva la fila en `worker_documents`, sube el archivo al bucket
 *      `"documents"` y completa la generación con `complete_document_generation`.
 *   5. Actualiza `public.document_generation_jobs` a `GENERADO` (con `worker_document_id`) o,
 *      ante cualquier fallo, a `ERROR` con `last_error`, incrementando `attempts` y aplicando
 *      backoff exponencial (1, 5 y 15 minutos; máximo 5 intentos).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import PizZip from "https://esm.sh/pizzip@3.1.7"
import {
  WORD_PART_PATTERN,
  XLSX_PART_PATTERN,
  renderWordPartXml,
  renderXlsxXmlPart,
} from "../../../src/modules/document-generation/domain/ooxml-xml.ts"

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
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  INDEFINITE_CONTRACT: "Contrato por tiempo indeterminado",
  DETERMINED_CONTRACT: "Contrato por tiempo determinado",
  CONTRACT_VARIATION_ADDENDUM: "Anexo de variación contractual",
  APPOINTMENT_RESOLUTION: "Resolución de nombramiento",
  MOVEMENT_RESOLUTION: "Resolución de movimiento",
  PAYROLL_MOVEMENT: "Movimiento de nómina",
  SC_4_04: "Modelo SC-4-04 (Vacaciones / Certificado médico)",
}

const formatIsoDate = (iso: string | null | undefined): string => {
  if (!iso) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

const formatMoney = (amount: number | string | null | undefined, currency?: string | null): string => {
  if (amount === null || amount === undefined || amount === "") return ""
  const n = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(n)) return ""
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

function renderDocxBytes(templateBytes: ArrayBuffer, variables: Record<string, string>): Uint8Array {
  const zip = new PizZip(templateBytes)
  const xmlPaths = Object.keys(zip.files).filter(
    (name) => WORD_PART_PATTERN.test(name) && !zip.files[name].dir
  )

  for (const path of xmlPaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = file.asText()
    const rendered = renderWordPartXml(xml, variables, {
      normalizeKeys: true,
      fallbackEmpty: true,
    })
    if (rendered.xml !== xml) {
      zip.file(path, rendered.xml)
    }
  }

  return zip.generate({ type: "uint8array", compression: "DEFLATE" })
}

function renderXlsxBytes(templateBytes: ArrayBuffer, variables: Record<string, string>): Uint8Array {
  const zip = new PizZip(templateBytes)
  const xmlPaths = Object.keys(zip.files).filter(
    (name) => XLSX_PART_PATTERN.test(name) && !zip.files[name].dir
  )

  for (const path of xmlPaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = file.asText()
    const replaced = renderXlsxXmlPart(xml, variables)
    if (replaced !== xml) {
      zip.file(path, replaced)
    }
  }

  return zip.generate({ type: "uint8array", compression: "DEFLATE" })
}

function flattenVariables(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}_${key}` : key
    if (value === null || value === undefined) {
      out[fullKey] = ""
    } else if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenVariables(value as Record<string, unknown>, fullKey))
      // También exponer claves directas del subobjeto cuando no colisionan
      for (const [subK, subV] of Object.entries(value as Record<string, unknown>)) {
        if (subV !== null && subV !== undefined && typeof subV !== "object" && !(subK in out)) {
          out[subK] = String(subV)
        }
      }
    } else if (!Array.isArray(value)) {
      const strVal = String(value)
      out[fullKey] = /^\d{4}-\d{2}-\d{2}$/.test(strVal) ? formatIsoDate(strVal) : strVal
    }
  }
  return out
}

// deno-lint-ignore no-explicit-any
async function processSingleJob(supabase: any, job: DocumentJobRow): Promise<{ ok: boolean; status: string; error?: string }> {
  try {
    let templateTypeCode = ""
    let referenceDate = new Date().toISOString().slice(0, 10)
    let variables: Record<string, string> = {}
    let workerId = job.worker_id
    let entityId = job.organization_entity_id
    let contractId: string | null = null
    let addendumId: string | null = null
    let resolutionId: string | null = null
    let payrollMovementId: string | null = null
    let vacationId: string | null = null
    let medicalCertificateId: string | null = null

    if (job.kind === "CONTRACT") {
      const { data, error } = await supabase.rpc("get_contract_document_data", {
        p_contract_id: job.source_id,
      })
      if (error || !data) {
        throw new Error(error?.message || "No se pudieron obtener los datos del contrato.")
      }
      contractId = job.source_id
      entityId = data.entity?.id || entityId
      workerId = data.worker?.id || workerId
      const typeCode = String(data.contract?.type_code || "").toUpperCase()
      templateTypeCode = typeCode === "INDETERMINADO" ? "EMPLOYMENT_CONTRACT_INDETERMINED" : "EMPLOYMENT_CONTRACT_DETERMINED"
      referenceDate = data.contract?.signature_date || data.contract?.start_date || referenceDate
      variables = {
        ...flattenVariables(data as Record<string, unknown>),
        nombre_entidad: data.entity?.name || "",
        nombre_trabajador: data.worker?.full_name || "",
        ci_trabajador: data.worker?.identification || "",
        cargo_trabajador: data.job?.name || "",
        puesto_trabajador: data.position?.name || "",
        area_trabajador: data.area?.name || "",
        salario_escala: formatMoney(data.salary?.amount, data.salary?.currency_code),
        total_retribucion: formatMoney(data.retribution?.total_compensation, data.salary?.currency_code),
        fecha_firma: formatIsoDate(data.contract?.signature_date || data.contract?.start_date),
        lugar_firma: data.contract?.signature_place || "",
        nombre_representante: data.representative?.person_name || "",
        cargo_representante: data.representative?.position_title || "",
      }
    } else if (job.kind === "ADDENDUM") {
      const { data, error } = await supabase.rpc("get_addendum_document_data", {
        p_addendum_id: job.source_id,
      })
      if (error || !data) {
        throw new Error(error?.message || "No se pudieron obtener los datos del anexo.")
      }
      addendumId = job.source_id
      contractId = data.contract?.id || null
      entityId = data.entity?.id || entityId
      workerId = data.worker?.id || workerId
      templateTypeCode = "EMPLOYMENT_CONTRACT_ADDENDUM"
      referenceDate = data.addendum?.signature_date || data.addendum?.effective_date || referenceDate
      variables = {
        ...flattenVariables(data as Record<string, unknown>),
        nombre_entidad: data.entity?.name || "",
        nombre_trabajador: data.worker?.full_name || "",
        ci_trabajador: data.worker?.identification || "",
        numero_anexo: String(data.addendum?.addendum_number ?? ""),
        motivo_anexo: data.addendum?.reason || "",
        fecha_efectiva: formatIsoDate(data.addendum?.effective_date),
        fecha_firma: formatIsoDate(data.addendum?.signature_date || data.addendum?.effective_date),
        lugar_firma: data.addendum?.signature_place || "",
        nombre_representante: data.representative?.person_name || "",
        cargo_representante: data.representative?.position_title || "",
      }
    } else if (job.kind === "RESOLUTION") {
      const { data, error } = await supabase.rpc("get_resolution_document_data", {
        p_resolution_id: job.source_id,
      })
      if (error || !data) {
        throw new Error(error?.message || "No se pudieron obtener los datos de la resolución.")
      }
      resolutionId = job.source_id
      entityId = data.entity?.id || entityId
      workerId = data.worker?.id || workerId
      const resKind = String(data.resolution?.resolution_kind || "APPOINTMENT").toUpperCase()
      templateTypeCode = "RESOLUTION"
      referenceDate = data.resolution?.resolution_date || data.resolution?.effective_date || referenceDate
      variables = {
        ...flattenVariables(data as Record<string, unknown>),
        nombre_entidad: data.entity?.name || "",
        nombre_trabajador: data.worker?.full_name || "",
        ci_trabajador: data.worker?.identification || "",
        cargo_trabajador: data.job?.name || "",
        puesto_trabajador: data.position?.name || "",
        area_trabajador: data.area?.name || "",
        fecha_resolucion: formatIsoDate(data.resolution?.resolution_date),
        fecha_efectiva: formatIsoDate(data.resolution?.effective_date),
        nombre_representante: data.representative?.person_name || "",
        cargo_representante: data.representative?.position_title || "",
      }
    } else if (job.kind === "PAYROLL_MOVEMENT") {
      const { data, error } = await supabase.rpc("get_payroll_movement_document_data", {
        p_movement_id: job.source_id,
      })
      if (error || !data) {
        throw new Error(error?.message || "No se pudieron obtener los datos del movimiento de nómina.")
      }
      payrollMovementId = job.source_id
      entityId = data.entity?.id || entityId
      workerId = data.worker?.id || workerId
      templateTypeCode = "PAYROLL_MOVEMENT"
      referenceDate = data.movement?.effective_date || referenceDate
      variables = {
        ...flattenVariables(data as Record<string, unknown>),
        nombre_entidad: data.entity?.name || "",
        nombre_trabajador: data.worker?.full_name || "",
        ci_trabajador: data.worker?.identification || "",
        codigo_trabajador: data.worker?.code || "",
        tipo_movimiento: data.movement?.movement_type || "",
        fecha_efectiva: formatIsoDate(data.movement?.effective_date),
      }
    } else if (job.kind === "VACATION") {
      vacationId = job.source_id
      templateTypeCode = "SC_4_04"
      const { data: vacRow, error: vacErr } = await supabase
        .from("worker_vacations")
        .select("id, worker_id, start_date, end_date, natural_days, charged_days, notes")
        .eq("id", job.source_id)
        .maybeSingle()
      if (vacErr || !vacRow) {
        throw new Error(vacErr?.message || "Período de vacaciones no encontrado.")
      }
      workerId = vacRow.worker_id
      referenceDate = vacRow.start_date || referenceDate
      const { data: workerRow } = await supabase
        .from("workers")
        .select("id, code, first_name, first_surname, second_surname, identification, organization_entity_id")
        .eq("id", vacRow.worker_id)
        .maybeSingle()
      entityId = workerRow?.organization_entity_id || entityId
      const fullName = [workerRow?.first_name, workerRow?.first_surname, workerRow?.second_surname]
        .filter(Boolean)
        .join(" ")
      variables = {
        nombre_trabajador: fullName,
        ci_trabajador: workerRow?.identification || "",
        codigo_trabajador: workerRow?.code || "",
        fecha_inicio: formatIsoDate(vacRow.start_date),
        fecha_fin: formatIsoDate(vacRow.end_date),
        dias_naturales: String(vacRow.natural_days ?? ""),
        dias_habiles: String(vacRow.charged_days ?? ""),
        observaciones: vacRow.notes || "",
      }
    } else if (job.kind === "MEDICAL_CERTIFICATE") {
      medicalCertificateId = job.source_id
      templateTypeCode = "SC_4_04"
      const { data: certRow, error: certErr } = await supabase
        .from("worker_medical_certificates")
        .select("id, worker_id, organization_entity_id, certificate_number, start_date, return_date, days, document_id, notes")
        .eq("id", job.source_id)
        .maybeSingle()
      if (certErr || !certRow) {
        throw new Error(certErr?.message || "Certificado médico no encontrado.")
      }
      workerId = certRow.worker_id
      entityId = certRow.organization_entity_id || entityId
      referenceDate = certRow.start_date || referenceDate
      const { data: workerRow } = await supabase
        .from("workers")
        .select("id, code, first_name, first_surname, second_surname, identification, organization_entity_id")
        .eq("id", certRow.worker_id)
        .maybeSingle()
      entityId = entityId || workerRow?.organization_entity_id
      const fullName = [workerRow?.first_name, workerRow?.first_surname, workerRow?.second_surname]
        .filter(Boolean)
        .join(" ")
      variables = {
        nombre_trabajador: fullName,
        ci_trabajador: workerRow?.identification || "",
        codigo_trabajador: workerRow?.code || "",
        numero_certificado: certRow.certificate_number || certRow.document_id || "",
        fecha_inicio: formatIsoDate(certRow.start_date),
        fecha_fin: formatIsoDate(certRow.return_date),
        dias_naturales: String(certRow.days ?? ""),
        observaciones: certRow.notes || "",
      }
    }

    // Resolver versión activa de la plantilla para (entityId, templateTypeCode, referenceDate)
    const { data: resolvedRows, error: resolveError } = await supabase.rpc(
      "resolve_document_template_version",
      {
        p_entity_id: entityId,
        p_document_type_code: templateTypeCode,
        p_reference_date: referenceDate,
      }
    )

    if (resolveError) {
      throw new Error(resolveError.message)
    }

    const resolved = Array.isArray(resolvedRows) ? resolvedRows[0] : resolvedRows
    if (!resolved || !resolved.version_id || !resolved.storage_path) {
      const label = TEMPLATE_TYPE_LABELS[templateTypeCode] || templateTypeCode
      const missingMsg = `No hay plantilla activa de ${label} vigente al ${formatIsoDate(referenceDate)}`
      await supabase.rpc("mark_document_generation_job_result", {
        p_job_id: job.id,
        p_status: "SIN_PLANTILLA",
        p_worker_document_id: null,
        p_error: missingMsg,
      })
      return { ok: false, status: "SIN_PLANTILLA", error: missingMsg }
    }

    // Descargar binario de la plantilla desde `"document-templates"`
    const { data: templateBlob, error: downloadError } = await supabase.storage
      .from("document-templates")
      .download(resolved.storage_path)

    if (downloadError || !templateBlob) {
      throw new Error(downloadError?.message || "No se pudo descargar el archivo de la plantilla.")
    }

    const templateBytes = await templateBlob.arrayBuffer()
    const isXlsx =
      String(resolved.file_name || "").toLowerCase().endsWith(".xlsx") ||
      String(resolved.mime_type || "").includes("spreadsheetml")

    const renderedBytes = isXlsx
      ? renderXlsxBytes(templateBytes, variables)
      : renderDocxBytes(templateBytes, variables)

    const mimeType = isXlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    // Reservar registro en `worker_documents`
    let reservation: { worker_document_id: string; storage_path: string; file_name: string } | null = null

    if (job.kind === "CONTRACT" || job.kind === "ADDENDUM") {
      const { data: beginData, error: beginError } = await supabase.rpc("begin_document_generation", {
        p_worker_id: workerId,
        p_contract_id: contractId,
        p_addendum_id: addendumId,
        p_template_version_id: resolved.version_id,
        p_reference_date: referenceDate,
      })
      if (beginError || !beginData) {
        throw new Error(beginError?.message || "No se pudo iniciar el registro del documento.")
      }
      reservation = beginData
    } else if (job.kind === "RESOLUTION") {
      const { data: beginData, error: beginError } = await supabase.rpc("begin_resolution_generation", {
        p_resolution_id: resolutionId,
        p_template_version_id: resolved.version_id,
        p_reference_date: referenceDate,
      })
      if (beginError || !beginData) {
        throw new Error(beginError?.message || "No se pudo iniciar el registro de la resolución.")
      }
      reservation = beginData
    } else if (job.kind === "PAYROLL_MOVEMENT") {
      const { data: beginData, error: beginError } = await supabase.rpc(
        "begin_payroll_movement_generation",
        {
          p_movement_id: payrollMovementId,
          p_template_version_id: resolved.version_id,
          p_reference_date: referenceDate,
        }
      )
      if (beginError || !beginData) {
        throw new Error(beginError?.message || "No se pudo iniciar el registro del movimiento de nómina.")
      }
      reservation = beginData
    } else {
      const { data: beginData, error: beginError } = await supabase.rpc("begin_sc404_generation", {
        p_vacation_id: vacationId,
        p_medical_certificate_id: medicalCertificateId,
        p_template_version_id: resolved.version_id,
        p_reference_date: referenceDate,
      })
      if (beginError || !beginData) {
        throw new Error(beginError?.message || "No se pudo iniciar el registro del modelo SC-4-04.")
      }
      reservation = beginData
    }

    if (!reservation?.worker_document_id || !reservation?.storage_path) {
      throw new Error("El servidor no devolvió una ruta de almacenamiento válida para el documento.")
    }

    try {
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(reservation.storage_path, renderedBytes, {
          contentType: mimeType,
          upsert: true,
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { error: completeError } = await supabase.rpc("complete_document_generation", {
        p_worker_document_id: reservation.worker_document_id,
        p_file_size: renderedBytes.byteLength,
        p_mime_type: mimeType,
      })

      if (completeError) {
        throw new Error(completeError.message)
      }
    } catch (uploadOrCompleteErr) {
      const errMsg =
        uploadOrCompleteErr instanceof Error
          ? uploadOrCompleteErr.message
          : "Error al subir el documento generado."
      await supabase.rpc("fail_document_generation", {
        p_worker_document_id: reservation.worker_document_id,
        p_error: errMsg,
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
