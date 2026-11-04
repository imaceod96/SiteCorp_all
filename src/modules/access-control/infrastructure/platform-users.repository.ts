import { supabase } from "@/lib/supabase"
import { buildCustomSessionHeaders } from "./authentication.repository"
import { saveStoredPlatformUserEmail } from "./user-profiles.repository"
import type {
  CreatedPlatformUser,
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
 * Alta de un usuario de plataforma:
 *   1. Prioriza la RPC nativa de PostgreSQL `create_platform_user_with_credentials` (`SECURITY DEFINER`
 *      con `pgcrypto`), que genera la contraseña inicial CSPRNG de 24 caracteres directamente en
 *      PostgreSQL sin depender de Edge Functions ni de `SUPABASE_SERVICE_ROLE_KEY`.
 *   2. Si la RPC aún no se ha aplicado en la base de datos, recurre como respaldo a la Edge Function
 *      `create-sitecorp-user`.
 *
 * Devuelve la CONTRASEÑA INICIAL generada, que viaja UNA SOLA VEZ en la respuesta y nunca se
 * persiste en el cliente.
 */
export async function invokeCreatePlatformUser(
  input: CreatePlatformUserInput
): Promise<CreatedPlatformUser> {
  const customHeaders = buildCustomSessionHeaders()
  const sessionToken = Object.values(customHeaders)[0] ?? null

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "create_platform_user_with_credentials",
    {
      p_full_name: input.fullName,
      p_username: input.username,
      p_email: input.email,
      p_platform_role_id: input.platformRoleId,
      p_is_active: input.isActive,
      p_session_token: sessionToken,
    }
  )

  if (!rpcError && rpcData) {
    const createdRpc = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
      user_id: string
      email: string
      username: string
      full_name: string
      platform_role_id: string | null
      initial_password?: string
    }

    if (!createdRpc?.initial_password) {
      throw new Error("El servidor no devolvió la contraseña inicial del usuario.")
    }

    saveStoredPlatformUserEmail(createdRpc.user_id, createdRpc.email || input.email)

    return {
      userId: createdRpc.user_id,
      email: createdRpc.email,
      username: createdRpc.username,
      fullName: createdRpc.full_name,
      platformRoleId: createdRpc.platform_role_id ?? null,
      initialPassword: createdRpc.initial_password,
    }
  }

  const isMissingRpc =
    rpcError?.code === "42883" ||
    rpcError?.code === "PGRST202" ||
    Boolean(rpcError?.message?.includes("Could not find the function"))

  if (rpcError && !isMissingRpc) {
    throw new Error(rpcError.message || "No se pudo crear el usuario.")
  }

  const { data, error } = await supabase.functions.invoke("create-sitecorp-user", {
    body: {
      full_name: input.fullName,
      username: input.username,
      email: input.email,
      is_active: input.isActive,
      platform_role_id: input.platformRoleId,
    },
    headers: customHeaders,
  })

  if (error) {
    let backendMessage: string | null = null
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: string } | null
        backendMessage = body?.error ?? null
      } catch {
        backendMessage = null
      }
    }
    throw new Error(
      backendMessage ||
        error.message ||
        "No se pudo crear el usuario (verifica haber ejecutado la migración SQL completa)."
    )
  }
  if (!data) throw new Error("Respuesta vacía del servidor")

  const created = data as {
    user_id: string
    email: string
    username: string
    full_name: string
    platform_role_id: string | null
    initial_password?: string
    error?: string
  }

  if (created.error) {
    throw new Error(created.error)
  }

  if (!created.initial_password) {
    throw new Error("El servidor no devolvió la contraseña inicial del usuario.")
  }

  saveStoredPlatformUserEmail(created.user_id, created.email || input.email)

  return {
    userId: created.user_id,
    email: created.email,
    username: created.username,
    fullName: created.full_name,
    platformRoleId: created.platform_role_id ?? null,
    initialPassword: created.initial_password,
  }
}

/**
 * ELIMINACIÓN definitiva de un usuario de plataforma mediante la Edge Function
 * `delete-platform-user`.
 *
 * El borrado de una cuenta exige privilegios de administrador que el navegador
 * NUNCA tiene: la única vía es esta función, que revalida el rol del llamante, impide
 * borrar la propia cuenta o la última de SuperAdmin y conserva el historial.
 *
 * El servidor exige la confirmación del `username` exacto: un error de la interfaz no puede
 * provocar un borrado por accidente.
 */
export async function invokeDeletePlatformUser(input: {
  userId: string
  confirmUsername: string
}): Promise<void> {
  const customHeaders = buildCustomSessionHeaders()
  const sessionToken = Object.values(customHeaders)[0] ?? null

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "delete_platform_user_account",
    {
      p_target_user_id: input.userId,
      p_confirm_username: input.confirmUsername,
      p_session_token: sessionToken,
    }
  )

  if (!rpcError && rpcData) {
    const rpcResult = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
      deleted?: boolean
      error?: string
    } | null
    if (rpcResult?.deleted === true) {
      return
    }
    if (rpcResult?.error) {
      throw new Error(rpcResult.error)
    }
  }

  const isMissingRpc =
    rpcError?.code === "42883" ||
    rpcError?.code === "PGRST202" ||
    Boolean(rpcError?.message?.includes("Could not find the function"))

  if (rpcError && !isMissingRpc) {
    throw new Error(rpcError.message || "No se pudo eliminar el usuario.")
  }

  const { data, error } = await supabase.functions.invoke("delete-platform-user", {
    body: {
      user_id: input.userId,
      confirm_username: input.confirmUsername,
    },
    headers: customHeaders,
  })

  if (error) {
    let backendMessage: string | null = null
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: string } | null
        backendMessage = body?.error ?? null
      } catch {
        backendMessage = null
      }
    }

    throw new Error(backendMessage || error.message || "No se pudo eliminar el usuario.")
  }

  const failure = (data as { error?: string } | null)?.error
  if (failure) throw new Error(failure)
}
