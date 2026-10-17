import {
  fetchEntityName,
  fetchEntityScheduleSegments,
  fetchEntityStaffingJobs,
  fetchSalaryValuesForGroups,
  fetchStaffingExportRows,
  resolveApplicableScaleId,
} from "@/modules/organization-structure"
import type {
  PositionScheduleSegment,
  SalaryValue,
  StaffingExportRow,
} from "@/modules/organization-structure"
import { loadEntityPermissionSafe } from "@/modules/access-control"
import {
  fetchActiveContractTypes,
  fetchEntityHireablePeople,
  fetchEntityOccupancy,
  fetchEntityStaffingPositions,
  fetchEntityStaffingWorkers,
  fetchSeparationReasons,
  fetchWorkerIdentity,
} from "../infrastructure/staffing.repository"
import { previewPositionChangeRpc } from "../infrastructure/worker-transitions.repository"
import type {
  ContractTypeOption,
  EntityOccupancy,
  HireablePerson,
  PositionChangePreview,
  SeparationReason,
  StaffingPosition,
  StaffingWorkerRow,
  WorkerIdentity,
} from "../domain/entities"

/**
 * Personas — Consultas de contratación y transiciones (aplicación).
 *
 * Casos de uso de LECTURA que necesitan las pantallas del bloque: el tablero de
 * contratación de la entidad (plantilla, ocupación y permisos), el espacio de trabajo de
 * las transiciones (puestos con su ocupación, tipos de contrato y contexto del
 * trabajador), las diferencias contractuales de una reubicación y la PLANTILLA OPERATIVA
 * (los trabajadores de la entidad con su trayectoria de puestos).
 *
 * Las consultas y su ámbito son los mismos que ya usaban las pantallas; lo que cambia es
 * que viven una sola vez. Las lecturas de OTROS dominios (cargos, jornadas del puesto,
 * escala salarial aplicable, plantilla del Anexo14B) siguen siendo de sus dueños y no se
 * duplican aquí: se piden a `organization-structure`, dueño de la estructura.
 */

/** Permiso interno que habilita la configuración de representantes de la entidad. */
export const CONTRACT_DATA_PERMISSION = "contract_data.manage"

export interface EntityStaffingBoard {
  /** La entidad se puede ver o gestionar: sin permiso no se lee plantilla alguna. */
  authorized: boolean
  canManage: boolean
  positions: StaffingPosition[]
  occupancy: EntityOccupancy
}

const emptyOccupancy = (): EntityOccupancy => ({ counts: {}, occupants: {} })

/**
 * Tablero de contratación: puestos ACTIVOS de la entidad con su ocupación vigente.
 * Sólo lectura: cubrir un puesto es una operación aparte.
 */
export async function loadEntityStaffingBoard(entityId: string): Promise<EntityStaffingBoard> {
  const [canView, canManage] = await Promise.all([
    loadEntityPermissionSafe(entityId, "workers.view"),
    loadEntityPermissionSafe(entityId, "workers.manage"),
  ])

  if (!canView && !canManage) {
    return { authorized: false, canManage: false, positions: [], occupancy: emptyOccupancy() }
  }

  const [positions, occupancy] = await Promise.all([
    fetchEntityStaffingPositions(entityId, { onlyActive: true }),
    fetchEntityOccupancy(entityId),
  ])

  return { authorized: true, canManage, positions, occupancy }
}

export interface TransitionWorkspace {
  positions: StaffingPosition[]
  occupancy: EntityOccupancy
  contractTypes: ContractTypeOption[]
  /** Habilita la configuración de representantes desde el propio diálogo. */
  canManageContractData: boolean
  /** Identidad del trabajador, cuando el flujo parte de un trabajador concreto. */
  worker: WorkerIdentity | null
}

/**
 * Espacio de trabajo de las transiciones: TODOS los puestos de la entidad (la pantalla
 * decide cuáles son elegibles), su ocupación vigente, los tipos de contrato activos y el
 * contexto del trabajador.
 */
export async function loadTransitionWorkspace(
  entityId: string,
  options: { workerId?: string | null } = {}
): Promise<TransitionWorkspace> {
  const [positions, occupancy, contractTypes, canManageContractData, worker] = await Promise.all([
    fetchEntityStaffingPositions(entityId),
    fetchEntityOccupancy(entityId),
    fetchActiveContractTypes(),
    loadEntityPermissionSafe(entityId, CONTRACT_DATA_PERMISSION),
    options.workerId ? fetchWorkerIdentity(options.workerId) : Promise.resolve(null),
  ])

  return { positions, occupancy, contractTypes, canManageContractData, worker }
}

export interface ContractChangeWorkspace {
  contractTypes: ContractTypeOption[]
  /** Habilita la configuración de representantes desde el propio diálogo. */
  canManageContractData: boolean
}

/**
 * Espacio de trabajo del cambio de contrato: tipos de contrato activos y permiso de los
 * datos contractuales. No necesita la plantilla de puestos: el puesto no cambia.
 */
export async function loadContractChangeWorkspace(
  entityId: string
): Promise<ContractChangeWorkspace> {
  const [contractTypes, canManageContractData] = await Promise.all([
    fetchActiveContractTypes(),
    loadEntityPermissionSafe(entityId, CONTRACT_DATA_PERMISSION),
  ])
  return { contractTypes, canManageContractData }
}

export interface HiringWorkspace extends TransitionWorkspace {
  /** Personas candidatas de la entidad con su vínculo laboral (contratación o recontratación). */
  people: HireablePerson[]
}

/** Espacio de trabajo de la contratación: añade las personas candidatas de la entidad. */
export async function loadHiringWorkspace(
  entityId: string,
  options: { workerId?: string | null } = {}
): Promise<HiringWorkspace> {
  const [workspace, people] = await Promise.all([
    loadTransitionWorkspace(entityId, options),
    fetchEntityHireablePeople(entityId),
  ])
  return { ...workspace, people }
}

/**
 * Diferencias contractuales de un cambio de puesto (§21/§22), calculadas por el backend.
 *
 * `targetAssignmentId` identifica la asignación afectada cuando el trabajador tiene DOS
 * contratos vigentes (pluriempleo); con uno solo viaja `null`/ausente y la llamada es la
 * misma de siempre.
 */
export async function previewPositionChange(input: {
  workerId: string
  newPositionId: string
  effectiveDate: string
  targetAssignmentId?: string | null
}): Promise<PositionChangePreview> {
  return previewPositionChangeRpc(input)
}

/** Motivos de baja activos que puede elegir quien registra la baja. */
export async function loadSeparationReasons(): Promise<SeparationReason[]> {
  return fetchSeparationReasons()
}

/**
 * Plantilla operativa de la entidad: TODO lo que necesita la pantalla en una sola lectura.
 *
 *   · Permiso de trabajadores (sin él no se lee plantilla alguna).
 *   · Nombre de la entidad y sus cargos (estructura organizativa: son suyos el área, el
 *     cargo y el grupo salarial).
 *   · Puestos con su estructura y trabajadores con su trayectoria de puestos (personas).
 *   · Capacidades del Anexo14B, jornadas por puesto, escala aplicable y valores salariales.
 *
 * El aislamiento es el de siempre: entidad (`organization_entity_id`) + RLS por
 * `company_client_id`; `company_client_id` y `organization_entity_id` nunca se mezclan.
 */
export interface EntityStaffingWorkspace {
  /** La entidad se puede ver o gestionar: sin permiso no se lee plantilla alguna. */
  authorized: boolean
  canManage: boolean
  entityName: string
  /** Puestos de la entidad (activos e inactivos: la pantalla decide cuáles muestra). */
  positions: StaffingPosition[]
  /** Trabajadores de la entidad con su trayectoria de puestos. */
  workers: StaffingWorkerRow[]
  /** Capacidades de la plantilla (misma fuente que el Anexo14B). */
  exportRows: StaffingExportRow[]
  segmentsByPosition: Record<string, PositionScheduleSegment[]>
  applicableScaleId: string | null
  /** Valor salarial vigente por grupo salarial de los cargos de la entidad. */
  salaryValuesByGroup: Record<string, SalaryValue | null>
}

const emptyStaffingWorkspace = (canManage = false): EntityStaffingWorkspace => ({
  authorized: false,
  canManage,
  entityName: "",
  positions: [],
  workers: [],
  exportRows: [],
  segmentsByPosition: {},
  applicableScaleId: null,
  salaryValuesByGroup: {},
})

export async function loadEntityStaffingWorkspace(
  entityId: string
): Promise<EntityStaffingWorkspace> {
  const [canView, canManage] = await Promise.all([
    loadEntityPermissionSafe(entityId, "workers.view"),
    loadEntityPermissionSafe(entityId, "workers.manage"),
  ])
  if (!canView && !canManage) return emptyStaffingWorkspace(canManage)

  const [entityName, jobs, positions] = await Promise.all([
    fetchEntityName(entityId),
    fetchEntityStaffingJobs(entityId),
    fetchEntityStaffingPositions(entityId),
  ])

  const [workers, exportRows, segmentsByPosition, applicableScaleId] = await Promise.all([
    fetchEntityStaffingWorkers(entityId),
    fetchStaffingExportRows(entityId),
    fetchEntityScheduleSegments(entityId),
    resolveApplicableScaleId(entityId),
  ])

  const groupIds = jobs
    .map((job) => job.salary_group?.id)
    .filter((id): id is string => !!id)
  const salaryValuesByGroup = await fetchSalaryValuesForGroups(groupIds)

  return {
    authorized: true,
    canManage,
    entityName,
    positions,
    workers,
    exportRows,
    segmentsByPosition,
    applicableScaleId,
    salaryValuesByGroup,
  }
}
