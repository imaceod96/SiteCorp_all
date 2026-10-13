import {
  fetchJobPreparationLevels,
  fetchOccupationalCategories,
} from "../infrastructure/catalogs.repository"
import { fetchEntityName } from "../infrastructure/entity-staffing.repository"
import { fetchEntityScheduleSegments } from "../infrastructure/schedule.repository"
import {
  fetchSalaryValuesForGroups,
  resolveApplicableScaleId,
} from "../infrastructure/salary.repository"
import { selectEntityAreas } from "../infrastructure/areas.repository"
import {
  selectConfigurationJobRows,
  type ConfigurationJobRow,
} from "../infrastructure/jobs.repository"
import { selectConfigurationPositionRows } from "../infrastructure/positions.repository"
import { loadEntityPermission } from "@/domains/access-control"
import type {
  OccupationalCategory,
  OrganizationArea,
  OrganizationJob,
  OrganizationPosition,
  PreparationLevel,
  SalaryValue,
} from "../domain/entities"

/**
 * Estructura organizativa — Caso de uso de la configuración de plantilla (aplicación).
 *
 * Lee TODO lo que necesita la pantalla «Configuración de plantilla»: el permiso interno de
 * la entidad, su nombre, sus áreas (con la jerarquía), sus cargos con el área, la categoría
 * ocupacional, el grupo salarial y su importe vigente, el árbol Área → Cargo → Puesto con el
 * horario habitual de cada puesto, la escala aplicable a la entidad y los importes vigentes
 * por grupo salarial.
 *
 * La pantalla no compone ninguna consulta: recibe datos ya resueltos. El aislamiento es el
 * de siempre (entidad + RLS por `company_client_id`) y `company_client_id` nunca se envía.
 *
 * Los permisos, el ámbito y los mensajes son EXACTAMENTE los que ya usaba la pantalla.
 */

export interface StaffingConfigurationWorkspace {
  /** La entidad se puede ver o gestionar: sin permiso no se lee configuración alguna. */
  authorized: boolean
  canManage: boolean
  entityName: string
  areas: OrganizationArea[]
  jobs: OrganizationJob[]
  positions: OrganizationPosition[]
  /** Nombre de la categoría ocupacional por identificador (catálogo global). */
  categoryNameById: Record<string, string>
  /** Niveles de preparación configurados en cada cargo (derivados del CARGO). */
  preparationLevelsByJob: Record<string, PreparationLevel[]>
  /** Escala aplicable: la presupuestada global o la empresarial de la entidad (sin fallback). */
  applicableScaleId: string | null
  /** Importe vigente por grupo salarial de los cargos de la entidad. */
  salaryValuesByGroup: Record<string, SalaryValue | null>
}

const emptyStaffingConfiguration = (canManage = false): StaffingConfigurationWorkspace => ({
  authorized: false,
  canManage,
  entityName: "",
  areas: [],
  jobs: [],
  positions: [],
  categoryNameById: {},
  preparationLevelsByJob: {},
  applicableScaleId: null,
  salaryValuesByGroup: {},
})

/**
 * La categoría ocupacional y el grupo salarial del cargo se resuelven en el cliente por
 * identificador: la pantalla nunca depende de que PostgREST detecte la relación.
 */
function mapConfigurationJobs(
  rows: ConfigurationJobRow[],
  categoryById: Map<string, OccupationalCategory>
): OrganizationJob[] {
  return rows.map((row) => {
    const values = row.salary_group?.salary_group_values
    const currentValue = values && values.length > 0 ? values[0] : null

    return {
      ...row,
      occupational_category: row.occupational_category_id
        ? categoryById.get(row.occupational_category_id) || null
        : null,
      salary_group: row.salary_group
        ? {
            id: row.salary_group.id,
            salary_scale_id: row.salary_group.salary_scale_id,
            sequence_number: row.salary_group.sequence_number,
            description: row.salary_group.description,
            is_active: row.salary_group.is_active,
            current_value: currentValue
              ? { amount: currentValue.amount, currency_code: currentValue.currency_code }
              : null,
          }
        : null,
    }
  })
}

export async function loadStaffingConfiguration(
  entityId: string
): Promise<StaffingConfigurationWorkspace> {
  const [canView, canManage] = await Promise.all([
    loadEntityPermission(entityId, "staffing.view"),
    loadEntityPermission(entityId, "staffing.manage"),
  ])

  if (!canView && !canManage) return emptyStaffingConfiguration(canManage)

  const entityName = await fetchEntityName(entityId)
  const areas = await selectEntityAreas(entityId)

  const jobRows = await selectConfigurationJobRows(entityId)

  // Catálogo GLOBAL de categorías ocupacionales: se resuelve por identificador para
  // mostrar la categoría del cargo sin depender de la detección de la relación.
  const categories = await fetchOccupationalCategories({ includeInactive: true })
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const categoryNameById: Record<string, string> = {}
  categories.forEach((c) => {
    categoryNameById[c.id] = c.name
  })

  const jobs = mapConfigurationJobs(jobRows, categoryById)

  const preparationLevelsByJob = await fetchJobPreparationLevels(jobs.map((job) => job.id))

  const applicableScaleId = await resolveApplicableScaleId(entityId)

  const groupIds = jobs
    .map((job) => job.salary_group?.id)
    .filter((id): id is string => !!id)
  const salaryValuesByGroup = await fetchSalaryValuesForGroups(groupIds)

  const positionRows = await selectConfigurationPositionRows(entityId)
  const segmentsByPosition = await fetchEntityScheduleSegments(entityId)
  const positions: OrganizationPosition[] = positionRows.map((position) => ({
    ...position,
    schedule_segments: segmentsByPosition[position.id] || [],
  }))

  return {
    authorized: true,
    canManage,
    entityName,
    areas,
    jobs,
    positions,
    categoryNameById,
    preparationLevelsByJob,
    applicableScaleId,
    salaryValuesByGroup,
  }
}
