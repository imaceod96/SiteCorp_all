import { supabase } from "../../../lib/supabase"
import type {
  AuthChangeEvent,
  AuthError,
  Session,
  User,
} from "@supabase/supabase-js"
import type {
  AuthPasswordRecoveryInput,
  AuthPasswordRecoveryResult,
  AuthSession,
  AuthSignInCredentials,
  AuthSignInResult,
  AuthStateChangeEvent,
  AuthStateChangeEventType,
  AuthUpdatePasswordInput,
  AuthUpdatePasswordResult,
  AuthUserIdentity,
  IAuthenticationProvider,
} from "../domain/auth-provider.contracts"

/**
 * Interfaz estructural mínima del cliente de autenticación de Supabase.
 * Permite inyectar la instancia de producción (`supabase.auth`) o dobles de prueba (mocks)
 * sin acoplar los tests unitarios a sockets ni a la nube de Supabase.
 */
export interface SupabaseAuthClientLike {
  getSession(): Promise<{
    data: { session: Session | null }
    error: AuthError | null
  }>
  signInWithPassword(credentials: {
    email: string
    password: string
  }): Promise<{
    data: { user: User | null; session: Session | null }
    error: AuthError | null
  }>
  signOut(): Promise<{ error: AuthError | null }>
  refreshSession(currentSession?: { refresh_token: string }): Promise<{
    data: { user: User | null; session: Session | null }
    error: AuthError | null
  }>
  updateUser(attributes: {
    password?: string
  }): Promise<{
    data: { user: User | null }
    error: AuthError | null
  }>
  resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string }
  ): Promise<{
    data: unknown
    error: AuthError | null
  }>
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ): {
    data: {
      subscription: {
        unsubscribe: () => void
      }
    }
  }
  getUser?(jwt?: string): Promise<{
    data: { user: User | null }
    error: AuthError | null
  }>
}

/**
 * Transforma un usuario de Supabase Auth en la identidad de dominio AuthUserIdentity.
 * Preserva exactamente el UUID v4 del usuario sin transformaciones ni modificaciones.
 */
export function mapSupabaseUserToIdentity(user: User): AuthUserIdentity {
  return {
    id: user.id,
    email: user.email ?? "",
    confirmedAt: (user.confirmed_at ?? (user as unknown as { email_confirmed_at?: string }).email_confirmed_at) || null,
    createdAt: user.created_at,
  }
}

/**
 * Transforma una sesión de Supabase Auth en la sesión de dominio AuthSession.
 */
export function mapSupabaseSessionToAuthSession(session: Session): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    user: mapSupabaseUserToIdentity(session.user),
  }
}

/**
 * Mapea eventos del SDK de Supabase Auth al enum de dominio AuthStateChangeEventType.
 * Los eventos no contemplados en el dominio devuelven null para ser ignorados.
 */
export function mapSupabaseAuthEvent(event: AuthChangeEvent): AuthStateChangeEventType | null {
  switch (event) {
    case "INITIAL_SESSION":
      return "INITIAL_SESSION"
    case "SIGNED_IN":
      return "SIGNED_IN"
    case "SIGNED_OUT":
      return "SIGNED_OUT"
    case "TOKEN_REFRESHED":
      return "TOKEN_REFRESHED"
    case "USER_UPDATED":
      return "USER_UPDATED"
    case "PASSWORD_RECOVERY":
      return "PASSWORD_RECOVERY"
    default:
      return null
  }
}

/**
 * Adaptador de infraestructura que implementa IAuthenticationProvider delegando
 * en el SDK de Supabase Auth.
 *
 * NOTA DE ARQUITECTURA:
 * Este adaptador se encuentra completamente aislado y NO está conectado aún al
 * ciclo de vida activo de la aplicación (AuthProvider, AuthContext, login).
 * Mantiene la separación estricta: sólo gestiona autenticación e identidad,
 * sin tocar roles, permisos ni membresías de negocio.
 */
export class SupabaseAuthAdapter implements IAuthenticationProvider {
  private readonly client: SupabaseAuthClientLike

  constructor(client?: SupabaseAuthClientLike) {
    this.client = client ?? (supabase.auth as unknown as SupabaseAuthClientLike)
  }

  async getSession(): Promise<AuthSession | null> {
    try {
      const { data, error } = await this.client.getSession()
      if (error || !data?.session) {
        return null
      }
      return mapSupabaseSessionToAuthSession(data.session)
    } catch {
      return null
    }
  }

  async signInWithPassword(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
    try {
      const { data, error } = await this.client.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      })

      if (error) {
        return {
          session: null,
          error: error.message,
        }
      }

      if (!data?.session) {
        return {
          session: null,
          error: "No se recibió ninguna sesión activa del proveedor",
        }
      }

      return {
        session: mapSupabaseSessionToAuthSession(data.session),
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado al iniciar sesión"
      return {
        session: null,
        error: message,
      }
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.signOut()
    if (error) {
      throw error
    }
  }

  async refreshToken(): Promise<AuthSession | null> {
    try {
      const { data, error } = await this.client.refreshSession()
      if (error || !data?.session) {
        return null
      }
      return mapSupabaseSessionToAuthSession(data.session)
    } catch {
      return null
    }
  }

  async updatePassword(input: AuthUpdatePasswordInput): Promise<AuthUpdatePasswordResult> {
    try {
      const { error } = await this.client.updateUser({
        password: input.newPassword,
      })
      if (error) {
        return {
          success: false,
          error: error.message,
        }
      }
      return {
        success: true,
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al actualizar la contraseña"
      return {
        success: false,
        error: message,
      }
    }
  }

  async requestPasswordRecovery(
    input: AuthPasswordRecoveryInput
  ): Promise<AuthPasswordRecoveryResult> {
    try {
      const { error } = await this.client.resetPasswordForEmail(
        input.email,
        input.redirectTo ? { redirectTo: input.redirectTo } : undefined
      )
      if (error) {
        return {
          success: false,
          error: error.message,
        }
      }
      return {
        success: true,
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al solicitar la recuperación de contraseña"
      return {
        success: false,
        error: message,
      }
    }
  }

  subscribeToAuthChanges(callback: (event: AuthStateChangeEvent) => void): () => void {
    const {
      data: { subscription },
    } = this.client.onAuthStateChange((event, session) => {
      const mappedEvent = mapSupabaseAuthEvent(event)
      if (!mappedEvent) return

      callback({
        event: mappedEvent,
        session: session ? mapSupabaseSessionToAuthSession(session) : null,
      })
    })

    return () => {
      subscription.unsubscribe()
    }
  }

  async getCurrentUserId(): Promise<string | null> {
    try {
      const { data, error } = await this.client.getSession()
      if (error || !data?.session?.user) {
        return null
      }
      return data.session.user.id
    } catch {
      return null
    }
  }
}
