import { fetchPersonCatalogs } from "../infrastructure/catalogs.repository"
import { resolveApplicableScaleId } from "@/domains/organization-structure"
import {
  fetchSalaryScaleName,
  fetchWorkerEmploymentMovements,
  fetchWorkerExpediente,
  fetchWorkerExpedienteCatalogs,
  fetchWorkerLicenseIds,
  fetchWorkerTenurePayment,
} from "../infrastructure/worker-expediente.repository"
import { loadEntityPermissionSafe } from "@/domains/access-control"
import type {
  CatalogOption,
  TenurePaymentRule,
  WorkerEmploymentMovement,
  WorkerExpediente,
  WorkerExpedienteCatalogs,
} from "../domain/entities"

/**
 * Personas — Casos de uso de lectura del expediente del TRABAJADOR (aplicación).
 *
 * La ficha del trabajador pide aquí su expediente completo: la persona con su trayectoria
 * (asignaciones y contratos), su bitácora de movimientos, sus licencias de conducción, sus
 * catálogos, el pago por antigüedad aplicable y la escala salarial de su entidad. Nada de
 * esto se compone ya en la pantalla.
 *
 * Permisos: se leen igual que antes (`can_access_entity`) y SIN propagar fallos: solo
 * deciden qué se puede ver o editar, y la autoridad real sigue siendo RLS y las RPC.
 *
 * Tolerancias (las mismas de siempre): un catálogo o una lectura auxiliar que falla no
 * vacía la ficha; las licencias y los catálogos globales de persona SÍ propagan su error,
 * como ya hacían.
 */

export interface WorkerExpedientePermissions {
  canView: boolean
  canManage: boolean
}

/** Permisos que gobiernan el formulario del trabajador. */
export interface WorkerFormPermissions {
  /** Datos contractuales de la organización: condiciones del contrato en el alta. */
  canManageContractData: boolean
}

/** Permisos del formulario del trabajador (sin propagar fallos, como ya hacía). */
export async function loadWorkerFormPermissions(
  entityId: string
): Promise<WorkerFormPermissions> {
  return {
    canManageContractData: await loadEntityPermissionSafe(entityId, "contract_data.manage"),
  }
}

/** Licencias de conducción registradas para el trabajador (edición del expediente). */
export async function loadWorkerExpedienteLicenseIds(workerId: string): Promise<string[]> {
  return fetchWorkerLicenseIds(workerId)
}

export interface WorkerExpedienteView {
  permissions: WorkerExpedientePermissions
  /** Ficha laboral; `null` cuando no hay permiso de lectura o no existe. */
  worker: WorkerExpediente | null
  catalogs: WorkerExpedienteCatalogs
  skinColors: CatalogOption[]
  licenseCategories: CatalogOption[]
  drivingLicenseIds: string[]
  /** Bitácora laboral: bajas, reincorporaciones y cambios de puesto, con su autor. */
  movements: WorkerEmploymentMovement[]
  /** Pago por antigüedad aplicable, resuelto en el servidor. */
  tenurePayment: TenurePaymentRule | null
  applicableScaleId: string | null
  applicableScaleName: string | null
}

const emptyCatalogs = (): WorkerExpedienteCatalogs => ({
  genders: [],
  maritalStatuses: [],
  educationLevels: [],
  contractTypes: [],
})

/**
 * Catálogos del expediente laboral. Un catálogo que falla no vacía la pantalla, igual que
 * antes: la vista se pinta sin esa lista.
 */
export async function loadWorkerReferenceCatalogs(): Promise<WorkerExpedienteCatalogs> {
  try {
    return await fetchWorkerExpedienteCatalogs()
  } catch (error) {
    console.warn("[people] catálogos del expediente no disponibles", error)
    return emptyCatalogs()
  }
}

/**
 * Expediente completo del trabajador. Es la lectura que sostiene la ficha: si el trabajador
 * no existe o no pertenece a la entidad, el error se propaga y la pantalla lo muestra.
 */
export async function loadWorkerExpedienteView(input: {
  entityId: string
  workerId: string
}): Promise<WorkerExpedienteView> {
  const [canView, canManage] = await Promise.all([
    loadEntityPermissionSafe(input.entityId, "workers.view"),
    loadEntityPermissionSafe(input.entityId, "workers.manage"),
  ])

  const permissions: WorkerExpedientePermissions = { canView, canManage }

  if (!canView && !canManage) {
    return {
      permissions,
      worker: null,
      catalogs: emptyCatalogs(),
      skinColors: [],
      licenseCategories: [],
      drivingLicenseIds: [],
      movements: [],
      tenurePayment: null,
      applicableScaleId: null,
      applicableScaleName: null,
    }
  }

  const worker = await fetchWorkerExpediente(input.entityId, input.workerId)

  const [personCatalogs, licenseIds, catalogs, movements, tenurePayment, applicableScaleId] =
    await Promise.all([
      fetchPersonCatalogs(),
      fetchWorkerLicenseIds(worker.id),
      loadWorkerReferenceCatalogs(),
      // La bitácora es auxiliar: si no se puede leer, la ficha sigue mostrándose.
      (async () => {
        try {
          return await fetchWorkerEmploymentMovements(input.workerId)
        } catch (error) {
          console.warn("[people] no se pudo leer la bitácora laboral", error)
          return [] as WorkerEmploymentMovement[]
        }
      })(),
      fetchWorkerTenurePayment(input.entityId, input.workerId),
      resolveApplicableScaleId(input.entityId),
    ])

  const applicableScaleName = applicableScaleId
    ? await fetchSalaryScaleName(applicableScaleId)
    : null

  return {
    permissions,
    worker,
    catalogs,
    skinColors: personCatalogs.skinColors,
    licenseCategories: personCatalogs.licenseCategories,
    drivingLicenseIds: licenseIds,
    movements,
    tenurePayment,
    applicableScaleId,
    applicableScaleName,
  }
}
