import { supabase } from "@/lib/supabase"
import { appConfig } from "@/shared/config/app-config"
import { rpcName, selectQuery, tableName } from "@/integrations/supabase/schema-target"
import { avatarObjectPath } from "../domain/account.rules"
import type { User } from "@supabase/supabase-js"
import type { AuthMembershipRecord } from "../domain/entities"

/**
 * Control de acceso — Repositorio de AUTENTICACIÓN Y SESIÓN (infraestructura).
 *
 * Único punto desde el que se habla con el motor de autenticación y con las RPC que resuelven el
 * nivel de plataforma.
 */

/** Bucket PRIVADO de los avatares de usuario (`public = false`). */
const AVATARS_BUCKET = appConfig.auth.avatarsBucket

/** Clave de almacenamiento local para el token de sesión propio en PostgreSQL (`public.user_sessions`). */
const CUSTOM_SESSION_STORAGE_KEY = appConfig.auth.sessionStorageKey

/** Respuesta tipada de la RPC `public.authenticate_user_credentials`. */
interface AuthenticateCredentialsRpcRow {
  authenticated: boolean
  message: string | null
  session_token: string | null
  expires_at: string | null
  user_id: string | null
  email: string | null
  username: string | null
  full_name: string | null
  must_change_password: boolean | null
}

/** Respuesta tipada de la RPC `public.validate_user_session`. */
interface ValidateSessionRpcRow {
  valid: boolean
  user_id: string | null
  email: string | null
  username: string | null
  full_name: string | null
  must_change_password: boolean | null
  expires_at: string | null
}

/** Obtiene el token de sesión propio (`public.user_sessions`) si existe en el navegador. */
export function getCustomSessionToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(CUSTOM_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Persiste o elimina el token de sesión propio en el navegador. */
export function setCustomSessionToken(token: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (token) {
      window.localStorage.setItem(CUSTOM_SESSION_STORAGE_KEY, token)
    } else {
      window.localStorage.removeItem(CUSTOM_SESSION_STORAGE_KEY)
    }
  } catch {
    // Ignorar restricciones de almacenamiento privado
  }
}

/** Cabeceras adicionales con el token de sesión propio para invocaciones a funciones de servidor. */
export function buildCustomSessionHeaders(): Record<string, string> {
  const token = getCustomSessionToken()
  return token ? { [appConfig.auth.sessionHeaderName]: token } : {}
}

/** Indica si un error de PostgREST corresponde a una función RPC aún no desplegada en la BD. */
function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    Boolean(error.message?.includes("Could not find the function"))
  )
}

/** Usuario de la sesión actual, o `null` si no hay sesión. */
export async function selectSessionUser() {
  const customToken = getCustomSessionToken()
  if (customToken) {
    const { data: validationData, error: validationError } = await supabase.rpc(
      "validate_user_session",
      { p_session_token: customToken }
    )

    if (!validationError && validationData) {
      const row = (
        Array.isArray(validationData) ? validationData[0] : validationData
      ) as ValidateSessionRpcRow | undefined

      if (row && row.valid === false) {
        setCustomSessionToken(null)
        await supabase.auth.signOut().catch(() => undefined)
        return null
      }
    } else if (validationError && !isMissingRpcError(validationError)) {
      // Si hay un fallo transitorio de red no cerramos la sesión local
    }
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
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      setCustomSessionToken(null)
    }
    handler(event, session?.user ?? null)
  })

  return () => subscription.unsubscribe()
}

/**
 * Inicio de sesión con identificador (correo electrónico o nombre de usuario) y contraseña.
 *
 * 1. Valida primero contra `public.user_credentials` + `public.profiles` mediante la RPC
 *    `authenticate_user_credentials` (`SECURITY DEFINER` con `pgcrypto`), lo que permite iniciar
 *    sesión tanto por **correo electrónico** como por **nombre de usuario (`username`)**, aplica
 *    control de bloqueo temporal y emite una sesión propia en `public.user_sessions`.
 * 2. Con el correo canónico devuelto por PostgreSQL, sincroniza la sesión JWT de PostgREST /
 *    Storage para que todas las políticas RLS (`auth.uid()`) y el bucket privado `avatars`
 *    sigan funcionando sin regresiones.
 */
export async function signInWithPassword(
  identifier: string,
  password: string
): Promise<string | null> {
  const cleanIdentifier = identifier.trim()
  if (!cleanIdentifier) {
    return "Debes ingresar tu correo electrónico o nombre de usuario."
  }

  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "authenticate_user_credentials",
    {
      p_identifier: cleanIdentifier,
      p_password: password,
      p_user_agent: userAgent,
      p_ip_address: null,
    }
  )

  if (!rpcError && rpcData) {
    const authResult = (
      Array.isArray(rpcData) ? rpcData[0] : rpcData
    ) as AuthenticateCredentialsRpcRow | undefined

    if (!authResult || !authResult.authenticated) {
      setCustomSessionToken(null)
      return authResult?.message ?? "Credenciales inválidas."
    }

    if (authResult.session_token) {
      setCustomSessionToken(authResult.session_token)
    }

    const resolvedEmail = authResult.email?.trim() || cleanIdentifier
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    })

    if (signInError) {
      return signInError.message
    }

    return null
  }

  if (rpcError && !isMissingRpcError(rpcError)) {
    return rpcError.message
  }

  // Respaldo de compatibilidad si la migración SQL aún no se ha aplicado en el entorno
  const { error: fallbackError } = await supabase.auth.signInWithPassword({
    email: cleanIdentifier,
    password,
  })
  return fallbackError?.message ?? null
}

/** Cierre de la sesión actual (revoca la sesión en `public.user_sessions` y cierra el JWT local). */
export async function signOut(): Promise<void> {
  const customToken = getCustomSessionToken()
  setCustomSessionToken(null)

  if (customToken) {
    await supabase
      .rpc("revoke_user_session", { p_session_token: customToken })
      .catch(() => undefined)
  }

  await supabase.auth.signOut()
}

/** Cambio de la contraseña del propio usuario autenticado en `public.user_credentials` y Auth. */
export async function updateOwnPassword(password: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc("update_user_password_credentials", {
    p_user_id: null,
    p_new_password: password,
  })

  if (rpcError && !isMissingRpcError(rpcError)) {
    throw rpcError
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

/**
 * Cambio de la contraseña INICIAL:
 *   1. Prioriza la RPC nativa de PostgreSQL `complete_initial_password_change` (`SECURITY DEFINER`
 *      con `pgcrypto`), que actualiza el hash bcrypt y confirma el ciclo de vida directamente en
 *      PostgreSQL sin depender de Edge Functions ni de `SUPABASE_SERVICE_ROLE_KEY`.
 *   2. Si la RPC aún no se ha aplicado en la base de datos, recurre como respaldo a la Edge Function
 *      `change-initial-password`.
 */
export async function invokeChangeInitialPassword(newPassword: string): Promise<void> {
  const sessionToken = getCustomSessionToken()

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "complete_initial_password_change",
    {
      p_new_password: newPassword,
      p_session_token: sessionToken,
    }
  )

  if (!rpcError && rpcData) {
    const rpcResult = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
      | { success?: boolean; error?: string }
      | undefined
    if (!rpcResult || rpcResult.success !== true) {
      throw new Error(rpcResult?.error ?? "No se pudo cambiar la contraseña.")
    }
    return
  }

  if (rpcError && !isMissingRpcError(rpcError)) {
    throw new Error(rpcError.message || "No se pudo cambiar la contraseña.")
  }

  const { data, error } = await supabase.functions.invoke("change-initial-password", {
    body: { new_password: newPassword },
    headers: buildCustomSessionHeaders(),
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
    throw new Error(backendMessage || error.message || "No se pudo cambiar la contraseña.")
  }

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
