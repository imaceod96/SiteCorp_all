/**
 * Pruebas FOCALIZADAS del alta manual de anexos con dos contratos vigentes (pluriempleo).
 *
 * `@/lib/supabase` se mockea por completo: no hay conexión real, no se ejecuta SQL y no
 * se toca Supabase. La prueba comprueba una sola cosa — QUÉ CONTRATO RECIBE EL ANEXO:
 *
 *   · el contrato seleccionado en la ficha viaja como `p_target_contract_id`;
 *   · cada contrato seleccionado recibe su propio anexo (dos altas, dos ids distintos);
 *   · con un único contrato activo el parámetro NO se envía: la llamada queda
 *     EXACTAMENTE como está hoy y la RPC resuelve el contrato por sí misma.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }))

import { rpcCreateContractAddendum } from "../infrastructure/addendums.repository"
import { createManualAddendum } from "../application/addendums.commands"

const WORKER_ID = "8d9b6f52-1c34-4d0f-9c62-1f0f2a7b6a11"
/** Contrato seleccionado en la ficha (pluriempleo: dos contratos vigentes). */
const CONTRACT_A = "f02d1e49-2f0a-4c12-9c9f-3b6a1d4e5f60"
const CONTRACT_B = "a4c1b6d2-7e55-4a30-8f2b-9d77c0e1b812"

const baseInput = {
  workerId: WORKER_ID,
  changes: [
    {
      field_code: "WORK_LOCATION",
      old_value: "Oficina Central",
      new_value: "Dirección General",
      old_display_value: "Oficina Central",
      new_display_value: "Dirección General",
      old_reference_id: null,
      new_reference_id: null,
      display_order: 7,
    },
  ],
  reasonCode: "COMPENSATION_CHANGE" as const,
  reason: "Cambio de condiciones",
  effectiveDate: "2026-03-01",
}

/** Parámetros del envío n-ésimo a la RPC (el segundo argumento de `supabase.rpc`). */
const paramsOf = (call: number): Record<string, unknown> =>
  rpcMock.mock.calls[call][1] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockResolvedValue({
    data: { status: "OK", addendum_id: "11111111-1111-4111-8111-111111111111", addendum_number: 3 },
    error: null,
  })
})

describe("create_contract_addendum — contrato que recibe el anexo", () => {
  it("envía el contrato seleccionado como p_target_contract_id", async () => {
    await rpcCreateContractAddendum({ ...baseInput, targetContractId: CONTRACT_A })

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0][0]).toBe("create_contract_addendum")
    expect(paramsOf(0)).toMatchObject({
      p_worker_id: WORKER_ID,
      p_target_contract_id: CONTRACT_A,
      p_source_type: "MANUAL",
    })
  })

  it("cada contrato seleccionado recibe su propio anexo", async () => {
    await rpcCreateContractAddendum({ ...baseInput, targetContractId: CONTRACT_A })
    await rpcCreateContractAddendum({ ...baseInput, targetContractId: CONTRACT_B })

    expect(paramsOf(0).p_target_contract_id).toBe(CONTRACT_A)
    expect(paramsOf(1).p_target_contract_id).toBe(CONTRACT_B)
  })

  it("con un único contrato activo NO envía p_target_contract_id", async () => {
    await rpcCreateContractAddendum({ ...baseInput, targetContractId: null })

    expect(paramsOf(0)).not.toHaveProperty("p_target_contract_id")
  })

  it("sin contrato indicado tampoco envía el parámetro", async () => {
    await rpcCreateContractAddendum(baseInput)

    expect(paramsOf(0)).not.toHaveProperty("p_target_contract_id")
  })
})

describe("createManualAddendum — la interfaz transmite el contrato seleccionado", () => {
  it("reenvía el contrato seleccionado a la RPC", async () => {
    await createManualAddendum({ ...baseInput, targetContractId: CONTRACT_B })

    expect(paramsOf(0).p_target_contract_id).toBe(CONTRACT_B)
  })

  it("conserva el resto de parámetros del alta manual", async () => {
    await createManualAddendum({
      ...baseInput,
      targetContractId: CONTRACT_B,
      requireFormalized: true,
    })

    expect(paramsOf(0)).toMatchObject({
      p_changes: baseInput.changes,
      p_reason_code: "COMPENSATION_CHANGE",
      p_effective_date: "2026-03-01",
      p_source_type: "MANUAL",
      p_require_formalized: true,
      p_target_contract_id: CONTRACT_B,
    })
  })
})
