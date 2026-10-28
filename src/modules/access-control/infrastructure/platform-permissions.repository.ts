import { supabase } from "@/lib/supabase"

/**
 * Control de acceso — Repositorio de permisos de PLATAFORMA (infraestructura).
 *
 * Único punto que habla con Supabase para la comprobación de un permiso de plataforma
 * (`has_platform_permission`). Ningún otro dominio —ni la presentación— invoca esa RPC:
 * los consumidores pasan por los casos de uso de `application/platform-permissions.queries`.
 *
 * El nombre del ARGUMENTO (`permission_code`) es el contrato del backend y no cambia. La
 * función del backend ya resuelve por sí misma el privilegio del superadministrador
 * (`... OR is_platform_superadmin()`), de modo que aquí no se duplica ninguna regla de
 * autorización: sólo se pregunta.
 *
 * Los fallos se PROPAGAN tal cual; traducirlos a «sin permiso» es una decisión del caso
 * de uso, no del repositorio.
 */
export async function rpcHasPlatformPermission(permissionCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_platform_permission", {
    permission_code: permissionCode,
  })

  if (error) throw error
  return Boolean(data)
}
