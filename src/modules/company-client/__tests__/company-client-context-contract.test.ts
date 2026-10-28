import { describe, expect, it } from "vitest"
// `import type` se elimina en tiempo de ejecución: la prueba no arrastra React.
import type { CompanyClientSummary } from "@/contexts/CurrentCompanyClientContext"
import type { LegacyTenantSummary } from "../infrastructure/company-client.mapper"
import { toCompanyClient } from "../infrastructure/company-client.mapper"

/**
 * Protege la equivalencia entre el ESTADO DE INTERFAZ del cliente activo
 * (`CompanyClientSummary`, expuesto por `CurrentCompanyClientContext`) y el tipo
 * de compatibilidad del dominio (`LegacyTenantSummary`, fila legacy de `tenants`).
 *
 * Si ambas formas se separan, esta prueba deja de compilar, lo que obligaría a
 * introducir un adaptador explícito en lugar de degradar la lectura en silencio.
 */

const COMPANY_CLIENT_ID = "8b1e4c77-2f0a-4d51-9c3a-5e6f7a8b9c0d"

describe("Contrato del cliente activo (contexto ↔ dominio)", () => {
  it("CompanyClientSummary es asignable al tipo de compatibilidad del dominio", () => {
    const summary: CompanyClientSummary = {
      id: COMPANY_CLIENT_ID,
      name: "Grupo Empresarial Mayabeque",
      code: "GRUPO-EMPRESARIAL-MAYABEQUE-A7K4P2",
      description: null,
      is_active: true,
      created_at: null,
      updated_at: null,
    }

    // Compila solo mientras ambas formas sigan siendo equivalentes.
    const asLegacy: LegacyTenantSummary = summary

    expect(asLegacy).toBe(summary)
  })

  it("el cliente activo del contexto se proyecta al dominio sin adaptador", () => {
    const summary: CompanyClientSummary = { id: COMPANY_CLIENT_ID, name: "Cliente mínimo" }

    expect(toCompanyClient(summary)).toEqual({
      companyClientId: COMPANY_CLIENT_ID,
      name: "Cliente mínimo",
      code: null,
      description: null,
      isActive: null,
      createdAt: null,
      updatedAt: null,
    })
  })

  it("conserva el identificador del cliente (no se generan identificadores)", () => {
    const summary: CompanyClientSummary = { id: COMPANY_CLIENT_ID, name: "Cliente" }

    expect(toCompanyClient(summary).companyClientId).toBe(summary.id)
  })

  it("el cliente activo nulo del contexto no produce ningún cliente", () => {
    const summary: CompanyClientSummary | null = null

    expect(summary ? toCompanyClient(summary) : null).toBeNull()
  })
})
