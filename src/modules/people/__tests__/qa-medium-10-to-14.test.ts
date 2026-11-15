import { describe, expect, it, vi, beforeEach } from "vitest"
import { extractErrorMessage } from "@/utils/error-message"
import { validateReincorporationInput } from "@/modules/people/domain/rules"

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
  },
}))

vi.mock("@/modules/people/infrastructure/transition-documents", () => ({
  ensureAddendumDocument: vi.fn().mockResolvedValue(null),
  ensureContractDocument: vi.fn().mockResolvedValue(null),
  ensureMovementDocument: vi.fn().mockResolvedValue(null),
  ensureResolutionDocument: vi.fn().mockResolvedValue(null),
}))

import {
  registerWorkerSeparation,
  cancelScheduledWorkerSeparation,
} from "@/modules/people/application/worker-transitions.commands"

describe("QA Medios #10–#14", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("#10 — Diálogo de cambio salarial espera cálculo de impacto y conserva importe vigente", () => {
    it("ReviewSalaryChangeDialog usa currentValue de respaldo y bloquea envío mientras previewLoading es true", async () => {
      const fs = await import("fs")
      const content = fs.readFileSync(
        "src/modules/contracts/presentation/components/ReviewSalaryChangeDialog.tsx",
        "utf8"
      )
      expect(content).toContain("currentValue?:")
      expect(content).toContain("Calculando importe vigente")
      expect(content).toContain("!previewLoading &&")
      expect(content).toContain("!!preview &&")
      expect(content).toContain("extractErrorMessage")
    })
  })

  describe("#11 — Cambio salarial en escala respeta inicio de contrato futuro en SQL", () => {
    it("La migración 20261115000002 filtra contratos con COALESCE(c.start_date, a.start_date) <= effective_date", async () => {
      const fs = await import("fs")
      const sql = fs.readFileSync(
        "supabase/migrations/20261115000002_qa_medium_10_to_14.sql",
        "utf8"
      )
      expect(sql).toContain("AND COALESCE(c.start_date, a.start_date) <= ctx.ref_date")
      expect(sql).toContain("AND c.start_date > v_effective")
      expect(sql).toContain("and coalesce(c.start_date, a.start_date) <= p_effective_date")
    })
  })

  describe("#12 — Bajas futuras programadas vs inmediatas", () => {
    it("Una baja futura programada retorna scheduled: true y cancelScheduledWorkerSeparation invoca su RPC", async () => {
      rpcMock.mockResolvedValueOnce({
        data: { scheduled: true, effective_date: "2026-12-31" },
        error: null,
      })

      const outcome = await registerWorkerSeparation({
        workerId: "w-1",
        effectiveDate: "2026-12-31",
        separationReasonId: "r-1",
        notes: "Baja programada de fin de año",
      })

      expect(outcome).toEqual({ scheduled: true, effectiveDate: "2026-12-31" })
      expect(rpcMock).toHaveBeenCalledWith("register_worker_separation", {
        p_worker_id: "w-1",
        p_effective_date: "2026-12-31",
        p_separation_reason_id: "r-1",
        p_notes: "Baja programada de fin de año",
      })

      rpcMock.mockResolvedValueOnce({ data: { cancelled: true }, error: null })
      await cancelScheduledWorkerSeparation({ workerId: "w-1" })
      expect(rpcMock).toHaveBeenCalledWith("cancel_scheduled_worker_separation", {
        p_worker_id: "w-1",
      })
    })
  })

  describe("#13 — Anexos pendientes bloqueados sobre contratos finalizados", () => {
    it("ContractAddendumsSection solo permite «Nuevo anexo» cuando existe contrato con isCurrent === true", async () => {
      const fs = await import("fs")
      const content = fs.readFileSync(
        "src/modules/contracts/presentation/components/ContractAddendumsSection.tsx",
        "utf8"
      )
      expect(content).toContain("contracts.find((row) => row.isCurrent) || null")
      expect(content).not.toContain("contracts[0]")
    })
  })

  describe("#14 — Reincorporación valida fecha contra baja previa y extrae errores PostgREST", () => {
    it("extractErrorMessage conserva el mensaje real de PostgrestError (objeto plano)", () => {
      const postgrestErr = {
        message: "La fecha de reincorporación debe ser posterior al fin del período laboral anterior (25/11/2026)",
        code: "P0001",
        details: null,
        hint: null,
      }
      expect(extractErrorMessage(postgrestErr, "Fallback")).toBe(postgrestErr.message)
      expect(extractErrorMessage(new Error("Error JS"), "Fallback")).toBe("Error JS")
      expect(extractErrorMessage(null, "Fallback")).toBe("Fallback")
    })

    it("validateReincorporationInput rechaza reincorporación en fecha igual o anterior a la última baja", () => {
      const baseInput = {
        positionId: "pos-1",
        lastSeparationDate: "2026-11-25",
        resolutionDocument: false,
        contractTypeId: "ct-1",
        signatureDate: "2026-11-26",
        formalization: {
          representativeAssignmentId: "rep-1",
          signatureDate: "2026-11-26",
          signaturePlace: "Cotorro",
          paymentMethodId: "pm-1",
          paymentScheduleText: "",
          hasInvalidComponents: false,
          blocking: [],
        },
        isDetermined: false,
        contractStartDate: "2026-11-26",
        contractEndDate: "",
      }

      expect(
        validateReincorporationInput({ ...baseInput, reincorporationDate: "2026-11-25" })
      ).toContain("25/11/2026")
      expect(
        validateReincorporationInput({ ...baseInput, reincorporationDate: "2026-11-20" })
      ).toContain("25/11/2026")
      expect(
        validateReincorporationInput({ ...baseInput, reincorporationDate: "2026-11-26" })
      ).toBeNull()
    })
  })
})
