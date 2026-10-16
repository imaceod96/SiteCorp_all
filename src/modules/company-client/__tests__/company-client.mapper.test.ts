/**
 * Pruebas unitarias del mapper de compatibilidad Company Client.
 *
 * Verifican lógica PURA en memoria: no tocan Supabase, no usan React y no
 * conceden autorización. Se importa el mapper directamente (no el `index` del
 * dominio) para no cargar el repositorio ni instanciar el cliente Supabase.
 */
import { describe, expect, it } from "vitest"
import {
  companyClientIdToTenantId,
  tenantIdToCompanyClientId,
  toCompanyClient,
  type LegacyTenantSummary,
} from "../infrastructure/company-client.mapper"

/** UUID real de `tenants.id` (sin transformar). */
const TENANT_ID = "3f1c2b8a-9d4e-4f6a-8b2c-1e5d7a9c0b34"

const fullTenant: LegacyTenantSummary = {
  id: TENANT_ID,
  name: "Empresa Demo",
  code: "EMP-DEMO-01",
  description: "Cliente de prueba",
  is_active: true,
  created_at: "2026-01-02T03:04:05.000Z",
  updated_at: "2026-02-03T04:05:06.000Z",
}

describe("toCompanyClient", () => {
  it("conserva el identificador exactamente", () => {
    expect(toCompanyClient(fullTenant).companyClientId).toBe(TENANT_ID)
  })

  it("transforma correctamente todos los campos del cliente", () => {
    expect(toCompanyClient(fullTenant)).toEqual({
      companyClientId: TENANT_ID,
      name: "Empresa Demo",
      code: "EMP-DEMO-01",
      description: "Cliente de prueba",
      isActive: true,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-03T04:05:06.000Z",
    })
  })

  it("normaliza a null los campos opcionales ausentes", () => {
    const minimal: LegacyTenantSummary = { id: TENANT_ID, name: "Solo nombre" }

    expect(toCompanyClient(minimal)).toEqual({
      companyClientId: TENANT_ID,
      name: "Solo nombre",
      code: null,
      description: null,
      isActive: null,
      createdAt: null,
      updatedAt: null,
    })
  })

  it("normaliza a null los campos opcionales con valor null", () => {
    const explicitNulls: LegacyTenantSummary = {
      id: TENANT_ID,
      name: "Con nulos",
      code: null,
      description: null,
      is_active: null,
      created_at: null,
      updated_at: null,
    }

    expect(toCompanyClient(explicitNulls)).toEqual({
      companyClientId: TENANT_ID,
      name: "Con nulos",
      code: null,
      description: null,
      isActive: null,
      createdAt: null,
      updatedAt: null,
    })
  })

  it("no muta el objeto de origen (congelado)", () => {
    const frozen = Object.freeze({ ...fullTenant })
    const snapshot = { ...frozen }

    // Si el mapper intentara escribir sobre el origen, el modo estricto de ESM
    // lanzaría un TypeError y esta prueba fallaría.
    toCompanyClient(frozen)

    expect(frozen).toEqual(snapshot)
  })

  it("no genera un identificador nuevo ni deriva de él", () => {
    const other = toCompanyClient({ id: TENANT_ID, name: "Otro" })

    expect(other.companyClientId).toBe(TENANT_ID)
    expect(other.companyClientId).toBe(fullTenant.id)
  })
})

describe("correspondencia legacy ↔ dominio", () => {
  it("tenant_id → CompanyClientId es una identidad", () => {
    expect(tenantIdToCompanyClientId(TENANT_ID)).toBe(TENANT_ID)
  })

  it("CompanyClientId → tenant_id es una identidad", () => {
    expect(companyClientIdToTenantId(TENANT_ID)).toBe(TENANT_ID)
  })

  it("el recorrido completo conserva el valor original", () => {
    expect(companyClientIdToTenantId(tenantIdToCompanyClientId(TENANT_ID))).toBe(TENANT_ID)
  })
})
