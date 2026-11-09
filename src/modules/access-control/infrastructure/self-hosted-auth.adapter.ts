import type {
  AuthPasswordRecoveryInput,
  AuthPasswordRecoveryResult,
  AuthSession,
  AuthSignInCredentials,
  AuthSignInResult,
  AuthStateChangeEvent,
  AuthUpdatePasswordInput,
  AuthUpdatePasswordResult,
  AuthUserIdentity,
  IAuthenticationProvider,
} from "../domain/auth-provider.contracts"

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SelfHostedAuthAdapterOptions {
  baseUrl?: string
  fetchFn?: typeof fetch
  storage?: StorageLike
}

interface ApiUserResponse {
  id: string
  email: string
  status: string
  mustChangePassword?: boolean
  createdAt: string
  updatedAt: string
}

interface ApiLoginResponse {
  data: {
    accessToken: string
    tokenType: string
    expiresInSeconds: number
    mustChangePassword: boolean
    csrfToken: string | null
    user: ApiUserResponse
  }
  meta: {
    requestId: string
    timestamp: string
  }
}

interface ApiRefreshResponse {
  data: {
    accessToken: string
    tokenType: string
    expiresInSeconds: number
    csrfToken: string
    user: ApiUserResponse
  }
  meta: {
    requestId: string
    timestamp: string
  }
}

interface ApiMeResponse {
  data: {
    user: ApiUserResponse
    session: {
      id: string
      createdAt: string
    }
  }
  meta: {
    requestId: string
    timestamp: string
  }
}

const STORAGE_SESSION_KEY = "sitecorp_self_hosted_session"
const STORAGE_CSRF_KEY = "sitecorp_self_hosted_csrf"

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

/**
 * Adaptador de infraestructura que implementa IAuthenticationProvider contra el
 * backend propio Node.js/Fastify de SiteCorp.
 *
 * Características:
 * - Comunicación vía endpoints HTTP REST (/api/v1/auth/*).
 * - Soporte para sesión híbrida (access token en memoria/Bearer, refresh token en cookie HttpOnly).
 * - Detección y soporte transparente del flujo de activación obligatoria para usuarios migrados (mustChangePassword).
 * - Totalmente testeable mediante inyección de `fetchFn` y `storage`.
 */
export class SelfHostedAuthAdapter implements IAuthenticationProvider {
  private readonly baseUrl: string
  private readonly fetch: typeof fetch
  private readonly storage: StorageLike
  private readonly listeners = new Set<(event: AuthStateChangeEvent) => void>()
  private currentSession: AuthSession | null = null
  private currentCsrfToken: string | null = null
  private pendingActivationPassword: string | null = null

  constructor(options: SelfHostedAuthAdapterOptions = {}) {
    const win = (
      globalThis as unknown as {
        window?: { __SITECORP_AUTH_URL__?: string; sessionStorage?: StorageLike }
      }
    ).window
    const defaultBaseUrl = win?.__SITECORP_AUTH_URL__
      ? win.__SITECORP_AUTH_URL__
      : "http://127.0.0.1:4010"

    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "")
    this.fetch =
      options.fetchFn ??
      (typeof fetch !== "undefined"
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch))

    if (options.storage) {
      this.storage = options.storage
    } else if (win?.sessionStorage) {
      this.storage = win.sessionStorage
    } else {
      this.storage = new MemoryStorage()
    }

    this.loadPersistedSession()
  }

  private loadPersistedSession(): void {
    try {
      const raw = this.storage.getItem(STORAGE_SESSION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AuthSession
        if (parsed && parsed.accessToken && parsed.user?.id) {
          this.currentSession = parsed
          this.currentCsrfToken = this.storage.getItem(STORAGE_CSRF_KEY)
        }
      }
    } catch {
      this.storage.removeItem(STORAGE_SESSION_KEY)
      this.storage.removeItem(STORAGE_CSRF_KEY)
    }
  }

  private persistSession(session: AuthSession | null, csrfToken?: string | null): void {
    this.currentSession = session
    if (csrfToken !== undefined) {
      this.currentCsrfToken = csrfToken
    }

    if (session) {
      try {
        this.storage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session))
        if (this.currentCsrfToken) {
          this.storage.setItem(STORAGE_CSRF_KEY, this.currentCsrfToken)
        }
      } catch {
        // En caso de cuotas de almacenamiento excedidas, la sesión se mantiene en memoria
      }
    } else {
      this.storage.removeItem(STORAGE_SESSION_KEY)
      this.storage.removeItem(STORAGE_CSRF_KEY)
      this.pendingActivationPassword = null
    }
  }

  private emitStateChange(event: AuthStateChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Los errores de los oyentes no deben abortar la cadena
      }
    }
  }

  private mapUserResponseToIdentity(user: ApiUserResponse): AuthUserIdentity {
    return {
      id: user.id,
      email: user.email,
      confirmedAt: user.status === "ACTIVE" ? user.updatedAt : null,
      createdAt: user.createdAt,
    }
  }

  async getSession(): Promise<AuthSession | null> {
    if (this.currentSession) {
      // Si la sesión no ha expirado (con margen de 30 segundos), la devolvemos
      if (!this.currentSession.expiresAt || this.currentSession.expiresAt > Math.floor(Date.now() / 1000) + 30) {
        return this.currentSession
      }
    }

    // Intentamos refrescar la sesión contra el endpoint propio
    const refreshed = await this.refreshToken()
    if (refreshed) {
      return refreshed
    }

    return this.currentSession
  }

  async signInWithPassword(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email: credentials.email.trim().toLowerCase(),
          password: credentials.password,
        }),
      })

      const json = (await response.json().catch(() => null)) as Record<string, any> | null

      if (!response.ok) {
        const errorMessage =
          json?.error?.message ??
          (response.status === 401
            ? "Credenciales incorrectas o usuario no encontrado"
            : response.status === 403
            ? "Acceso no autorizado o cuenta inactiva"
            : response.status === 423
            ? "Cuenta temporalmente bloqueada por exceso de intentos fallidos"
            : "Error al iniciar sesión en el servidor")

        return {
          session: null,
          error: errorMessage,
        }
      }

      const loginData = json as ApiLoginResponse
      if (!loginData?.data?.accessToken || !loginData?.data?.user) {
        return {
          session: null,
          error: "Respuesta inválida del servidor de autenticación propio",
        }
      }

      const { accessToken, expiresInSeconds, mustChangePassword, csrfToken, user } = loginData.data

      const session: AuthSession = {
        accessToken,
        expiresAt: expiresInSeconds ? Math.floor(Date.now() / 1000) + expiresInSeconds : undefined,
        user: this.mapUserResponseToIdentity(user),
      }

      // Para usuarios migrados con cambio obligatorio de contraseña, guardamos temporalmente
      // la credencial en memoria para permitir su activación automática en updatePassword.
      if (mustChangePassword) {
        this.pendingActivationPassword = credentials.password
      } else {
        this.pendingActivationPassword = null
      }

      this.persistSession(session, csrfToken)

      this.emitStateChange({
        event: mustChangePassword ? "PASSWORD_RECOVERY" : "SIGNED_IN",
        session,
      })

      return {
        session,
        error: null,
      }
    } catch (err) {
      return {
        session: null,
        error: err instanceof Error ? err.message : "Error de conexión con el backend de autenticación",
      }
    }
  }

  async signOut(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      }

      if (this.currentSession?.accessToken) {
        headers.Authorization = `Bearer ${this.currentSession.accessToken}`
      }
      if (this.currentCsrfToken) {
        headers["x-csrf-token"] = this.currentCsrfToken
      }

      await this.fetch(`${this.baseUrl}/api/v1/auth/logout`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ allDevices: false }),
      }).catch(() => undefined)
    } finally {
      this.persistSession(null, null)
      this.emitStateChange({
        event: "SIGNED_OUT",
        session: null,
      })
    }
  }

  async refreshToken(): Promise<AuthSession | null> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      }
      if (this.currentCsrfToken) {
        headers["x-csrf-token"] = this.currentCsrfToken
      }

      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.persistSession(null, null)
          this.emitStateChange({
            event: "SIGNED_OUT",
            session: null,
          })
        }
        return null
      }

      const refreshData = (await response.json()) as ApiRefreshResponse
      if (!refreshData?.data?.accessToken) {
        return null
      }

      const { accessToken, expiresInSeconds, csrfToken, user } = refreshData.data

      let resolvedIdentity: AuthUserIdentity | null = user
        ? this.mapUserResponseToIdentity(user)
        : this.currentSession?.user ?? null

      if (!resolvedIdentity) {
        const meRes = await this.fetch(`${this.baseUrl}/api/v1/auth/me`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: "include",
        }).catch(() => null)
        if (meRes && meRes.ok) {
          const meJson = (await meRes.json().catch(() => null)) as ApiMeResponse | null
          if (meJson?.data?.user) {
            resolvedIdentity = this.mapUserResponseToIdentity(meJson.data.user)
          }
        }
      }

      if (!resolvedIdentity) {
        return null
      }

      const session: AuthSession = {
        accessToken,
        expiresAt: expiresInSeconds ? Math.floor(Date.now() / 1000) + expiresInSeconds : undefined,
        user: resolvedIdentity,
      }

      this.persistSession(session, csrfToken)

      this.emitStateChange({
        event: "TOKEN_REFRESHED",
        session,
      })

      return session
    } catch {
      return null
    }
  }

  async updatePassword(
    input: AuthUpdatePasswordInput & { currentPassword?: string }
  ): Promise<AuthUpdatePasswordResult> {
    try {
      const session = await this.getSession()
      if (!session?.accessToken) {
        return {
          success: false,
          error: "No hay una sesión activa para cambiar la contraseña",
        }
      }

      const currentPassword = input.currentPassword ?? this.pendingActivationPassword
      if (!currentPassword) {
        return {
          success: false,
          error: "Se requiere la contraseña actual o provisional para completar el cambio",
        }
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      }

      if (this.currentCsrfToken) {
        headers["x-csrf-token"] = this.currentCsrfToken
      }

      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/change-password`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          currentPassword,
          newPassword: input.newPassword,
        }),
      })

      const json = (await response.json().catch(() => null)) as Record<string, any> | null

      if (!response.ok) {
        const errorMsg =
          json?.error?.message ??
          (response.status === 400
            ? "La contraseña actual es incorrecta o la nueva contraseña no cumple con las políticas de seguridad"
            : "Error al actualizar la contraseña en el backend propio")

        return {
          success: false,
          error: errorMsg,
        }
      }

      // Contraseña actualizada con éxito: limpiar credencial de activación
      this.pendingActivationPassword = null

      this.emitStateChange({
        event: "USER_UPDATED",
        session: this.currentSession,
      })

      return {
        success: true,
        error: null,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Error de comunicación al actualizar la contraseña",
      }
    }
  }

  async requestPasswordRecovery(
    input: AuthPasswordRecoveryInput
  ): Promise<AuthPasswordRecoveryResult> {
    try {
      // Flujo de solicitud de recuperación/activación soberano
      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/recover-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          redirectTo: input.redirectTo,
        }),
      }).catch(() => null)

      // Fallo silencioso deliberado o 200 OK genérico para evitar enumeración de usuarios
      if (!response || response.ok || response.status === 404 || response.status === 429) {
        return {
          success: true,
          error: null,
        }
      }

      return {
        success: true,
        error: null,
      }
    } catch {
      // Política de seguridad: siempre retornar success para prevenir enumeración externa
      return {
        success: true,
        error: null,
      }
    }
  }

  /**
   * Activa una cuenta de usuario importada o migrada utilizando un token de un solo uso.
   * No requiere que el usuario conozca una contraseña temporal previa.
   */
  async activateAccountWithToken(
    token: string,
    newPassword: string
  ): Promise<{ success: boolean; error: string | null; message?: string }> {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          token: token.trim(),
          newPassword,
        }),
      })

      const json = (await response.json().catch(() => null)) as Record<string, any> | null

      if (!response.ok) {
        return {
          success: false,
          error:
            json?.error?.message ??
            (response.status === 400
              ? "El enlace o token de activación es inválido o ya ha sido utilizado."
              : response.status === 401
              ? "El enlace de activación ha caducado. Solicita uno nuevo."
              : "Error al activar la cuenta"),
        }
      }

      return {
        success: true,
        error: null,
        message: json?.data?.message ?? "Cuenta activada exitosamente.",
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Error de comunicación con el servicio de activación",
      }
    }
  }

  /**
   * Restablece la contraseña de una cuenta utilizando un token de recuperación de un solo uso.
   */
  async resetPasswordWithToken(
    token: string,
    newPassword: string
  ): Promise<{ success: boolean; error: string | null; message?: string }> {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/v1/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          token: token.trim(),
          newPassword,
        }),
      })

      const json = (await response.json().catch(() => null)) as Record<string, any> | null

      if (!response.ok) {
        return {
          success: false,
          error:
            json?.error?.message ??
            (response.status === 400
              ? "El enlace de recuperación es inválido o ya ha sido utilizado."
              : response.status === 401
              ? "El enlace de recuperación ha caducado. Solicita uno nuevo."
              : "Error al restablecer la contraseña"),
        }
      }

      return {
        success: true,
        error: null,
        message: json?.data?.message ?? "Contraseña restablecida exitosamente.",
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Error de comunicación con el servicio de restablecimiento",
      }
    }
  }

  subscribeToAuthChanges(callback: (event: AuthStateChangeEvent) => void): () => void {
    this.listeners.add(callback)

    // Notificación inmediata del estado actual si existe
    if (this.currentSession) {
      try {
        callback({
          event: "INITIAL_SESSION",
          session: this.currentSession,
        })
      } catch {
        // Ignorar fallo de callback inicial
      }
    }

    return () => {
      this.listeners.delete(callback)
    }
  }

  async getCurrentUserId(): Promise<string | null> {
    const session = await this.getSession()
    return session?.user?.id ?? null
  }
}
