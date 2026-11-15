import { beforeEach, describe, expect, it, vi } from "vitest"

const { selectMock, eqMock, orderMock, fromMock } = vi.hoisted(() => {
  const orderMock = vi.fn()
  const eqMock = vi.fn()
  const selectMock = vi.fn()
  const builder = { select: selectMock, eq: eqMock, order: orderMock }
  selectMock.mockReturnValue(builder)
  eqMock.mockReturnValue(builder)
  const fromMock = vi.fn(() => builder)
  return { selectMock, eqMock, orderMock, fromMock }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    storage: { from: vi.fn() },
  },
}))

import { fetchEntityOrganizationAreas } from "../infrastructure/training.repository"

describe("QA #2 — Carga de áreas organizativas en Capacitación", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const builder = { select: selectMock, eq: eqMock, order: orderMock }
    selectMock.mockReturnValue(builder)
    eqMock.mockReturnValue(builder)
  })

  it("consulta organization_areas sin solicitar la columna inexistente 'code'", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "area-1", name: "Dirección", is_active: true },
        { id: "area-2", name: "Recursos Humanos", is_active: true },
        { id: "area-3", name: "Dirección (2)", is_active: false },
      ],
      error: null,
    })

    const result = await fetchEntityOrganizationAreas("entity-qa")

    expect(fromMock).toHaveBeenCalledWith("organization_areas")
    expect(selectMock).toHaveBeenCalledWith("id, name, is_active")
    expect(eqMock).toHaveBeenCalledWith("organization_entity_id", "entity-qa")
    expect(result).toHaveLength(3)
    expect(result.filter((a) => a.is_active)).toHaveLength(2)
    expect(result[0]).toEqual({
      id: "area-1",
      name: "Dirección",
      code: null,
      is_active: true,
    })
  })
})
