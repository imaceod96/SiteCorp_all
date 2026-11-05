import { describe, expect, it } from "vitest"
import ExcelJSNode from "exceljs"
import {
  EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS,
  OFFICIAL_SEPARATION_CAUSE_COLUMNS,
  buildEmploymentRegistryWorkbookBlob,
  computeEmploymentRegistryIncompleteSummary,
  computeEmploymentRegistrySummary,
  filterAndSortEmploymentPeriods,
  isEmploymentPeriodIncomplete,
  resolveOfficialSeparationColumn,
  validateSeparationInput,
  type EmploymentPeriodRow,
} from "@/modules/people"

const makePeriod = (overrides: Partial<EmploymentPeriodRow> = {}): EmploymentPeriodRow => ({
  id: "p-1",
  companyClientId: "cc-1",
  organizationEntityId: "ent-1",
  workerId: "w-1",
  workerCode: "TRB-0001",
  workerFullName: "Juan Pérez Gómez",
  workerFirstName: "Juan",
  workerFirstSurname: "Pérez",
  workerSecondSurname: "Gómez",
  workerIdentification: "85010112345",
  workerCurrentStatus: "active",
  workerOrigin: "HIRING",
  periodSequence: 1,
  originType: "INITIAL_HIRE",
  sourceOrigin: "Sector estatal",
  reincorporationMovementId: null,
  hireDate: "2023-01-10",
  hireNumber: "001",
  positionNameSnapshot: "Especialista Principal",
  areaNameSnapshot: "Dirección General",
  occupationalCategorySnapshot: "Técnico",
  separationMovementId: null,
  separationDate: null,
  separationNumber: null,
  separationReasonId: null,
  separationReasonCode: null,
  separationReasonCatalogSnapshot: null,
  separationReasonMovementSnapshot: null,
  separationOtherReason: null,
  separationNotes: null,
  reasonValidationStatus: null,
  inconsistencyCode: null,
  inconsistencyDetails: null,
  status: "ACTIVE",
  createdAt: "2023-01-10T00:00:00Z",
  updatedAt: "2023-01-10T00:00:00Z",
  ...overrides,
})

describe("Módulo Altas y Bajas — Reglas de dominio y exportación 17 columnas", () => {
  it("define exactamente las 17 columnas oficiales del Registro de Altas y Bajas", () => {
    expect(EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS).toHaveLength(17)
    expect(OFFICIAL_SEPARATION_CAUSE_COLUMNS).toHaveLength(11)
    expect(EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[0]).toBe("Fecha de Alta")
    expect(EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[6]).toBe("Salarial")
    expect(EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS[16]).toBe("Otras")
  })

  it("Opción 2A: mapea Renuncia, Fin de contrato, Despido, Mutuo acuerdo y Otro hacia Otras (Col. 17)", () => {
    for (const [code, name] of [
      ["RENUNCIA", "Renuncia"],
      ["FIN_CONTRATO", "Fin de contrato"],
      ["DESPIDO", "Despido"],
      ["MUTUO_ACUERDO", "Mutuo acuerdo"],
    ] as const) {
      const res = resolveOfficialSeparationColumn(
        makePeriod({
          status: "CLOSED",
          separationDate: "2025-05-01",
          separationReasonCode: code,
          separationReasonCatalogSnapshot: name,
          reasonValidationStatus: "AUTO_MATCHED",
        })
      )
      expect(res.columnKey).toBe("OTRAS")
      expect(res.isPendingValidation).toBe(false)
      expect(res.detailComment).toContain(name)
    }

    const resOtro = resolveOfficialSeparationColumn(
      makePeriod({
        status: "CLOSED",
        separationDate: "2025-05-01",
        separationReasonCode: "OTRO",
        separationReasonCatalogSnapshot: "Otro",
        separationOtherReason: "Traslado familiar",
        reasonValidationStatus: "AUTO_MATCHED",
      })
    )
    expect(resOtro.columnKey).toBe("OTRAS")
    expect(resOtro.detailComment).toBe("Otro: Traslado familiar")
  })

  it("Opción 3A: no marca columna oficial cuando el motivo está en PENDING_VALIDATION", () => {
    const res = resolveOfficialSeparationColumn(
      makePeriod({
        status: "CLOSED",
        separationDate: "2020-05-31",
        separationReasonCode: "FALLECIMIENTO",
        separationReasonCatalogSnapshot: "Fallecimiento",
        separationReasonMovementSnapshot: "Terminación del término contractual inicial",
        reasonValidationStatus: "PENDING_VALIDATION",
        inconsistencyCode: "CONTRADICTION_DECEASED_REINCORPORATED",
      })
    )
    expect(res.columnKey).toBeNull()
    expect(res.isPendingValidation).toBe(true)
    expect(res.detailComment).toContain("Fallecimiento")
  })

  it("calcula el resumen y filtra por estado, procedencia y búsqueda", () => {
    const rows: EmploymentPeriodRow[] = [
      makePeriod({ id: "1", status: "ACTIVE", periodSequence: 1, originType: "INITIAL_HIRE" }),
      makePeriod({
        id: "2",
        status: "CLOSED",
        periodSequence: 1,
        originType: "INITIAL_HIRE",
        separationDate: "2024-06-30",
        separationNumber: null,
        reasonValidationStatus: "PENDING_VALIDATION",
      }),
      makePeriod({
        id: "3",
        status: "ACTIVE",
        periodSequence: 2,
        originType: "REINCORPORATION",
        hireDate: "2024-09-01",
      }),
    ]

    const summary = computeEmploymentRegistrySummary(rows)
    expect(summary).toEqual({
      totalPeriods: 3,
      activePeriods: 2,
      closedPeriods: 1,
      reentryPeriods: 1,
      migrationPeriods: 0,
      pendingValidationPeriods: 1,
      incompletePeriods: 1,
    })

    const onlyPending = filterAndSortEmploymentPeriods(rows, {
      search: "",
      status: "PENDING_VALIDATION",
      origin: "ALL",
      reasonId: "",
      dateFrom: "",
      dateTo: "",
      sortBy: "HIRE_DATE_DESC",
    })
    expect(onlyPending).toHaveLength(1)
    expect(onlyPending[0].id).toBe("2")
  })

  it("detecta períodos con datos incompletos sin duplicar un período con varios campos faltantes", () => {
    const completeActive = makePeriod({
      id: "complete-active",
      status: "ACTIVE",
      hireNumber: "A-001",
      sourceOrigin: "Graduado universitario",
    })
    const incompleteMultiple = makePeriod({
      id: "incomplete-closed-multi",
      status: "CLOSED",
      hireNumber: null,
      sourceOrigin: null,
      separationDate: "2025-01-15",
      separationNumber: null,
      reasonValidationStatus: "PENDING_VALIDATION",
    })

    expect(isEmploymentPeriodIncomplete(completeActive)).toBe(false)
    expect(isEmploymentPeriodIncomplete(incompleteMultiple)).toBe(true)

    const incompleteSummary = computeEmploymentRegistryIncompleteSummary([
      completeActive,
      incompleteMultiple,
    ])
    expect(incompleteSummary).toEqual({
      incompletePeriodsCount: 1,
      missingHireNumberCount: 1,
      missingSourceOriginCount: 1,
      missingSeparationNumberCount: 1,
      pendingValidationReasonCount: 1,
    })
  })

  it("exige especificar el motivo cuando se selecciona la causa Otro en validateSeparationInput", () => {
    expect(
      validateSeparationInput({
        effectiveDate: "2026-05-01",
        currentPositionStartDate: "2026-01-01",
        separationReasonId: "r-otro",
        isOtherReason: true,
        otherReasonText: "   ",
      })
    ).toBe('Debe especificar el motivo de baja cuando selecciona la causa "Otro".')

    expect(
      validateSeparationInput({
        effectiveDate: "2026-05-01",
        currentPositionStartDate: "2026-01-01",
        separationReasonId: "r-otro",
        isOtherReason: true,
        otherReasonText: "Cambio de residencia",
      })
    ).toBeNull()
  })

  it("genera el archivo Excel (.xlsx) con las 17 columnas oficiales", async () => {
    const rows: EmploymentPeriodRow[] = [
      makePeriod({
        id: "1",
        hireDate: "2024-01-15",
        hireNumber: "A-10",
        status: "ACTIVE",
      }),
      makePeriod({
        id: "2",
        hireDate: "2022-03-01",
        hireNumber: "A-11",
        status: "CLOSED",
        separationDate: "2024-11-30",
        separationNumber: "B-05",
        separationReasonCode: "JUBILACION",
        separationReasonCatalogSnapshot: "Jubilación",
        reasonValidationStatus: "AUTO_MATCHED",
      }),
    ]

    const blob = await buildEmploymentRegistryWorkbookBlob(rows, {
      entityName: "Empresa de Prueba",
      generatedAt: new Date("2026-11-05T12:00:00Z"),
    })

    const buffer = await blob.arrayBuffer()
    const wb = new ExcelJSNode.Workbook()
    await wb.xlsx.load(buffer)

    const sheet = wb.getWorksheet("Registro de Altas y Bajas")
    expect(sheet).toBeDefined()
    expect(sheet?.getRow(5).getCell(7).value).toBe("MOTIVOS DE BAJAS")
    expect(sheet?.getRow(6).getCell(8).value).toBe("Jubilación")
    expect(sheet?.getRow(6).getCell(17).value).toBe("Otras")

    // Fila 7 = período activo (sin X en columnas 7..17) y con procedencia reflejada
    expect(sheet?.getRow(7).getCell(1).value).toBe("15/01/2024")
    expect(sheet?.getRow(7).getCell(2).value).toBe("A-10")
    expect(String(sheet?.getRow(7).getCell(4).value)).toContain("Procedencia: Sector estatal")
    expect(sheet?.getRow(7).getCell(3).note).toBe("Procedencia: Sector estatal")
    expect(sheet?.getRow(7).getCell(8).value).toBe("")

    // Fila 8 = período cerrado por Jubilación (X en columna 8) con número de baja en Col. 6
    expect(sheet?.getRow(8).getCell(5).value).toBe("30/11/2024")
    expect(sheet?.getRow(8).getCell(6).value).toBe("B-05")
    expect(sheet?.getRow(8).getCell(8).value).toBe("X")
  })
})
