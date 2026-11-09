import { supabase } from "@/lib/supabase"
import type {
  EmploymentPeriodOriginType,
  EmploymentPeriodRow,
  EmploymentPeriodStatus,
  ReasonValidationStatus,
} from "../domain/employment-registry.rules"

export const EMPLOYMENT_REGISTRY_CHANGED_EVENT =
  "sitecorp:employment-registry-changed"

function emitEmploymentRegistryChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EMPLOYMENT_REGISTRY_CHANGED_EVENT))
  }
}

interface RawWorkerRef {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  employment_status: string
  origin: string | null
}

interface RawSeparationReasonRef {
  id: string
  code: string
  name: string
}

interface RawEmploymentPeriodRow {
  id: string
  company_client_id: string
  organization_entity_id: string
  worker_id: string
  period_sequence: number
  origin_type: EmploymentPeriodOriginType
  source_origin?: string | null
  reincorporation_movement_id: string | null
  hire_date: string
  hire_number: string | null
  position_name_snapshot: string | null
  area_name_snapshot: string | null
  occupational_category_snapshot: string | null
  separation_movement_id: string | null
  separation_date: string | null
  separation_number: string | null
  separation_reason_id: string | null
  separation_reason_catalog_snapshot: string | null
  separation_reason_movement_snapshot: string | null
  separation_other_reason: string | null
  separation_notes: string | null
  reason_validation_status: ReasonValidationStatus | null
  inconsistency_code: string | null
  inconsistency_details: string | null
  status: EmploymentPeriodStatus
  created_at: string
  updated_at: string
  workers: RawWorkerRef | RawWorkerRef[] | null
  worker_separation_reasons: RawSeparationReasonRef | RawSeparationReasonRef[] | null
}

function unwrapSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function buildFullName(
  firstName: string,
  firstSurname: string,
  secondSurname: string | null
): string {
  return [firstName, firstSurname, secondSurname]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
}

/**
 * Consulta todos los períodos laborales históricos de una entidad desde `public.worker_employment_periods`.
 */
export async function fetchEntityEmploymentPeriods(
  entityId: string
): Promise<EmploymentPeriodRow[]> {
  const { data, error } = await supabase
    .from("worker_employment_periods")
    .select(
      `
      *,
      workers!inner (
        id,
        code,
        first_name,
        first_surname,
        second_surname,
        identification,
        employment_status,
        origin
      ),
      worker_separation_reasons (
        id,
        code,
        name
      )
    `
    )
    .eq("organization_entity_id", entityId)
    .order("hire_date", { ascending: false })
    .order("period_sequence", { ascending: false })

  if (error) {
    throw new Error(error.message || "No se pudo cargar el registro de altas y bajas.")
  }

  const rows = (data ?? []) as unknown as RawEmploymentPeriodRow[]

  return rows.map((row) => {
    const worker = unwrapSingle(row.workers)
    const reason = unwrapSingle(row.worker_separation_reasons)
    const firstName = worker?.first_name ?? ""
    const firstSurname = worker?.first_surname ?? ""
    const secondSurname = worker?.second_surname ?? null

    return {
      id: row.id,
      companyClientId: row.company_client_id,
      organizationEntityId: row.organization_entity_id,
      workerId: row.worker_id,
      workerCode: worker?.code ?? "—",
      workerFullName: buildFullName(firstName, firstSurname, secondSurname),
      workerFirstName: firstName,
      workerFirstSurname: firstSurname,
      workerSecondSurname: secondSurname,
      workerIdentification: worker?.identification ?? "—",
      workerCurrentStatus: worker?.employment_status ?? "active",
      workerOrigin: worker?.origin ?? null,
      periodSequence: row.period_sequence,
      originType: row.origin_type,
      sourceOrigin: row.source_origin ?? null,
      reincorporationMovementId: row.reincorporation_movement_id,
      hireDate: row.hire_date,
      hireNumber: row.hire_number,
      positionNameSnapshot: row.position_name_snapshot,
      areaNameSnapshot: row.area_name_snapshot,
      occupationalCategorySnapshot: row.occupational_category_snapshot,
      separationMovementId: row.separation_movement_id,
      separationDate: row.separation_date,
      separationNumber: row.separation_number,
      separationReasonId: row.separation_reason_id,
      separationReasonCode: reason?.code ?? null,
      separationReasonCatalogSnapshot:
        row.separation_reason_catalog_snapshot ?? reason?.name ?? null,
      separationReasonMovementSnapshot: row.separation_reason_movement_snapshot,
      separationOtherReason: row.separation_other_reason,
      separationNotes: row.separation_notes,
      reasonValidationStatus: row.reason_validation_status,
      inconsistencyCode: row.inconsistency_code,
      inconsistencyDetails: row.inconsistency_details,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
}

export interface UpdateHireNumberResult {
  id: string
  worker_id: string
  period_sequence: number
  hire_number: string | null
  updated_at: string
}

/**
 * Actualiza el Número de Alta (`hire_number`) de un período laboral
 * invocando la RPC autorizada `public.update_worker_employment_period_hire_number`.
 */
export async function updateEmploymentPeriodHireNumberRpc(input: {
  periodId: string
  hireNumber: string | null
}): Promise<UpdateHireNumberResult> {
  const { data, error } = await supabase.rpc(
    "update_worker_employment_period_hire_number",
    {
      p_period_id: input.periodId,
      p_hire_number: input.hireNumber,
    }
  )

  if (error) {
    throw new Error(error.message || "No se pudo actualizar el número de alta.")
  }

  emitEmploymentRegistryChanged()
  return data as UpdateHireNumberResult
}

export interface UpdateSeparationNumberResult {
  id: string
  worker_id: string
  period_sequence: number
  separation_number: string | null
  updated_at: string
}

/**
 * Actualiza el Número de Baja (`separation_number`) de un período laboral cerrado (`CLOSED`)
 * invocando la RPC autorizada existente `public.update_worker_employment_period_separation_number`.
 */
export async function updateEmploymentPeriodSeparationNumberRpc(input: {
  periodId: string
  separationNumber: string | null
}): Promise<UpdateSeparationNumberResult> {
  const { data, error } = await supabase.rpc(
    "update_worker_employment_period_separation_number",
    {
      p_period_id: input.periodId,
      p_separation_number: input.separationNumber,
    }
  )

  if (error) {
    throw new Error(error.message || "No se pudo actualizar el número de baja.")
  }

  emitEmploymentRegistryChanged()
  return data as UpdateSeparationNumberResult
}

export interface UpdateSourceOriginResult {
  id: string
  worker_id: string
  period_sequence: number
  origin_type: EmploymentPeriodOriginType
  source_origin: string | null
  updated_at: string
}

/**
 * Actualiza la Procedencia administrativa (`source_origin`) de un período laboral
 * sin alterar `origin_type`, invocando la RPC autorizada `public.update_worker_employment_period_source_origin`.
 */
export async function updateEmploymentPeriodSourceOriginRpc(input: {
  periodId: string
  sourceOrigin: string | null
}): Promise<UpdateSourceOriginResult> {
  const { data, error } = await supabase.rpc(
    "update_worker_employment_period_source_origin",
    {
      p_period_id: input.periodId,
      p_source_origin: input.sourceOrigin,
    }
  )

  if (error) {
    throw new Error(
      error.message ||
        "No se pudo actualizar la procedencia. Verifique que la migración 20261110_03 esté aplicada en Supabase."
    )
  }

  emitEmploymentRegistryChanged()
  return data as UpdateSourceOriginResult
}
