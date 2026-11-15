import { beforeEach, describe, expect, it, vi } from "vitest"

const { eqMock, orMock, orderMock, rpcMock, selectMock, fromMock } = vi.hoisted(() => {
  const orderMock = vi.fn()
  const orMock = vi.fn()
  const eqMock = vi.fn()
  const selectMock = vi.fn()
  const rpcMock = vi.fn()

  const builder = {
    select: selectMock,
    eq: eqMock,
    or: orMock,
    order: orderMock,
  }
  selectMock.mockReturnValue(builder)
  eqMock.mockReturnValue(builder)
  orMock.mockReturnValue(builder)

  const fromMock = vi.fn(() => builder)
  return { eqMock, orMock, orderMock, rpcMock, selectMock, fromMock }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    functions: { invoke: vi.fn() },
    storage: { from: vi.fn() },
  },
}))

import {
  rpcCreateDocumentBatchesForEvent,
  selectBatchItems,
  selectPendingBatches,
  selectUngeneratedEventMovements,
} from "../infrastructure/document-batches.repository"
import { fetchPendingBatches } from "../application/document-batches.queries"

describe("QA #1 — Aislamiento por entidad en Documentos pendientes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const builder = {
      select: selectMock,
      eq: eqMock,
      or: orMock,
      order: orderMock,
    }
    selectMock.mockReturnValue(builder)
    eqMock.mockReturnValue(builder)
    orMock.mockReturnValue(builder)
    orderMock.mockResolvedValue({ data: [], error: null })
    rpcMock.mockResolvedValue({ data: { batches: 1 }, error: null })
  })

  it("fetchPendingBatches no consulta ni devuelve lotes si falta entityId", async () => {
    const res = await fetchPendingBatches("")
    expect(res).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("selectPendingBatches filtra estrictamente por organization_entity_id", async () => {
    await selectPendingBatches("entity-qa-ficticia")
    expect(fromMock).toHaveBeenCalledWith("document_batches")
    expect(eqMock).toHaveBeenCalledWith("organization_entity_id", "entity-qa-ficticia")
  })

  it("selectBatchItems valida que el lote pertenezca a la entidad activa", async () => {
    await selectBatchItems("batch-1", "entity-qa-ficticia")
    expect(fromMock).toHaveBeenCalledWith("document_batch_items")
    expect(eqMock).toHaveBeenCalledWith("batch_id", "batch-1")
    expect(eqMock).toHaveBeenCalledWith("batch.organization_entity_id", "entity-qa-ficticia")
  })

  it("selectUngeneratedEventMovements y rpcCreateDocumentBatchesForEvent acotan por entidad", async () => {
    const afterOr = { eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
    orMock.mockReturnValueOnce(afterOr)

    await selectUngeneratedEventMovements("event-1", "entity-qa-ficticia")
    expect(afterOr.eq).toHaveBeenCalledWith("organization_entity_id", "entity-qa-ficticia")

    await rpcCreateDocumentBatchesForEvent("event-1", "entity-qa-ficticia")
    expect(rpcMock).toHaveBeenCalledWith("create_document_batches_for_event", {
      p_event_id: "event-1",
      p_entity_id: "entity-qa-ficticia",
    })
  })
})
