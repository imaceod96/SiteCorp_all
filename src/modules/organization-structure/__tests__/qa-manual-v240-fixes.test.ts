import { describe, expect, it } from "vitest"
import { validateAreaInput, areaSaveErrorMessage } from "../domain/areas.rules"
import { deduplicateOccupationalCategories } from "../infrastructure/catalogs.repository"
import {
  formatTenureMonths,
  formatTenureRange,
  tenureFormToValues,
  validateTenureScaleContinuity,
} from "../domain/tenure-scale.rules"
import {
  calculateScheduledWeeklyHours,
  getScheduleWeeklyHoursWarning,
  positionSaveErrorMessage,
} from "../domain/positions.rules"
import type { OrganizationArea, OccupationalCategory, TenureScaleRange } from "../domain/entities"

describe("QA Manual de Gestor v2.4.0 — Estructura Organizativa y Antigüedad", () => {
  describe("G3 — Validación de áreas duplicadas por nombre en la misma entidad", () => {
    const existingAreas: OrganizationArea[] = [
      {
        id: "area-1",
        organization_entity_id: "entity-qa",
        name: "Dirección General",
        code: "AREA-01",
        description: null,
        parent_area_id: null,
        hierarchy_order: 1,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "area-other-entity",
        organization_entity_id: "entity-other",
        name: "Recursos Humanos",
        code: "AREA-02",
        description: null,
        parent_area_id: null,
        hierarchy_order: 1,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]

    it("rechaza crear un área con el mismo nombre (insensible a mayúsculas y espacios extra) en la misma entidad", () => {
      const error = validateAreaInput({
        name: "  dirección   general ",
        parentAreaId: null,
        entityId: "entity-qa",
        areas: existingAreas,
      })
      expect(error).toBe("Ya existe un área con ese nombre en esta entidad")
    })

    it("permite conservar el mismo nombre al editar la propia área", () => {
      const error = validateAreaInput({
        name: "Dirección General",
        parentAreaId: null,
        entityId: "entity-qa",
        areas: existingAreas,
        editingAreaId: "area-1",
      })
      expect(error).toBeNull()
    })

    it("permite un nombre que existe en otra entidad distinta", () => {
      const error = validateAreaInput({
        name: "Recursos Humanos",
        parentAreaId: null,
        entityId: "entity-qa",
        areas: existingAreas,
      })
      expect(error).toBeNull()
    })

    it("traduce el índice único de base de datos organization_areas_entity_name_unique", () => {
      const msg = areaSaveErrorMessage(
        new Error('duplicate key value violates unique constraint "organization_areas_entity_name_unique"')
      )
      expect(msg).toBe("Ya existe un área con ese nombre en esta entidad")
    })
  })

  describe("G4 — Deduplicación y normalización del catálogo de categorías ocupacionales", () => {
    it("unifica duplicados y sinónimos equivalentes en las 5 categorías oficiales cubanas", () => {
      const raw: OccupationalCategory[] = [
        { id: "1", code: "ADMINISTRATIVO", name: "Administrativo", sort_order: 3, is_active: true },
        { id: "2", code: "ADMIN_DUP", name: "Administrativo", sort_order: 10, is_active: true },
        { id: "3", code: "DIRECTIVO", name: "Directivo", sort_order: 1, is_active: true },
        { id: "4", code: "CUADRO", name: "Cuadro", sort_order: 1, is_active: true },
        { id: "5", code: "OBRERO", name: "Obrero", sort_order: 5, is_active: true },
        { id: "6", code: "OPERARIO", name: "Operario", sort_order: 5, is_active: true },
        { id: "7", code: "SERVICIOS", name: "Servicios", sort_order: 4, is_active: true },
        { id: "8", code: "TECNICO", name: "Técnico", sort_order: 2, is_active: true },
      ]

      const clean = deduplicateOccupationalCategories(raw)
      expect(clean.map((c) => c.name)).toEqual([
        "Cuadro",
        "Técnico",
        "Administrativo",
        "Servicio",
        "Operario",
      ])
    })
  })

  describe("G5 y G6 — Escala de antigüedad: columnas Desde/Hasta y continuidad sin huecos ni solapamientos", () => {
    it("G6: formatea por separado los meses de Desde y Hasta sin concatenar el rango completo", () => {
      const range: TenureScaleRange = {
        id: "r1",
        from_months: 12,
        to_months: 60,
        amount: 250,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }
      expect(formatTenureMonths(range.from_months)).toBe("1 año")
      expect(formatTenureMonths(range.to_months!)).toBe("5 años")
      expect(formatTenureRange(range)).toBe("1 año a 5 años")
    })

    it("G5: rechaza tramos solapados, huecos intermedios (ej. 1-5 años y 6-10 años) y dobles tramos abiertos", () => {
      const existing: TenureScaleRange[] = [
        {
          id: "r1",
          from_months: 12,
          to_months: 60,
          amount: 250,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]

      // Solapamiento: 3 a 8 años sobre 1 a 5 años
      const overlap = validateTenureScaleContinuity(
        { from_months: 36, to_months: 96, amount: 400 },
        existing
      )
      expect(overlap).toContain("se solapa")

      // Hueco de 12 meses: 6 a 10 años después de 1 a 5 años
      const gap = validateTenureScaleContinuity(
        { from_months: 72, to_months: 120, amount: 500 },
        existing
      )
      expect(gap).toContain("hueco sin cobertura")

      // Continuo válido: 5 a 10 años después de 1 a 5 años
      const validNext = validateTenureScaleContinuity(
        { from_months: 60, to_months: 120, amount: 500 },
        existing
      )
      expect(validNext).toBeNull()

      // Doble tramo Sin límite
      const withOpen: TenureScaleRange[] = [
        ...existing,
        {
          id: "r2",
          from_months: 60,
          to_months: null,
          amount: 500,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]
      const duplicateOpen = validateTenureScaleContinuity(
        { from_months: 120, to_months: null, amount: 900 },
        withOpen
      )
      expect(duplicateOpen).toContain("Solo puede existir un último tramo abierto")

      // Importe negativo rechazado por tenureFormToValues
      const negative = tenureFormToValues({
        from_amount: "1",
        from_unit: "Años",
        to_amount: "5",
        to_unit: "Años",
        to_limit: false,
        amount: "-100",
      })
      expect(negative.error).toContain("importe")
    })
  })

  describe("Ronda 2 — Puestos: detalle de error PostgREST y aviso por diferencia de horas semanales", () => {
    it("extrae message, details y hint de errores planos devueltos por PostgREST", () => {
      const msg = positionSaveErrorMessage({
        message: 'column "company_client_id" of relation "organization_positions" does not exist',
        details: "Fallo en save_position_with_schedule",
        hint: "Revisa la migración SQL",
      })
      expect(msg).toContain("company_client_id")
      expect(msg).toContain("Fallo en save_position_with_schedule")
      expect(msg).toContain("Revisa la migración SQL")
    })

    it("calcula horas brutas y efectivas (incluidos turnos nocturnos) y advierte si difieren de las declaradas", () => {
      const segments5x8Effective = [1, 2, 3, 4, 5].map(() => ({
        start_time: "08:00",
        end_time: "16:30",
      }))
      const summary = calculateScheduledWeeklyHours(segments5x8Effective, 30)
      expect(summary.grossHours).toBe(42.5)
      expect(summary.effectiveHours).toBe(40)

      const warning = getScheduleWeeklyHoursWarning({
        segments: segments5x8Effective,
        weeklyHours: 44,
        breakMinutes: 30,
      })
      expect(warning).toContain("44 h")
      expect(warning).toContain("40 h efectivas")

      const noWarning = getScheduleWeeklyHoursWarning({
        segments: segments5x8Effective,
        weeklyHours: 40,
        breakMinutes: 30,
      })
      expect(noWarning).toBeNull()

      const overnight = calculateScheduledWeeklyHours(
        [{ start_time: "20:00", end_time: "04:00" }],
        0
      )
      expect(overnight.effectiveHours).toBe(8)
    })
  })
})
