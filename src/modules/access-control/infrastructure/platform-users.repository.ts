import { supabase } from "@/lib/supabase"
import type {
  CreatePlatformUserInput,
  PlatformRole,
  PlatformUserRoleRow,
} from "../domain/entities"

/**
 * Control de acceso — Repositorio de ADMINISTRACIÓN DE PLATAFORMA (infraestructura).
 *
 * Único punto que consulta y escribe el nivel 1 de SiteCorp: los roles de plataforma
 * (`platform_roles`), sus asignaciones (`platform_user_roles`) y el alta de usuarios, que NO
 * se hace con contraseña desde el cliente sino mediante la Edge Function
 * `create-sitecorp-user` (su contrato de cuerpo no cambia).
 *
 * Los privilegios NO se modifican: RLS y las comprobaciones del backend siguen decidiendo
 * quién puede leer o escribir cada fila; aquí sólo se envían las mismas consultas de antes.
 */

/** Roles de plataforma asignados a un usuario, con el rol embebido. */
export async function selectPlatformUserRoles(userId: string): Promise<PlatformUserRoleRow[]> {
  const { data } = await supabase
    .from("platform_user_roles")
    .select("platform_role_id, platform_roles(name, is_system_role)")
    .eq("user_id", userId)

  return (data as PlatformUserRoleRow[] | null) || []
}

/** Catálogo de roles de plataforma ACTIVOS, por nombre. */
export async function selectActivePlatformRoles(): Promise<PlatformRole[]> {
  const { data, error } = await supabase
    .from("platform_roles")
    .select("*")
    .eq("is_active", true)
    .order("name")

  if (error) throw error
  return (data as PlatformRole[] | null) || []
}

/**
 * Asignación de un rol de plataforma.
 *
 * No se comprueba aquí la duplicidad: la restricción única del backend es la que la impide,
 * y su error se propaga tal cual.
 */
export async function insertPlatformUserRole(userId: string, roleId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_user_roles")
    .insert({ user_id: userId, platform_role_id: roleId })

  if (error) throw error
}

/** Retirada de un rol de plataforma de un usuario. */
export async function deletePlatformUserRole(userId: string, roleId: string): Promise<void> {
  const { error } = await supabase
    .from("platform_user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("platform_role_id", roleId)

  if (error) throw error
}

/**
 * Alta de un usuario de plataforma mediante la Edge Function `create-sitecorp-user`.
 *
 * El cuerpo conserva EXACTAMENTE las claves del contrato del backend (nombre completo,
 * nombre de usuario, correo, contraseña temporal, estado y rol de plataforma): la función es
 * la que crea el usuario en `auth.users` con privilegios elevados, y el cliente nunca los
 * tiene.
 */
export async function invokeCreatePlatformUser(
  input: CreatePlatformUserInput
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("create-sitecorp-user", {
    body: {
      full_name: input.fullName,
      username: input.username,
      email: input.email,
      password: input.password,
      is_active: input.isActive,
      platform_role_id: input.platformRoleId,
    },
  })

  if (error) throw error
  if (!data) throw new Error("Respuesta vacía del servidor")
}
