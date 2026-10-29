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
}

// Create a single supabase client for interacting with your database
const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
  "https://xvswjkpoeccgpiewptur.supabase.co"
const supabaseAnonKey =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_ANON_KEY) ||
  "sb_publishable_4ZKRypToE3sUnlo_oAGdRA_KhkLmieP"

const baseFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined

const auditedFetch: typeof fetch | undefined = baseFetch
  ? async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await baseFetch(input, init)
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