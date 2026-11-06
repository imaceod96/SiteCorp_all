import { describe, expect, it, vi } from "vitest"
import {
  AuthProviderFactory,
  createAuthenticationProvider,
  type AuthProviderConfig,
} from "../infrastructure/auth-provider.factory"
import { SupabaseAuthAdapter, type SupabaseAuthClientLike } from "../infrastructure/supabase-auth.adapter"
import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"

function createMockSupabaseClient(): SupabaseAuthClientLike {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    }),
  }
}

describe("AuthProviderFactory (Fase 3A)", () => {
  describe("1. Selección explícita del proveedor Supabase", () => {
    it("crea una instancia de SupabaseAuthAdapter cuando se especifica type: 'supabase' con cliente mock", () => {
      const mockClient = createMockSupabaseClient()
      const provider = AuthProviderFactory.create({
        type: "supabase",
        client: mockClient,
      })

      expect(provider).toBeInstanceOf(SupabaseAuthAdapter)
    })

    it("la función auxiliar createAuthenticationProvider produce el mismo resultado que la clase", () => {
      const mockClient = createMockSupabaseClient()
      const provider = createAuthenticationProvider({
        type: "supabase",
        client: mockClient,
      })

      expect(provider).toBeInstanceOf(SupabaseAuthAdapter)
    })

    it("el proveedor retornado satisface íntegramente todos los métodos de IAuthenticationProvider", () => {
      const mockClient = createMockSupabaseClient()
      const provider: IAuthenticationProvider = AuthProviderFactory.create({
        type: "supabase",
        client: mockClient,
      })

      expect(typeof provider.getSession).toBe("function")
      expect(typeof provider.signInWithPassword).toBe("function")
      expect(typeof provider.signOut).toBe("function")
      expect(typeof provider.refreshToken).toBe("function")
      expect(typeof provider.updatePassword).toBe("function")
      expect(typeof provider.requestPasswordRecovery).toBe("function")
      expect(typeof provider.subscribeToAuthChanges).toBe("function")
      expect(typeof provider.getCurrentUserId).toBe("function")
    })
  })

  describe("2. Rechazo estricto de proveedores no implementados", () => {
    it("lanza un error explícito cuando se solicita el proveedor 'self_hosted'", () => {
      expect(() => {
        AuthProviderFactory.create({
          type: "self_hosted",
          baseUrl: "http://localhost:9999",
        })
      }).toThrowError(/El proveedor de autenticación 'self_hosted' aún no está disponible/)
    })

    it("no activa ningún fallback silencioso a Supabase si se solicita 'self_hosted'", () => {
      let createdProvider: IAuthenticationProvider | null = null

      try {
        createdProvider = AuthProviderFactory.create({ type: "self_hosted" })
      } catch {
        // Error esperado
      }

      expect(createdProvider).toBeNull()
    })
  })

  describe("3. Rechazo de configuraciones inválidas o malformadas", () => {
    it("lanza error si la configuración es null o undefined", () => {
      expect(() => AuthProviderFactory.create(null as unknown as AuthProviderConfig)).toThrowError(
        /Configuración de proveedor de autenticación no válida/
      )

      expect(() => AuthProviderFactory.create(undefined as unknown as AuthProviderConfig)).toThrowError(
        /Configuración de proveedor de autenticación no válida/
      )
    })

    it("lanza error si la configuración no tiene la propiedad 'type'", () => {
      expect(() => AuthProviderFactory.create({} as unknown as AuthProviderConfig)).toThrowError(
        /Configuración de proveedor de autenticación no válida/
      )
    })

    it("lanza error explícito si se pasa un tipo no soportado o desconocido", () => {
      const invalidConfig = { type: "firebase" } as unknown as AuthProviderConfig

      expect(() => AuthProviderFactory.create(invalidConfig)).toThrowError(
        /Proveedor de autenticación no reconocido: 'firebase'/
      )
    })
  })

  describe("4. Aislamiento e inmutabilidad de la factoría", () => {
    it("no realiza ninguna llamada de red ni accede a APIs externas al invocarse", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const mockClient = createMockSupabaseClient()

      const provider = AuthProviderFactory.create({
        type: "supabase",
        client: mockClient,
      })

      expect(provider).toBeDefined()
      expect(fetchSpy).not.toHaveBeenCalled()

      fetchSpy.mockRestore()
    })

    it("no conserva estado mutable compartido entre llamadas sucesivas", () => {
      const clientA = createMockSupabaseClient()
      const clientB = createMockSupabaseClient()

      const providerA = AuthProviderFactory.create({ type: "supabase", client: clientA })
      const providerB = AuthProviderFactory.create({ type: "supabase", client: clientB })

      expect(providerA).not.toBe(providerB)
    })
  })
})
