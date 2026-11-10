import { describe, expect, it } from "vitest"
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

/**
 * Implementación simulada en memoria del contrato IAuthenticationProvider.
 * Valida que los contratos definidos cubren todos los casos de uso
 * requeridos (identidad, sesión, inicio/cierre, renovación, contraseñas y eventos)
 * sin depender de servicios externos ni de la nube.
 */
class MockAuthenticationProvider implements IAuthenticationProvider {
  private currentSession: AuthSession | null = null
  private listeners: Array<(event: AuthStateChangeEvent) => void> = []

  constructor(initialSession: AuthSession | null = null) {
    this.currentSession = initialSession
  }

  async getSession(): Promise<AuthSession | null> {
    return this.currentSession
  }

  async signInWithPassword(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
    if (credentials.email === "admin@sitecorp.local" && credentials.password === "ValidPassword123!") {
      const user: AuthUserIdentity = {
        id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
        email: credentials.email,
        confirmedAt: "2026-09-22T14:20:48Z",
        createdAt: "2026-09-22T14:20:48Z",
      }
      this.currentSession = {
        accessToken: "mock.jwt.access-token",
        refreshToken: "mock.refresh-token.123",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user,
      }
      this.notifyListeners({ event: "SIGNED_IN", session: this.currentSession })
      return { session: this.currentSession, error: null }
    }
    return { session: null, error: "Credenciales inválidas" }
  }

  async signOut(): Promise<void> {
    this.currentSession = null
    this.notifyListeners({ event: "SIGNED_OUT", session: null })
  }

  async refreshToken(): Promise<AuthSession | null> {
    if (!this.currentSession) return null
    this.currentSession = {
      ...this.currentSession,
      accessToken: "mock.jwt.refreshed-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }
    this.notifyListeners({ event: "TOKEN_REFRESHED", session: this.currentSession })
    return this.currentSession
  }

  async updatePassword(input: AuthUpdatePasswordInput): Promise<AuthUpdatePasswordResult> {
    if (!this.currentSession) {
      return { success: false, error: "No hay sesión activa para cambiar la contraseña" }
    }
    if (input.newPassword.length < 8) {
      return { success: false, error: "La contraseña debe tener al menos 8 caracteres" }
    }
    this.notifyListeners({ event: "USER_UPDATED", session: this.currentSession })
    return { success: true, error: null }
  }

  async requestPasswordRecovery(input: AuthPasswordRecoveryInput): Promise<AuthPasswordRecoveryResult> {
    if (!input.email || !input.email.includes("@")) {
      return { success: false, error: "Correo electrónico no válido" }
    }
    // En entorno offline o autogestionado, genera el token o mensaje local sin fallar
    return { success: true, error: null }
  }

  subscribeToAuthChanges(callback: (event: AuthStateChangeEvent) => void): () => void {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback)
    }
  }

  async getCurrentUserId(): Promise<string | null> {
    return this.currentSession?.user.id ?? null
  }

  private notifyListeners(event: AuthStateChangeEvent) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

describe("Contratos de Autenticación Autogestionada (IAuthenticationProvider)", () => {
  it("inicia sesión correctamente con credenciales válidas y emite el evento SIGNED_IN", async () => {
    const provider = new MockAuthenticationProvider()
    const emittedEvents: string[] = []

    provider.subscribeToAuthChanges((e) => {
      emittedEvents.push(e.event)
    })

    const result = await provider.signInWithPassword({
      email: "admin@sitecorp.local",
      password: "ValidPassword123!",
    })

    expect(result.error).toBeNull()
    expect(result.session).not.toBeNull()
    expect(result.session?.user.id).toBe("e7062a40-bc05-4ffb-a5a5-ba73d1ab116f")
    expect(result.session?.user.email).toBe("admin@sitecorp.local")
    expect(emittedEvents).toContain("SIGNED_IN")
  })

  it("rechaza inicio de sesión con credenciales erróneas sin emitir evento ni alterar sesión", async () => {
    const provider = new MockAuthenticationProvider()
    const result = await provider.signInWithPassword({
      email: "admin@sitecorp.local",
      password: "WrongPassword",
    })

    expect(result.session).toBeNull()
    expect(result.error).toBe("Credenciales inválidas")
    expect(await provider.getSession()).toBeNull()
    expect(await provider.getCurrentUserId()).toBeNull()
  })

  it("cierra la sesión activa, limpia el estado y emite SIGNED_OUT", async () => {
    const provider = new MockAuthenticationProvider({
      accessToken: "existing.jwt",
      user: { id: "user-123", email: "user@sitecorp.local" },
    })

    const emittedEvents: string[] = []
    provider.subscribeToAuthChanges((e) => {
      emittedEvents.push(e.event)
    })

    expect(await provider.getCurrentUserId()).toBe("user-123")

    await provider.signOut()

    expect(await provider.getSession()).toBeNull()
    expect(await provider.getCurrentUserId()).toBeNull()
    expect(emittedEvents).toContain("SIGNED_OUT")
  })

  it("renueva tokens de sesión expirados o por rotación emitiendo TOKEN_REFRESHED", async () => {
    const provider = new MockAuthenticationProvider({
      accessToken: "initial.jwt",
      user: { id: "user-123", email: "user@sitecorp.local" },
    })

    const emittedEvents: string[] = []
    provider.subscribeToAuthChanges((e) => {
      emittedEvents.push(e.event)
    })

    const refreshed = await provider.refreshToken()

    expect(refreshed?.accessToken).toBe("mock.jwt.refreshed-token")
    expect(emittedEvents).toContain("TOKEN_REFRESHED")
  })

  it("actualiza contraseña solo cuando existe sesión activa y valida restricciones", async () => {
    const unauthenticatedProvider = new MockAuthenticationProvider(null)
    const failResult = await unauthenticatedProvider.updatePassword({ newPassword: "Short1" })
    expect(failResult.success).toBe(false)
    expect(failResult.error).toContain("No hay sesión activa")

    const authenticatedProvider = new MockAuthenticationProvider({
      accessToken: "token",
      user: { id: "u-1", email: "u@sitecorp.local" },
    })
    const shortResult = await authenticatedProvider.updatePassword({ newPassword: "Short" })
    expect(shortResult.success).toBe(false)
    expect(shortResult.error).toContain("al menos 8 caracteres")

    const okResult = await authenticatedProvider.updatePassword({ newPassword: "NewValidPassword123!" })
    expect(okResult.success).toBe(true)
    expect(okResult.error).toBeNull()
  })

  it("permite cancelar suscripciones a eventos sin fugas de memoria", () => {
    const provider = new MockAuthenticationProvider()
    let calls = 0
    const unsubscribe = provider.subscribeToAuthChanges(() => {
      calls += 1
    })

    unsubscribe()
    void provider.signOut()

    expect(calls).toBe(0)
  })

  it("emite y reconoce el evento INITIAL_SESSION en el contrato de ciclo de vida", () => {
    const provider = new MockAuthenticationProvider({
      accessToken: "init.jwt",
      user: { id: "user-init-1", email: "init@sitecorp.local" },
    })
    const events: AuthStateChangeEvent[] = []
    provider.subscribeToAuthChanges((e) => events.push(e))

    // Notificar INITIAL_SESSION
    ;(provider as unknown as { notifyListeners: (e: AuthStateChangeEvent) => void }).notifyListeners({
      event: "INITIAL_SESSION",
      session: {
        accessToken: "init.jwt",
        user: { id: "user-init-1", email: "init@sitecorp.local" },
      },
    })

    expect(events).toHaveLength(1)
    expect(events[0].event).toBe("INITIAL_SESSION")
    expect(events[0].session?.user.id).toBe("user-init-1")
  })
})
