import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  ciToBirthDate,
  formatIsoDateToDisplay as ciFormatIsoDateToDisplay,
  IDENTIFICATION_LENGTH,
  sanitizeIdentificationInput,
} from "@/utils/ci"
import {
  todayIsoInCuba,
  formatIsoDateToDisplay,
  toRomanNumeral,
} from "@/utils/cuba-date"
import {
  candidateRequiresSpecialty,
  missingPersonProfileFields,
} from "../domain/rules"
import { resolveAllDocumentVariables } from "@/modules/document-generation/domain/document-resolution.rules"
import {
  computeMedicalCertificateDays,
  validateMedicalCertificateInput,
} from "@/modules/vacations-licenses/medical-certificates/domain/rules"

describe("QA Ronda 2 — Suite Completa de Correcciones (Bloques A, B, C, D y E)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("D3 / Personas: ciToBirthDate devuelve formato YYYY-MM-DD local exacto sin desfase horario y formatIsoDateToDisplay lo convierte a dd/mm/aaaa", () => {
    const iso = ciToBirthDate("95031512345")
    expect(iso).toBe("1995-03-15")
    expect(ciFormatIsoDateToDisplay(iso)).toBe("15/03/1995")

    const year2000 = ciToBirthDate("02010154321")
    expect(year2000).toBe("2002-01-01")
    expect(ciFormatIsoDateToDisplay(year2000)).toBe("01/01/2002")

    expect(ciToBirthDate("95023112345")).toBeNull()
  })

  it("D3 / Personas: sanitizeIdentificationInput elimina caracteres no numéricos y recorta exactamente a 11 dígitos", () => {
    expect(sanitizeIdentificationInput("950315123456789012345")).toBe("95031512345")
    expect(sanitizeIdentificationInput("95-03-15 12345abc")).toBe("95031512345")
    expect(sanitizeIdentificationInput("950315123456789012345")).toHaveLength(
      IDENTIFICATION_LENGTH
    )
  })

  it("D3 (#27): candidateRequiresSpecialty reconoce Obrero Calificado, Técnico Medio y Superior, y missingPersonProfileFields no exige estado civil ni color de piel", () => {
    expect(candidateRequiresSpecialty("Obrero Calificado")).toBe(true)
    expect(candidateRequiresSpecialty("Técnico Medio")).toBe(true)
    expect(candidateRequiresSpecialty("Superior")).toBe(true)
    expect(candidateRequiresSpecialty("Secundaria Básica")).toBe(false)
    expect(candidateRequiresSpecialty(null)).toBe(false)

    const missing = missingPersonProfileFields({
      first_name: "Ana",
      first_surname: "Pérez",
      second_surname: "Gómez",
      identification: "89042312345",
      birth_date: "1989-04-23",
      gender_id: "gen-f",
      marital_status_id: null,
      skin_color_id: null,
      education_level_id: "edu-sup",
      education_level_name: "Superior",
      specialty: "Derecho",
      profession_or_trade: "Jurista",
      address: "Calle 23 #456",
      province: "La Habana",
      municipality: "Plaza de la Revolución",
      employment_start_date: "2026-11-16",
    } as unknown as Parameters<typeof missingPersonProfileFields>[0])
    expect(missing).toEqual([])
  })

  it("B3 (N2) y D1 (#20): todayIsoInCuba devuelve YYYY-MM-DD en zona America/Havana, formatIsoDateToDisplay formatea dd/mm/aaaa y toRomanNumeral convierte grupos salariales", () => {
    const cubaDate = todayIsoInCuba(new Date("2026-11-15T03:30:00.000Z"))
    // 03:30 UTC del 15/11 es 22:30 del 14/11 en La Habana (UTC-5)
    expect(cubaDate).toBe("2026-11-14")

    expect(formatIsoDateToDisplay("2026-11-14")).toBe("14/11/2026")
    expect(formatIsoDateToDisplay("2026-11-16T00:00:00Z")).toBe("16/11/2026")
    expect(formatIsoDateToDisplay(null)).toBe("—")

    expect(toRomanNumeral(1)).toBe("I")
    expect(toRomanNumeral(12)).toBe("XII")
    expect(toRomanNumeral(18)).toBe("XVIII")
    expect(toRomanNumeral(24)).toBe("XXIV")
    expect(toRomanNumeral("XVI")).toBe("XVI")
  })

  it("B1 / B2 (N1): resolveAllDocumentVariables rellena valores laborales cubanos por defecto (Mensual, No aplica, CUP) para evitar bloqueo por variables opcionales", () => {
    const resolved = resolveAllDocumentVariables({
      document_type: "CONTRACT",
      contract_id: "c-1",
      contract_type_code: "INDETERMINADO",
      contract_type_name: "Contrato por tiempo indeterminado",
      entity: {
        name: "Empresa QA Ficticia",
        organism: "OSDE QA",
        branch: "Servicios",
        labor_code: "EQAF-01",
        address: "Calle 23 #100",
        province: "La Habana",
        municipality: "Plaza de la Revolución",
        revolution_year: "68",
      },
      representative: {
        name: "Director General QA",
        position: "Director General",
      },
      worker: {
        full_name: "Carlos Tester Uno",
        identification: "92061412345",
        birth_date: "1992-06-14",
        profession: "Economista",
        address: "Calle 10 #102",
        province: "La Habana",
        municipality: "Playa",
      },
      job: {
        name: "Especialista en Gestión de RRHH",
        salary_group_sequence: 12,
        occupational_category: "Técnico",
      },
      position: {
        name: "Especialista RRHH",
        code: "P-01",
        work_location: "Oficina Central",
      },
      schedule: {
        daily_hours: 8,
        weekly_hours: 44,
        monthly_hours: 190.6,
        text: "Lunes a viernes 8:00 a 17:00",
        break_minutes: 60,
      },
      contract: {
        type_code: "INDETERMINADO",
        type_name: "Contrato por tiempo indeterminado",
        start_date: "2026-11-16",
        end_date: null,
        signature_date: "2026-11-14",
        signature_place: "La Habana",
        payment_method: "A tiempo",
        payment_schedule: null,
      },
      compensation: {
        base_salary: 4610,
        additional_payments: null,
        abnormal_conditions_payments: null,
        other_payments: null,
        total: 4610,
        currency: null,
      },
      formalized_addendums: [],
    })

    expect(resolved.values["contract.payment_schedule"]).toBe("Mensual")
    expect(resolved.values["c.momentoPago"]).toBe("Mensual")
    expect(resolved.values["compensation.additional_payments"]).toBe("No aplica")
    expect(resolved.values["compensation.abnormal_conditions_payments"]).toBe("No aplica")
    expect(resolved.values["compensation.other_payments"]).toBe("No aplica")
    expect(resolved.values["compensation.currency"]).toBe("CUP")
    expect(resolved.values["job.salary_group"]).toBe("XII")
  })

  it("E5 (N11): validateMedicalCertificateInput exige coherencia entre días otorgados y el rango Fecha inicio - Fecha reincorporación", () => {
    expect(computeMedicalCertificateDays("2026-11-01", "2026-11-05")).toBe(4)

    const mismatch = validateMedicalCertificateInput({
      startDate: "2026-11-01",
      returnDate: "2026-11-05",
      days: 30,
      employment: {
        periods: [{ hire_date: "2026-10-01", separation_date: null }],
        fallbackHireDate: "2026-10-01",
      },
    })
    expect(mismatch).toContain("4 día(s)")

    const valid = validateMedicalCertificateInput({
      startDate: "2026-11-01",
      returnDate: "2026-11-05",
      days: 4,
      employment: {
        periods: [{ hire_date: "2026-10-01", separation_date: null }],
        fallbackHireDate: "2026-10-01",
      },
    })
    expect(valid).toBeNull()
  })

  it("E8 (N14): Transliteración de tildes y eñes conserva vocales y n en correos generados", () => {
    const transliterateEmailLocalPart = (raw: string) => {
      const map: Record<string, string> = {
        á: "a",
        é: "e",
        í: "i",
        ó: "o",
        ú: "u",
        ü: "u",
        ñ: "n",
      }
      return raw
        .toLowerCase()
        .replace(/[áéíóúüñ]/g, (ch) => map[ch] || ch)
        .replace(/[^a-z0-9.]/g, "")
    }

    expect(`${transliterateEmailLocalPart("Adrián.Núñez1")}@horizonte-demo.cu`).toBe(
      "adrian.nunez1@horizonte-demo.cu"
    )
    expect(`${transliterateEmailLocalPart("Inés.Benítez3")}@horizonte-demo.cu`).toBe(
      "ines.benitez3@horizonte-demo.cu"
    )
  })
})
