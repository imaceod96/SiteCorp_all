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

/**
 * Generador de usuarios simulados de Supabase Auth para pruebas unitarias.
 */
function createFakeSupabaseUser(overrides: Partial<User> = {}): User {
  return {
    id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    confirmation_sent_at: "2026-09-22T14:20:00Z",
    recovery_sent_at: undefined,
    email_change_sent_at: undefined,
    new_email: undefined,
    invited_at: undefined,
    action_link: undefined,
    email: "admin@sitecorp.local",
    phone: "",
    created_at: "2026-09-22T14:20:48Z",
    confirmed_at: "2026-09-22T14:20:48Z",
    email_confirmed_at: "2026-09-22T14:20:48Z",
    phone_confirmed_at: undefined,
    last_sign_in_at: "2026-11-05T10:00:00Z",
    role: "authenticated",
    updated_at: "2026-11-05T10:00:00Z",
    identities: [],
    factors: [],
    ...overrides,
  }
}

/**
 * Generador de sesiones simuladas de Supabase Auth.
 */
function createFakeSupabaseSession(overrides: Partial<Session> = {}): Session {
  const user = createFakeSupabaseUser()
  return {
    access_token: "fake.supabase.jwt.access_token",
    refresh_token: "fake.supabase.refresh_token",
    expires_in: 3600,
    expires_at: 1762340000,
    token_type: "bearer",
    user,
    ...overrides,
  }
}

/**
 * Crea un cliente falso de Supabase Auth con métodos mockeables mediante vi.fn().
 */
function createMockClient(): {
  client: SupabaseAuthClientLike
  unsubscribeMock: ReturnType<typeof vi.fn>
  authChangeCallbackHolder: { callback?: (event: AuthChangeEvent, session: Session | null) => void }
} {
  const unsubscribeMock = vi.fn()
  const authChangeCallbackHolder: { callback?: (event: AuthChangeEvent, session: Session | null) => void } = {}

  const client: SupabaseAuthClientLike = {
    getSession: vi.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    }),
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({
      error: null,
    }),
    refreshSession: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({
      data: {},
      error: null,
    }),
    onAuthStateChange: vi.fn().mockImplementation((callback) => {
      authChangeCallbackHolder.callback = callback
      return {
        data: {
          subscription: {
            unsubscribe: unsubscribeMock,
          },
        },
      }
    }),
  }

  return { client, unsubscribeMock, authChangeCallbackHolder }
}

describe("SupabaseAuthAdapter (Fase 2B)", () => {
  describe("Mapeadores puros", () => {
    it("conserva exactamente el UUID v4 del usuario sin alteraciones ni truncados", () => {
      const originalUuid = "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f"
      const fakeUser = createFakeSupabaseUser({ id: originalUuid })

      const identity = mapSupabaseUserToIdentity(fakeUser)

      expect(identity.id).toBe(originalUuid)
      expect(identity.email).toBe("admin@sitecorp.local")
      expect(identity.confirmedAt).toBe("2026-09-22T14:20:48Z")
      expect(identity.createdAt).toBe("2026-09-22T14:20:48Z")
    })

    it("transforma la sesión completa mapeando tokens, expiración e identidad", () => {
      const fakeSession = createFakeSupabaseSession()
      const domainSession = mapSupabaseSessionToAuthSession(fakeSession)

      expect(domainSession.accessToken).toBe("fake.supabase.jwt.access_token")
      expect(domainSession.refreshToken).toBe("fake.supabase.refresh_token")
      expect(domainSession.expiresAt).toBe(1762340000)
      expect(domainSession.user.id).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")
    })

    it("mapea los eventos de ciclo de vida de Supabase a los tipos de dominio y filtra desconocidos", () => {
      expect(mapSupabaseAuthEvent("INITIAL_SESSION")).toBe("INITIAL_SESSION")
      expect(mapSupabaseAuthEvent("SIGNED_IN")).toBe("SIGNED_IN")
      expect(mapSupabaseAuthEvent("SIGNED_OUT")).toBe("SIGNED_OUT")
      expect(mapSupabaseAuthEvent("TOKEN_REFRESHED")).toBe("TOKEN_REFRESHED")
      expect(mapSupabaseAuthEvent("USER_UPDATED")).toBe("USER_UPDATED")
      expect(mapSupabaseAuthEvent("PASSWORD_RECOVERY")).toBe("PASSWORD_RECOVERY")
      expect(mapSupabaseAuthEvent("MFA_CHALLENGE_VERIFIED" as AuthChangeEvent)).toBeNull()
    })
  })

  describe("Operaciones de IAuthenticationProvider", () => {
    it("getSession() devuelve null cuando el cliente no tiene sesión activa", async () => {
      const { client } = createMockClient()
      const adapter = new SupabaseAuthAdapter(client)

      const session = await adapter.getSession()

      expect(session).toBeNull()
      expect(client.getSession).toHaveBeenCalledOnce()
    })

    it("getSession() devuelve la sesión mapeada cuando el cliente tiene sesión activa", async () => {
      const { client } = createMockClient()
      const fakeSession = createFakeSupabaseSession()
      vi.mocked(client.getSession).mockResolvedValueOnce({
        data: { session: fakeSession },
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const session = await adapter.getSession()

      expect(session).not.toBeNull()
      expect(session?.user.id).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")
      expect(session?.accessToken).toBe("fake.supabase.jwt.access_token")
    })

    it("signInWithPassword() inicia sesión exitosamente y retorna sesión de dominio", async () => {
      const { client } = createMockClient()
      const fakeSession = createFakeSupabaseSession()
      vi.mocked(client.signInWithPassword).mockResolvedValueOnce({
        data: { user: fakeSession.user, session: fakeSession },
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const result = await adapter.signInWithPassword({
        email: "admin@sitecorp.local",
        password: "ValidPassword123!",
      })

      expect(result.error).toBeNull()
      expect(result.session).not.toBeNull()
      expect(result.session?.user.id).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")
      expect(client.signInWithPassword).toHaveBeenCalledWith({
        email: "admin@sitecorp.local",
        password: "ValidPassword123!",
      })
    })

    it("signInWithPassword() captura errores devueltos por el proveedor sin lanzar excepciones", async () => {
      const { client } = createMockClient()
      vi.mocked(client.signInWithPassword).mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { name: "AuthApiError", message: "Invalid login credentials", status: 400 } as AuthError,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const result = await adapter.signInWithPassword({
        email: "admin@sitecorp.local",
        password: "BadPassword",
      })

      expect(result.session).toBeNull()
      expect(result.error).toBe("Invalid login credentials")
    })

    it("signOut() delega en el cliente de autenticación", async () => {
      const { client } = createMockClient()
      const adapter = new SupabaseAuthAdapter(client)

      await adapter.signOut()

      expect(client.signOut).toHaveBeenCalledOnce()
    })

    it("signOut() propaga errores cuando el cliente falla", async () => {
      const { client } = createMockClient()
      vi.mocked(client.signOut).mockResolvedValueOnce({
        error: { name: "AuthError", message: "Network error on sign out", status: 500 } as AuthError,
      })
      const adapter = new SupabaseAuthAdapter(client)

      await expect(adapter.signOut()).rejects.toThrow("Network error on sign out")
    })

    it("refreshToken() renueva la sesión mediante refreshSession()", async () => {
      const { client } = createMockClient()
      const renewedSession = createFakeSupabaseSession({
        access_token: "new.jwt.access_token",
        refresh_token: "new.refresh_token",
      })
      vi.mocked(client.refreshSession).mockResolvedValueOnce({
        data: { user: renewedSession.user, session: renewedSession },
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const refreshed = await adapter.refreshToken()

      expect(refreshed?.accessToken).toBe("new.jwt.access_token")
      expect(refreshed?.refreshToken).toBe("new.refresh_token")
      expect(client.refreshSession).toHaveBeenCalledOnce()
    })

    it("refreshToken() devuelve null si la sesión no pudo renovarse", async () => {
      const { client } = createMockClient()
      vi.mocked(client.refreshSession).mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { name: "AuthSessionMissingError", message: "Auth session missing", status: 400 } as AuthError,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const refreshed = await adapter.refreshToken()

      expect(refreshed).toBeNull()
    })

    it("updatePassword() delega en updateUser() con la nueva contraseña", async () => {
      const { client } = createMockClient()
      vi.mocked(client.updateUser).mockResolvedValueOnce({
        data: { user: createFakeSupabaseUser() },
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const result = await adapter.updatePassword({ newPassword: "NewSecretPassword123!" })

      expect(result.success).toBe(true)
      expect(result.error).toBeNull()
      expect(client.updateUser).toHaveBeenCalledWith({ password: "NewSecretPassword123!" })
    })

    it("updatePassword() reporta el error cuando updateUser() falla", async () => {
      const { client } = createMockClient()
      vi.mocked(client.updateUser).mockResolvedValueOnce({
        data: { user: null },
        error: { name: "AuthWeakPasswordError", message: "Password should be at least 6 characters", status: 422 } as AuthError,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const result = await adapter.updatePassword({ newPassword: "123" })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Password should be at least 6 characters")
    })

    it("requestPasswordRecovery() delega en resetPasswordForEmail() con redirectTo opcional", async () => {
      const { client } = createMockClient()
      vi.mocked(client.resetPasswordForEmail).mockResolvedValueOnce({
        data: {},
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const result = await adapter.requestPasswordRecovery({
        email: "user@sitecorp.local",
        redirectTo: "http://localhost:3000/reset-password",
      })

      expect(result.success).toBe(true)
      expect(result.error).toBeNull()
      expect(client.resetPasswordForEmail).toHaveBeenCalledWith("user@sitecorp.local", {
        redirectTo: "http://localhost:3000/reset-password",
      })
    })

    it("subscribeToAuthChanges() traduce eventos del SDK, no duplica eventos y cancela suscripciones limpiamente", () => {
      const { client, unsubscribeMock, authChangeCallbackHolder } = createMockClient()
      const adapter = new SupabaseAuthAdapter(client)
      const receivedEvents: Array<{ event: string; userId?: string }> = []

      const unsubscribe = adapter.subscribeToAuthChanges((e) => {
        receivedEvents.push({ event: e.event, userId: e.session?.user.id })
      })

      expect(client.onAuthStateChange).toHaveBeenCalledOnce()
      expect(authChangeCallbackHolder.callback).toBeDefined()

      // 1. Disparar INITIAL_SESSION con sesión válida
      const fakeSession = createFakeSupabaseSession()
      authChangeCallbackHolder.callback!("INITIAL_SESSION", fakeSession)
      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0].event).toBe("INITIAL_SESSION")
      expect(receivedEvents[0].userId).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")

      // 2. Disparar INITIAL_SESSION sin sesión (null)
      authChangeCallbackHolder.callback!("INITIAL_SESSION", null)
      expect(receivedEvents).toHaveLength(2)
      expect(receivedEvents[1].event).toBe("INITIAL_SESSION")
      expect(receivedEvents[1].userId).toBeUndefined()

      // 3. Disparar SIGNED_IN con sesión válida
      authChangeCallbackHolder.callback!("SIGNED_IN", fakeSession)
      expect(receivedEvents).toHaveLength(3)
      expect(receivedEvents[2].event).toBe("SIGNED_IN")
      expect(receivedEvents[2].userId).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")

      // 4. Disparar TOKEN_REFRESHED con nueva sesión
      const renewedSession = createFakeSupabaseSession({ access_token: "refreshed.jwt.123" })
      authChangeCallbackHolder.callback!("TOKEN_REFRESHED", renewedSession)
      expect(receivedEvents).toHaveLength(4)
      expect(receivedEvents[3].event).toBe("TOKEN_REFRESHED")
      expect(receivedEvents[3].userId).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")

      // 5. Disparar SIGNED_OUT
      authChangeCallbackHolder.callback!("SIGNED_OUT", null)
      expect(receivedEvents).toHaveLength(5)
      expect(receivedEvents[4].event).toBe("SIGNED_OUT")
      expect(receivedEvents[4].userId).toBeUndefined()

      // 6. Ausencia de eventos duplicados o no mapeados
      authChangeCallbackHolder.callback!("MFA_CHALLENGE_VERIFIED" as AuthChangeEvent, null)
      expect(receivedEvents).toHaveLength(5) // No se disparó ningún evento adicional

      // 7. Cancelar suscripción
      unsubscribe()
      expect(unsubscribeMock).toHaveBeenCalledOnce()
    })

    it("getCurrentUserId() devuelve el UUID exacto del usuario autenticado o null si no hay sesión", async () => {
      const { client } = createMockClient()
      const fakeSession = createFakeSupabaseSession({
        user: createFakeSupabaseUser({ id: "33333333-4444-5555-6666-777777777777" }),
      })
      vi.mocked(client.getSession).mockResolvedValueOnce({
        data: { session: fakeSession },
        error: null,
      })
      const adapter = new SupabaseAuthAdapter(client)

      const userId = await adapter.getCurrentUserId()
      expect(userId).toBe("33333333-4444-5555-6666-777777777777")

      // Caso sin sesión
      vi.mocked(client.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      })
      const noUserId = await adapter.getCurrentUserId()
      expect(noUserId).toBeNull()
    })
  })
})
