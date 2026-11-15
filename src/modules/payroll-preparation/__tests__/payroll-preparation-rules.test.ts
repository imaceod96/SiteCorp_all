import { describe, expect, it } from "vitest"
import {
  computeMaxWorkedDaysInPeriod,
  getDaysInMonth,
  validateWorkedDays,
} from "../domain/rules"
import { normalizeWorkerEntry } from "../domain/normalization"
import type { PrenominaWorkerEntry } from "../domain/entities"

describe("QA #4 y #5 — Prenómina: tope de días e integración de asignaciones", () => {
  it("QA #4: calcula los días del mes y el tope por fecha de alta/baja en noviembre 2026", () => {
    expect(getDaysInMonth(2026, 11)).toBe(30)
    expect(getDaysInMonth(2024, 2)).toBe(29)

    // Laura Tester: alta 16/11/2026 -> máximo 15 días en noviembre
    const lauraMax = computeMaxWorkedDaysInPeriod({
      year: 2026,
      month: 11,
      activeStartDate: "2026-11-16",
      activeEndDate: null,
    })
    expect(lauraMax).toBe(15)

    // Rechaza 45 días (> días del mes) y 20 días (> días de alta de Laura)
    expect(
      validateWorkedDays(45, { maxMonthDays: 30, maxActiveDays: lauraMax })
    ).toContain("días del mes (30)")

    expect(
      validateWorkedDays(20, { maxMonthDays: 30, maxActiveDays: lauraMax })
    ).toContain("días de alta del trabajador en el período (15)")

    expect(
      validateWorkedDays(15, { maxMonthDays: 30, maxActiveDays: lauraMax })
    ).toBeNull()
  })

  it("QA #5: calcula topes por cada asignación histórica en el mes (Carlos Tester 16–20 y 25–30)", () => {
    const especialistaMax = computeMaxWorkedDaysInPeriod({
      year: 2026,
      month: 11,
      activeStartDate: "2026-11-16",
      activeEndDate: "2026-11-20",
    })
    const directorMax = computeMaxWorkedDaysInPeriod({
      year: 2026,
      month: 11,
      activeStartDate: "2026-11-25",
      activeEndDate: null,
    })

    expect(especialistaMax).toBe(5)
    expect(directorMax).toBe(6)

    const normalized = normalizeWorkerEntry({
      id: "e1",
      period_id: "p1",
      organization_entity_id: "ent1",
      worker_id: "w1",
      worker_name_snapshot: "Carlos Tester",
      identification_snapshot: "90010112345",
      area_name_snapshot: "RRHH",
      job_name_snapshot: "Especialista en Gestión de RRHH",
      position_name_snapshot: "Especialista RRHH QA",
      salary_group_id: null,
      salary_group_sequence: 2,
      salary_scale_id: null,
      salary_scale_amount: 5500,
      salary_currency: "CUP",
      workday_hours: 8,
      worked_days: 5,
      period_active_start: "2026-11-16",
      period_active_end: "2026-11-20",
      max_worked_days: 5,
      absence_days_in_period: 0,
      proposed_worked_days: 5,
      worked_days_manual: false,
      worked_hours: 40,
      hourly_scale_rate: 28.856243,
      scale_salary_payment: 1154.25,
      employment_start_date_snapshot: "2026-11-16",
      tenure_reference_date: "2026-11-30",
      tenure_years: 0,
      tenure_months: 0,
      tenure_total_months: 0,
      tenure_band_id: null,
      tenure_band_label: null,
      tenure_base_amount: null,
      tenure_hourly_rate: 0,
      tenure_payment: 0,
      tenure_status: "OK",
      has_masters_degree_snapshot: false,
      has_doctorate_degree_snapshot: false,
      academic_category: null,
      academic_status: "OK",
      academic_monthly_amount: null,
      academic_hourly_rate: 0,
      academic_payment: 0,
      cla_applied: false,
      cla_day_enabled: false,
      cla_day_used: false,
      cla_day_hourly_rate: null,
      cla_day_minutes: 0,
      cla_day_hours: 0,
      cla_day_payment: 0,
      cla_night_enabled: false,
      cla_night_used: false,
      cla_night1_start: null,
      cla_night1_end: null,
      cla_night1_hourly_rate: null,
      cla_night1_minutes: 0,
      cla_night1_hours: 0,
      cla_night1_payment: 0,
      cla_night2_start: null,
      cla_night2_end: null,
      cla_night2_hourly_rate: null,
      cla_night2_minutes: 0,
      cla_night2_hours: 0,
      cla_night2_payment: 0,
      cla_total_payment: 0,
      night_payment_19_23: 0,
      night_payment_23_07: 0,
      total_night_payment: 0,
      total_payment: 1154.25,
    } as PrenominaWorkerEntry)

    expect(normalized.max_worked_days).toBe(5)
    expect(normalized.proposed_worked_days).toBe(5)
    expect(normalized.period_active_start).toBe("2026-11-16")
    expect(normalized.period_active_end).toBe("2026-11-20")
  })
})
