import { ciToBirthDate } from "@/utils/ci"
import {
  fetchEntityMigrationBatchRows,
  fetchWorkerMigrationCatalogs,
  rpcMigrationValidateRows,
} from "../infrastructure/worker-migration.repository"
import { buildWorkerMigrationTemplate } from "../infrastructure/worker-migration.workbook"
import {
  buildMigrationBatchHistory,
  mapMigrationRowValues,
  migrationCatalogIndexes,
  migrationCatalogMaps,
  validateMigrationRow,
} from "../domain/worker-migration.rules"
import type {
  MigrationBatchHistory,
  MigrationPreviewRow,
  MigrationRow,
} from "../domain/entities"

/**
 * Personas — Casos de uso de LECTURA de la Carga inicial de trabajadores (aplicación).
 *
 * La pantalla no compone consultas ni conoce las RPC: pide el archivo mapeado, la
 * validación por fila y el historial de lotes. La validación es SOLO lectura: no crea
 * trabajadores, asignaciones ni documentos.
 */

/**
 * Prepara las filas del archivo: resuelve los textos de catálogo (sexo, estado civil,
 * color de piel, nivel educacional y licencias) contra los catálogos globales y deriva la
 * fecha de nacimiento del carné con la lógica que YA existe en SiteCorp (`ciToBirthDate`),
 * sin inventar nunca una fecha.
 */
export async function mapMigrationRows(rows: MigrationRow[]): Promise<MigrationRow[]> {
  const catalogs = await fetchWorkerMigrationCatalogs()
  const maps = migrationCatalogMaps(catalogs)
  return rows.map((row) => {
    const mapped = mapMigrationRowValues(row, maps)
    return {
      ...mapped,
      birth_date: row.birth_date || ciToBirthDate(row.identification) || "",
    }
  })
}

/**
 * Valida las filas contra el backend y completa cada resultado con las reglas del dominio:
 * catálogos inexistentes, formato del carné, fechas y saldo de vacaciones (errores) y los
 * datos que pueden completarse después desde Trabajadores (advertencias).
 */
export async function validateWorkerMigration(
  entityId: string,
  rows: MigrationRow[]
): Promise<MigrationPreviewRow[]> {
  const [backend, catalogs] = await Promise.all([
    rpcMigrationValidateRows(entityId, rows),
    fetchWorkerMigrationCatalogs(),
  ])
  const indexes = migrationCatalogIndexes(catalogs)
  return backend.map((item, index) => validateMigrationRow(rows[index], indexes, item))
}

/** Historial de lotes de carga inicial de la entidad (total, vinculados y pendientes). */
export async function loadEntityMigrationHistory(
  entityId: string
): Promise<MigrationBatchHistory[]> {
  return buildMigrationBatchHistory(await fetchEntityMigrationBatchRows(entityId))
}

/**
 * Plantilla oficial con los valores REALES de los catálogos globales: las columnas de
 * catálogo llevan lista desplegable (hoja «Catálogos»), de modo que el archivo solo puede
 * contener valores que la validación reconoce —por nombre de catálogo— y que la importación
 * guarda como identificador. Los catálogos son GLOBALES (sin entidad ni cliente).
 */
export async function buildOfficialWorkerMigrationTemplate(): Promise<Blob> {
  return buildWorkerMigrationTemplate(await fetchWorkerMigrationCatalogs())
}
