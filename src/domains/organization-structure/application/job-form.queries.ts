import {
  fetchOccupationalCategories,
  fetchPreparationLevels,
} from "../infrastructure/catalogs.repository"
import { selectActiveEntityAreas } from "../infrastructure/areas.repository"
import {
  selectJobClaNightSegments,
  selectJobPreparationLevelIds,
} from "../infrastructure/jobs.repository"
import {
  selectCurrentSalaryGroupValue,
  selectGroupsWithValues,
} from "../infrastructure/salary-administration.repository"
import {
  fetchEntityRegime,
  selectSalaryScaleSummary,
} from "../infrastructure/entity-configuration.repository"
import { resolveApplicableScaleId } from "../infrastructure/salary.repository"
import type {
  JobClaNightSegment,
  OccupationalCategory,
  OrganizationArea,
  PreparationLevel,
  SalaryGroupWithCurrent,
  SalaryValue,
} from "../domain/entities"

/**
 * Estructura organizativa — Caso de uso del formulario del cargo (aplicación).
 *
 * El cargo se clasifica y se retribuye con datos que la interfaz NO elige por su cuenta:
 * el catálogo global de categorías ocupacionales y de niveles de preparación, las áreas
 * activas de la entidad y los grupos de la ESCALA APLICABLE a la entidad con su importe
 * vigente. Si la entidad no tiene escala (empresarial sin configurar) la pantalla lo dice:
 * nunca hay fallback a la escala presupuestada.
 *
 * Al editar un cargo se recuperan también sus dos tramos de CLA, sus niveles de preparación
 * y el importe vigente de su grupo. El fallo de estos datos accesorios NUNCA impide abrir el
 * formulario: se devuelven vacíos, igual que antes.
 */

/** Escala aplicable a la entidad: de dónde salen los grupos que puede elegir el cargo. */
export interface JobFormScaleInfo {
  scaleId: string | null
  scaleName: string
  scopeType: string | null
  regime: string | null
}

export interface JobFormWorkspace {
  areas: OrganizationArea[]
  categories: OccupationalCategory[]
  preparationLevels: PreparationLevel[]
  scaleInfo: JobFormScaleInfo
  groups: SalaryGroupWithCurrent[]
  claNightSegments: JobClaNightSegment[]
  preparationLevelIds: string[]
  currentSalaryValue: SalaryValue | null
}

/**
 * Mensajes por etapa de carga: son los que ve el usuario y distinguen qué no se pudo leer.
 */
const STAGE_MESSAGES = {
  areas: "No se pudieron cargar las áreas.",
  categorias: "No se pudieron cargar las categorías ocupacionales.",
  escala: "No se pudieron cargar los grupos salariales.",
  grupos: "No se pudieron cargar los grupos salariales.",
} as const

export async function loadJobFormWorkspace(
  entityId: string,
  options: { jobId?: string | null; salaryGroupId?: string | null } = {}
): Promise<JobFormWorkspace> {
  let stage: keyof typeof STAGE_MESSAGES = "areas"

  const basics = await (async () => {
    try {
      const areas = await selectActiveEntityAreas(entityId)

      stage = "categorias"
      const categories = await fetchOccupationalCategories()
      const preparationLevels = await fetchPreparationLevels()

      stage = "escala"
      const regime = await fetchEntityRegime(entityId)
      const scaleId = await resolveApplicableScaleId(entityId)

      stage = "grupos"
      if (!scaleId) {
        return {
          areas,
          categories,
          preparationLevels,
          groups: [] as SalaryGroupWithCurrent[],
          scaleInfo: { scaleId: null, scaleName: "", scopeType: null, regime } as JobFormScaleInfo,
        }
      }

      const details = await selectSalaryScaleSummary(scaleId)
      const groups = await selectGroupsWithValues(scaleId)

      return {
        areas,
        categories,
        preparationLevels,
        groups,
        scaleInfo: {
          scaleId,
          scaleName: details?.name || "Escala aplicable",
          scopeType: details?.scope_type || null,
          regime,
        } as JobFormScaleInfo,
      }
    } catch (error) {
      console.error("Error cargando el formulario del cargo:", error)
      throw new Error(STAGE_MESSAGES[stage])
    }
  })()

  const jobId = options.jobId || null
  const salaryGroupId = options.salaryGroupId || null
  if (!jobId && !salaryGroupId) {
    return { ...basics, claNightSegments: [], preparationLevelIds: [], currentSalaryValue: null }
  }

  // Datos del cargo en edición: si alguno falla, el formulario se abre igualmente vacío.
  const [claNightSegments, preparationLevelIds, currentSalaryValue] = await Promise.all([
    jobId
      ? selectJobClaNightSegments(jobId).catch(() => [] as JobClaNightSegment[])
      : Promise.resolve([] as JobClaNightSegment[]),
    jobId
      ? selectJobPreparationLevelIds(jobId).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
    salaryGroupId
      ? loadCurrentSalaryValueForGroup(salaryGroupId)
      : Promise.resolve(null as SalaryValue | null),
  ])

  return { ...basics, claNightSegments, preparationLevelIds, currentSalaryValue }
}

/** Importe vigente de un grupo salarial (al cambiar de grupo en el formulario del cargo). */
export async function loadCurrentSalaryValueForGroup(
  groupId: string
): Promise<SalaryValue | null> {
  const value = await selectCurrentSalaryGroupValue(groupId).catch(() => null)
  if (!value) return null
  return { amount: value.amount, currency_code: value.currency_code }
}
