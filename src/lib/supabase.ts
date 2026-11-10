import { createClient } from "@supabase/supabase-js"

export interface SupabaseMutationInterceptPayload {
  url: string
  method: string
  requestBody: unknown
  responseBody: unknown
  status: number
  ok: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __sitecorpSupabaseMutationHook:
    | ((payload: SupabaseMutationInterceptPayload) => void)
    | undefined
  // eslint-disable-next-line no-var
  var __SITECORP_AUTH_PROVIDER__: "supabase" | "self_hosted" | undefined
  // eslint-disable-next-line no-var
  var __SITECORP_AUTH_API_URL__: string | undefined
  // eslint-disable-next-line no-var
  var __SITECORP_SELF_HOSTED_ACCESS_TOKEN__: string | null | undefined
  // eslint-disable-next-line no-var
  var __SITECORP_ACTIVE_COMPANY_ID__: string | null | undefined
  // eslint-disable-next-line no-var
  var __SITECORP_CUSTOM_FETCH__: typeof fetch | undefined
}

function readViteEnvVar(key: string): string | undefined {
  const metaEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      : undefined
  return (
    metaEnv?.[key] ||
    (typeof process !== "undefined" ? process.env?.[key] : undefined)
  )
}

const supabaseUrl =
  readViteEnvVar("VITE_SUPABASE_URL") ||
  "https://xvswjkpoeccgpiewptur.supabase.co"
const supabaseAnonKey =
  readViteEnvVar("VITE_SUPABASE_ANON_KEY") ||
  "sb_publishable_4ZKRypToE3sUnlo_oAGdRA_KhkLmieP"

export function isSelfHostedModeActive(): boolean {
  if (globalThis.__SITECORP_AUTH_PROVIDER__) {
    return globalThis.__SITECORP_AUTH_PROVIDER__ === "self_hosted"
  }
  const envProvider = readViteEnvVar("VITE_AUTH_PROVIDER") || "supabase"
  return String(envProvider).trim().toLowerCase() === "self_hosted"
}

export function resolveAutonomousApiBaseUrl(): string {
  if (globalThis.__SITECORP_AUTH_API_URL__) {
    return globalThis.__SITECORP_AUTH_API_URL__.replace(/\/+$/, "")
  }
  const envUrl = readViteEnvVar("VITE_AUTH_API_URL") || "http://127.0.0.1:4010"
  return String(envUrl).trim().replace(/\/+$/, "")
}

export function configureSelfHostedRuntimeBridge(options: {
  provider: "supabase" | "self_hosted"
  apiBaseUrl?: string
  accessToken?: string | null
  activeCompanyId?: string | null
  customFetch?: typeof fetch
}): void {
  globalThis.__SITECORP_AUTH_PROVIDER__ = options.provider
  if (options.apiBaseUrl !== undefined) {
    globalThis.__SITECORP_AUTH_API_URL__ = options.apiBaseUrl
  }
  if (options.accessToken !== undefined) {
    globalThis.__SITECORP_SELF_HOSTED_ACCESS_TOKEN__ = options.accessToken
  }
  if (options.activeCompanyId !== undefined) {
    globalThis.__SITECORP_ACTIVE_COMPANY_ID__ = options.activeCompanyId
  }
  if (options.customFetch !== undefined) {
    globalThis.__SITECORP_CUSTOM_FETCH__ = options.customFetch
  }
}

const baseFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined

function readHeaderValue(
  headers: RequestInit["headers"],
  targetName: string
): string | null {
  if (!headers) return null
  const lower = targetName.toLowerCase()
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(targetName) ?? headers.get(lower)
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === lower) return v
    }
    return null
  }
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v
  }
  return null
}

async function routeSupabaseRequestToAutonomousBackend(
  rawUrl: string,
  init?: RequestInit
): Promise<Response> {
  const effectiveFetch = globalThis.__SITECORP_CUSTOM_FETCH__ ?? baseFetch
  if (!effectiveFetch) {
    throw new Error("No hay implementación de fetch disponible para el modo self_hosted.")
  }

  const parsedUrl = new URL(rawUrl)
  const pathname = parsedUrl.pathname
  const method = (init?.method ?? "GET").toUpperCase()
  const baseUrl = resolveAutonomousApiBaseUrl()
  const token = globalThis.__SITECORP_SELF_HOSTED_ACCESS_TOKEN__
  const activeCompanyId = globalThis.__SITECORP_ACTIVE_COMPANY_ID__

  const authHeaders: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (token) {
    authHeaders.Authorization = `Bearer ${token}`
  }

  let parsedBody: unknown = {}
  if (typeof init?.body === "string" && init.body.trim().length > 0) {
    try {
      parsedBody = JSON.parse(init.body)
    } catch {
      parsedBody = {}
    }
  }

  // 1. Llamadas RPC: /rest/v1/rpc/<rpcName> -> /api/v1/submodules/rpc/<rpcName>
  if (pathname.startsWith("/rest/v1/rpc/")) {
    const rpcName = decodeURIComponent(pathname.slice("/rest/v1/rpc/".length))
    const bodyObj =
      parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? (parsedBody as Record<string, unknown>)
        : {}
    const rpcBody = {
      ...(activeCompanyId ? { p_company_client_id: activeCompanyId } : {}),
      ...bodyObj,
    }
    const resp = await effectiveFetch(
      `${baseUrl}/api/v1/submodules/rpc/${encodeURIComponent(rpcName)}`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(rpcBody),
      }
    )
    const json = (await resp.json().catch(() => null)) as Record<string, any> | null
    if (!resp.ok) {
      return new Response(
        JSON.stringify({
          message: json?.error?.message ?? json?.message ?? "Error en RPC autónomo",
          code: json?.error?.code ?? "AUTONOMOUS_RPC_ERROR",
        }),
        { status: resp.status, headers: { "Content-Type": "application/json" } }
      )
    }
    return new Response(JSON.stringify(json?.data?.result ?? null), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // 2. Llamadas Edge Functions: /functions/v1/<fnName> -> /api/v1/submodules/edge/<fnName>
  if (pathname.startsWith("/functions/v1/")) {
    const fnName = decodeURIComponent(pathname.slice("/functions/v1/".length))
    const bodyObj =
      parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? (parsedBody as Record<string, unknown>)
        : {}
    const fnBody = {
      ...(activeCompanyId ? { companyClientId: activeCompanyId } : {}),
      ...bodyObj,
    }
    const resp = await effectiveFetch(
      `${baseUrl}/api/v1/submodules/edge/${encodeURIComponent(fnName)}`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(fnBody),
      }
    )
    const json = (await resp.json().catch(() => null)) as Record<string, any> | null
    if (!resp.ok) {
      return new Response(
        JSON.stringify({
          message: json?.error?.message ?? json?.message ?? "Error en función autónoma",
          code: json?.error?.code ?? "AUTONOMOUS_FUNCTION_ERROR",
        }),
        { status: resp.status, headers: { "Content-Type": "application/json" } }
      )
    }
    return new Response(JSON.stringify(json?.data?.result ?? null), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // 3. Consultas de tablas PostgREST: /rest/v1/<tableName> -> /api/v1/submodules/query/<tableName>
  if (pathname.startsWith("/rest/v1/")) {
    const tableName = decodeURIComponent(pathname.slice("/rest/v1/".length))
    const filters: Record<string, string> = {}
    const orderBy: Array<{ column: string; direction: "asc" | "desc" }> = []
    let explicitCompanyId: string | null = activeCompanyId ?? null
    let limit: number | undefined
    let offset: number | undefined
    let onConflict: string | null = null

    const preferHeader = readHeaderValue(init?.headers, "Prefer") ?? ""
    const acceptHeader = readHeaderValue(init?.headers, "Accept") ?? ""
    const rangeHeader =
      readHeaderValue(init?.headers, "Range") ??
      parsedUrl.searchParams.get("range")

    const countExact = preferHeader.toLowerCase().includes("count=exact")
    const isUpsertHeader = preferHeader
      .toLowerCase()
      .includes("resolution=merge-duplicates")
    const wantsSingleObject = acceptHeader
      .toLowerCase()
      .includes("application/vnd.pgrst.object+json")

    if (rangeHeader) {
      const m = rangeHeader.match(/(\d+)\s*-\s*(\d+)/)
      if (m) {
        const from = Number(m[1])
        const to = Number(m[2])
        if (Number.isInteger(from) && Number.isInteger(to) && to >= from) {
          offset = from
          limit = Math.min(500, to - from + 1)
        }
      }
    }

    for (const [k, v] of parsedUrl.searchParams.entries()) {
      if (k === "select" || k === "columns") {
        // Si select solicita joins embebidos no soportados (ej. otra_tabla(...)), fallar explícitamente
        if (v.includes("(") && v.includes(")")) {
          return new Response(
            JSON.stringify({
              message: `La pasarela autónoma no soporta relaciones embebidas de PostgREST ('${v}'). Utilice consultas explícitas o endpoints de dominio.`,
              code: "UNSUPPORTED_POSTGREST_FEATURE",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          )
        }
        continue
      }
      if (k === "order") {
        for (const part of v.split(",")) {
          const segments = part.trim().split(".")
          const col = segments[0]?.trim()
          const dir = segments[1]?.trim().toLowerCase() === "desc" ? "desc" : "asc"
          if (col) {
            orderBy.push({ column: col, direction: dir })
          }
        }
        continue
      }
      if (k === "limit") {
        limit = Number(v)
        continue
      }
      if (k === "offset") {
        offset = Number(v)
        continue
      }
      if (k === "on_conflict") {
        onConflict = v
        continue
      }

      filters[k] = v
      if (
        (k === "company_client_id" || k === "client_id") &&
        v.startsWith("eq.")
      ) {
        explicitCompanyId = v.slice(3)
      }
    }

    const op =
      method === "GET" || method === "HEAD"
        ? "select"
        : method === "DELETE"
          ? "delete"
          : method === "PATCH" || method === "PUT"
            ? "update"
            : isUpsertHeader || onConflict
              ? "upsert"
              : "insert"

    const resp = await effectiveFetch(
      `${baseUrl}/api/v1/submodules/query/${encodeURIComponent(tableName)}`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          operation: op,
          companyClientId: explicitCompanyId,
          filters,
          orderBy: orderBy.length > 0 ? orderBy : undefined,
          limit,
          offset,
          countExact,
          onConflict,
          payload: parsedBody,
        }),
      }
    )
    const json = (await resp.json().catch(() => null)) as Record<string, any> | null
    if (!resp.ok) {
      return new Response(
        JSON.stringify({
          message:
            json?.error?.message ??
            json?.message ??
            "Acceso denegado o consulta inválida en tabla autónoma",
          code: json?.error?.code ?? "AUTONOMOUS_REST_ERROR",
        }),
        { status: resp.status, headers: { "Content-Type": "application/json" } }
      )
    }

    const rows: unknown[] = Array.isArray(json?.data?.rows) ? json.data.rows : []
    const totalCount: number =
      typeof json?.data?.totalCount === "number"
        ? json.data.totalCount
        : rows.length

    const responseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (countExact) {
      const start = offset ?? 0
      const end = rows.length > 0 ? start + rows.length - 1 : start
      responseHeaders["Content-Range"] =
        rows.length > 0 ? `${start}-${end}/${totalCount}` : `*/${totalCount}`
    }

    if (wantsSingleObject) {
      if (rows.length !== 1) {
        return new Response(
          JSON.stringify({
            code: "PGRST116",
            details: `The result contains ${rows.length} rows`,
            hint: null,
            message: "JSON object requested, multiple (or no) rows returned",
          }),
          { status: 406, headers: responseHeaders }
        )
      }
      return new Response(JSON.stringify(rows[0]), {
        status: 200,
        headers: responseHeaders,
      })
    }

    return new Response(JSON.stringify(rows), {
      status: method === "POST" ? 201 : 200,
      headers: responseHeaders,
    })
  }

  throw new Error(
    `Bloqueo estricto en modo self_hosted: se impidió una llamada directa no autorizada a Supabase Cloud (${rawUrl}).`
  )
}

const auditedFetch: typeof fetch | undefined = baseFetch
  ? async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      // En modo self_hosted, todas las operaciones se redirigen al backend autónomo
      // y se bloquea cualquier intento de conexión hacia *.supabase.co.
      if (isSelfHostedModeActive()) {
        return routeSupabaseRequestToAutonomousBackend(url, init)
      }

      const response = await baseFetch(input, init)
      try {
        const hook = globalThis.__sitecorpSupabaseMutationHook
        if (hook) {
          const method = (
            init?.method ||
            (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET") ||
            "GET"
          ).toUpperCase()

          if (
            (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") &&
            (url.includes("/rest/v1/") || url.includes("/functions/v1/")) &&
            !url.includes("/rest/v1/audit_events") &&
            !url.includes("/auth/v1/")
          ) {
            let requestBody: unknown = null
            if (typeof init?.body === "string" && init.body.trim().length > 0) {
              try {
                requestBody = JSON.parse(init.body)
              } catch {
                requestBody = init.body
              }
            }
            const cloned = response.clone()
            void cloned
              .text()
              .then((text) => {
                let responseBody: unknown = null
                if (text && text.trim().length > 0) {
                  try {
                    responseBody = JSON.parse(text)
                  } catch {
                    responseBody = text
                  }
                }
                hook({
                  url,
                  method,
                  requestBody,
                  responseBody,
                  status: response.status,
                  ok: response.ok,
                })
              })
              .catch(() => {
                // Ignore stream read errors
              })
          }
        }
      } catch {
        // Never interfere with main request flow
      }
      return response
    }
  : undefined

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  auditedFetch ? { global: { fetch: auditedFetch } } : undefined
)

// Types for our database (to be updated as we create tables)
export type Database = {
  public: {
    Tables: {
      // Placeholder for future tables
      [_ in never]: never
    }
  }
}