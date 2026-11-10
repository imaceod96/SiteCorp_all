import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  supabase,
  configureSelfHostedRuntimeBridge,
  isSelfHostedModeActive,
} from "../../../lib/supabase"

interface WorkerRow {
  id: string
  first_name: string
  last_name: string
  identification_number: string
}

/**
 * Componente React de presentación del panel operativo autónomo de SiteCorp.
 * Renderiza el estado cargado desde la pasarela `/api/v1/submodules/*`.
 */
function AutonomousWorkersAndPayrollView({
  workers,
  totalCount,
  rpcStatus,
  errorBanner,
}: {
  workers: readonly WorkerRow[]
  totalCount: number
  rpcStatus: string
  errorBanner: string | null
}) {
  return (
    <section data-module="workers-and-payroll">
      <h1>Panel Operativo Autónomo SiteCorp</h1>
      <p data-testid="workers-count">Total trabajadores: {totalCount}</p>
      <p data-testid="rpc-status">Estado RPC: {rpcStatus}</p>
      {errorBanner && (
        <div role="alert" data-testid="error-banner">
          {errorBanner}
        </div>
      )}
      <ul data-testid="workers-list">
        {workers.map((w) => (
          <li key={w.id}>
            {w.first_name} {w.last_name} ({w.identification_number})
          </li>
        ))}
      </ul>
    </section>
  )
}

describe("Fase 4G.8 · Pruebas de Interfaz React y Puente Frontend sobre Pasarela Autónoma self_hosted", () => {
  const companyAId = "11111111-2222-4333-8444-555555555555"
  let capturedRequests: Array<{ url: string; method: string; body: unknown }> = []

  beforeEach(() => {
    capturedRequests = []
    const mockFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const method = init?.method ?? "GET"
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      capturedRequests.push({ url, method, body })

      if (url.endsWith("/api/v1/submodules/query/workers")) {
        return new Response(
          JSON.stringify({
            data: {
              rows: [
                {
                  id: "w-1",
                  first_name: "Carlos",
                  last_name: "Maceo Céspedes",
                  identification_number: "88041212345",
                },
                {
                  id: "w-2",
                  first_name: "Elena",
                  last_name: "Gómez Calixto",
                  identification_number: "91072554321",
                },
              ],
              count: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }

      if (url.endsWith("/api/v1/submodules/rpc/save_entity_plan")) {
        return new Response(
          JSON.stringify({
            data: {
              result: { saved: true, year: 2026 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }

      if (url.endsWith("/api/v1/submodules/edge/generate-document-pdf")) {
        return new Response(
          JSON.stringify({
            data: {
              result: { generated: true, documentId: "doc-2026-01" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }

      return new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "Operación no autorizada en pasarela." },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    }

    configureSelfHostedRuntimeBridge({
      provider: "self_hosted",
      apiBaseUrl: "http://127.0.0.1:4010",
      accessToken: "jwt-react-ui-test-token",
      activeCompanyId: companyAId,
      customFetch: mockFetch,
    })
  })

  afterEach(() => {
    configureSelfHostedRuntimeBridge({
      provider: "supabase",
      accessToken: null,
      activeCompanyId: null,
      customFetch: undefined,
    })
  })

  it("consulta trabajadores con filtros PostgREST y conteo exacto y renderiza el árbol React sin contactar Supabase Cloud", async () => {
    expect(isSelfHostedModeActive()).toBe(true)

    const { data, count, error } = await supabase
      .from("workers")
      .select("id, first_name, last_name, identification_number", { count: "exact" })
      .eq("company_client_id", companyAId)
      .order("first_name", { ascending: true })
      .range(0, 9)

    expect(error).toBeNull()
    const rows = (data as unknown as WorkerRow[]) ?? []
    expect(rows).toHaveLength(2)
    expect(count).toBe(2)

    const html = renderToStaticMarkup(
      <AutonomousWorkersAndPayrollView
        workers={rows}
        totalCount={count ?? 0}
        rpcStatus="ready"
        errorBanner={null}
      />
    )

    expect(html).toContain("Total trabajadores: 2")
    expect(html).toContain("Carlos Maceo Céspedes (88041212345)")
    expect(html).toContain("Elena Gómez Calixto (91072554321)")

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.url).toBe(
      "http://127.0.0.1:4010/api/v1/submodules/query/workers"
    )
    expect(capturedRequests[0]?.body).toMatchObject({
      operation: "select",
      companyClientId: companyAId,
      countExact: true,
      limit: 10,
      offset: 0,
    })
  })

  it("ejecuta RPCs y Edge Functions autónomas y renderiza alerta explícita ante joins PostgREST no soportados", async () => {
    const rpcRes = await supabase.rpc("save_entity_plan", {
      p_company_client_id: companyAId,
      p_plan_type: "FUERZA_TRABAJO",
      p_year: 2026,
    })
    expect(rpcRes.error).toBeNull()

    const edgeRes = await supabase.functions.invoke("generate-document-pdf", {
      body: { companyClientId: companyAId, templateCode: "TPL-01" },
    })
    expect(edgeRes.error).toBeNull()
    expect(edgeRes.data).toMatchObject({ generated: true, documentId: "doc-2026-01" })

    const unsupportedRes = await supabase
      .from("workers")
      .select("id, first_name, employment_contracts(id)")
    expect(unsupportedRes.error).not.toBeNull()
    expect(unsupportedRes.error?.code).toBe("UNSUPPORTED_POSTGREST_FEATURE")

    const html = renderToStaticMarkup(
      <AutonomousWorkersAndPayrollView
        workers={[]}
        totalCount={0}
        rpcStatus="plan_saved:2026"
        errorBanner={`${unsupportedRes.error?.code}: ${unsupportedRes.error?.message}`}
      />
    )

    expect(html).toContain("Estado RPC: plan_saved:2026")
    expect(html).toContain("UNSUPPORTED_POSTGREST_FEATURE")
  })
})
