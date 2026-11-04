import { supabase } from "@/lib/supabase"
import { appConfig } from "@/shared/config/app-config"
import { rpcName, selectQuery, tableName } from "@/integrations/supabase/schema-target"
import { avatarObjectPath } from "../domain/account.rules"
import type { User } from "@supabase/supabase-js"
import type { AuthMembershipRecord } from "../domain/entities"

/**
 * Control de acceso — Repositorio de AUTENTICACIÓN Y SESIÓN NATIVA (infraestructura).
 *
 * Opera exclusivamente contra PostgreSQL (`public.profiles`, `public.user_credentials`,
 * `public.user_sessions`, `public.platform_user_roles`) mediante las funciones RPC:
 *   · `authenticate_user_credentials`
 *   · `validate_user_session`
 *   · `revoke_user_session`
 *   · `update_user_password_credentials`
 *   · `complete_initial_password_change`
 *
 * No depende de Supabase Auth (`auth.users` / GoTrue) ni almacena contraseñas o hashes en el
 * navegador.
 */

/** Bucket PRIVADO de los avatares de usuario (`public = false`). */
const AVATARS_BUCKET = appConfig.auth.avatarsBucket

/** Clave de almacenamiento local para el token de sesión propio en PostgreSQL (`public.user_sessions`). */
const CUSTOM_SESSION_STORAGE_KEY = appConfig.auth.sessionStorageKey

/** Clave de almacenamiento local para el JWT HS256 emitido opcionalmente por PostgreSQL. */
const CUSTOM_JWT_STORAGE_KEY = `${appConfig.auth.sessionStorageKey}_jwt`

/** Clave de almacenamiento local para los metadatos públicos de la sesión activa (sin secretos). */
const CUSTOM_SESSION_USER_STORAGE_KEY = `${appConfig.auth.sessionStorageKey}_user`

/** Metadatos verificados de la sesión activa en PostgreSQL (nunca incluye contraseñas ni hashes). */
export interface NativeSessionUserMetadata {
  userId: string
  email: string | null
  username: string | null
  fullName: string | null
  avatarUrl: string | null
  isActive: boolean
  mustChangePassword: boolean
  isPlatformSuperAdmin?: boolean
  isPlatformUser?: boolean
  expiresAt: string | null
}

/** Respuesta tipada de la RPC `public.authenticate_user_credentials`. */
interface AuthenticateCredentialsRpcRow {
  authenticated: boolean
  reason?: string | null
  message?: string | null
  session_token?: string | null
  access_token?: string | null
  expires_at?: string | null
  user_id?: string | null
  email?: string | null
  username?: string | null
  full_name?: string | null
  avatar_url?: string | null
  is_active?: boolean | null
  must_change_password?: boolean | null
  is_platform_superadmin?: boolean | null
  is_platform_user?: boolean | null
}

/** Respuesta tipada de la RPC `public.validate_user_session`. */
interface ValidateSessionRpcRow {
  valid: boolean
  reason?: string | null
  user_id?: string | null
  email?: string | null
  username?: string | null
  full_name?: string | null
  avatar_url?: string | null
  is_active?: boolean | null
  must_change_password?: boolean | null
  is_platform_superadmin?: boolean | null
  is_platform_user?: boolean | null
  access_token?: string | null
  expires_at?: string | null
}

type AuthStateListener = (event: string, user: User | null) => void

const authStateListeners = new Set<AuthStateListener>()
let inMemorySessionMeta: NativeSessionUserMetadata | null = null

function notifyAuthStateListeners(event: string, user: User | null): void {
  for (const listener of Array.from(authStateListeners)) {
    try {
      listener(event, user)
    } catch (err) {
      console.error("[auth] listener error:", err)
    }
  }
}

/** Comprueba si una marca temporal ISO ya expiró. */
export function isSessionExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  const parsed = Date.parse(expiresAt)
  if (Number.isNaN(parsed)) return false
  return parsed <= Date.now()
}

/** Construye un objeto `User` compatible con el contrato de la aplicación a partir de la sesión nativa. */
export function buildNativeSessionUser(meta: NativeSessionUserMetadata): User {
  const nowIso = new Date().toISOString()
  return {
    id: meta.userId,
    aud: "authenticated",
    role: "authenticated",
    email: meta.email ?? undefined,
    email_confirmed_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
    app_metadata: {
      provider: "sitecorp_postgres",
      providers: ["sitecorp_postgres"],
    },
    user_metadata: {
      username: meta.username ?? undefined,
      full_name: meta.fullName ?? undefined,
      avatar_url: meta.avatarUrl ?? undefined,
    },
  } as User
}

/** Obtiene el token de sesión propio (`public.user_sessions`) si existe en el navegador. */
export function getCustomSessionToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    const val = window.localStorage.getItem(CUSTOM_SESSION_STORAGE_KEY)
    return val && val.trim().length > 0 ? val.trim() : null
  } catch {
    return null
  }
}

/** Persiste o elimina el token de sesión propio en el navegador. */
export function setCustomSessionToken(token: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (token && token.trim().length > 0) {
      window.localStorage.setItem(CUSTOM_SESSION_STORAGE_KEY, token.trim())
    } else {
      window.localStorage.removeItem(CUSTOM_SESSION_STORAGE_KEY)
    }
  } catch {
    // Ignorar restricciones de almacenamiento privado
  }
}

/** Obtiene el JWT HS256 firmado por PostgreSQL si fue emitido para la sesión activa. */
export function getCustomJwtToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    const val = window.localStorage.getItem(CUSTOM_JWT_STORAGE_KEY)
    return val && val.trim().length > 0 ? val.trim() : null
  } catch {
    return null
  }
}

/** Persiste o elimina el JWT HS256 firmado por PostgreSQL. */
export function setCustomJwtToken(jwt: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (jwt && jwt.trim().length > 0) {
      window.localStorage.setItem(CUSTOM_JWT_STORAGE_KEY, jwt.trim())
    } else {
      window.localStorage.removeItem(CUSTOM_JWT_STORAGE_KEY)
    }
  } catch {
    // Ignorar restricciones de almacenamiento privado
  }
}

/** Lee los metadatos verificados de la sesión activa desde memoria o localStorage. */
export function getStoredSessionUserMetadata(): NativeSessionUserMetadata | null {
  if (inMemorySessionMeta) {
    if (isSessionExpired(inMemorySessionMeta.expiresAt)) {
      clearLocalSessionStorage()
      return null
    }
    return inMemorySessionMeta
  }

  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CUSTOM_SESSION_USER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as NativeSessionUserMetadata
    if (!parsed || typeof parsed.userId !== "string" || !parsed.userId.trim()) {
      return null
    }
    if (isSessionExpired(parsed.expiresAt)) {
      clearLocalSessionStorage()
      return null
    }
    inMemorySessionMeta = parsed
    return parsed
  } catch {
    return null
  }
}

/** Guarda o limpia los metadatos verificados de la sesión activa (nunca guarda contraseñas). */
export function setStoredSessionUserMetadata(meta: NativeSessionUserMetadata | null): void {
  inMemorySessionMeta = meta
  if (typeof window === "undefined") return
  try {
    if (meta) {
      window.localStorage.setItem(CUSTOM_SESSION_USER_STORAGE_KEY, JSON.stringify(meta))
    } else {
      window.localStorage.removeItem(CUSTOM_SESSION_USER_STORAGE_KEY)
    }
  } catch {
    // Ignorar restricciones de almacenamiento privado
  }
}

/** Limpia de forma atómica el token de sesión, el JWT opcional y los metadatos de usuario. */
export function clearLocalSessionStorage(): void {
  setCustomSessionToken(null)
  setCustomJwtToken(null)
  setStoredSessionUserMetadata(null)
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

/**
 * Valida el token de sesión actual contra PostgreSQL (`public.validate_user_session`)
 * y devuelve el usuario autenticado o `null` si no hay sesión o si expiró/fue revocada.
 */
export async function selectSessionUser(): Promise<User | null> {
  const customToken = getCustomSessionToken()
  if (!customToken) {
    setStoredSessionUserMetadata(null)
    setCustomJwtToken(null)
    return null
  }

  const cachedMeta = getStoredSessionUserMetadata()
  if (cachedMeta && isSessionExpired(cachedMeta.expiresAt)) {
    clearLocalSessionStorage()
    await supabase.rpc("revoke_user_session", { p_session_token: customToken }).catch(() => undefined)
    notifyAuthStateListeners("SIGNED_OUT", null)
    return null
  }

  const { data: validationData, error: validationError } = await supabase.rpc(
    "validate_user_session",
    { p_session_token: customToken }
  )

  if (!validationError && validationData) {
    const row = (
      Array.isArray(validationData) ? validationData[0] : validationData
    ) as ValidateSessionRpcRow | undefined

    if (!row || row.valid !== true || !row.user_id || row.is_active === false) {
      clearLocalSessionStorage()
      notifyAuthStateListeners("SIGNED_OUT", null)
      return null
    }

    if (isSessionExpired(row.expires_at)) {
      clearLocalSessionStorage()
      await supabase
        .rpc("revoke_user_session", { p_session_token: customToken })
        .catch(() => undefined)
      notifyAuthStateListeners("SIGNED_OUT", null)
      return null
    }

    const updatedMeta: NativeSessionUserMetadata = {
      userId: row.user_id,
      email: row.email ?? cachedMeta?.email ?? null,
      username: row.username ?? cachedMeta?.username ?? null,
      fullName: row.full_name ?? cachedMeta?.fullName ?? null,
      avatarUrl: row.avatar_url !== undefined ? row.avatar_url : (cachedMeta?.avatarUrl ?? null),
      isActive: row.is_active !== false,
      mustChangePassword: Boolean(row.must_change_password),
      isPlatformSuperAdmin:
        typeof row.is_platform_superadmin === "boolean"
          ? row.is_platform_superadmin
          : cachedMeta?.isPlatformSuperAdmin,
      isPlatformUser:
        typeof row.is_platform_user === "boolean"
          ? row.is_platform_user
          : cachedMeta?.isPlatformUser,
      expiresAt: row.expires_at ?? cachedMeta?.expiresAt ?? null,
    }

    setStoredSessionUserMetadata(updatedMeta)
    if (row.access_token) {
      setCustomJwtToken(row.access_token)
    }

    return buildNativeSessionUser(updatedMeta)
  }

  // Si hay un fallo transitorio de red pero existe sesión local vigente no expirada, mantenerla
  if (cachedMeta && !isSessionExpired(cachedMeta.expiresAt)) {
    return buildNativeSessionUser(cachedMeta)
  }

  return null
}

/**
 * Obtiene el usuario autenticado actual (usando la sesión nativa verificada en memoria/storage
 * o validándola contra PostgreSQL si aún no está cargada).
 */
export async function getCurrentAuthenticatedUser(): Promise<User | null> {
  const token = getCustomSessionToken()
  if (!token) return null

  const cached = getStoredSessionUserMetadata()
  if (cached && !isSessionExpired(cached.expiresAt)) {
    return buildNativeSessionUser(cached)
  }

  return selectSessionUser()
}

/** Obtiene el UUID del usuario autenticado en la sesión nativa actual, o `null`. */
export async function getCurrentAuthenticatedUserId(): Promise<string | null> {
  const user = await getCurrentAuthenticatedUser()
  return user?.id ?? null
}

/**
 * Suscripción a los cambios de estado de la sesión nativa.
 *
 * Escucha eventos internos (`SIGNED_IN`, `SIGNED_OUT`, `USER_UPDATED`), sincronización entre
 * pestañas (`storage`) y revalidación al recuperar el foco de la ventana.
 */
export function subscribeAuthStateChanges(
  handler: (event: string, user: User | null) => void
): () => void {
  authStateListeners.add(handler)

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== CUSTOM_SESSION_STORAGE_KEY) return
    const newToken = event.newValue?.trim() || null
    if (!newToken) {
      setStoredSessionUserMetadata(null)
      setCustomJwtToken(null)
      handler("SIGNED_OUT", null)
    } else {
      void selectSessionUser().then((user) => {
        if (user) {
          handler("SIGNED_IN", user)
        } else {
          handler("SIGNED_OUT", null)
        }
      })
    }
  }

  const handleWindowFocus = () => {
    const token = getCustomSessionToken()
    if (!token) return
    const meta = getStoredSessionUserMetadata()
    if (meta && isSessionExpired(meta.expiresAt)) {
      clearLocalSessionStorage()
      void supabase.rpc("revoke_user_session", { p_session_token: token }).catch(() => undefined)
      notifyAuthStateListeners("SIGNED_OUT", null)
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageEvent)
    window.addEventListener("focus", handleWindowFocus)
  }

  return () => {
    authStateListeners.delete(handler)
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorageEvent)
      window.removeEventListener("focus", handleWindowFocus)
    }
  }
}

/**
 * Inicio de sesión 100 % nativo en PostgreSQL con identificador (correo electrónico o
 * nombre de usuario `username`) y contraseña.
 *
 * Valida contra `public.user_credentials` + `public.profiles` mediante la RPC
 * `authenticate_user_credentials` (`SECURITY DEFINER` con `pgcrypto`), aplica control de
 * bloqueo temporal, persiste el token de sesión en `public.user_sessions` y publica el
 * evento `SIGNED_IN` al contexto global de la aplicación.
 */
export async function signInWithPassword(
  identifier: string,
  password: string
): Promise<string | null> {
  const cleanIdentifier = identifier.trim()
  if (!cleanIdentifier) {
    return "Debes ingresar tu correo electrónico o nombre de usuario."
  }
  if (!password) {
    return "Debes ingresar tu contraseña."
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

  if (rpcError) {
    clearLocalSessionStorage()
    return rpcError.message || "No se pudo verificar tus credenciales."
  }

  const authResult = (
    Array.isArray(rpcData) ? rpcData[0] : rpcData
  ) as AuthenticateCredentialsRpcRow | undefined

  if (!authResult || !authResult.authenticated || !authResult.user_id || !authResult.session_token) {
    clearLocalSessionStorage()
    return authResult?.message ?? "Credenciales inválidas."
  }

  const sessionMeta: NativeSessionUserMetadata = {
    userId: authResult.user_id,
    email: authResult.email?.trim() || null,
    username: authResult.username?.trim() || null,
    fullName: authResult.full_name?.trim() || null,
    avatarUrl: authResult.avatar_url ?? null,
    isActive: authResult.is_active !== false,
    mustChangePassword: Boolean(authResult.must_change_password),
    isPlatformSuperAdmin:
      typeof authResult.is_platform_superadmin === "boolean"
        ? authResult.is_platform_superadmin
        : undefined,
    isPlatformUser:
      typeof authResult.is_platform_user === "boolean"
        ? authResult.is_platform_user
        : undefined,
    expiresAt: authResult.expires_at ?? null,
  }

  setCustomSessionToken(authResult.session_token)
  setCustomJwtToken(authResult.access_token ?? null)
  setStoredSessionUserMetadata(sessionMeta)

  const nativeUser = buildNativeSessionUser(sessionMeta)
  notifyAuthStateListeners("SIGNED_IN", nativeUser)

  return null
}

/** Cierre de la sesión actual (revoca la sesión en `public.user_sessions` y limpia el estado local). */
export async function signOut(): Promise<void> {
  const customToken = getCustomSessionToken()
  clearLocalSessionStorage()
  notifyAuthStateListeners("SIGNED_OUT", null)

  if (customToken) {
    await supabase
      .rpc("revoke_user_session", { p_session_token: customToken })
      .catch(() => undefined)
  }
}

/** Cambio de la contraseña del propio usuario autenticado en `public.user_credentials`. */
export async function updateOwnPassword(password: string): Promise<void> {
  const sessionToken = getCustomSessionToken()
  const sessionMeta = getStoredSessionUserMetadata()
  const userId = sessionMeta?.userId ?? null

  const { error: rpcError3 } = await supabase.rpc("update_user_password_credentials", {
    p_user_id: userId,
    p_new_password: password,
    p_session_token: sessionToken,
  })

  if (rpcError3) {
    if (isMissingRpcError(rpcError3)) {
      const { error: rpcError2 } = await supabase.rpc("update_user_password_credentials", {
        p_user_id: userId,
        p_new_password: password,
      })
      if (rpcError2) throw rpcError2
    } else {
      throw rpcError3
    }
  }

  if (sessionMeta) {
    setStoredSessionUserMetadata({
      ...sessionMeta,
      mustChangePassword: false,
    })
  }
}

/**
 * Cambio de la contraseña INICIAL:
 *   1. Ejecuta la RPC nativa de PostgreSQL `complete_initial_password_change` (`SECURITY DEFINER`
 *      con `pgcrypto`), que actualiza el hash bcrypt y confirma el ciclo de vida directamente en
 *      PostgreSQL sin depender de Supabase Auth.
 *   2. Si la RPC aún no está aplicada, recurre a la Edge Function `change-initial-password`
 *      enviando la cabecera de sesión propia.
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

    const currentMeta = getStoredSessionUserMetadata()
    if (currentMeta) {
      setStoredSessionUserMetadata({
        ...currentMeta,
        mustChangePassword: false,
      })
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

  const currentMeta = getStoredSessionUserMetadata()
  if (currentMeta) {
    setStoredSessionUserMetadata({
      ...currentMeta,
      mustChangePassword: false,
    })
  }
}

/**
 * Sube el avatar del PROPIO usuario al bucket privado y devuelve la RUTA del objeto.
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
 */
export async function rpcIsPlatformSuperAdmin(): Promise<boolean> {
  const cachedMeta = getStoredSessionUserMetadata()
  const { data, error } = await supabase.rpc("is_platform_superadmin")

  if (!error) {
    const rpcFlag = Boolean(data)
    if (rpcFlag) return true
    if (typeof cachedMeta?.isPlatformSuperAdmin === "boolean") {
      return cachedMeta.isPlatformSuperAdmin
    }
    return false
  }

  if (typeof cachedMeta?.isPlatformSuperAdmin === "boolean") {
    return cachedMeta.isPlatformSuperAdmin
  }

  throw error
}

/**
 * Nivel de usuario de plataforma (`is_platform_user`: al menos un rol activo).
 */
export async function rpcIsPlatformUser(): Promise<boolean> {
  const cachedMeta = getStoredSessionUserMetadata()
  const { data, error } = await supabase.rpc("is_platform_user")

  if (!error) {
    const rpcFlag = Boolean(data)
    if (rpcFlag) return true
    if (typeof cachedMeta?.isPlatformUser === "boolean") {
      return cachedMeta.isPlatformUser
    }
    return false
  }

  if (typeof cachedMeta?.isPlatformUser === "boolean") {
    return cachedMeta.isPlatformUser
  }

  throw error
}

/**
 * Membresías ACTIVAS de la sesión, con su cliente propietario.
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
 * Permiso de CLIENTE del solicitante (Nivel 2) mediante `has_tenant_permission` / `has_company_client_permission`.
 */
export async function rpcHasClientPermission(permissionCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(rpcName("hasClientPermission"), {
    permission_code: permissionCode,
  })
  if (error) throw error
  return Boolean(data)
}
