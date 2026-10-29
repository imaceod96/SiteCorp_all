import { describe, it, expect } from "vitest"
import {
  calculatePlanCombination,
  canEntityHavePlan,
  diffPlanPackages,
  isModuleEnabledInPlan,
  validateEntityForPlanAssignment,
  PLAN_COMBINATION_LABELS,
} from "../domain/plan.rules"

describe("Módulo de Planes por Entidad (SiteCorp)", () => {
  describe("Combinaciones de planes permitidas (§5)", () => {
    it("Combinación 1: Básico", () => {
      expect(calculatePlanCombination(false, false)).toBe("BASIC")
      expect(PLAN_COMBINATION_LABELS.BASIC).toBe("Básico")
    })

    it("Combinación 2: Básico + Prenómina", () => {
      expect(calculatePlanCombination(true, false)).toBe("BASIC_PRENOMINA")
      expect(PLAN_COMBINATION_LABELS.BASIC_PRENOMINA).toBe("Básico + Prenómina")
    })

    it("Combinación 3: Básico + Capacitación y SST", () => {
      expect(calculatePlanCombination(false, true)).toBe("BASIC_TRAINING_SST")
      expect(PLAN_COMBINATION_LABELS.BASIC_TRAINING_SST).toBe("Básico + Capacitación y SST")
    })

    it("Combinación 4: Básico + Prenómina + Capacitación y SST", () => {
      expect(calculatePlanCombination(true, true)).toBe("BASIC_FULL")
      expect(PLAN_COMBINATION_LABELS.BASIC_FULL).toBe("Básico + Prenómina + Capacitación y SST")
    })
  })

  describe("Requisitos obligatorios y validación de Cuenta SiteCorp (§3)", () => {
    it("Permite plan si la entidad existe y es cuenta SiteCorp", () => {
      const entity = { id: "ent-1", is_sitecorp_account: true }
      expect(canEntityHavePlan(entity)).toBe(true)
      const res = validateEntityForPlanAssignment(entity)
      expect(res.valid).toBe(true)
      expect(res.error).toBeUndefined()
    })

    it("Rechaza si la entidad existe pero no es cuenta SiteCorp", () => {
      const entity = { id: "ent-2", is_sitecorp_account: false }
      expect(canEntityHavePlan(entity)).toBe(false)
      const res = validateEntityForPlanAssignment(entity)
      expect(res.valid).toBe(false)
      expect(res.error).toBe(
        "Error: esta entidad no está registrada como cuenta SiteCorp. No es posible asignarle un plan."
      )
    })

    it("Rechaza si la entidad no existe", () => {
      expect(canEntityHavePlan(null)).toBe(false)
      const res = validateEntityForPlanAssignment(null)
      expect(res.valid).toBe(false)
      expect(res.error).toBe(
        "Error: la entidad seleccionada no existe. Debes crearla antes de asignarle un plan."
      )
    })
  })

  describe("Cálculo de transiciones de plan e historial (§10)", () => {
    it("Detecta alta inicial como CREACION", () => {
      const diff = diffPlanPackages(null, { prenomina: true, trainingSst: false })
      expect(diff.isChanged).toBe(true)
      expect(diff.operationType).toBe("CREACION")
      expect(diff.addedPackages).toContain("Prenómina")
      expect(diff.removedPackages).toHaveLength(0)
    })

    it("Detecta AMPLIACION al incorporar un paquete opcional", () => {
      const previous = { prenomina: false, trainingSst: false }
      const next = { prenomina: true, trainingSst: false }
      const diff = diffPlanPackages(previous, next)
      expect(diff.isChanged).toBe(true)
      expect(diff.operationType).toBe("AMPLIACION")
      expect(diff.addedPackages).toEqual(["Prenómina"])
      expect(diff.removedPackages).toHaveLength(0)
    })

    it("Detecta REDUCCION al retirar un paquete opcional", () => {
      const previous = { prenomina: true, trainingSst: true }
      const next = { prenomina: false, trainingSst: true }
      const diff = diffPlanPackages(previous, next)
      expect(diff.isChanged).toBe(true)
      expect(diff.operationType).toBe("REDUCCION")
      expect(diff.removedPackages).toEqual(["Prenómina"])
      expect(diff.addedPackages).toHaveLength(0)
    })

    it("No genera cambios ni historial si la configuración es idéntica (§10.4)", () => {
      const state = { prenomina: true, trainingSst: true }
      const diff = diffPlanPackages(state, state)
      expect(diff.isChanged).toBe(false)
      expect(diff.addedPackages).toHaveLength(0)
      expect(diff.removedPackages).toHaveLength(0)
    })
  })

  describe("Visibilidad de módulos según plan (§7)", () => {
    it("Entidad con plan Básico solo accede a módulos básicos", () => {
      const basicPlan = { packagePrenomina: false, packageTrainingSst: false }

      // Básico siempre permitido
      expect(isModuleEnabledInPlan("summary", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("candidates", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("workers", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("hiring", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("staffing", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("vacations", basicPlan)).toBe(true)
      expect(isModuleEnabledInPlan("settings", basicPlan)).toBe(true)

      // Prenómina, Capacitación y SST bloqueados
      expect(isModuleEnabledInPlan("prenomina", basicPlan)).toBe(false)
      expect(isModuleEnabledInPlan("training", basicPlan)).toBe(false)
      expect(isModuleEnabledInPlan("sst", basicPlan)).toBe(false)
    })

    it("Entidad con Básico + Prenómina accede a prenómina pero no a Capacitación/SST", () => {
      const plan = { packagePrenomina: true, packageTrainingSst: false }
      expect(isModuleEnabledInPlan("prenomina", plan)).toBe(true)
      expect(isModuleEnabledInPlan("training", plan)).toBe(false)
      expect(isModuleEnabledInPlan("sst", plan)).toBe(false)
    })

    it("Entidad con Básico + Capacitación y SST accede conjuntamente a ambos pero no a prenómina", () => {
      const plan = { packagePrenomina: false, packageTrainingSst: true }
      expect(isModuleEnabledInPlan("training", plan)).toBe(true)
      expect(isModuleEnabledInPlan("sst", plan)).toBe(true)
      expect(isModuleEnabledInPlan("prenomina", plan)).toBe(false)
    })

    it("Entidad con los 3 paquetes accede a todos los módulos", () => {
      const fullPlan = { packagePrenomina: true, packageTrainingSst: true }
      expect(isModuleEnabledInPlan("summary", fullPlan)).toBe(true)
      expect(isModuleEnabledInPlan("prenomina", fullPlan)).toBe(true)
      expect(isModuleEnabledInPlan("training", fullPlan)).toBe(true)
      expect(isModuleEnabledInPlan("sst", fullPlan)).toBe(true)
    })
  })
})
