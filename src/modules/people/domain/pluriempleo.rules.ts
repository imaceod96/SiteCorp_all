/**
 * Personas — Pluriempleo: vocabulario y reglas de la interfaz.
 *
 * PLURIEMPLEO = una MISMA persona (una única ficha) con DOS contratos laborales
 * vigentes en la MISMA entidad, cada uno sobre un puesto distinto.
 *
 * Este archivo NO duplica reglas del backend: la autoridad sobre el límite de dos
 * contratos, la capacidad del puesto, la preparación contractual y los snapshots es
 * de las RPC (`create_worker_pluriemploy`). Aquí vive únicamente:
 *   · el interruptor de activación de la interfaz;
 *   · la lectura de los contratos/asignaciones vigentes del expediente;
 *   · la identificación del contrato afectado por una operación (`p_target_*`);
 *   · las etiquetas del vocabulario de la bitácora laboral.
 */

import { validateWorkerContractInput } from "./rules"
import {
  PLURIEMPLEO_DISABLED_MESSAGE,
  PLURIEMPLEO_ENABLED,
  PLURIEMPLEO_LABEL,
  PLURIEMPLEO_MAX_ACTIVE_CONTRACTS,
  PLURIEMPLEO_MOVEMENT_TYPE,
  PLURIEMPLEO_TARGET_REQUIRED_MESSAGE,
} from "@/shared/config/pluriempleo"
import type { WorkerAssignmentRow, WorkerContractRow, WorkerExpediente } from "./entities"

/**
 * El INTERRUPTOR de activación (`PLURIEMPLEO_ENABLED`) y su vocabulario viven en la capa
 * compartida (`@/shared/config/pluriempleo`) porque también los necesita el módulo
 * Contratos. Se reexportan aquí para que Personas tenga un único punto de entrada.
 */
export {
  PLURIEMPLEO_DISABLED_MESSAGE,
  PLURIEMPLEO_ENABLED,
  PLURIEMPLEO_LABEL,
  PLURIEMPLEO_MAX_ACTIVE_CONTRACTS,
  PLURIEMPLEO_MOVEMENT_TYPE,
  PLURIEMPLEO_TARGET_REQUIRED_MESSAGE,
}

/**
 * Vocabulario de la bitácora laboral (`worker_employment_movements.movement_type`).
 * Se incluye «Pluriempleo» para que el evento del segundo contrato se muestre con su
 * propio nombre y no se confunda con un cambio de puesto o de contrato.
 */
export const EMPLOYMENT_MOVEMENT_LABELS: Record<string, string> = {
  ALTA: "Alta",
  BAJA: "Baja",
  REINCORPORACION: "Reincorporación",
  CAMBIO_PUESTO: "Cambio de puesto",
  CAMBIO_CONTRATO: "Cambio de contrato",
  [PLURIEMPLEO_MOVEMENT_TYPE]: PLURIEMPLEO_LABEL,
}

/** Etiqueta legible de un movimiento de la bitácora (nunca inventa: usa el código). */
export const employmentMovementLabel = (movementType: string): string =>
  EMPLOYMENT_MOVEMENT_LABELS[movementType] || movementType

/** Contratos VIGENTES del trabajador (los que cuentan para el límite de dos). */
export const activeContractsOf = (
  worker: WorkerExpediente | null | undefined
): WorkerContractRow[] => (worker?.contracts ?? []).filter((contract) => !!contract.is_current)

/** Asignaciones de puesto VIGENTES (sin fecha de fin) del trabajador. */
export const activeAssignmentsOf = (
  worker: WorkerExpediente | null | undefined
): WorkerAssignmentRow[] =>
  (worker?.assignments ?? []).filter((a) => !!a.is_current && !a.end_date)

/** El trabajador está en pluriempleo cuando tiene más de un contrato vigente. */
export const hasPluriempleo = (worker: WorkerExpediente | null | undefined): boolean =>
  activeContractsOf(worker).length > 1

/**
 * ¿Se puede ofrecer la opción «Pluriempleo»? Requiere la interfaz habilitada, el
 * trabajador ACTIVO y EXACTAMENTE un contrato vigente (el segundo contrato se
 * formaliza sobre esa base; con dos ya no hay un tercero posible).
 */
export function canOfferPluriempleo(worker: WorkerExpediente | null | undefined): boolean {
  if (!PLURIEMPLEO_ENABLED) return false
  if (!worker || worker.employment_status !== "active") return false
  return activeContractsOf(worker).length === 1
}

export interface ContractTarget {
  /** Asignación del contrato afectado (`p_target_assignment_id`). */
  targetAssignmentId: string | null
  /** Contrato afectado (`p_target_contract_id`). */
  targetContractId: string | null
}

const NO_TARGET: ContractTarget = { targetAssignmentId: null, targetContractId: null }

/**
 * Identifica el contrato afectado por una operación contractual.
 *
 * Con UN solo contrato vigente devuelve `null`: la operación se envía EXACTAMENTE
 * como hasta ahora y la RPC resuelve el contrato por sí misma. Con DOS contratos
 * devuelve obligatoriamente el contrato/asignación seleccionados.
 */
export function resolveContractTarget(
  worker: WorkerExpediente | null | undefined,
  contractId?: string | null
): ContractTarget {
  if (!PLURIEMPLEO_ENABLED) return NO_TARGET
  const contracts = activeContractsOf(worker)
  if (contracts.length <= 1) return NO_TARGET

  const contract = contractId ? contracts.find((c) => c.id === contractId) : null
  if (!contract) return NO_TARGET

  return { targetAssignmentId: contract.assignment_id ?? null, targetContractId: contract.id }
}

/**
 * Contrato seleccionado del expediente: el pedido o, si no hay, el vigente. Con un
 * solo contrato devuelve ese mismo (comportamiento actual intacto).
 */
export function selectedContractOf(
  worker: WorkerExpediente | null | undefined,
  contractId?: string | null
): WorkerContractRow | null {
  const contracts = worker?.contracts ?? []
  if (contractId) {
    const found = contracts.find((c) => c.id === contractId)
    if (found) return found
  }
  return contracts.find((c) => c.is_current) ?? null
}

/** Asignación vigente que corresponde a un contrato (por su `assignment_id`). */
export function assignmentOfContract(
  worker: WorkerExpediente | null | undefined,
  contract: WorkerContractRow | null
): WorkerAssignmentRow | null {
  if (!contract) return null
  return (worker?.assignments ?? []).find((a) => a.id === contract.assignment_id) ?? null
}

// ---------------------------------------------------------------------------
// Validación previa del segundo contrato (misma batería de mensajes que el registro
// de contrato del expediente, más las comprobaciones propias del segundo puesto)
// ---------------------------------------------------------------------------

export interface PluriemployValidationInput {
  positionId: string
  /** Fecha de incorporación al segundo puesto (inicio de la nueva asignación). */
  hireDate: string
  /** El puesto destino conserva vacante según la ocupación vigente de la entidad. */
  positionAvailable: boolean
  contractTypeId: string
  isDetermined: boolean
  endDate: string
  signatureDate: string
  signaturePlace: string
  paymentMethodId: string
  hasInvalidComponents: boolean
  blocking: string[]
  representativeAssignmentId: string | null
}

export function validatePluriemployInput(input: PluriemployValidationInput): string | null {
  if (!PLURIEMPLEO_ENABLED) return PLURIEMPLEO_DISABLED_MESSAGE
  if (!input.positionId) return "Selecciona el segundo puesto"
  if (!input.hireDate) return "La fecha de incorporación al segundo puesto es obligatoria"
  if (!input.positionAvailable) {
    return "El puesto seleccionado ya no tiene plazas disponibles. Selecciona otro puesto."
  }

  return validateWorkerContractInput({
    contractTypeId: input.contractTypeId,
    startDate: input.hireDate,
    hireDate: input.hireDate,
    isDetermined: input.isDetermined,
    endDate: input.endDate,
    signatureDate: input.signatureDate,
    signaturePlace: input.signaturePlace,
    paymentMethodId: input.paymentMethodId,
    hasInvalidComponents: input.hasInvalidComponents,
    blocking: input.blocking,
    representativeAssignmentId: input.representativeAssignmentId,
  })
}
