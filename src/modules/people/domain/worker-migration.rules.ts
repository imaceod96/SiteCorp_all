import type {
  MigrationBatchHistory,
  MigrationBatchRow,
  MigrationPreviewRow,
  MigrationRow,
  WorkerMigrationCatalogs,
} from "./entities"

/**
 * Personas — Reglas puras de la Carga inicial de trabajadores.
 *
 * Resuelven los valores del archivo contra los catálogos globales, validan cada fila
 * (identificación, fechas, saldo de vacaciones y datos que pueden completarse después) y
 * agrupan el historial de lotes. Los MENSAJES son exactamente los que ve el usuario en el
 * preview: la importación vuelve a validar en el backend antes de crear personas.
 *
 * Este módulo no importa React, Supabase ni `@/lib/*`: puede verificarse de forma aislada.
 * La derivación de la fecha de nacimiento desde el carné (objeto de valor del kernel
 * compartido) la aporta el caso de uso al construir las filas mapeadas.
 */

/** Identificación válida de la carga inicial: exactamente 11 dígitos, como texto. */
export const MIGRATION_IDENTIFICATION_PATTERN = /^[0-9]{11}$/

/** Saldo inicial de vacaciones admitido (días). */
export const MIGRATION_VACATION_BALANCE_MIN = 0
export const MIGRATION_VACATION_BALANCE_MAX = 24

/** Filas de información que pueden completarse después desde Trabajadores. */
const INCOMPLETE_FIELD_LABELS: { field: keyof MigrationRow; label: string }[] = [
  { field: "birth_date", label: "fecha de nacimiento" },
  { field: "gender_id", label: "sexo" },
  { field: "marital_status_id", label: "estado civil" },
  { field: "skin_color_id", label: "color de piel" },
  { field: "address", label: "dirección" },
]

/** Número máximo de lotes que muestra el historial de la carga inicial. */
export const MIGRATION_HISTORY_LIMIT = 20

/** Índices de catálogo (por identificador) con los que se valida cada fila. */
export interface MigrationCatalogIndexes {
  genderId: Set<string>
  maritalStatusId: Set<string>
  skinColorId: Set<string>
  educationLevelId: Set<string>
  drivingLicenseCategoryId: Set<string>
}

/** Mapa de resolución del archivo: nombre o código en minúsculas → identificador. */
export type MigrationCatalogMap = Map<string, string>

export interface MigrationCatalogMaps {
  genders: MigrationCatalogMap
  maritalStatuses: MigrationCatalogMap
  skinColors: MigrationCatalogMap
  educationLevels: MigrationCatalogMap
  drivingLicenseCategories: MigrationCatalogMap
}

const catalogMap = (
  options: { id: string; name: string; code?: string | null }[]
): MigrationCatalogMap => {
  const map = new Map<string, string>()
  options.forEach((option) => {
    map.set(option.name.trim().toLocaleLowerCase(), option.id)
    if (option.code) map.set(option.code.trim().toLocaleLowerCase(), option.id)
  })
  return map
}

/** Índices de existencia de los catálogos globales. */
export const migrationCatalogIndexes = (
  catalogs: WorkerMigrationCatalogs
): MigrationCatalogIndexes => ({
  genderId: new Set(catalogs.genders.map((row) => row.id)),
  maritalStatusId: new Set(catalogs.maritalStatuses.map((row) => row.id)),
  skinColorId: new Set(catalogs.skinColors.map((row) => row.id)),
  educationLevelId: new Set(catalogs.educationLevels.map((row) => row.id)),
  drivingLicenseCategoryId: new Set(catalogs.drivingLicenseCategories.map((row) => row.id)),
})

/** Mapas de resolución (nombre o código → identificador) de los catálogos globales. */
export const migrationCatalogMaps = (
  catalogs: WorkerMigrationCatalogs
): MigrationCatalogMaps => ({
  genders: catalogMap(catalogs.genders),
  maritalStatuses: catalogMap(catalogs.maritalStatuses),
  skinColors: catalogMap(catalogs.skinColors),
  educationLevels: catalogMap(catalogs.educationLevels),
  drivingLicenseCategories: catalogMap(catalogs.drivingLicenseCategories),
})

/** Un valor del archivo se resuelve por nombre o código; si no existe, se conserva tal cual. */
export const mapMigrationCatalogValue = (value: string, map: MigrationCatalogMap): string =>
  map.get(value.trim().toLocaleLowerCase()) || value

/** Sustituye los textos de catálogo del archivo por sus identificadores. */
export const mapMigrationRowValues = (
  row: MigrationRow,
  maps: MigrationCatalogMaps
): MigrationRow => ({
  ...row,
  gender_id: mapMigrationCatalogValue(row.gender_id, maps.genders),
  marital_status_id: mapMigrationCatalogValue(row.marital_status_id, maps.maritalStatuses),
  skin_color_id: mapMigrationCatalogValue(row.skin_color_id, maps.skinColors),
  education_level_id: mapMigrationCatalogValue(row.education_level_id, maps.educationLevels),
  driving_license_category_ids: row.driving_license_category_ids.map((value) =>
    mapMigrationCatalogValue(value, maps.drivingLicenseCategories)
  ),
})

/**
 * Resultado de validar UNA fila: mensajes del backend + los errores que bloquean la carga
 * + las advertencias de información que puede completarse después.
 *
 * El aviso de «pendiente de vinculación» del backend es el estado normal de la carga
 * inicial: no degrada la fila a advertencia por sí mismo.
 */
export function validateMigrationRow(
  row: MigrationRow,
  catalogs: MigrationCatalogIndexes,
  backend: MigrationPreviewRow
): MigrationPreviewRow {
  const errors: string[] = []
  const warnings: string[] = []

  const addCatalogError = (
    key: "gender_id" | "marital_status_id" | "skin_color_id" | "education_level_id",
    label: string,
    known: Set<string>
  ) => {
    const value = row[key]
    if (value && !known.has(value)) errors.push(`${label} no existe en el catálogo.`)
  }

  addCatalogError("gender_id", "Sexo", catalogs.genderId)
  addCatalogError("marital_status_id", "Estado civil", catalogs.maritalStatusId)
  addCatalogError("skin_color_id", "Color de piel", catalogs.skinColorId)
  addCatalogError("education_level_id", "Nivel educacional", catalogs.educationLevelId)

  if (row.driving_license_category_ids.some((id) => !catalogs.drivingLicenseCategoryId.has(id))) {
    errors.push("Una o más categorías de licencia no existen en el catálogo.")
  }

  // Número de Identificación: exactamente 11 dígitos (0-9), como texto.
  if (!MIGRATION_IDENTIFICATION_PATTERN.test(String(row.identification || "").trim())) {
    errors.push("El número de identificación debe contener exactamente 11 dígitos.")
  }

  const dates: [string, string][] = [
    [row.birth_date, "Fecha de nacimiento"],
    [row.employment_start_date, "Fecha de incorporación"],
    [row.vacation_cutoff_date, "Fecha de corte de vacaciones"],
  ]
  for (const [date, label] of dates) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`${label} inválida.`)
  }

  if (row.initial_vacation_balance) {
    const amount = Number(row.initial_vacation_balance)
    if (
      !Number.isFinite(amount) ||
      amount < MIGRATION_VACATION_BALANCE_MIN ||
      amount > MIGRATION_VACATION_BALANCE_MAX
    ) {
      errors.push("Saldo inicial de vacaciones inválido; debe estar entre 0 y 24 días.")
    }
  }

  // Información que puede completarse posteriormente. No bloquea la carga.
  const incomplete = INCOMPLETE_FIELD_LABELS.filter(({ field }) => !row[field]).map(
    ({ label }) => label
  )
  if (incomplete.length) {
    warnings.push(
      `Información incompleta: falta ${incomplete.join(", ")}. Podrá completarse después desde Trabajadores.`
    )
  }

  const status: MigrationPreviewRow["status"] =
    backend.status === "ERROR" || errors.length > 0
      ? "ERROR"
      : warnings.length > 0
        ? "WARNING"
        : "VALID"

  return { ...backend, status, messages: [...backend.messages, ...errors, ...warnings] }
}

/**
 * Historial de lotes de carga inicial: cada lote con su total de trabajadores creados,
 * los que quedaron vinculados a un puesto y los pendientes de vinculación.
 *
 * Un trabajador ACTIVO cuenta como vinculado cuando tiene un Assignment vigente
 * (`is_current` sin fecha de fin); si está activo y sin Assignment, queda pendiente.
 */
export function buildMigrationBatchHistory(rows: MigrationBatchRow[]): MigrationBatchHistory[] {
  const batches = new Map<string, MigrationBatchHistory>()
  rows.forEach((row) => {
    if (!row.migration_batch_id) return
    const batch = batches.get(row.migration_batch_id) || {
      batchId: row.migration_batch_id,
      migratedAt: row.migrated_at ?? "",
      total: 0,
      linked: 0,
      pending: 0,
    }
    batch.total += 1
    const assigned = (row.worker_position_assignments || []).some(
      (assignment) => assignment.is_current && !assignment.end_date
    )
    if (row.employment_status === "active" && assigned) batch.linked += 1
    else if (row.employment_status === "active") batch.pending += 1
    batches.set(row.migration_batch_id, batch)
  })
  return [...batches.values()].slice(0, MIGRATION_HISTORY_LIMIT)
}
