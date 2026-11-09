/**
 * Personas — Reglas de dominio del Registro Histórico de Altas y Bajas.
 *
 * Implementa:
 *   · Modelo de lectura de períodos laborales (`EmploymentPeriodRow`), distinguiendo entre:
 *       - `originType`: tipo de período laboral calculado automáticamente e inmutable
 *         (`INITIAL_HIRE`, `MIGRATION`, `REINCORPORATION`, `BACKFILL`).
 *       - `sourceOrigin`: procedencia administrativa editable del trabajador en ese período.
 *   · Mapeo hacia las 17 columnas del modelo oficial «Registro de Altas y Bajas»:
 *       - Opción 1A: 7 motivos históricos + 8 causas oficiales nuevas en catálogo.
 *       - Opción 2A: Renuncia, Fin de contrato, Despido, Mutuo acuerdo y Otro se
 *         corresponden con la columna 17 («Otras») conservando el motivo original como detalle.
 *       - Opción 3A (con modificaciones): Las discrepancias históricas y contradicciones
 *         materiales permanecen en `PENDING_VALIDATION` («Pendiente de validación») y NO
 *         marcan una `"X"` automática en causas no verificadas.
 *   · Detección de períodos con información pendiente de completar para la notificación
 *     en la pestaña Inicio de cada entidad.
 */

export type EmploymentPeriodOriginType =
  | "INITIAL_HIRE"
  | "MIGRATION"
  | "REINCORPORATION"
  | "BACKFILL"

export type EmploymentPeriodStatus = "ACTIVE" | "CLOSED"

export type ReasonValidationStatus =
  | "AUTO_MATCHED"
  | "PENDING_VALIDATION"
  | "VERIFIED"

export interface EmploymentPeriodRow {
  id: string
  companyClientId: string
  organizationEntityId: string
  workerId: string
  workerCode: string
  workerFullName: string
  workerFirstName: string
  workerFirstSurname: string
  workerSecondSurname: string | null
  workerIdentification: string
  workerCurrentStatus: string
  workerOrigin: string | null
  periodSequence: number
  /** Tipo de período laboral calculado automáticamente (no editable). */
  originType: EmploymentPeriodOriginType
  /** Procedencia administrativa real del trabajador (editable con workers.manage). */
  sourceOrigin: string | null
  reincorporationMovementId: string | null
  hireDate: string
  hireNumber: string | null
  positionNameSnapshot: string | null
  areaNameSnapshot: string | null
  occupationalCategorySnapshot: string | null
  separationMovementId: string | null
  separationDate: string | null
  separationNumber: string | null
  separationReasonId: string | null
  separationReasonCode: string | null
  separationReasonCatalogSnapshot: string | null
  separationReasonMovementSnapshot: string | null
  separationOtherReason: string | null
  separationNotes: string | null
  reasonValidationStatus: ReasonValidationStatus | null
  inconsistencyCode: string | null
  inconsistencyDetails: string | null
  status: EmploymentPeriodStatus
  createdAt: string
  updatedAt: string
}

/**
 * Las 11 columnas de causas de baja del modelo oficial (columnas 7 a 17 del Excel).
 */
export type OfficialSeparationColumnKey =
  | "SALARIAL"
  | "JUBILACION"
  | "FALLECIMIENTO"
  | "INVALIDEZ_TOTAL"
  | "INVALIDEZ_PARCIAL"
  | "PRIVACION_LIBERTAD"
  | "PASO_FORMAS_NO_ESTATALES"
  | "PROCESO_DISPONIBILIDAD"
  | "SANCION_ADMINISTRATIVA"
  | "SALIDA_PAIS"
  | "OTRAS"

export interface OfficialSeparationColumnDef {
  key: OfficialSeparationColumnKey
  columnIndex: number // 7..17 (1-based en el modelo oficial de 17 columnas)
  label: string
}

export const OFFICIAL_SEPARATION_CAUSE_COLUMNS: readonly OfficialSeparationColumnDef[] = [
  { key: "SALARIAL", columnIndex: 7, label: "Salarial" },
  { key: "JUBILACION", columnIndex: 8, label: "Jubilación" },
  { key: "FALLECIMIENTO", columnIndex: 9, label: "Fallecimiento" },
  { key: "INVALIDEZ_TOTAL", columnIndex: 10, label: "Invalidez Total" },
  { key: "INVALIDEZ_PARCIAL", columnIndex: 11, label: "Invalidez Parcial" },
  { key: "PRIVACION_LIBERTAD", columnIndex: 12, label: "Privación de Libertad" },
  { key: "PASO_FORMAS_NO_ESTATALES", columnIndex: 13, label: "Paso a Formas no Estatales" },
  { key: "PROCESO_DISPONIBILIDAD", columnIndex: 14, label: "Proceso de Disponibilidad" },
  { key: "SANCION_ADMINISTRATIVA", columnIndex: 15, label: "Sanción Administrativa" },
  { key: "SALIDA_PAIS", columnIndex: 16, label: "Salida del País" },
  { key: "OTRAS", columnIndex: 17, label: "Otras" },
] as const

/**
 * Las 17 columnas del modelo oficial «Registro de Altas y Bajas».
 */
export const EMPLOYMENT_REGISTRY_OFFICIAL_HEADERS: readonly string[] = [
  "Fecha de Alta",
  "No.",
  "Nombre y Apellidos",
  "Cargo y/o Categoría Ocupacional",
  "Fecha de Baja",
  "No.",
  ...OFFICIAL_SEPARATION_CAUSE_COLUMNS.map((c) => c.label),
] as const

export interface OfficialSeparationResolution {
  /** Columna oficial (7..17) donde se marca "X", o null si no aplica / está pendiente de validación. */
  columnKey: OfficialSeparationColumnKey | null
  /** Detalle o comentario explicativo para la celda en el Excel o en la vista. */
  detailComment: string | null
  /** Indica si el motivo presenta discrepancia o contradicción pendiente de revisión. */
  isPendingValidation: boolean
}

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

/**
 * Resuelve la correspondencia de un período con las 11 columnas de motivos de baja
 * del Excel oficial (Opción 2A + Opción 3A con modificaciones).
 */
export function resolveOfficialSeparationColumn(
  row: Pick<
    EmploymentPeriodRow,
    | "status"
    | "separationReasonCode"
    | "separationReasonCatalogSnapshot"
    | "separationReasonMovementSnapshot"
    | "separationOtherReason"
    | "reasonValidationStatus"
    | "inconsistencyCode"
    | "inconsistencyDetails"
  >
): OfficialSeparationResolution {
  if (row.status !== "CLOSED") {
    return {
      columnKey: null,
      detailComment: null,
      isPendingValidation: false,
    }
  }

  // Opción 3A: Si el motivo está pendiente de validación (discrepancia histórica o contradicción),
  // NO se marca "X" en ninguna columna oficial no verificada.
  if (row.reasonValidationStatus === "PENDING_VALIDATION") {
    const catalogLabel = row.separationReasonCatalogSnapshot || "Sin motivo de catálogo"
    const movementLabel = row.separationReasonMovementSnapshot || "Sin descripción en movimiento"
    return {
      columnKey: null,
      detailComment:
        row.inconsistencyDetails ||
        `Pendiente de validación documental. Catálogo: "${catalogLabel}" | Movimiento: "${movementLabel}".`,
      isPendingValidation: true,
    }
  }

  const code = (row.separationReasonCode ?? "").trim().toUpperCase()
  const normalizedName = normalizeText(row.separationReasonCatalogSnapshot)

  if (code === "SALARIAL" || normalizedName === "salarial") {
    return { columnKey: "SALARIAL", detailComment: null, isPendingValidation: false }
  }
  if (code === "JUBILACION" || normalizedName === "jubilacion") {
    return { columnKey: "JUBILACION", detailComment: null, isPendingValidation: false }
  }
  if (code === "FALLECIMIENTO" || normalizedName === "fallecimiento") {
    return { columnKey: "FALLECIMIENTO", detailComment: null, isPendingValidation: false }
  }
  if (code === "INVALIDEZ_TOTAL" || normalizedName === "invalidez total") {
    return { columnKey: "INVALIDEZ_TOTAL", detailComment: null, isPendingValidation: false }
  }
  if (code === "INVALIDEZ_PARCIAL" || normalizedName === "invalidez parcial") {
    return { columnKey: "INVALIDEZ_PARCIAL", detailComment: null, isPendingValidation: false }
  }
  if (code === "PRIVACION_LIBERTAD" || normalizedName === "privacion de libertad") {
    return { columnKey: "PRIVACION_LIBERTAD", detailComment: null, isPendingValidation: false }
  }
  if (
    code === "PASO_FORMAS_NO_ESTATALES" ||
    normalizedName === "paso a formas no estatales"
  ) {
    return {
      columnKey: "PASO_FORMAS_NO_ESTATALES",
      detailComment: null,
      isPendingValidation: false,
    }
  }
  if (
    code === "PROCESO_DISPONIBILIDAD" ||
    normalizedName === "proceso de disponibilidad"
  ) {
    return {
      columnKey: "PROCESO_DISPONIBILIDAD",
      detailComment: null,
      isPendingValidation: false,
    }
  }
  if (
    code === "SANCION_ADMINISTRATIVA" ||
    normalizedName === "sancion administrativa"
  ) {
    return {
      columnKey: "SANCION_ADMINISTRATIVA",
      detailComment: null,
      isPendingValidation: false,
    }
  }
  if (code === "SALIDA_PAIS" || normalizedName === "salida del pais") {
    return { columnKey: "SALIDA_PAIS", detailComment: null, isPendingValidation: false }
  }

  // Opción 2A: Renuncia, Fin de contrato, Despido, Mutuo acuerdo y Otro se corresponden
  // con la columna 17 ("Otras"), conservando el motivo original como detalle.
  if (code === "OTRO" || normalizedName === "otro") {
    const otherDetail = row.separationOtherReason?.trim()
    return {
      columnKey: "OTRAS",
      detailComment: otherDetail ? `Otro: ${otherDetail}` : "Otro",
      isPendingValidation: false,
    }
  }

  if (
    code === "RENUNCIA" ||
    code === "FIN_CONTRATO" ||
    code === "DESPIDO" ||
    code === "MUTUO_ACUERDO" ||
    normalizedName === "renuncia" ||
    normalizedName === "fin de contrato" ||
    normalizedName === "despido" ||
    normalizedName === "mutuo acuerdo"
  ) {
    return {
      columnKey: "OTRAS",
      detailComment: `Motivo registrado: ${row.separationReasonCatalogSnapshot || code}`,
      isPendingValidation: false,
    }
  }

  if (row.separationReasonCatalogSnapshot) {
    return {
      columnKey: "OTRAS",
      detailComment: `Motivo registrado: ${row.separationReasonCatalogSnapshot}`,
      isPendingValidation: false,
    }
  }

  return {
    columnKey: null,
    detailComment: null,
    isPendingValidation: false,
  }
}

export function formatPeriodOriginLabel(
  originType: EmploymentPeriodOriginType,
  periodSequence: number
): string {
  if (periodSequence > 1 || originType === "REINCORPORATION") {
    return "Reincorporación"
  }
  if (originType === "MIGRATION") {
    return "Carga inicial"
  }
  return "Alta inicial"
}

export function formatCargoAndCategory(
  positionName: string | null,
  occupationalCategory: string | null
): string {
  const pos = (positionName ?? "").trim()
  const cat = (occupationalCategory ?? "").trim()
  if (pos && cat) return `${pos} (${cat})`
  if (pos) return pos
  if (cat) return cat
  return "—"
}

export function formatDateDisplay(isoDate: string | null | undefined): string {
  if (!isoDate) return "—"
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!match) return isoDate
  return `${match[3]}/${match[2]}/${match[1]}`
}

/**
 * Determina si un período laboral tiene algún dato pendiente de completar:
 *   1. Sin Número de alta (`hireNumber`).
 *   2. Sin Procedencia administrativa (`sourceOrigin`).
 *   3. Período `CLOSED` sin Número de baja (`separationNumber`).
 *   4. Período `CLOSED` con motivo de baja en `PENDING_VALIDATION`.
 */
export function isEmploymentPeriodIncomplete(
  row: Pick<
    EmploymentPeriodRow,
    | "hireNumber"
    | "sourceOrigin"
    | "status"
    | "separationNumber"
    | "reasonValidationStatus"
  >
): boolean {
  const missingHireNumber = !(row.hireNumber ?? "").trim()
  const missingSourceOrigin = !(row.sourceOrigin ?? "").trim()
  const missingSeparationNumber =
    row.status === "CLOSED" && !(row.separationNumber ?? "").trim()
  const pendingReasonValidation =
    row.status === "CLOSED" && row.reasonValidationStatus === "PENDING_VALIDATION"

  return (
    missingHireNumber ||
    missingSourceOrigin ||
    missingSeparationNumber ||
    pendingReasonValidation
  )
}

export interface EmploymentPeriodIncompleteSummary {
  /** Total de períodos únicos con al menos un dato pendiente (sin duplicar el mismo período). */
  incompletePeriodsCount: number
  missingHireNumberCount: number
  missingSourceOriginCount: number
  missingSeparationNumberCount: number
  pendingValidationReasonCount: number
}

export function computeEmploymentRegistryIncompleteSummary(
  rows: Pick<
    EmploymentPeriodRow,
    | "hireNumber"
    | "sourceOrigin"
    | "status"
    | "separationNumber"
    | "reasonValidationStatus"
  >[]
): EmploymentPeriodIncompleteSummary {
  let incompletePeriodsCount = 0
  let missingHireNumberCount = 0
  let missingSourceOriginCount = 0
  let missingSeparationNumberCount = 0
  let pendingValidationReasonCount = 0

  for (const row of rows) {
    const missingHire = !(row.hireNumber ?? "").trim()
    const missingOrigin = !(row.sourceOrigin ?? "").trim()
    const missingSep =
      row.status === "CLOSED" && !(row.separationNumber ?? "").trim()
    const pendingReason =
      row.status === "CLOSED" && row.reasonValidationStatus === "PENDING_VALIDATION"

    if (missingHire) missingHireNumberCount += 1
    if (missingOrigin) missingSourceOriginCount += 1
    if (missingSep) missingSeparationNumberCount += 1
    if (pendingReason) pendingValidationReasonCount += 1

    if (missingHire || missingOrigin || missingSep || pendingReason) {
      incompletePeriodsCount += 1
    }
  }

  return {
    incompletePeriodsCount,
    missingHireNumberCount,
    missingSourceOriginCount,
    missingSeparationNumberCount,
    pendingValidationReasonCount,
  }
}

export interface EmploymentRegistrySummary {
  totalPeriods: number
  activePeriods: number
  closedPeriods: number
  reentryPeriods: number
  migrationPeriods: number
  pendingValidationPeriods: number
  incompletePeriods: number
}

export function computeEmploymentRegistrySummary(
  rows: EmploymentPeriodRow[]
): EmploymentRegistrySummary {
  let activePeriods = 0
  let closedPeriods = 0
  let reentryPeriods = 0
  let migrationPeriods = 0
  let pendingValidationPeriods = 0
  let incompletePeriods = 0

  for (const r of rows) {
    if (r.status === "ACTIVE") activePeriods += 1
    if (r.status === "CLOSED") closedPeriods += 1
    if (r.periodSequence > 1 || r.originType === "REINCORPORATION") reentryPeriods += 1
    if (r.originType === "MIGRATION") migrationPeriods += 1
    if (r.status === "CLOSED" && r.reasonValidationStatus === "PENDING_VALIDATION") {
      pendingValidationPeriods += 1
    }
    if (isEmploymentPeriodIncomplete(r)) {
      incompletePeriods += 1
    }
  }

  return {
    totalPeriods: rows.length,
    activePeriods,
    closedPeriods,
    reentryPeriods,
    migrationPeriods,
    pendingValidationPeriods,
    incompletePeriods,
  }
}

export type PeriodStatusFilter =
  | "ALL"
  | "ACTIVE"
  | "CLOSED"
  | "PENDING_VALIDATION"
  | "INCOMPLETE"
export type PeriodOriginFilter = "ALL" | "INITIAL_HIRE" | "REINCORPORATION" | "MIGRATION"
export type PeriodSortOrder =
  | "HIRE_DATE_DESC"
  | "HIRE_DATE_ASC"
  | "SEPARATION_DATE_DESC"
  | "WORKER_NAME_ASC"

export interface EmploymentRegistryFilterState {
  search: string
  status: PeriodStatusFilter
  origin: PeriodOriginFilter
  reasonId: string
  dateFrom: string
  dateTo: string
  sortBy: PeriodSortOrder
}

export function filterAndSortEmploymentPeriods(
  rows: EmploymentPeriodRow[],
  filters: EmploymentRegistryFilterState
): EmploymentPeriodRow[] {
  const query = normalizeText(filters.search)

  const filtered = rows.filter((row) => {
    if (filters.status === "ACTIVE" && row.status !== "ACTIVE") return false
    if (filters.status === "CLOSED" && row.status !== "CLOSED") return false
    if (
      filters.status === "PENDING_VALIDATION" &&
      !(row.status === "CLOSED" && row.reasonValidationStatus === "PENDING_VALIDATION")
    ) {
      return false
    }
    if (filters.status === "INCOMPLETE" && !isEmploymentPeriodIncomplete(row)) {
      return false
    }

    if (filters.origin === "REINCORPORATION") {
      if (!(row.periodSequence > 1 || row.originType === "REINCORPORATION")) return false
    } else if (filters.origin === "MIGRATION") {
      if (row.originType !== "MIGRATION") return false
    } else if (filters.origin === "INITIAL_HIRE") {
      if (row.periodSequence !== 1 || row.originType === "MIGRATION") return false
    }

    if (filters.reasonId && row.separationReasonId !== filters.reasonId) {
      return false
    }

    if (filters.dateFrom) {
      const effectiveEnd = row.separationDate || row.hireDate
      if (row.hireDate < filters.dateFrom && effectiveEnd < filters.dateFrom) {
        return false
      }
    }

    if (filters.dateTo) {
      if (row.hireDate > filters.dateTo) {
        return false
      }
    }

    if (query) {
      const haystack = normalizeText(
        [
          row.workerFullName,
          row.workerCode,
          row.workerIdentification,
          row.hireNumber,
          row.sourceOrigin,
          row.separationNumber,
          row.positionNameSnapshot,
          row.areaNameSnapshot,
          row.occupationalCategorySnapshot,
          row.separationReasonCatalogSnapshot,
          row.separationReasonMovementSnapshot,
          row.separationOtherReason,
        ]
          .filter(Boolean)
          .join(" ")
      )
      if (!haystack.includes(query)) return false
    }

    return true
  })

  return [...filtered].sort((a, b) => {
    if (filters.sortBy === "HIRE_DATE_ASC") {
      if (a.hireDate !== b.hireDate) return a.hireDate.localeCompare(b.hireDate)
      if (a.workerFullName !== b.workerFullName) {
        return a.workerFullName.localeCompare(b.workerFullName, "es")
      }
      return a.periodSequence - b.periodSequence
    }

    if (filters.sortBy === "SEPARATION_DATE_DESC") {
      const sepA = a.separationDate ?? ""
      const sepB = b.separationDate ?? ""
      if (sepA !== sepB) return sepB.localeCompare(sepA)
      if (a.hireDate !== b.hireDate) return b.hireDate.localeCompare(a.hireDate)
      return a.workerFullName.localeCompare(b.workerFullName, "es")
    }

    if (filters.sortBy === "WORKER_NAME_ASC") {
      const cmp = a.workerFullName.localeCompare(b.workerFullName, "es")
      if (cmp !== 0) return cmp
      return a.periodSequence - b.periodSequence
    }

    // Default: HIRE_DATE_DESC
    if (a.hireDate !== b.hireDate) return b.hireDate.localeCompare(a.hireDate)
    const cmp = a.workerFullName.localeCompare(b.workerFullName, "es")
    if (cmp !== 0) return cmp
    return b.periodSequence - a.periodSequence
  })
}
