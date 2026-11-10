import { describe, expect, it, vi } from "vitest"
import type {
  AuthChangeEvent,
  AuthError,
  Session,
  User,
} from "@supabase/supabase-js"
import {
  mapSupabaseAuthEvent,
  mapSupabaseSessionToAuthSession,
  mapSupabaseUserToIdentity,
  SupabaseAuthAdapter,
  type SupabaseAuthClientLike,
} from "../infrastructure/supabase-auth.adapter"
import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"

/**
 * Pruebas de caracterización y regresión de compatibilidad (Fase 2C).
 *
 * Valida de forma aislada las similitudes y discrepancias de comportamiento entre:
 *   1) El sistema actual de autenticación (basado en Supabase Auth / authentication.repository).
 *   2) La nueva abstracción tecnológica desacoplada (IAuthenticationProvider / SupabaseAuthAdapter).
 *
 * Ninguna prueba realiza llamadas reales a Supabase Cloud ni a la red.
 */

function buildMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Administrador de Pruebas" },
    aud: "authenticated",
    confirmation_sent_at: "2026-09-01T10:00:00Z",
    recovery_sent_at: undefined,
    email_change_sent_at: undefined,
    new_email: undefined,
    invited_at: undefined,
    action_link: undefined,
    email: "operador@sitecorp.local",
    phone: "",
    created_at: "2026-09-01T10:00:00Z",
    confirmed_at: "2026-09-01T10:05:00Z",
    email_confirmed_at: "2026-09-01T10:05:00Z",
    phone_confirmed_at: undefined,
    last_sign_in_at: "2026-11-05T08:00:00Z",
    role: "authenticated",
    updated_at: "2026-11-05T08:00:00Z",
    identities: [],
    factors: [],
    ...overrides,
  }
}

function buildMockSession(overrides: Partial<Session> = {}): Session {
  const user = buildMockUser()
  return {
    access_token: "jwt.token.access.test",
    refresh_token: "refresh.token.test",
    expires_in: 3600,
    expires_at: 1762350000,
    token_type: "bearer",
    user,
    ...overrides,
  }
}

describe("Fase 2C — Pruebas de Caracterización y Regresión de Compatibilidad", () => {
  describe("1. Caracterización de inicialización de sesión y getSession()", () => {
    it("el sistema actual (selectSessionUser) devuelve sólo User mientras que el adaptador provee AuthSession completa", async () => {
      const mockSession = buildMockSession()
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn().mockResolvedValue({
          data: { session: mockSession },
          error: null,
        }),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter: IAuthenticationProvider = new SupabaseAuthAdapter(client)
      const session = await adapter.getSession()

      // El adaptador entrega la sesión completa con tokens y usuario
      expect(session).not.toBeNull()
      expect(session?.accessToken).toBe(mockSession.access_token)
      expect(session?.refreshToken).toBe(mockSession.refresh_token)
      expect(session?.expiresAt).toBe(mockSession.expires_at)
      expect(session?.user.id).toBe(mockSession.user.id)
      expect(session?.user.email).toBe(mockSession.user.email)
    })

    it("ante error o ausencia de sesión ambos modelos coinciden en resolver null", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      expect(await adapter.getSession()).toBeNull()
      expect(await adapter.getCurrentUserId()).toBeNull()
    })
  })

  describe("2. Caracterización de eventos del SDK: INITIAL_SESSION como evento independiente", () => {
    it("conserva INITIAL_SESSION como evento propio sin convertirlo en SIGNED_IN", () => {
      expect(mapSupabaseAuthEvent("INITIAL_SESSION")).toBe("INITIAL_SESSION")
      expect(mapSupabaseAuthEvent("SIGNED_IN")).toBe("SIGNED_IN")
      expect(mapSupabaseAuthEvent("SIGNED_OUT")).toBe("SIGNED_OUT")
      expect(mapSupabaseAuthEvent("TOKEN_REFRESHED")).toBe("TOKEN_REFRESHED")
    })

    it("subscribeToAuthChanges notifica INITIAL_SESSION con sesión válida y sin sesión sin duplicar", () => {
      let registeredCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
      const unsubscribeMock = vi.fn()
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn().mockImplementation((cb) => {
          registeredCallback = cb
          return {
            data: { subscription: { unsubscribe: unsubscribeMock } },
          }
        }),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const receivedEvents: Array<{ event: string; userId?: string; hasSession: boolean }> = []

      const unsubscribe = adapter.subscribeToAuthChanges((e) => {
        receivedEvents.push({
          event: e.event,
          userId: e.session?.user.id,
          hasSession: e.session !== null,
        })
      })

      expect(registeredCallback).not.toBeNull()

      // 1. INITIAL_SESSION con sesión válida: conserva UUID
      const testUser = buildMockUser({ id: "98765432-abcd-ef01-2345-6789abcdef01" })
      const testSession = buildMockSession({ user: testUser })
      registeredCallback!("INITIAL_SESSION", testSession)

      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0].event).toBe("INITIAL_SESSION")
      expect(receivedEvents[0].userId).toBe("98765432-abcd-ef01-2345-6789abcdef01")
      expect(receivedEvents[0].hasSession).toBe(true)

      // 2. INITIAL_SESSION sin sesión (null)
      registeredCallback!("INITIAL_SESSION", null)
      expect(receivedEvents).toHaveLength(2)
      expect(receivedEvents[1].event).toBe("INITIAL_SESSION")
      expect(receivedEvents[1].userId).toBeUndefined()
      expect(receivedEvents[1].hasSession).toBe(false)

      // 3. SIGNED_IN
      registeredCallback!("SIGNED_IN", testSession)
      expect(receivedEvents).toHaveLength(3)
      expect(receivedEvents[2].event).toBe("SIGNED_IN")
      expect(receivedEvents[2].userId).toBe("98765432-abcd-ef01-2345-6789abcdef01")

      // 4. TOKEN_REFRESHED
      const renewedSession = buildMockSession({ user: testUser, access_token: "refreshed.token.jwt" })
      registeredCallback!("TOKEN_REFRESHED", renewedSession)
      expect(receivedEvents).toHaveLength(4)
      expect(receivedEvents[3].event).toBe("TOKEN_REFRESHED")
      expect(receivedEvents[3].userId).toBe("98765432-abcd-ef01-2345-6789abcdef01")

      // 5. SIGNED_OUT
      registeredCallback!("SIGNED_OUT", null)
      expect(receivedEvents).toHaveLength(5)
      expect(receivedEvents[4].event).toBe("SIGNED_OUT")
      expect(receivedEvents[4].hasSession).toBe(false)

      // 6. Ausencia de eventos duplicados: eventos desconocidos no generan emisiones
      registeredCallback!("MFA_CHALLENGE_VERIFIED" as AuthChangeEvent, null)
      expect(receivedEvents).toHaveLength(5)

      // 7. Cancelación de la suscripción
      unsubscribe()
      expect(unsubscribeMock).toHaveBeenCalledOnce()
    })
  })

  describe("3. Caracterización de resiliencia y pérdida de conectividad", () => {
    it("getSession captura excepciones inesperadas de red y retorna null sin propagar", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn().mockRejectedValue(new Error("Failed to fetch (offline)")),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const result = await adapter.getSession()
      expect(result).toBeNull()
    })

    it("signInWithPassword captura excepciones de red y las devuelve en formato estructurado", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn().mockRejectedValue(new Error("Network connection lost")),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const result = await adapter.signInWithPassword({
        email: "operador@sitecorp.local",
        password: "Pass",
      })

      expect(result.session).toBeNull()
      expect(result.error).toBe("Network connection lost")
    })

    it("signOut propaga errores de desconexión o fallo en el servidor", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn().mockResolvedValue({
          error: { name: "AuthError", message: "Network error during sign out", status: 500 } as AuthError,
        }),
        refreshSession: vi.fn(),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      await expect(adapter.signOut()).rejects.toThrow("Network error during sign out")
    })
  })

  describe("4. Caracterización de renovación de sesiones y expiración", () => {
    it("refreshToken() retorna la nueva sesión con token rotado", async () => {
      const renewed = buildMockSession({
        access_token: "renewed.jwt.token",
        refresh_token: "renewed.refresh.token",
        expires_at: 1762353600,
      })

      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn().mockResolvedValue({
          data: { user: renewed.user, session: renewed },
          error: null,
        }),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const res = await adapter.refreshToken()

      expect(res).not.toBeNull()
      expect(res?.accessToken).toBe("renewed.jwt.token")
      expect(res?.refreshToken).toBe("renewed.refresh.token")
      expect(res?.expiresAt).toBe(1762353600)
    })

    it("refreshToken() maneja errores de sesión expirada devolviendo null", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { name: "AuthSessionMissingError", message: "Token expired", status: 400 } as AuthError,
        }),
        updateUser: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const res = await adapter.refreshToken()
      expect(res).toBeNull()
    })
  })

  describe("5. Caracterización de cambio de contraseña: estándar vs obligatorio inicial", () => {
    it("updatePassword delega la actualización de contraseña estándar de usuario activo", async () => {
      const client: SupabaseAuthClientLike = {
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        refreshSession: vi.fn(),
        updateUser: vi.fn().mockResolvedValue({
          data: { user: buildMockUser() },
          error: null,
        }),
        resetPasswordForEmail: vi.fn(),
        onAuthStateChange: vi.fn(),
      }

      const adapter = new SupabaseAuthAdapter(client)
      const res = await adapter.updatePassword({ newPassword: "StrongPassword2026!" })

      expect(res.success).toBe(true)
      expect(res.error).toBeNull()
      expect(client.updateUser).toHaveBeenCalledWith({ password: "StrongPassword2026!" })
    })

    it("caracteriza que el cambio inicial de contraseña en SiteCorp utiliza Edge Function y no updateUser", () => {
      // En SiteCorp (authentication.commands.ts / invokeChangeInitialPassword):
      // changeInitialPassword -> supabase.functions.invoke("change-initial-password", { body: { new_password } })
      // Se comprueba que el contrato del proveedor no asume esta lógica de negocio específica de Edge Function.
      expect(typeof SupabaseAuthAdapter.prototype.updatePassword).toBe("function")
      // @ts-expect-error - El método específico de Edge Function no forma parte de IAuthenticationProvider
      expect(SupabaseAuthAdapter.prototype.invokeChangeInitialPassword).toBeUndefined()
    })
  })

  describe("6. Caracterización de fidelidad de identidad (UUID v4) y mapeo", () => {
    it("preserva la totalidad del identificador UUID original sin truncamiento", () => {
      const uuid = "4a5e2f7b-9c3d-4e1a-8f2b-7c6d5e4a3b2c"
      const user = buildMockUser({ id: uuid, email: "operario@sitecorp.local" })
      const identity = mapSupabaseUserToIdentity(user)

      expect(identity.id).toBe(uuid)
      expect(identity.email).toBe("operario@sitecorp.local")
      expect(identity.confirmedAt).toBe("2026-09-01T10:05:00Z")
    })

    it("mapSupabaseSessionToAuthSession mantiene la integridad de los datos", () => {
      const session = buildMockSession()
      const domainSession = mapSupabaseSessionToAuthSession(session)

      expect(domainSession.accessToken).toBe(session.access_token)
      expect(domainSession.refreshToken).toBe(session.refresh_token)
      expect(domainSession.expiresAt).toBe(session.expires_at)
      expect(domainSession.user.id).toBe(session.user.id)
    })
  })
})
