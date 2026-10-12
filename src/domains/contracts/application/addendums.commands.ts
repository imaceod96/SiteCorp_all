import {
  rpcCancelContractAddendum,
  rpcCreateContractAddendum,
  rpcFormalizeContractAddendum,
} from "../infrastructure/addendums.repository"
import type {
  AddendumChangeInput,
  AddendumReasonCode,
  ManualAddendumResult,
} from "../domain/entities"

/**
 * Contratos y documentos — Casos de uso de escritura de anexos (aplicación).
 *
 * Los parámetros y los mensajes son EXACTAMENTE los que ya enviaba la aplicación: la
 * autoridad sobre el número de anexo, los totales y las condiciones vigentes sigue siendo
 * el backend.
 */

/** Anexo manual: condiciones retributivas, forma de pago, lugar y jornada. */
export async function createManualAddendum(input: {
  workerId: string
  changes: AddendumChangeInput[]
  reasonCode: AddendumReasonCode
  reason?: string | null
  effectiveDate: string
  notes?: string | null
  components?: { component_type: string; description: string; amount: number }[]
  signatureDate?: string | null
  signaturePlace?: string | null
  representativeAssignmentId?: string | null
  requireFormalized?: boolean
}): Promise<ManualAddendumResult> {
  return rpcCreateContractAddendum(input)
}

/** Formalizar: sólo confirma los datos del anexo. No modifica salario, escala ni puesto. */
export async function formalizeAddendum(input: {
  addendumId: string
  signatureDate: string
  signaturePlace: string
  representativeAssignmentId: string | null
}): Promise<void> {
  await rpcFormalizeContractAddendum(input)
}

/** Cancelar anexo pendiente. No revierte el movimiento operativo ni el histórico. */
export async function cancelAddendum(input: {
  addendumId: string
  reason?: string | null
}): Promise<void> {
  await rpcCancelContractAddendum(input)
}
