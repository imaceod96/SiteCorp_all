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

/**
 * UUID de la cuenta fundadora (una sola fila; RLS la permite leer a los SuperAdmin).
 *
 * Lo necesita la pantalla de usuarios para cerrar la fila de la cuenta fundadora —eliminar y
 * desactivar— también cuando quien mira NO es el fundador: sólo su propia sesión conoce su
 * condición, pero cualquier SuperAdmin puede ver esta pantalla.
 *
 * Lectura TOLERANTE: sin fila, sin permiso o con la migración sin aplicar devuelve `null` y la
 * interfaz se comporta como antes. La autorización efectiva sigue siendo del servidor.
 */
export async function selectPlatformFounderId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("platform_founder")
    .select("user_id")
    .maybeSingle()

  if (error || !data) return null
  return (data as { user_id: string }).user_id
}
