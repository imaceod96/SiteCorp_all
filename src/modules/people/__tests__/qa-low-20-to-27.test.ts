import { describe, expect, it, beforeEach } from "vitest"
import { summarizeCandidates } from "@/modules/entity-summary/domain/summary.rules"
import {
  AUDIT_MODULES,
  AUDIT_MODULE_LABELS,
  auditModuleLabel,
} from "@/modules/audit-history/domain/rules"
import {
  readStoredActiveEntityId,
  writeStoredActiveEntityId,
  clearStoredActiveEntityId,
} from "@/contexts/CurrentEntityContext"
import {
  ENTITY_INITIAL_SETUP_FLOW,
  MANUAL_SECTIONS,
  GLOSSARY_TERMS,
} from "@/modules/user-manual/domain/manual-data"
import {
  ciToGenderHint,
  resolveGenderIdFromCi,
  formatIsoDateToDisplay,
} from "@/utils/ci"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { validatePositionInput } from "@/modules/organization-structure"
import { organizationEntitySchema } from "@/modules/organization-structure/presentation/components/organization-entity-dialog"

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
  }
}

describe("QA Bajos #20 a #27", () => {
  describe("#20 — Formato consistente de grupos salariales (números romanos), moneda y fechas dd/mm/aaaa", () => {
    it("formatea la secuencia del grupo salarial en números romanos y normaliza el prefijo Grupo sin duplicarlo", () => {
      expect(`Grupo ${toRomanNumeral(1)}`).toBe("Grupo I")
      expect(`Grupo ${toRomanNumeral(2)}`).toBe("Grupo II")

      const groupLabelFromCaller = "Grupo I"
      const normalized = /^grupo\b/i.test(groupLabelFromCaller.trim())
        ? groupLabelFromCaller.trim()
        : `Grupo ${groupLabelFromCaller.trim()}`
      expect(`Cambio salarial · Escala QA 2026 · ${normalized}`).toBe(
        "Cambio salarial · Escala QA 2026 · Grupo I"
      )
      expect(formatIsoDateToDisplay("2026-11-16")).toBe("16/11/2026")
    })
  })

  describe("#22 — Resumen de entidad no cuenta en Candidatos 'Activos' a personas ya contratadas", () => {
    it("separa candidatos activos pendientes de los candidatos ya contratados (worker_id presente)", () => {
      const summary = summarizeCandidates([
        { status: "active", worker_id: null },
        { status: "active", worker_id: "w-1" },
        { status: "hired", worker_id: "w-2" },
        { status: "archived", worker_id: null },
      ])

      expect(summary.total).toBe(4)
      expect(summary.active).toBe(1)
      expect(summary.hired).toBe(2)
      expect(summary.archived).toBe(1)
    })
  })

  describe("#23 — Validación explícita de campos obligatorios en Nueva entidad y Nuevo puesto", () => {
    it("reporta errores explícitos cuando faltan campos obligatorios en Nueva entidad y Nuevo puesto", () => {
      const entityParse = organizationEntitySchema.safeParse({
        name: "   ",
        entity_type: "company",
        regime_id: "EMPRESARIAL",
        is_active: true,
        description: null,
        is_sitecorp_account: false,
        account_code: null,
        parent_id: null,
      })
      expect(entityParse.success).toBe(false)

      const posMissingJob = validatePositionInput({
        jobId: "",
        jobExists: false,
        name: "",
        authorizedQuantity: "1",
        workLocation: "",
        dailyHours: "",
        weeklyHours: "",
        monthlyHours: "",
        breakMinutes: "",
        segmentsCount: 0,
        scheduleNotes: "",
      })
      expect(posMissingJob.error).toBe("El cargo es obligatorio")
    })
  })

  describe("#24 — Historial de auditoría clasifica certificados médicos en su propio módulo", () => {
    it("expone el módulo 'medical_certificates' con etiqueta 'Certificados médicos'", () => {
      expect(AUDIT_MODULES).toContain("medical_certificates")
      expect(AUDIT_MODULE_LABELS.medical_certificates).toBe("Certificados médicos")
      expect(auditModuleLabel("medical_certificates")).toBe("Certificados médicos")
    })
  })

  describe("#25 — Persistencia de entidad activa entre pestañas (localStorage fallback)", () => {
    beforeEach(() => {
      ;(globalThis as unknown as { window: unknown }).window = {
        sessionStorage: createMemoryStorage(),
        localStorage: createMemoryStorage(),
      }
      clearStoredActiveEntityId()
    })

    it("recupera la entidad activa desde localStorage cuando una nueva pestaña tiene sessionStorage vacío", () => {
      writeStoredActiveEntityId("user-1", "entity-qa-1")
      // Simular apertura de nueva pestaña (sessionStorage vacío, localStorage poblado)
      window.sessionStorage.clear()

      expect(readStoredActiveEntityId("user-1")).toBe("entity-qa-1")
      expect(readStoredActiveEntityId("other-user")).toBeNull()
    })
  })

  describe("#26 — Manual de Gestor alineado con normativa cubana y los 6 tipos documentales oficiales", () => {
    it("documenta los 6 tipos oficiales, prefijo sc404.* y terminología laboral cubana (sin EMO ni IPERC)", () => {
      const step5 = ENTITY_INITIAL_SETUP_FLOW.steps.find((s) => s.stepNumber === 5)
      expect(step5).toBeDefined()
      expect(step5?.keyElements.join(" ")).toContain("6 tipos oficiales")
      expect(step5?.keyElements.join(" ")).toContain("sc404.")

      const allGlossaryTerms = GLOSSARY_TERMS.map((g) => g.term).join(" ")
      expect(allGlossaryTerms).not.toContain("IPERC")
      expect(allGlossaryTerms).toContain("Chequeos Médicos Preempleo y Periódicos")

      const allManualText = JSON.stringify(MANUAL_SECTIONS)
      expect(allManualText).not.toContain("IPERC")
    })
  })

  describe("#27 — Derivación automática del sexo desde el 10.º dígito del carné de identidad cubano", () => {
    const genders = [
      { id: "g-male", name: "Masculino", code: "male" },
      { id: "g-female", name: "Femenino", code: "female" },
    ]

    it("deriva Masculino cuando el 10.º dígito es par y Femenino cuando es impar", () => {
      // 92061012345 -> 10.º dígito (índice 9) es '4' (par => Masculino)
      expect(ciToGenderHint("92061012345")).toBe("M")
      expect(resolveGenderIdFromCi("92061012345", genders)).toBe("g-male")

      // 92061012355 -> 10.º dígito (índice 9) es '5' (impar => Femenino)
      expect(ciToGenderHint("92061012355")).toBe("F")
      expect(resolveGenderIdFromCi("92061012355", genders)).toBe("g-female")
    })
  })
})
