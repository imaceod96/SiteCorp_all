import { describe, expect, it } from "vitest"
import {
  computeMedicalCertificateDays,
  validateMedicalCertificateInput,
} from "../domain/rules"

describe("QA #3 — Certificados médicos: cálculo de días y período laboral", () => {
  it("calcula los días naturales entre la fecha de salida y la de reincorporación", () => {
    expect(computeMedicalCertificateDays("2026-11-16", "2026-11-20")).toBe(4)
    expect(computeMedicalCertificateDays("2026-11-20", "2026-11-16")).toBeNull()
    expect(computeMedicalCertificateDays("2026-11-20", "2026-11-20")).toBeNull()
  })

  it("rechaza incoherencia entre fechas y cantidad de días manual (ej. 01/11 a 05/11 con 30 días)", () => {
    const err = validateMedicalCertificateInput({
      startDate: "2026-11-01",
      returnDate: "2026-11-05",
      days: 30,
      employment: {
        periods: [{ hire_date: "2026-10-01", separation_date: null }],
        fallbackHireDate: "2026-10-01",
      },
    })
    expect(err).toContain("4 día(s)")
  })

  it("rechaza certificados anteriores al alta del trabajador (Laura Tester: alta 16/11/2026)", () => {
    const err = validateMedicalCertificateInput({
      startDate: "2026-11-01",
      returnDate: "2026-11-05",
      days: 4,
      employment: {
        periods: [{ hire_date: "2026-11-16", separation_date: null }],
        fallbackHireDate: "2026-11-16",
      },
    })
    expect(err).toContain("fuera del período laboral")
    expect(err).toContain("16/11/2026")
  })

  it("acepta un certificado válido dentro del período laboral con días consistentes", () => {
    const err = validateMedicalCertificateInput({
      startDate: "2026-11-18",
      returnDate: "2026-11-21",
      days: 3,
      employment: {
        periods: [{ hire_date: "2026-11-16", separation_date: null }],
        fallbackHireDate: "2026-11-16",
      },
    })
    expect(err).toBeNull()
  })
})
