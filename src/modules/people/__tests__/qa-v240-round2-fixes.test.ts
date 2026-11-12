import { describe, expect, it } from "vitest"
import {
  ciToBirthDate,
  formatIsoDateToDisplay,
  IDENTIFICATION_LENGTH,
  sanitizeIdentificationInput,
} from "@/utils/ci"
import { candidateRequiresSpecialty } from "../domain/rules"

describe("QA Ronda 2 — Personas, Candidatos y Migración", () => {
  it("ciToBirthDate devuelve formato YYYY-MM-DD local exacto sin desfase horario y formatIsoDateToDisplay lo convierte a dd/mm/aaaa", () => {
    const iso = ciToBirthDate("95031512345")
    expect(iso).toBe("1995-03-15")
    expect(formatIsoDateToDisplay(iso)).toBe("15/03/1995")

    const year2000 = ciToBirthDate("02010154321")
    expect(year2000).toBe("2002-01-01")
    expect(formatIsoDateToDisplay(year2000)).toBe("01/01/2002")

    // Fecha inválida (31 de febrero) -> null
    expect(ciToBirthDate("95023112345")).toBeNull()
  })

  it("sanitizeIdentificationInput elimina caracteres no numéricos y recorta exactamente a 11 dígitos", () => {
    expect(sanitizeIdentificationInput("950315123456789012345")).toBe("95031512345")
    expect(sanitizeIdentificationInput("95-03-15 12345abc")).toBe("95031512345")
    expect(sanitizeIdentificationInput("950315123456789012345")).toHaveLength(
      IDENTIFICATION_LENGTH
    )
  })

  it("candidateRequiresSpecialty reconoce Obrero Calificado, Técnico Medio y Superior (consistente entre listado y ficha)", () => {
    expect(candidateRequiresSpecialty("Obrero Calificado")).toBe(true)
    expect(candidateRequiresSpecialty("Técnico Medio")).toBe(true)
    expect(candidateRequiresSpecialty("Superior")).toBe(true)
    expect(candidateRequiresSpecialty("Secundaria Básica")).toBe(false)
    expect(candidateRequiresSpecialty(null)).toBe(false)
  })
})
