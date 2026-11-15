import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  IDENTIFICATION_BIRTHDATE_MISMATCH_ERROR,
  IDENTIFICATION_CALENDAR_DATE_ERROR,
  IDENTIFICATION_ERROR_MESSAGE,
  isCompleteIsoDate,
  validateIdentificationWithBirthDate,
} from "@/utils/ci"
import { validateHireInput } from "@/modules/people/domain/rules"

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
  },
}))

import { fetchRepresentativePositions } from "@/modules/representatives/infrastructure/representatives.repository"

describe("QA Altos #6–#9", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("#6 — Validación de Carné de Identidad cubano y fecha de nacimiento", () => {
    it("rechaza formatos inválidos, fechas imposibles (mes 13 / 30 feb) y discrepancias con nacimiento", () => {
      expect(validateIdentificationWithBirthDate("950131", "31/01/1995")).toBe(
        IDENTIFICATION_ERROR_MESSAGE
      )
      expect(validateIdentificationWithBirthDate("95133112345", "31/01/1995")).toBe(
        IDENTIFICATION_CALENDAR_DATE_ERROR
      )
      expect(validateIdentificationWithBirthDate("95023012345", "28/02/1995")).toBe(
        IDENTIFICATION_CALENDAR_DATE_ERROR
      )
      expect(validateIdentificationWithBirthDate("95013012345", "31/01/1995")).toBe(
        IDENTIFICATION_BIRTHDATE_MISMATCH_ERROR
      )
      expect(validateIdentificationWithBirthDate("95013112345", "31/01/1995")).toBeNull()
      expect(validateIdentificationWithBirthDate("95013112345", "1995-01-31")).toBeNull()
    })
  })

  describe("#7 — Lugar de firma y validación inmediata de formalización", () => {
    it("rechaza lugar de firma vacío en estado real aunque exista municipio por defecto y acepta cuando está informado", () => {
      const baseInput = {
        hasCandidate: true,
        positionId: "pos-1",
        hireDate: "2026-11-16",
        resolutionDocument: false,
        skipsContractTerms: false,
        contractTypeId: "type-1",
        signatureDate: "2026-11-16",
        readiness: null,
        templateBlockedMessage: null,
        isDetermined: false,
        contractStartDate: "2026-11-16",
        contractEndDate: "",
      }

      expect(
        validateHireInput({
          ...baseInput,
          formalization: {
            representativeAssignmentId: "rep-1",
            signatureDate: "2026-11-16",
            signaturePlace: "",
            paymentMethodId: "pm-1",
            paymentScheduleText: "",
            hasInvalidComponents: false,
            blocking: [],
          },
        })
      ).toBe("El lugar de firma es obligatorio.")

      expect(
        validateHireInput({
          ...baseInput,
          formalization: {
            representativeAssignmentId: "rep-1",
            signatureDate: "2026-11-16",
            signaturePlace: "Cotorro",
            paymentMethodId: "pm-1",
            paymentScheduleText: "",
            hasInvalidComponents: false,
            blocking: [],
          },
        })
      ).toBeNull()
    })
  })

  describe("#8 — Representantes autorizados y guardia de fecha completa", () => {
    it("isCompleteIsoDate descarta fechas parciales al teclear en <input type=date>", () => {
      expect(isCompleteIsoDate("0002-11-16")).toBe(false)
      expect(isCompleteIsoDate("2026-02-30")).toBe(false)
      expect(isCompleteIsoDate("2026-11-16")).toBe(true)
    })

    it("fetchRepresentativePositions envía fecha ISO vigente en lugar de null explícito cuando se omite onDate", async () => {
      rpcMock.mockResolvedValueOnce({ data: [], error: null })
      await fetchRepresentativePositions("entity-1")
      expect(rpcMock).toHaveBeenCalledTimes(1)
      const [fnName, params] = rpcMock.mock.calls[0]
      expect(fnName).toBe("resolve_entity_representatives")
      expect(params.p_entity_id).toBe("entity-1")
      expect(params.p_on_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe("#9 — Prevención de sobrescritura en Datos contractuales", () => {
    it("EntitySettingsContractData usa actualizadores funcionales en setContractData", async () => {
      const fs = await import("fs")
      const content = fs.readFileSync(
        "src/modules/organization-structure/presentation/pages/EntitySettingsContractData.tsx",
        "utf8"
      )
      expect(content).not.toContain("setContractData({ ...contractData,")
      expect(content).toContain("loadRequestIdRef")
    })
  })
})
