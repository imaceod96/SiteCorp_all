import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

/**
 * Eliminación definitiva de un Workspace.
 *
 * 1. Verifica la identidad del llamante con su JWT.
 * 2. Ejecuta la eliminación de base de datos llamando a la RPC de borrado CON EL
 *    TOKEN DEL USUARIO: la autorización (auth.uid() + permiso de plataforma
 *    `tenants.delete`, o SuperAdmin) y la confirmación por nombre se comprueban
 *    dentro de la función SQL, en una única transacción. La migración
 *    Tenant → CompanyClient renombra la función (`delete_workspace` →
 *    `delete_company_client`) preservando sus parámetros y sus columnas de salida,
 *    así que el CUERPO de la petición y de la respuesta no cambia.
 * 3. Limpia con el rol de servicio EXCLUSIVAMENTE los objetos privados que la
 *    función autorizada devolvió (rutas exactas + carpetas por id de trabajador,
 *    candidato y entidad). Nunca se borra por prefijo ambiguo.
 *
 * Si el borrado en base de datos falla, no se toca el Storage. Si la limpieza de
 * Storage falla parcialmente, la operación se reporta como completada con avisos
 * explícitos (nunca se oculta el fallo).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DOCUMENTS_BUCKET = "documents"
const TEMPLATES_BUCKET = "document-templates"
const REMOVE_CHUNK = 50

/**
 * Nombre de la RPC de borrado. Esta Edge Function no comparte código con el
 * frontend, así que su correspondencia de nombres es deliberadamente explícita:
 * intenta primero el nombre DEFINITIVO y cae al ACTUAL solo si PostgREST todavía
 * no conoce la función (PGRST202). Es una compatibilidad de transición: eliminar
 * el fallback cuando la Fase 3 esté cerrada.
 */
const DELETE_RPC_COMPANY_CLIENT = "delete_company_client"
const DELETE_RPC_LEGACY = "delete_workspace"

/** ¿El error significa «esa función no existe» (y por tanto hay que usar el otro nombre)? */
const isMissingFunction = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) &&
  (error?.code === "PGRST202" ||
    /could not find the function|function .* does not exist/i.test(error?.message ?? ""))

interface DeleteWorkspaceRequest {
  tenant_id?: string
  confirmation_name?: string
}

interface StorageItem {
  bucket: string
  path: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

/** Traduce el error de la función SQL a una respuesta estable para el cliente. */
const mapRpcError = (error: { message?: string; code?: string } | null) => {
  const message = error?.message ?? "No se pudo eliminar el workspace."
  const normalized = message.toLowerCase()

  if (error?.code === "42501" || normalized.includes("no tiene permiso")) {
    return { status: 403, error: "No tienes permiso para eliminar workspaces." }
  }
  if (error?.code === "22023" || normalized.includes("confirmación")) {
    return { status: 400, error: "El nombre de confirmación no coincide con el del workspace." }
  }
  if (error?.code === "P0002" || normalized.includes("no existe")) {
    return { status: 404, error: "El workspace no existe o ya fue eliminado." }
  }
  if (normalized.includes("no autenticado")) {
    return { status: 401, error: "Debes iniciar sesión para eliminar un workspace." }
  }
  return { status: 500, error: message }
}

/** Lista recursivamente los archivos de una carpeta del bucket. */
const listFolderFiles = async (
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> => {
  if (depth > 5) return []

  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) {
    if (error) {
      console.error("[delete-workspace] storage listing failed", { bucket, prefix, error })
    }
    return []
  }

  const files: string[] = []
  for (const entry of data) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id === null) {
      files.push(...(await listFolderFiles(client, bucket, entryPath, depth + 1)))
    } else {
      files.push(entryPath)
    }
  }
  return files
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401)
  }

  const token = authHeader.replace("Bearer ", "")

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // Cliente que actúa como el usuario: la autorización la aplica la base de datos.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })

  try {
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
    if (callerError || !callerData?.user) {
      console.error("[delete-workspace] invalid caller token", callerError)
      return json({ error: "Unauthorized" }, 401)
    }

    const body = (await req.json()) as DeleteWorkspaceRequest
    const tenantId = (body.tenant_id ?? "").trim()
    const confirmationName = body.confirmation_name ?? ""

    if (!tenantId) {
      return json({ error: "El workspace es obligatorio." }, 400)
    }

    // Los ARGUMENTOS no cambian: la migración SQL preserva los nombres de parámetro.
    const callDelete = (name: string) =>
      userClient.rpc(name, {
        p_tenant_id: tenantId,
        p_confirmation_name: confirmationName,
      })

    let { data: result, error: rpcError } = await callDelete(DELETE_RPC_COMPANY_CLIENT)

    if (isMissingFunction(rpcError)) {
      console.warn("[delete-workspace] RPC definitiva no disponible; se usa la actual", {
        code: rpcError?.code,
      })
      const legacy = await callDelete(DELETE_RPC_LEGACY)
      result = legacy.data
      rpcError = legacy.error
    }

    if (rpcError) {
      console.error("[delete-workspace] database deletion rejected", {
        tenantId,
        code: rpcError.code,
        message: rpcError.message,
      })
      const mapped = mapRpcError(rpcError)
      return json({ error: mapped.error, code: rpcError.code ?? null }, mapped.status)
    }

    const storage = (result?.storage ?? {}) as {
      documents?: string[]
      document_templates?: string[]
      worker_ids?: string[]
      candidate_ids?: string[]
      entity_ids?: string[]
    }

    // Rutas exactas registradas en la base de datos (propiedad verificada antes
    // del borrado) + carpetas por propietario exacto, para no dejar objetos
    // privados huérfanos bajo los prefijos del workspace eliminado.
    const items: StorageItem[] = []
    const push = (bucket: string, path: string | null | undefined) => {
      if (path && path !== "pending" && !path.startsWith("http")) {
        items.push({ bucket, path })
      }
    }

    ;(storage.documents ?? []).forEach((path) => push(DOCUMENTS_BUCKET, path))
    ;(storage.document_templates ?? []).forEach((path) => push(TEMPLATES_BUCKET, path))

    for (const workerId of storage.worker_ids ?? []) {
      for (const path of await listFolderFiles(adminClient, DOCUMENTS_BUCKET, `workers/${workerId}`)) {
        push(DOCUMENTS_BUCKET, path)
      }
    }

    for (const candidateId of storage.candidate_ids ?? []) {
      for (const path of await listFolderFiles(adminClient, DOCUMENTS_BUCKET, `candidates/${candidateId}`)) {
        push(DOCUMENTS_BUCKET, path)
      }
    }

    for (const entityId of storage.entity_ids ?? []) {
      for (const path of await listFolderFiles(adminClient, TEMPLATES_BUCKET, `entity/${entityId}`)) {
        push(TEMPLATES_BUCKET, path)
      }
    }

    const unique = new Map<string, StorageItem>()
    for (const item of items) {
      unique.set(`${item.bucket}:${item.path}`, item)
    }

    let removed = 0
    const failures: string[] = []

    for (const bucket of [DOCUMENTS_BUCKET, TEMPLATES_BUCKET]) {
      const paths = [...unique.values()].filter((item) => item.bucket === bucket).map((item) => item.path)
      for (let index = 0; index < paths.length; index += REMOVE_CHUNK) {
        const chunk = paths.slice(index, index + REMOVE_CHUNK)
        const { data: removedRows, error: removeError } = await adminClient.storage
          .from(bucket)
          .remove(chunk)

        if (removeError) {
          console.error("[delete-workspace] storage removal failed", { bucket, error: removeError })
          failures.push(...chunk)
        } else {
          removed += removedRows?.length ?? chunk.length
        }
      }
    }

    console.log("[delete-workspace] workspace deleted", {
      tenantId: result?.tenant_id,
      tenantName: result?.tenant_name,
      removed,
      failed: failures.length,
      requestedBy: callerData.user.id,
    })

    return json({
      status: "DELETED",
      tenant_id: result?.tenant_id ?? tenantId,
      tenant_name: result?.tenant_name ?? null,
      summary: result?.summary ?? null,
      storage: {
        removed,
        failed: failures.length,
        failures: failures.slice(0, 20),
      },
    })
  } catch (error) {
    console.error("[delete-workspace] unexpected error", error)
    return json({ error: "No se pudo eliminar el workspace." }, 500)
  }
})
