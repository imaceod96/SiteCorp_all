/**
 * Pruebas unitarias del repositorio de lectura Company Client.
 *
 * El módulo `@/lib/supabase` se MOCKEA por completo: no hay conexión real con
 * Supabase y no se ejecuta ninguna consulta. Estas pruebas validan únicamente el
 * comportamiento del código (qué tabla, qué campos, qué filtro y qué operación
 * de lectura usa). NO son una prueba real de RLS: la autorización efectiva vive
 * en RLS y en `can_access_entity`, y solo puede comprobarse contra el backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { fromMock, selectMock, eqMock, maybeSingleMock, writeMocks } = vi.hoisted(() => {
  const notAllowed = (name: string) =>
    vi.fn(() => {
      throw new Error(`Operación de escritura no permitida: ${name}`)
    })

  return {
    fromMock: vi.fn(),
    selectMock: vi.fn(),
    eqMock: vi.fn(),
    maybeSingleMock: vi.fn(),
    writeMocks: {
      insert: notAllowed("insert"),
      update: notAllowed("update"),
      delete: notAllowed("delete"),
      upsert: notAllowed("upsert"),
      rpc: notAllowed("rpc"),
    },
  }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: writeMocks.rpc,
  },
}))

import { getCompanyClientById } from "../infrastructure/company-client.repository"

const TENANT_ID = "3f1c2b8a-9d4e-4f6a-8b2c-1e5d7a9c0b34"
const EXPECTED_FIELDS = "id, name, code, description, is_active, created_at, updated_at"

const row = {
  id: TENANT_ID,
  name: "Empresa Demo",
  code: "EMP-DEMO-01",
  description: "Cliente de prueba",
  is_active: true,
  created_at: "2026-01-02T03:04:05.000Z",
  updated_at: "2026-02-03T04:05:06.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()

  const builder = {
    select: selectMock,
    insert: writeMocks.insert,
    update: writeMocks.update,
    delete: writeMocks.delete,
    upsert: writeMocks.upsert,
  }

  fromMock.mockReturnValue(builder)
  selectMock.mockReturnValue({ eq: eqMock })
  eqMock.mockReturnValue({ maybeSingle: maybeSingleMock })
})

describe("getCompanyClientById — consulta", () => {
  it("consulta exclusivamente la tabla tenants", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await getCompanyClientById(TENANT_ID)

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith("tenants")
  })

  it("selecciona explícitamente los campos esperados", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await getCompanyClientById(TENANT_ID)

    expect(selectMock).toHaveBeenCalledWith(EXPECTED_FIELDS)
  })

  it("filtra por la columna física id", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await getCompanyClientById(TENANT_ID)

    expect(eqMock).toHaveBeenCalledWith("id", TENANT_ID)
  })

  it("utiliza maybeSingle()", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await getCompanyClientById(TENANT_ID)

    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })
})

describe("getCompanyClientById — resultado", () => {
  it("devuelve un CompanyClient cuando existe la fila", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await expect(getCompanyClientById(TENANT_ID)).resolves.toEqual({
      companyClientId: TENANT_ID,
      name: "Empresa Demo",
      code: "EMP-DEMO-01",
      description: "Cliente de prueba",
      isActive: true,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-03T04:05:06.000Z",
    })
  })

  it("devuelve null cuando no existe la fila", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    await expect(getCompanyClientById(TENANT_ID)).resolves.toBeNull()
  })

  it("propaga el error de Supabase sin ocultarlo", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error("boom") })

    await expect(getCompanyClientById(TENANT_ID)).rejects.toThrow("boom")
  })
})

describe("getCompanyClientById — solo lectura", () => {
  it("no ejecuta ninguna operación de escritura", async () => {
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await getCompanyClientById(TENANT_ID)

    expect(writeMocks.insert).not.toHaveBeenCalled()
    expect(writeMocks.update).not.toHaveBeenCalled()
    expect(writeMocks.delete).not.toHaveBeenCalled()
    expect(writeMocks.upsert).not.toHaveBeenCalled()
    expect(writeMocks.rpc).not.toHaveBeenCalled()
  })
})
