import { describe, it, expect, vi } from "vitest"
import {
  SelfHostedDomainClient,
  SelfHostedDomainHttpError,
} from "../infrastructure/self-hosted-domain.client"
import type { IAuthenticationProvider } from "../domain/auth-provider.contracts"

function createMockAuthProvider(accessToken: string | null): IAuthenticationProvider {
  return {
    getSession: vi.fn().mockResolvedValue(
      accessToken
        ? {
            accessToken,
            expiresAt: Math.floor(Date.now() / 1000) + 900,
            user: {
              id: "user-123",
              email: "admin@sitecorp.cu",
              confirmedAt: "2026-01-01T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
            },
          }
        : null
    ),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    refreshToken: vi.fn(),
    updatePassword: vi.fn(),
    requestPasswordRecovery: vi.fn(),
    subscribeToAuthChanges: vi.fn().mockReturnValue(() => undefined),
    getCurrentUserId: vi.fn().mockResolvedValue(accessToken ? "user-123" : null),
  }
}

describe("SelfHostedDomainClient · Cliente autónomo para modo self_hosted", () => {
  it("rechaza con 401 UNAUTHENTICATED si no existe sesión activa", async () => {
    const fetchMock = vi.fn()
    const client = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider: createMockAuthProvider(null),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    await expect(client.listCompanies()).rejects.toThrow(SelfHostedDomainHttpError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("envía cabeceras Bearer y ejecuta operaciones de dominio y Storage sin invocar Supabase", async () => {
    const calledUrls: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      calledUrls.push(url)
      return new Response(
        JSON.stringify({
          data: {
            companies: [
              {
                id: "comp-1",
                code: "ALFA",
                name: "Empresa Alfa",
                description: null,
                logoUrl: null,
                isActive: true,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    })

    const client = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider: createMockAuthProvider("jwt-token-xyz"),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    const companies = await client.listCompanies()
    expect(companies).toHaveLength(1)
    expect(companies[0]?.code).toBe("ALFA")
    expect(calledUrls).toEqual(["http://127.0.0.1:4010/api/v1/domain/companies"])
  })

  it("propaga errores HTTP 403 FORBIDDEN cuando el backend deniega acceso multiempresa", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Acceso denegado: no pertenece a la empresa solicitada.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    })

    const client = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider: createMockAuthProvider("jwt-token-xyz"),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    await expect(client.listWorkers("comp-foreign")).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    })
  })
})
