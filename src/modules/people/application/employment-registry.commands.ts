import {
  updateEmploymentPeriodHireNumberRpc,
  updateEmploymentPeriodSeparationNumberRpc,
  updateEmploymentPeriodSourceOriginRpc,
  type UpdateHireNumberResult,
  type UpdateSeparationNumberResult,
  type UpdateSourceOriginResult,
} from "../infrastructure/employment-registry.repository"

/**
 * Actualiza el Número de Alta (`hire_number`) de un período laboral
 * a través de la RPC autorizada `public.update_worker_employment_period_hire_number`.
 */
export async function updateEmploymentPeriodHireNumber(input: {
  periodId: string
  hireNumber: string | null
}): Promise<UpdateHireNumberResult> {
  return updateEmploymentPeriodHireNumberRpc(input)
}

/**
 * Actualiza el Número de Baja (`separation_number`) de un período laboral cerrado (`CLOSED`)
 * a través de la RPC autorizada `public.update_worker_employment_period_separation_number`.
 */
export async function updateEmploymentPeriodSeparationNumber(input: {
  periodId: string
  separationNumber: string | null
}): Promise<UpdateSeparationNumberResult> {
  return updateEmploymentPeriodSeparationNumberRpc(input)
}

/**
 * Actualiza la Procedencia administrativa (`source_origin`) de un período laboral
 * sin alterar `origin_type`, a través de la RPC `public.update_worker_employment_period_source_origin`.
 */
export async function updateEmploymentPeriodSourceOrigin(input: {
  periodId: string
  sourceOrigin: string | null
}): Promise<UpdateSourceOriginResult> {
  return updateEmploymentPeriodSourceOriginRpc(input)
}
