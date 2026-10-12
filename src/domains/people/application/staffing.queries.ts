import {
  fetchActiveContractTypes,
  fetchEntityHireablePeople,
  fetchEntityOccupancy,
  fetchEntityPermission,
  fetchEntityStaffingPositions,
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
  WorkerIdentity,
} from "../domain/entities"

/**
 * Personas — Consultas de contratación y transiciones (aplicación).
 *
 * Casos de uso de LECTURA que necesitan las pantallas del bloque: el tablero de
 * contratación de la entidad (plantilla, ocupación y permisos), el espacio de trabajo de
 * las transiciones (puestos con su ocupación, tipos de contrato y contexto del
 * trabajador) y las diferencias contractuales de una reubicación.
 *
 * Las consultas y su ámbito son los mismos que ya usaban las pantallas; lo que cambia es
 * que viven una sola vez. Las lecturas de OTROS dominios (jornadas del puesto, escala
 * salarial aplicable, formas de pago) siguen siendo de sus dueños y no se duplican aquí.
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
    fetchEntityPermission(entityId, "workers.view"),
    fetchEntityPermission(entityId, "workers.manage"),
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
    fetchEntityPermission(entityId, CONTRACT_DATA_PERMISSION),
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
    fetchEntityPermission(entityId, CONTRACT_DATA_PERMISSION),
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

/** Diferencias contractuales de un cambio de puesto (§21/§22), calculadas por el backend. */
export async function previewPositionChange(input: {
  workerId: string
  newPositionId: string
  effectiveDate: string
}): Promise<PositionChangePreview> {
  return previewPositionChangeRpc(input)
}

/** Motivos de baja activos que puede elegir quien registra la baja. */
export async function loadSeparationReasons(): Promise<SeparationReason[]> {
  return fetchSeparationReasons()
}
