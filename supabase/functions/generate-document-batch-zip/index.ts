import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"
import JSZip from "https://esm.sh/jszip@3.10.1"

/**
 * generate-document-batch-zip
 *
 * Agrupa en un único ZIP los documentos YA generados de un lote documental
 * (un event_id + una entidad + un tipo documental). NO genera documentos ni
 * sustituye los documentos individuales del expediente: sólo los empaqueta para
 * descarga. El ZIP se sube al bucket privado `documents` y se registra en
 * document_batches.zip_path.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DOCUMENTS_BUCKET = "documents"

const sanitize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const serviceClient = createClient(supabaseUrl, serviceKey)

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401)
    }

    // Barrera de servidor: el llamante no puede tener un cambio de contraseña pendiente
    // (esta función usa el rol de servicio para leer ficheros y eludiría RLS).
    const { data: callerLifecycle } = await serviceClient
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", userData.user.id)
      .maybeSingle()
    if (callerLifecycle?.must_change_password === true) {
      return json({ error: "Forbidden: pending password change" }, 403)
    }

    const payload = await req.json().catch(() => ({}))
    const batchId = payload?.batch_id as string | undefined
    if (!batchId) {
      return json({ error: "batch_id es obligatorio" }, 400)
    }

    // RLS del cliente del usuario garantiza el acceso a la entidad del lote.
    const { data: batch, error: batchError } = await userClient
      .from("document_batches")
      .select(
        "id, event_id, organization_entity_id, document_type_code, label, status"
      )
      .eq("id", batchId)
      .maybeSingle()
    if (batchError) throw batchError
    if (!batch) {
      return json({ error: "Forbidden" }, 403)
    }

    const { data: event } = await userClient
      .from("document_generation_events")
      .select("id, effective_date, description")
      .eq("id", batch.event_id)
      .maybeSingle()

    const { data: items, error: itemsError } = await userClient
      .from("document_batch_items")
      .select("id, worker_id, worker_document_id, worker_name, status")
      .eq("batch_id", batchId)
    if (itemsError) throw itemsError

    const documentIds = (items || [])
      .map((item) => item.worker_document_id)
      .filter((id): id is string => !!id)

    if (documentIds.length === 0) {
      await serviceClient
        .from("document_batches")
        .update({ status: "ERRORS", updated_at: new Date().toISOString() })
        .eq("id", batchId)
      return json({ error: "El lote no tiene documentos generados" }, 409)
    }

    const { data: documents, error: docsError } = await serviceClient
      .from("worker_documents")
      .select("id, worker_id, file_name, storage_path")
      .in("id", documentIds)
    if (docsError) throw docsError

    const zip = new JSZip()
    let added = 0
    for (const doc of documents || []) {
      const { data: file, error: downloadError } = await serviceClient.storage
        .from(DOCUMENTS_BUCKET)
        .download(doc.storage_path)
      if (downloadError || !file) continue
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Nombre legible y seguro; conserva la extensión REAL del documento
      // (.docx para Word, .xlsx para el Movimiento de Nómina) y evita colisiones
      // con un sufijo corto del id.
      const rawName = String(doc.file_name || "")
      const extMatch =
        rawName.match(/\.([a-z0-9]+)$/i) || String(doc.storage_path || "").match(/\.([a-z0-9]+)$/i)
      const extension = extMatch ? extMatch[1].toLowerCase() : "docx"
      const base = sanitize(rawName.replace(/\.[a-z0-9]+$/i, ""))
      const name = `${base || "documento"}_${String(doc.id).slice(0, 8)}.${extension}`
      zip.file(name, bytes)
      added += 1
    }

    if (added === 0) {
      await serviceClient
        .from("document_batches")
        .update({ status: "ERRORS", updated_at: new Date().toISOString() })
        .eq("id", batchId)
      return json({ error: "No se pudo leer ningún documento del lote" }, 409)
    }

    const zipBytes = await zip.generateAsync({ type: "uint8array" })
    const dateLabel = (event?.effective_date as string) || new Date().toISOString().slice(0, 10)
    const prettyLabel = sanitize(String(batch.label || batch.document_type_code || "documentos"))
    const zipFileName = `${prettyLabel}_${dateLabel}.zip`
    const tempPath = `batches/${batch.organization_entity_id}/${batch.event_id}/${batchId}.zip`
    const finalPath = `batches/${batch.organization_entity_id}/${batch.event_id}/${zipFileName}`

    const { error: uploadError } = await serviceClient.storage
      .from(DOCUMENTS_BUCKET)
      .upload(tempPath, zipBytes, { contentType: "application/zip", upsert: true })
    if (uploadError) throw uploadError

    // Reubicación con nombre legible (evita colisiones dentro de la misma carpeta).
    await serviceClient.storage.from(DOCUMENTS_BUCKET).remove([finalPath])
    await serviceClient.storage.from(DOCUMENTS_BUCKET).move(tempPath, finalPath)

    await serviceClient
      .from("document_batches")
      .update({
        zip_path: finalPath,
        zip_file_name: zipFileName,
        status: "READY",
        generated_count: added,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)

    return json({ status: "READY", zip_path: finalPath, zip_file_name: zipFileName, documents: added })
  } catch (error) {
    console.error("[generate-document-batch-zip] error", error)
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500)
  }
})
