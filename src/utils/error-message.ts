/**
 * Extrae el mensaje legible de errores JS (`Error`) y errores PostgREST / Supabase
 * (`{ message, details, hint }`) sin perder mensajes lanzados por PostgreSQL.
 */
export function extractErrorMessage(err: unknown, fallback = ""): string {
  if (!err) return fallback
  if (typeof err === "string") return err.trim() || fallback
  if (err instanceof Error) return err.message.trim() || fallback
  if (typeof err === "object" && "message" in err) {
    const raw = (err as { message?: unknown }).message
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  return fallback
}
