import { supabase } from "@/lib/supabase"
import type {
  MigrationBatchRow,
  MigrationPreviewRow,
  MigrationRow,
  MigrationTemplateData,
  WorkerMigrationCatalogs,
  WorkerMigrationCreatedWorker,
  WorkerMigrationImportResult,
  WorkerMigrationLinkedWorker,
} from "../domain/entities"

/**
 * Personas — Repositorio de la Carga inicial de trabajadores (infraestructura).
 *
 * Única frontera con Supabase de la carga inicial: los catálogos que resuelven y validan
 * los valores del archivo, la plantilla que resuelve el backend, el historial de lotes y
 * las cuatro RPC de la migración, con sus parámetros EXACTOS:
 *
 *   · get_migration_template_data(entity_id, migration_type)
 *   · migration_validate_rows(p_entity_id, p_rows)
 *   · migration_import_rows(p_entity_id, p_rows, p_batch_id)
 *   · migration_create_single_worker(p_entity_id, p_row)
 *   · link_worker_to_position(p_worker_id, p_position_id, p_start_date)
 *
 * Ninguna RPC cambia de firma ni de comportamiento, y el formato del archivo Excel no
 * depende de este repositorio.
 */

/** Datos de referencia que la migración necesita antes de crear personas. */
export async function rpcMigrationTemplateData(
  entityId: string,
  migrationType: string
): Promise<MigrationTemplateData> {
  const { data, error } = await supabase.rpc("get_migration_template_data", {
    entity_id: entityId,
    migration_type: migrationType,
  })
  if (error) throw error
  return (data || {
    areas: [],
    jobs: [],
    positions: [],
    contract_types: [],
    payment_methods: [],
    representatives: [],
  }) as MigrationTemplateData
}

/** Catálogos globales que resuelven y validan los valores del archivo cargado. */
export async function fetchWorkerMigrationCatalogs(): Promise<WorkerMigrationCatalogs> {
  const [genders, marital, skin, education, licenses] = await Promise.all([
    supabase.from("genders").select("id,name"),
    supabase.from("marital_statuses").select("id,name"),
    supabase.from("skin_colors").select("id,name"),
    supabase.from("education_levels").select("id,name"),
    supabase.from("driving_license_categories").select("id,name,code"),
  ])
  for (const result of [genders, marital, skin, education, licenses]) {
    if (result.error) throw result.error
  }
  return {
    genders: genders.data || [],
    maritalStatuses: marital.data || [],
    skinColors: skin.data || [],
    educationLevels: education.data || [],
    drivingLicenseCategories: licenses.data || [],
  }
}

/** Validación por fila en el backend (no crea trabajadores ni asignaciones). */
export async function rpcMigrationValidateRows(
  entityId: string,
  rows: MigrationRow[]
): Promise<MigrationPreviewRow[]> {
  const { data, error } = await supabase.rpc("migration_validate_rows", {
    p_entity_id: entityId,
    p_rows: rows,
  })
  if (error) throw error
  return (data || []) as MigrationPreviewRow[]
}

/** Importación del lote completo: crea las personas (sin puestos ni documentos). */
export async function rpcMigrationImportRows(
  entityId: string,
  rows: MigrationRow[],
  batchId: string
): Promise<WorkerMigrationImportResult> {
  const { data, error } = await supabase.rpc("migration_import_rows", {
    p_entity_id: entityId,
    p_rows: rows,
    p_batch_id: batchId,
  })
  if (error) throw error
  return data as WorkerMigrationImportResult
}

/** Migración individual: crea un trabajador histórico sin puesto ni documentos. */
export async function rpcMigrationCreateSingleWorker(
  entityId: string,
  row: MigrationRow
): Promise<WorkerMigrationCreatedWorker> {
  const { data, error } = await supabase.rpc("migration_create_single_worker", {
    p_entity_id: entityId,
    p_row: row,
  })
  if (error) throw error
  return data as WorkerMigrationCreatedWorker
}

/** Vinculación a plantilla: crea únicamente el Assignment del puesto vacante. */
export async function rpcLinkWorkerToPosition(
  workerId: string,
  positionId: string
): Promise<WorkerMigrationLinkedWorker> {
  const { data, error } = await supabase.rpc("link_worker_to_position", {
    p_worker_id: workerId,
    p_position_id: positionId,
    p_start_date: null,
  })
  if (error) throw error
  return data as WorkerMigrationLinkedWorker
}

/**
 * Filas de trabajadores creados por un lote de migración, con la vinculación vigente de
 * cada uno. Solo lectura: el historial de lotes no modifica datos.
 */
export async function fetchEntityMigrationBatchRows(
  entityId: string
): Promise<MigrationBatchRow[]> {
  const { data, error } = await supabase
    .from("workers")
    .select(
      "migration_batch_id,migrated_at,employment_status,worker_position_assignments(id,is_current,end_date)"
    )
    .eq("organization_entity_id", entityId)
    .not("migration_batch_id", "is", null)
    .order("migrated_at", { ascending: false })
  if (error) throw error
  return (data || []) as MigrationBatchRow[]
}
