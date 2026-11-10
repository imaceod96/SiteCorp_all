import { isSelfHostedModeActive, supabase } from "../../../lib/supabase"
import { rpcName, selectQuery, tableName } from "../../../integrations/supabase/schema-target"
import { avatarObjectPath } from "../domain/account.rules"
import type { User } from "@supabase/supabase-js"
import type { AuthMembershipRecord } from "../domain/entities"
import type { AuthUserIdentity } from "../domain/auth-provider.contracts"
import { getSharedSelfHostedAuthAdapter } from "./self-hosted-auth.adapter"

/**
 * Control de acceso — Repositorio de AUTENTICACIÓN Y SESIÓN (infraestructura).
 *
 * Único punto desde el que se habla con el proveedor de autenticación configurado (`supabase` o
 * `self_hosted`) y con las dos RPC que resuelven el nivel de plataforma.
 *
 * Política de errores:
 *   · LECTURAS de IDENTIDAD (`rpcIsPlatformSuperAdmin`, `rpcIsPlatformUser`,
 *     `selectActiveMemberships`): un fallo de red o de RPC se PROPAGA. «No se pudo
 *     determinar el privilegio» no es «no tiene el privilegio»: convertir un error en
 *     `false` o en una lista vacía degradaba al usuario a otra interfaz sin avisar.
 *     Quien decide qué hacer con el fallo es la capa de aplicación.
 *   · PERFIL del usuario: lectura tolerante (un fallo deja `null`), porque la ausencia de
 *     perfil no concede nada.
 *   · RPC de permisos: `has_platform_permission` propaga el fallo; la variante «segura»
 *     de la capa de aplicación lo traduce a «sin permiso».
 *   · COMANDOS (contraseña, cierre de sesión): propagan el error; la pantalla decide el
 *     mensaje que ve el usuario.
 */

/** Bucket PRIVADO de los avatares de usuario (`public = false`). */
const AVATARS_BUCKET = "avatars"

function mapSelfHostedIdentityToUser(identity: AuthUserIdentity): User {
  const nowIso = new Date().toISOString()
  return {
    id: identity.id,
    email: identity.email ?? undefined,
    created_at: identity.createdAt ?? nowIso,
    confirmed_at: identity.confirmedAt ?? nowIso,
    app_metadata: { provider: "self_hosted" },
    user_metadata: {},
    aud: "authenticated",
  } as User
}

/** Usuario de la sesión actual, o `null` si no hay sesión. */
export async function selectSessionUser(): Promise<User | null> {
  if (isSelfHostedModeActive()) {
    const session = await getSharedSelfHostedAuthAdapter().getSession()
    return session?.user ? mapSelfHostedIdentityToUser(session.user) : null
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.user ?? null
}

/**
 * Suscripción a los cambios de estado de Auth.
 *
 * El manejador recibe el evento y el USUARIO de la sesión (o `null`), y devuelve la función
 * para darse de baja. La interpretación de cada evento es de la presentación.
 */
export function subscribeAuthStateChanges(
  handler: (event: string, user: User | null) => void
): () => void {
  if (isSelfHostedModeActive()) {
    return getSharedSelfHostedAuthAdapter().subscribeToAuthChanges(({ event, session }) => {
      handler(event, session?.user ? mapSelfHostedIdentityToUser(session.user) : null)
    })
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session?.user ?? null)
  })

  return () => subscription.unsubscribe()
}

/**
 * Inicio de sesión con correo y contraseña.
 *
 * Devuelve el MENSAJE de error del servidor o `null` si la sesión se abrió. El texto es el
 * del backend, tal como lo mostraba la pantalla de acceso.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<string | null> {
  if (isSelfHostedModeActive()) {
    const result = await getSharedSelfHostedAuthAdapter().signInWithPassword({
      email,
      password,
    })
    return result.error
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  return signInError?.message ?? null
}

/** Cierre de la sesión actual. */
export async function signOut(): Promise<void> {
  if (isSelfHostedModeActive()) {
    await getSharedSelfHostedAuthAdapter().signOut()
    return
  }

  await supabase.auth.signOut()
}

/** Cambio de la contraseña del propio usuario autenticado. */
export async function updateOwnPassword(password: string): Promise<void> {
  if (isSelfHostedModeActive()) {
    const result = await getSharedSelfHostedAuthAdapter().updatePassword({
      newPassword: password,
    })
    if (!result.success) {
      throw new Error(result.error ?? "No se pudo actualizar la contraseña.")
    }
    return
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

/**
 * Cambio de la contraseña INICIAL mediante el servicio de ciclo de vida de contraseña.
 *
 * El cuerpo solo lleva la contraseña nueva: el `user_id` lo determina el servidor desde el
 * token verificado y la confirmación del ciclo de vida (`mark_password_changed`) la ejecuta la
 * propia función en el servidor. El cliente nunca invoca la RPC de confirmación.
 */
export async function invokeChangeInitialPassword(newPassword: string): Promise<void> {
  if (isSelfHostedModeActive()) {
    const adapter = getSharedSelfHostedAuthAdapter()
    const directResult = await adapter.updatePassword({ newPassword })
    if (directResult.success) {
      return
    }
  }

  const { data, error } = await supabase.functions.invoke("change-initial-password", {
    body: { new_password: newPassword },
  })

  if (error) throw error

  const result = data as { success?: boolean; error?: string } | null
  if (!result || result.success !== true) {
    throw new Error(result?.error ?? "No se pudo cambiar la contraseña.")
  }
}

/**
 * Sube el avatar del PROPIO usuario al bucket privado y devuelve la RUTA del objeto.
 *
 * Nunca devuelve una URL: el bucket es privado y la única URL válida es la firmada y temporal
 * que se resuelve al pintar. La ruta la compone el dominio (`<user_id>/<archivo>`), de modo que
 * un nombre de archivo con separadores no puede salir de la carpeta del usuario.
 *
 * `upsert: true` permite reemplazar el avatar anterior sin dejar objetos huérfanos con el
 * mismo nombre; las políticas de Storage siguen exigiendo que el titular esté activo.
 */
export async function uploadOwnAvatar(userId: string, file: File): Promise<string> {
  const filePath = avatarObjectPath(userId, file.name)

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, file, { contentType: file.type, upsert: true })
  if (uploadError) throw uploadError

  return filePath
}

/**
 * URL TEMPORAL (firmada) de un objeto de avatar, con su caducidad en milisegundos.
 * Devuelve `null` si Storage no pudo firmar (objeto ausente o sin permiso de lectura): la
 * interfaz cae entonces a las iniciales y nunca rompe la pantalla.
 */
export async function createAvatarSignedUrl(
  path: string,
  expiresInSeconds: number
): Promise<{ url: string; expiresAt: number } | null> {
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) return null

  return { url: data.signedUrl, expiresAt: Date.now() + expiresInSeconds * 1000 }
}

/** Retira un objeto de avatar (reemplazo del anterior o baja del avatar propio). */
export async function deleteAvatarObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([path])
  if (error) throw error
}

/**
 * Estado de superadministrador de plataforma (`is_platform_superadmin`).
 *
 * Un error de la RPC se propaga: no se traduce a `false` (eso convertiría un fallo de red
 * en «no eres superadministrador» y degradaría al usuario a otra interfaz).
 */
export async function rpcIsPlatformSuperAdmin(): Promise<boolean> {
  if (
    isSelfHostedModeActive() &&
    getSharedSelfHostedAuthAdapter().isMustChangePasswordRequired()
  ) {
    return false
  }
  const { data, error } = await supabase.rpc("is_platform_superadmin")
  if (error) throw error
  return Boolean(data)
}

/**
 * Nivel de usuario de plataforma (`is_platform_user`: al menos un rol activo).
 *
 * Un error de la RPC se propaga, por la misma razón que en el caso anterior.
 */
export async function rpcIsPlatformUser(): Promise<boolean> {
  if (
    isSelfHostedModeActive() &&
    getSharedSelfHostedAuthAdapter().isMustChangePasswordRequired()
  ) {
    return false
  }
  const { data, error } = await supabase.rpc("is_platform_user")
  if (error) throw error
  return Boolean(data)
}

/**
 * Membresías ACTIVAS de la sesión, con su cliente propietario.
 *
 * Un error de la consulta se propaga: una lista vacía por fallo de red no es «el usuario no
 * tiene membresías», y esa confusión decidía a qué interfaz pertenece el usuario.
 */
export async function selectActiveMemberships(userId: string): Promise<AuthMembershipRecord[]> {
  if (isSelfHostedModeActive()) {
    const adapter = getSharedSelfHostedAuthAdapter()
    if (adapter.isMustChangePasswordRequired()) {
      return []
    }
    const session = await adapter.getSession()
    const token = session?.accessToken ?? adapter.getAccessTokenSync()
    if (!token) {
      throw new Error("No hay una sesión autenticada activa para consultar membresías.")
    }

    const response = await fetch(`${adapter.getBaseUrl()}/api/v1/domain/me/access`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    })

    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as Record<string, any> | null
      throw new Error(
        json?.error?.message ?? `Error HTTP ${response.status} al consultar membresías activas.`
      )
    }

    const payload = (await response.json()) as {
      data?: {
        access?: {
          memberships?: Array<{
            companyClientId: string
            companyName: string
          }>
        }
      }
    }

    const memberships = payload?.data?.access?.memberships ?? []
    return memberships.map((m) => ({
      id: `${userId}:${m.companyClientId}`,
      tenant_id: m.companyClientId,
      user_id: userId,
      is_active: true,
      tenant: {
        id: m.companyClientId,
        name: m.companyName,
      },
    }))
  }

  const { data, error } = await supabase
    .from(tableName("memberships"))
    .select(selectQuery(`*, tenant:${tableName("clients")}(*)`))
    .eq("user_id", userId)
    .eq("is_active", true)

  if (error) throw error
  return (data as AuthMembershipRecord[] | null) ?? []
}

/**
 * Permiso de CLIENTE del solicitante (Nivel 2) mediante `has_tenant_permission`.
 *
 * El nombre del argumento (`permission_code`) es el contrato del backend y no cambia.
 * Propaga el fallo: la variante «segura» vive en la capa de aplicación.
 */
export async function rpcHasClientPermission(permissionCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(rpcName("hasClientPermission"), {
    permission_code: permissionCode,
  })
  if (error) throw error
  return Boolean(data)
}

