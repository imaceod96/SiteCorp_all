import {
  rpcLinkWorkerToPosition,
  rpcMigrationCreateSingleWorker,
  rpcMigrationImportRows,
} from "../infrastructure/worker-migration.repository"
import type {
  MigrationRow,
  WorkerMigrationCreatedWorker,
  WorkerMigrationImportResult,
  WorkerMigrationLinkedWorker,
} from "../domain/entities"

/**
 * Personas — Casos de uso de ESCRITURA de la Carga inicial de trabajadores (aplicación).
 *
 * La autoridad sigue siendo el backend: las RPC comprueban los permisos, el aislamiento
 * entre clientes y entidades y vuelven a validar las filas antes de crear personas. La
 * migración NUNCA crea contratos, puestos ni documentos: solo personas.
 */

/**
 * Importa el lote completo. Las identificaciones repetidas (dentro del archivo o ya
 * existentes en el workspace) NO bloquean la carga: se devuelven para corregirlas.
 */
export async function importWorkerMigration(
  entityId: string,
  rows: MigrationRow[],
  batchId: string
): Promise<WorkerMigrationImportResult> {
  const result = await rpcMigrationImportRows(entityId, rows, batchId)
  return { ...result, duplicate_identifications: result.duplicate_identifications || [] }
}

/** Migración individual: crea un trabajador histórico sin puesto y sin documentos. */
export async function createMigratedWorker(
  entityId: string,
  row: MigrationRow
): Promise<WorkerMigrationCreatedWorker> {
  return rpcMigrationCreateSingleWorker(entityId, row)
}

/** Vincula un trabajador (activo y sin puesto) a un puesto con capacidad disponible. */
export async function linkMigratedWorker(
  workerId: string,
  positionId: string
): Promise<WorkerMigrationLinkedWorker> {
  return rpcLinkWorkerToPosition(workerId, positionId)
}
