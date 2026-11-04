import { createClient } from "@supabase/supabase-js"
import { appConfig } from "@/shared/config/app-config"

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
}

const supabaseUrl = appConfig.api.baseUrl
const supabaseAnonKey = appConfig.api.publicKey
const CUSTOM_SESSION_STORAGE_KEY = appConfig.auth.sessionStorageKey
const CUSTOM_JWT_STORAGE_KEY = `${appConfig.auth.sessionStorageKey}_jwt`
const CUSTOM_SESSION_HEADER = appConfig.auth.sessionHeaderName

function readStoredToken(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    const val = window.localStorage.getItem(key)
    return val && val.trim().length > 0 ? val.trim() : null
  } catch {
    return null
  }
}

function isJwtUnexpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return false
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    const payload = JSON.parse(atob(padded)) as { exp?: number }
    if (typeof payload.exp !== "number") return true
    return payload.exp * 1000 > Date.now() + 15_000
  } catch {
    return false
  }
}

function injectNativeSessionHeaders(
  input: RequestInfo | URL,
  init?: RequestInit
): RequestInit | undefined {
  const sessionToken = readStoredToken(CUSTOM_SESSION_STORAGE_KEY)
  const customJwt = readStoredToken(CUSTOM_JWT_STORAGE_KEY)

  if (!sessionToken && !customJwt) {
    return init
  }

  const headers = new Headers(
    init?.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
  )

  if (sessionToken && !headers.has(CUSTOM_SESSION_HEADER)) {
    headers.set(CUSTOM_SESSION_HEADER, sessionToken)
  }

  if (customJwt && isJwtUnexpired(customJwt)) {
    const currentAuth = headers.get("Authorization") || headers.get("authorization") || ""
    if (!currentAuth || currentAuth === `Bearer ${supabaseAnonKey}`) {
      headers.set("Authorization", `Bearer ${customJwt}`)
    }
  }

  return {
    ...init,
    headers,
  }
}

const baseFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined

const auditedFetch: typeof fetch | undefined = baseFetch
  ? async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const enrichedInit = injectNativeSessionHeaders(input, init)
      const response = await baseFetch(input, enrichedInit)
      try {
        const hook = globalThis.__sitecorpSupabaseMutationHook
        if (hook) {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url
          const method = (
            enrichedInit?.method ||
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
            if (typeof enrichedInit?.body === "string" && enrichedInit.body.trim().length > 0) {
              try {
                requestBody = JSON.parse(enrichedInit.body)
              } catch {
                requestBody = enrichedInit.body
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  ...(auditedFetch ? { global: { fetch: auditedFetch } } : {}),
})

// Types for our database (to be updated as we create tables)
export type Database = {
  public: {
    Tables: {
      // Placeholder for future tables
      [_ in never]: never
    }
  }
}