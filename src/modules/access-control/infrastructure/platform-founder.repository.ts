import { supabase } from "@/lib/supabase"

/**
 * Control de acceso — Identificación de la cuenta fundadora (infraestructura).
 *
 * La identidad del fundador vive en `platform_founder` (una sola fila, UUID de Auth) y la
 * resuelve el servidor con `public.is_platform_founder()`. El cliente NO deduce al fundador
 * comparando nombres ni fechas: pregunta a la base.
 *
 * Lectura TOLERANTE: si la función no existe todavía (migración sin aplicar) o falla, se
 * responde `false`. El efecto es restrictivo —se ocultan las acciones reservadas al
 * fundador—, nunca permisivo.
 */
export async function rpcIsPlatformFounder(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_founder")
  if (error) return false
  return data === true
}
