import { supabase } from "@/lib/supabase"
import { fetchWorkerDrivingLicenseIds, saveWorkerDrivingLicenseIds } from "@/lib/catalogs"
import {
  fetchEducationLevels,
  fetchGenders,
  fetchMaritalStatuses,
} from "./people.repository"
import { fetchActiveContractTypes } from "./staffing.repository"
import {
  requireCurrentUserId,
  storageFileName,
  uploadExpedienteFile,
} from "./expediente-storage"
import type {
  NewWorkerInput,
  TenurePaymentRule,
  WorkerContractFormalizationInput,
  WorkerContractRow,
  WorkerEmploymentMovement,
  WorkerExpediente,
  WorkerExpedienteCatalogs,
  WorkerExpedienteInput,
} from "../domain/entities"

/**
 * Personas — Repositorio del expediente del TRABAJADOR (infraestructura).
 *
 * Único punto del expediente laboral que conoce Supabase: la ficha (`workers`) con su
 * trayectoria (asignaciones de puesto y contratos), la bitácora de movimientos
 * (`worker_employment_movements` + autores en `profiles`), la escala aplicable
 * (`salary_scales`), el alta con puesto y contrato (`create_worker_with_position`), el
 * registro del contrato (`complete_worker_contract`), la antigüedad
 * (`resolve_tenure_payment_for_worker`) y los documentos verificadores
 * (`worker_documents` + Storage).
 *
 * Consultas, columnas embebidas, ordenación, RPC (con sus parámetros), rutas de Storage y
 * errores son EXACTAMENTE los que ya usaba la pantalla: es un traslado estructural, no un
 * cambio de comportamiento. Los UUID, el historial laboral y el aislamiento por cliente
 * se conservan intactos; `company_client_id` nunca se confunde con
 * `organization_entity_id`.
 */

/** Fila cruda de PostgREST: las relaciones embebidas llegan como arreglo o como objeto. */
interface RawWorkerJobRow {
  id: string
  name: string
  code: string
  is_active: boolean
  area_id: string
  area: { id: string; name: string }[] | null
  salary_group:
    | { id: string; salary_scale_id: string; sequence_number: number }
    | { id: string; salary_scale_id: string; sequence_number: number }[]
    | null
}

interface RawWorkerPositionRow {
  id: string
  name: string
  code: string
  is_active: boolean
  job_id: string
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  job: RawWorkerJobRow | RawWorkerJobRow[] | null
}

interface RawWorkerAssignmentRow {
  id: string
  position_id: string
  start_date: string
  end_date: string | null
  is_current: boolean
  position: RawWorkerPositionRow | RawWorkerPositionRow[] | null
}

interface RawWorkerContractRow {
  id: string
  assignment_id: string
  contract_type_id: string
  start_date: string
  end_date: string | null
  actual_end_date: string | null
  is_current: boolean
  salary_amount: number | null
  salary_currency_code: string | null
  salary_effective_date: string | null
  salary_snapshot_status: string
  representative_name_snapshot: string | null
  representative_position_snapshot: string | null
  representative_captured_at: string | null
  entity_name_snapshot: string | null
  signature_date: string | null
  signature_place: string | null
  payment_method_id: string | null
  payment_schedule_text: string | null
  total_compensation_snapshot: number | null
  conditions_captured_at: string | null
  salary_group: { id: string; sequence_number: number } | { id: string; sequence_number: number }[] | null
  payment_method: { name: string; code: string } | { name: string; code: string }[] | null
  contract_type:
    | { id: string; name: string; code: string }
    | { id: string; name: string; code: string }[]
    | null
}

type RawWorkerExpedienteRow = Omit<WorkerExpediente, "assignments" | "contracts"> & {
  assignments: RawWorkerAssignmentRow[] | null
  contracts: RawWorkerContractRow[] | null
}

/** Primera fila de una relación embebida (PostgREST puede devolver arreglo u objeto). */
const firstOf = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null

/** Normaliza las relaciones embebidas (arreglo u objeto) al modelo del expediente. */
function normalizeWorkerExpediente(raw: RawWorkerExpedienteRow): WorkerExpediente {
  return {
    ...raw,
    contracts: raw.contracts
      ? raw.contracts.map((contract): WorkerContractRow => {
          const salaryGroup = firstOf(contract.salary_group)
          const paymentMethod = firstOf(contract.payment_method)
          const contractType = firstOf(contract.contract_type)
          return {
            ...contract,
            salary_group: salaryGroup,
            payment_method: paymentMethod,
            contract_type: contractType,
          }
        })
      : null,
    assignments: raw.assignments
      ? raw.assignments.map((assignment) => {
          const position = firstOf(assignment.position)
          const job = position ? firstOf(position.job) : null
          const area = job ? firstOf(job.area) : null
          return {
            ...assignment,
            position: position
              ? {
                  ...position,
                  job: job
                    ? {
                        ...job,
                        area: job.area ? { id: area?.id || null, name: area?.name || null } : null,
                        salary_group: firstOf(job.salary_group),
                      }
                    : null,
                }
              : null,
          }
        })
      : null,
  }
}

/**
 * Ficha laboral del trabajador: identidad, datos personales, trayectoria (asignaciones con
 * su puesto, cargo, área y grupo salarial) y contratos con sus condiciones formalizadas.
 */
export async function fetchWorkerExpediente(
  entityId: string,
  workerId: string
): Promise<WorkerExpediente> {
  const { data, error } = await supabase
    .from("workers")
    .select(`
      *,
      assignments:worker_position_assignments(
        id, position_id, start_date, end_date, is_current,
        position:organization_positions(
          id, name, code, is_active, job_id,
          work_location, daily_hours, weekly_hours, monthly_hours, break_minutes, schedule_notes,
          job:organization_jobs(
            id, name, code, is_active, area_id,
            area:organization_areas(id, name),
            salary_group:salary_groups(id, salary_scale_id, sequence_number)
          )
        )
      ),
      contracts:employment_contracts(
        id, assignment_id, contract_type_id, start_date, end_date, actual_end_date, is_current,
        salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
        representative_name_snapshot, representative_position_snapshot, representative_captured_at,
        entity_name_snapshot, entity_organism_snapshot, entity_branch_snapshot,
        entity_labor_code_snapshot, entity_address_snapshot, entity_province_snapshot,
        entity_municipality_snapshot,
        signature_date, signature_place, payment_method_id, payment_schedule_text, total_compensation_snapshot,
        conditions_captured_at,
        salary_group:salary_groups(id, sequence_number),
        payment_method:payment_methods(name, code),
        contract_type:employment_contract_types(id, name, code)
      )
    `)
    .eq("id", workerId)
    .eq("organization_entity_id", entityId)
    .single()

  if (error) throw error
  return normalizeWorkerExpediente(data as unknown as RawWorkerExpedienteRow)
}

interface RawWorkerMovementRow {
  id: string
  movement_type: string
  effective_date: string
  reason: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  separation_reason: { name: string } | { name: string }[] | null
}

/**
 * Bitácora de movimientos laborales (bajas, reincorporaciones, cambios de puesto) con el
 * nombre del autor resuelto desde `profiles`. Es lectura auxiliar tolerante: un fallo no
 * vacía la ficha.
 */
export async function fetchWorkerEmploymentMovements(
  workerId: string
): Promise<WorkerEmploymentMovement[]> {
  const { data, error } = await supabase
    .from("worker_employment_movements")
    .select(
      `id, movement_type, effective_date, reason, notes, created_by, created_at,
       separation_reason:worker_separation_reasons(name)`
    )
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false })

  if (error) throw error

  const rows = ((data as unknown as RawWorkerMovementRow[]) || []).map((movement) => ({
    ...movement,
    separation_reason: firstOf(movement.separation_reason),
  }))

  const authorIds = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => !!id))
  )
  const authorMap: Record<string, string> = {}
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds)
    ;((profiles as unknown as { id: string; full_name: string }[]) || []).forEach((profile) => {
      authorMap[profile.id] = profile.full_name
    })
  }

  return rows.map((row) => ({
    ...row,
    authorName: row.created_by ? authorMap[row.created_by] || null : null,
  })) as WorkerEmploymentMovement[]
}

/**
 * Tramo de pago por antigüedad aplicable al trabajador, resuelto en el servidor. Es lectura
 * auxiliar: si no hay tramo (o falla), la ficha simplemente no lo muestra.
 */
export async function fetchWorkerTenurePayment(
  entityId: string,
  workerId: string
): Promise<TenurePaymentRule | null> {
  try {
    const { data } = await supabase.rpc("resolve_tenure_payment_for_worker", {
      p_entity_id: entityId,
      p_worker_id: workerId,
      p_reference_date: new Date().toISOString().slice(0, 10),
    })
    if (!data || !Array.isArray(data) || data.length === 0) return null
    return data[0] as TenurePaymentRule
  } catch {
    return null
  }
}

/** Nombre de la escala salarial aplicable a la entidad. */
export async function fetchSalaryScaleName(scaleId: string): Promise<string | null> {
  const { data } = await supabase
    .from("salary_scales")
    .select("name")
    .eq("id", scaleId)
    .maybeSingle()
  return (data as { name?: string } | null)?.name ?? null
}

/** Catálogos del expediente laboral (los mismos de la vista de personal). */
export async function fetchWorkerExpedienteCatalogs(): Promise<WorkerExpedienteCatalogs> {
  const [genders, maritalStatuses, educationLevels, contractTypes] = await Promise.all([
    fetchGenders(),
    fetchMaritalStatuses(),
    fetchEducationLevels(),
    fetchActiveContractTypes(),
  ])
  return { genders, maritalStatuses, educationLevels, contractTypes }
}

/** Datos personales del trabajador. Nunca toca al candidato: son registros independientes. */
export async function updateWorkerPersonalData(
  workerId: string,
  input: WorkerExpedienteInput
): Promise<void> {
  const { hire_date, ...personal } = input
  const { error } = await supabase
    .from("workers")
    .update(hire_date === undefined ? personal : { ...personal, hire_date })
    .eq("id", workerId)

  if (error) throw error
}

/** Licencias de conducción registradas para el trabajador. */
export async function fetchWorkerLicenseIds(workerId: string): Promise<string[]> {
  return fetchWorkerDrivingLicenseIds(workerId)
}

/** Reemplazo exacto de las licencias de conducción (RPC transaccional, en el backend). */
export async function saveWorkerLicenseIds(
  workerId: string,
  categoryIds: string[]
): Promise<void> {
  await saveWorkerDrivingLicenseIds(workerId, categoryIds)
}

/**
 * Registra el contrato del trabajador (`complete_worker_contract`), con sus condiciones
 * formalizadas y sus conceptos retributivos. Devuelve el identificador del contrato creado
 * para que se genere su documento automático.
 */
export async function registerWorkerContract(
  input: WorkerContractFormalizationInput
): Promise<string | null> {
  const { data, error } = await supabase.rpc("complete_worker_contract", {
    p_worker_id: input.workerId,
    p_contract_type_id: input.contractTypeId,
    p_contract_start_date: input.startDate,
    p_contract_end_date: input.endDate,
    p_representative_assignment_id: input.representativeAssignmentId,
    p_signature_date: input.signatureDate,
    p_signature_place: input.signaturePlace,
    p_payment_method_id: input.paymentMethodId,
    p_compensation_components: input.compensationComponents,
    p_payment_schedule_text: input.paymentScheduleText,
  })
  if (error) throw error
  return (data as { contract_id?: string } | null)?.contract_id ?? null
}

/**
 * Alta de un trabajador con su puesto, su contrato y sus licencias en una sola
 * transacción del backend. Devuelve el `worker_id` creado (la identidad de la persona no
 * se duplica: si ya existe, el backend lo rechaza y el mensaje lo explica).
 */
export async function createWorkerWithPosition(input: NewWorkerInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_worker_with_position", {
    p_entity_id: input.entityId,
    p_worker: input.person,
    p_position_id: input.positionId,
    p_hire_date: input.hireDate,
    p_contract_type_id: input.contractTypeId,
    p_contract_start_date: input.contractStartDate,
    p_contract_end_date: input.contractEndDate,
    p_representative_assignment_id: input.representativeAssignmentId,
    p_driving_license_category_ids: input.drivingLicenseCategoryIds,
    p_signature_date: input.signatureDate,
    p_signature_place: input.signaturePlace,
    p_payment_method_id: input.paymentMethodId,
    p_compensation_components: input.compensationComponents,
    p_payment_schedule_text: input.paymentScheduleText,
  })
  if (error) throw error

  const workerId = (data as { worker_id?: string } | null)?.worker_id
  if (!workerId) throw new Error("No se pudo obtener el ID del trabajador creado")
  return workerId
}

/**
 * Documento verificador del trabajador recién creado: se sube al Storage privado y se
 * registra en `worker_documents` (origen MANUAL, el mismo de siempre).
 */
export async function uploadWorkerVerificationDocument(
  workerId: string,
  documentTypeId: string,
  file: File
): Promise<void> {
  const uploadedBy = await requireCurrentUserId()
  const storagePath = storageFileName(`worker_${workerId}_${documentTypeId}`, file.name)

  await uploadExpedienteFile(storagePath, file)

  const { error } = await supabase.from("worker_documents").insert({
    worker_id: workerId,
    document_type_id: documentTypeId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    description:
      documentTypeId === "PRE_EMPLOYMENT_CHECK" ? "Chequeo Preempleo" : "Antecedentes Penales",
    source: "MANUAL",
    uploaded_by: uploadedBy,
  })
  if (error) throw error
}
