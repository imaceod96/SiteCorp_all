/**
 * Generación documental — Normalización de filas del backend (infraestructura).
 *
 * Las respuestas de Supabase llegan sin tipos (JSON): estos ayudantes convierten cada valor
 * al tipo del contrato del dominio SIN inventar datos (`null` se conserva como `null`).
 */

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

export const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const result = typeof value === "string" ? value.trim() : String(value)
  return result === "" ? null : result
}

export const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const throwIfError = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}
