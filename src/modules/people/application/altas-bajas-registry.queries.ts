import { loadEntityPermission } from "@/modules/access-control"
import {
  fetchEntityAltasBajasRegistry,
  formatAltaDisplay,
  formatShortDate,
  persistWorkerAltaNumber,
} from "../infrastructure/altas-bajas-registry.repository"
import {
  buildAltasBajasRegistryWorkbook,
  downloadAltasBajasRegistryExcel,
  type ExportAltasBajasExcelOptions,
} from "../infrastructure/altas-bajas-registry.workbook"
import type { AltasBajasRegistryRow } from "../domain/entities"

export interface EntityAltasBajasRegistryView {
  authorized: boolean
  canManage: boolean
  rows: AltasBajasRegistryRow[]
}

export interface SaveAltasBajasAltaNumberInput {
  workerId: string
  altaDate: string | null
  altaNumber: string | null
  assignmentId?: string | null
}

/**
 * Carga la vista del «b) Registro de Altas y Bajas» de una entidad.
 * Habilitado para usuarios con permiso de consulta o gestión de trabajadores u organización.
 */
export async function loadEntityAltasBajasRegistry(
  entityId: string
): Promise<EntityAltasBajasRegistryView> {
  const [canViewWorkers, canManageWorkers, canViewOrg, canManageOrg] = await Promise.all([
    loadEntityPermission(entityId, "workers.view"),
    loadEntityPermission(entityId, "workers.manage"),
    loadEntityPermission(entityId, "organization.view"),
    loadEntityPermission(entityId, "organization.manage"),
  ])

  const authorized = canViewWorkers || canManageWorkers || canViewOrg || canManageOrg
  const canManage = canManageWorkers || canManageOrg

  if (!authorized) {
    return {
      authorized: false,
      canManage: false,
      rows: [],
    }
  }

  const rows = await fetchEntityAltasBajasRegistry(entityId)
  return {
    authorized: true,
    canManage,
    rows,
  }
}

/**
 * Guarda o actualiza el Número de alta (Columna 4: Fecha y No. de alta) de una entrada
 * del Registro de Altas y Bajas (especialmente útil para migraciones iniciales).
 */
export async function saveAltasBajasAltaNumber(
  input: SaveAltasBajasAltaNumberInput
): Promise<void> {
  await persistWorkerAltaNumber(
    input.workerId,
    input.altaDate,
    input.altaNumber,
    input.assignmentId
  )
}

export {
  buildAltasBajasRegistryWorkbook,
  downloadAltasBajasRegistryExcel,
  formatAltaDisplay,
  formatShortDate,
  type ExportAltasBajasExcelOptions,
}
