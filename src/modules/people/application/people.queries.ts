import { loadEntityPermission } from "@/domains/access-control"
import { isPendingCandidate, isReentryWorker } from "../domain/rules"
import { fetchPersonIdentificationStatus } from "../infrastructure/candidate-registration.repository"
import { rpcMigrationTemplateData } from "../infrastructure/worker-migration.repository"
import {
  fetchCandidatesWithLicense,
  fetchClientEmploymentIndex,
  fetchEducationLevels,
  fetchEntityActiveWorkerOptions,
  fetchEntityActiveWorkers,
  fetchEntityCandidates,
  fetchEntityReentryWorkers,
  fetchGenders,
  fetchLicenseCategories,
  fetchMaritalStatuses,
  fetchSkinColorsCatalog,
  fetchWorkersLastSeparation,
  fetchWorkersLinkedToStaffing,
} from "../infrastructure/people.repository"
import type {
  CatalogOption,
  CatalogRow,
  EntityWorkerOption,
  MigrationTemplateData,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonIdentificationStatus,
  PersonRegistryCatalogs,
  PersonReentryWorker,
  PersonSeparation,
} from "../domain/entities"

/**
 * Personas — Casos de uso de lectura (aplicación).
 *
 * Coordinan repositorio + reglas para que la presentación no componga consultas ni
 * repita el criterio de clasificación: cada vista pide SU caso de uso y recibe las filas
 * ya clasificadas, además de los datos accesorios que necesita para pintar.
 *
 * Las tres vistas imponen el mismo ámbito: la entidad (`organization_entity_id`) y el
 * índice de relaciones del CLIENTE (`company_client_id`, que nunca es lo mismo que la
 * entidad). Aislamiento por cliente y jerarquía Grupo → Empresa → UEB intactos.
 */

/**
 * Lectura auxiliar tolerante: un catálogo o un adorno que falla no debe vaciar la vista.
 * Las lecturas que determinan la clasificación NO pasan por aquí (propagan el error).
 */
const optional = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await read()
  } catch (error) {
    console.warn("[people] lectura auxiliar no disponible", error)
    return []
  }
}

export interface EntityCandidatesView {
  /** Personas pendientes de contratación (nunca contratadas). */
  candidates: PersonCandidate[]
  /** Candidatos con al menos una categoría de licencia registrada. */
  candidatesWithLicense: Set<string>
}

/** Vista Candidatos: personas de la entidad sin ninguna relación laboral en el cliente. */
export async function loadEntityCandidatesView(input: {
  entityId: string
  companyClientId: string | null | undefined
}): Promise<EntityCandidatesView> {
  const rows = await fetchEntityCandidates(input.entityId)

  // Clasificación compartida: una persona ya contratada NO es candidata, aunque
  // conserve una fila en `candidates` (p. ej. una fila antigua sin vincular).
  const employmentIndex = await fetchClientEmploymentIndex(
    input.companyClientId,
    rows.map((row) => row.identification)
  )
  const candidates = rows.filter((row) => isPendingCandidate(row, employmentIndex))

  const candidatesWithLicense = await fetchCandidatesWithLicense(candidates.map((row) => row.id))

  return { candidates, candidatesWithLicense }
}

export interface EntityWorkersDirectoryView {
  canView: boolean
  canManage: boolean
  workers: PersonDirectoryWorker[]
  /** Trabajadores con Assignment vigente (filtro Vinculado / Pendiente). */
  linkedWorkerIds: Set<string>
  catalogs: {
    genders: CatalogRow[]
    maritalStatuses: CatalogRow[]
    skinColors: CatalogOption[]
    educationLevels: CatalogRow[]
  }
}

/** Vista Trabajadores: personas de la entidad con relación laboral vigente. */
export async function loadEntityWorkersDirectory(
  entityId: string
): Promise<EntityWorkersDirectoryView> {
  const canView = await loadEntityPermission(entityId, "workers.view")
  const canManage = await loadEntityPermission(entityId, "workers.manage")

  const empty: EntityWorkersDirectoryView = {
    canView,
    canManage,
    workers: [],
    linkedWorkerIds: new Set<string>(),
    catalogs: { genders: [], maritalStatuses: [], skinColors: [], educationLevels: [] },
  }
  if (!canView && !canManage) return empty

  const workers = await fetchEntityActiveWorkers(entityId)

  const [genders, maritalStatuses, skinColors, educationLevels] = await Promise.all([
    optional(fetchGenders),
    optional(fetchMaritalStatuses),
    optional(fetchSkinColorsCatalog),
    optional(fetchEducationLevels),
  ])

  const linkedWorkerIds = await fetchWorkersLinkedToStaffing(workers.map((row) => row.id))

  return {
    canView,
    canManage,
    workers,
    linkedWorkerIds,
    catalogs: { genders, maritalStatuses, skinColors, educationLevels },
  }
}

export interface EntityReentriesView {
  canView: boolean
  canManage: boolean
  /** Antiguos trabajadores sin relación laboral vigente en el cliente. */
  workers: PersonReentryWorker[]
  /** Última baja registrada por trabajador. */
  separations: Record<string, PersonSeparation>
  catalogs: { genders: CatalogRow[]; educationLevels: CatalogRow[] }
}

/** Vista Reingresos: relaciones laborales finalizadas y sin otra vigente. */
export async function loadEntityReentriesView(input: {
  entityId: string
  companyClientId: string | null | undefined
}): Promise<EntityReentriesView> {
  const canView = await loadEntityPermission(input.entityId, "workers.view")
  const canManage = await loadEntityPermission(input.entityId, "workers.manage")

  const empty: EntityReentriesView = {
    canView,
    canManage,
    workers: [],
    separations: {},
    catalogs: { genders: [], educationLevels: [] },
  }
  if (!canView && !canManage) return empty

  const rows = await fetchEntityReentryWorkers(input.entityId)

  // Si la persona mantiene OTRA relación vigente en el cliente (aunque sea en otra
  // entidad), no es un reingreso.
  const employmentIndex = await fetchClientEmploymentIndex(
    input.companyClientId,
    rows.map((row) => row.identification)
  )
  const workers = rows.filter((row) => isReentryWorker(row, employmentIndex))

  const [genders, educationLevels] = await Promise.all([
    optional(fetchGenders),
    optional(fetchEducationLevels),
  ])

  const separations = await fetchWorkersLastSeparation(workers.map((row) => row.id))

  return {
    canView,
    canManage,
    workers,
    separations,
    catalogs: { genders, educationLevels },
  }
}

/**
 * Datos de referencia del registro de personas (sexo, estado civil, nivel educacional,
 * color de piel y categorías de licencia). Aquí los errores SÍ se propagan: sin estos
 * catálogos el alta no puede completarse correctamente.
 */
export async function loadCandidateRegistryCatalogs(): Promise<PersonRegistryCatalogs> {
  const [genders, maritalStatuses, educationLevels, skinColors, licenseCategories] =
    await Promise.all([
      fetchGenders(),
      fetchMaritalStatuses(),
      fetchEducationLevels(),
      fetchSkinColorsCatalog(),
      fetchLicenseCategories(),
    ])

  return { genders, maritalStatuses, educationLevels, skinColors, licenseCategories }
}

/**
 * Datos de referencia de la carga inicial (`get_migration_template_data`): áreas, cargos,
 * puestos, tipos de contrato, formas de pago y representantes. La migración no compone esta
 * consulta en la pantalla.
 */
export async function loadMigrationTemplateData(
  entityId: string,
  migrationType: string
): Promise<MigrationTemplateData> {
  return rpcMigrationTemplateData(entityId, migrationType)
}

/**
 * Trabajadores activos de la entidad (id, nombre completo e identificación) para los
 * selectores del expediente. Una sola lectura para todos los formularios que eligen
 * trabajador: no se repite la consulta en cada diálogo.
 */
export async function loadEntityActiveWorkerOptions(
  entityId: string
): Promise<EntityWorkerOption[]> {
  return fetchEntityActiveWorkerOptions(entityId)
}

/**
 * Estado de identificación de la persona en el cliente (`person_identification_status`).
 * Es la comprobación que impide duplicar una persona; los mensajes que se muestran al
 * usuario los decide cada pantalla a partir de este resultado.
 */
export async function loadPersonIdentificationStatus(
  entityId: string,
  identification: string
): Promise<PersonIdentificationStatus> {
  return fetchPersonIdentificationStatus(entityId, identification.trim())
}
