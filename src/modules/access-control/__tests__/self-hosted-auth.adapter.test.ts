import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  SelfHostedAuthAdapter,
  type StorageLike,
} from "../infrastructure/self-hosted-auth.adapter"
import type { AuthStateChangeEvent } from "../domain/auth-provider.contracts"

class MockStorage implements StorageLike {
  private map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

describe("SelfHostedAuthAdapter (Fase 4G.4)", () => {
  let storage: MockStorage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = new MockStorage()
    mockFetch = vi.fn()
  })

  const createAdapter = () =>
    new SelfHostedAuthAdapter({
      baseUrl: "https://auth.sitecorp.cu",
      fetchFn: mockFetch as unknown as typeof fetch,
      storage,
    })

  describe("1. Inicio de sesión (signInWithPassword)", () => {
    it("inicia sesión correctamente para un usuario activo y persiste la sesión", async () => {
      const mockResponse = {
        data: {
          accessToken: "jwt.access.token.full",
          tokenType: "Bearer",
          expiresInSeconds: 900,
          mustChangePassword: false,
          csrfToken: "csrf-token-12345",
          user: {
            id: "u-12345-uuid",
            email: "operador@sitecorp.cu",
            status: "ACTIVE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        meta: {
          requestId: "req-1",
          timestamp: "2026-01-02T00:00:00.000Z",
        },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      })

      const adapter = createAdapter()
      const events: AuthStateChangeEvent[] = []
      adapter.subscribeToAuthChanges((e) => events.push(e))

      const result = await adapter.signInWithPassword({
        email: "operador@sitecorp.cu",
        password: "ValidPassword#2026!",
      })

      expect(result.error).toBeNull()
      expect(result.session).toBeDefined()
      expect(result.session?.accessToken).toBe("jwt.access.token.full")
      expect(result.session?.user.id).toBe("u-12345-uuid")
      expect(result.session?.user.email).toBe("operador@sitecorp.cu")

      // Evento SIGNED_IN emitido
      expect(events.some((e) => e.event === "SIGNED_IN")).toBe(true)

      // Persistencia en storage
      expect(storage.getItem("sitecorp_self_hosted_session")).toContain("jwt.access.token.full")
      expect(storage.getItem("sitecorp_self_hosted_csrf")).toBe("csrf-token-12345")
    })

    it("detecta usuario con cambio obligatorio (mustChangePassword) y activa flujo de activación", async () => {
      const mockResponse = {
        data: {
          accessToken: "jwt.access.token.pwd_change",
          tokenType: "Bearer",
          expiresInSeconds: 900,
          mustChangePassword: true,
          csrfToken: null,
          user: {
            id: "migrated-user-uuid",
            email: "migrado@sitecorp.cu",
            status: "PENDING_PASSWORD_CHANGE",
            mustChangePassword: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        meta: {
          requestId: "req-2",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      })

      const adapter = createAdapter()
      const events: AuthStateChangeEvent[] = []
      adapter.subscribeToAuthChanges((e) => events.push(e))

      const result = await adapter.signInWithPassword({
        email: "migrado@sitecorp.cu",
        password: "InitialPassword#2026!",
      })

      expect(result.error).toBeNull()
      expect(result.session?.user.id).toBe("migrated-user-uuid")
      // Emite evento de recuperación/cambio obligatorio
      expect(events.some((e) => e.event === "PASSWORD_RECOVERY")).toBe(true)
    })

    it("maneja credenciales inválidas (401) sin alterar el estado ni persistir sesión", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: "UNAUTHORIZED",
            message: "Credenciales de acceso incorrectas.",
          },
        }),
      })

      const adapter = createAdapter()
      const result = await adapter.signInWithPassword({
        email: "test@sitecorp.cu",
        password: "WrongPassword!",
      })

      expect(result.session).toBeNull()
      expect(result.error).toContain("Credenciales")
      expect(storage.getItem("sitecorp_self_hosted_session")).toBeNull()
    })
  })

  describe("2. Ciclo de sesión y actualización de contraseña (updatePassword)", () => {
    it("completa la activación de contraseña del usuario migrado inyectando la credencial provisional", async () => {
      // 1. Login inicial con mustChangePassword = true
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            accessToken: "token-provisional",
            tokenType: "Bearer",
            expiresInSeconds: 900,
            mustChangePassword: true,
            csrfToken: null,
            user: {
              id: "migrated-user-uuid",
              email: "migrado@sitecorp.cu",
              status: "PENDING_PASSWORD_CHANGE",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
          meta: { requestId: "r1", timestamp: "2026-01-01" },
        }),
      })

      const adapter = createAdapter()
      await adapter.signInWithPassword({
        email: "migrado@sitecorp.cu",
        password: "TempPassword#2026!",
      })

      // 2. Ejecutar updatePassword (como hace MustChangePassword sin conocer la anterior)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { passwordChanged: true },
          meta: { requestId: "r2", timestamp: "2026-01-01" },
        }),
      })

      const updateResult = await adapter.updatePassword({
        newPassword: "BrandNewDefinitivePassword#2026!",
      })

      expect(updateResult.success).toBe(true)
      expect(updateResult.error).toBeNull()

      // Comprobar que fetch fue llamado con la contraseña anterior y la nueva
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://auth.sitecorp.cu/api/v1/auth/change-password",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token-provisional",
          }),
          body: JSON.stringify({
            currentPassword: "TempPassword#2026!",
            newPassword: "BrandNewDefinitivePassword#2026!",
          }),
        })
      )
    })

    it("falla si no hay sesión activa al intentar actualizar contraseña", async () => {
      const adapter = createAdapter()
      const res = await adapter.updatePassword({ newPassword: "SomePassword#2026!" })
      expect(res.success).toBe(false)
      expect(res.error).toContain("No hay una sesión activa")
    })
  })

  describe("3. Renovación de token (refreshToken)", () => {
    it("renueva el access token mediante la cookie HttpOnly y actualiza la sesión", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            accessToken: "new-access-token-999",
            tokenType: "Bearer",
            expiresInSeconds: 900,
            csrfToken: "new-csrf-token",
            user: {
              id: "u-active",
              email: "active@sitecorp.cu",
              status: "ACTIVE",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          },
          meta: { requestId: "r-ref", timestamp: "2026-01-02" },
        }),
      })

      const adapter = createAdapter()
      const refreshed = await adapter.refreshToken()

      expect(refreshed).not.toBeNull()
      expect(refreshed?.accessToken).toBe("new-access-token-999")
      expect(storage.getItem("sitecorp_self_hosted_csrf")).toBe("new-csrf-token")
    })

    it("limpia la sesión si la renovación es rechazada con 401 Unauthorized", async () => {
      storage.setItem(
        "sitecorp_self_hosted_session",
        JSON.stringify({
          accessToken: "stale-token",
          user: { id: "u-1", email: "test@sitecorp.cu" },
        })
      )

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Refresh token revocado" } }),
      })

      const adapter = createAdapter()
      const refreshed = await adapter.refreshToken()

      expect(refreshed).toBeNull()
      expect(storage.getItem("sitecorp_self_hosted_session")).toBeNull()
    })
  })

  describe("4. Cierre de sesión (signOut)", () => {
    it("envía solicitud de revocación y purga inmediatamente la sesión local", async () => {
      storage.setItem(
        "sitecorp_self_hosted_session",
        JSON.stringify({
          accessToken: "token-to-revoke",
          user: { id: "u-1", email: "test@sitecorp.cu" },
        })
      )
      storage.setItem("sitecorp_self_hosted_csrf", "active-csrf")

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { loggedOut: true } }),
      })

      const adapter = createAdapter()
      const events: AuthStateChangeEvent[] = []
      adapter.subscribeToAuthChanges((e) => events.push(e))

      await adapter.signOut()

      expect(mockFetch).toHaveBeenCalledWith(
        "https://auth.sitecorp.cu/api/v1/auth/logout",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token-to-revoke",
            "x-csrf-token": "active-csrf",
          }),
        })
      )

      expect(storage.getItem("sitecorp_self_hosted_session")).toBeNull()
      expect(storage.getItem("sitecorp_self_hosted_csrf")).toBeNull()
      expect(events.some((e) => e.event === "SIGNED_OUT")).toBe(true)
    })
  })

  describe("5. Recuperación de contraseñas y consultas de identidad", () => {
    it("solicita recuperación de contraseña de forma no-enumerativa", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ok: true } }),
      })

      const adapter = createAdapter()
      const result = await adapter.requestPasswordRecovery({
        email: "user@sitecorp.cu",
      })

      expect(result.success).toBe(true)
      expect(result.error).toBeNull()
    })

    it("getCurrentUserId devuelve el id del usuario autenticado o null", async () => {
      storage.setItem(
        "sitecorp_self_hosted_session",
        JSON.stringify({
          accessToken: "valid-token",
          expiresAt: Math.floor(Date.now() / 1000) + 600,
          user: { id: "target-user-uuid", email: "user@sitecorp.cu" },
        })
      )

      const adapter = createAdapter()
      const userId = await adapter.getCurrentUserId()
      expect(userId).toBe("target-user-uuid")
    })
  })
})
