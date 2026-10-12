import { supabase } from "@/lib/supabase"
import { EMPLOYMENT_STATUS } from "../domain/entities"
import type {
  ContractTypeOption,
  EmploymentLink,
  EntityOccupancy,
  HireablePerson,
  PositionOccupant,
  SeparationReason,
  StaffingPosition,
  WorkerIdentity,
} from "../domain/entities"

/**
 * Personas — Repositorio de plantilla para los flujos de personal (infraestructura).
 *
 * Lecturas compartidas por la contratación y las transiciones laborales: puestos con su
 * estructura, ocupación vigente de la entidad, personas candidatas con su vínculo
 * laboral, tipos de contrato, identidad del trabajador y motivos de baja.
 *
 * Antes cada diálogo repetía estas consultas (y la normalización de las relaciones
 * embebidas de PostgREST, que llegan como objeto o como arreglo). Aquí viven una sola vez
 * con EXACTAMENTE las mismas columnas, ordenación y ámbito (`organization_entity_id`
 * + RLS por `company_client_id`) que ya usaban las pantallas.
 */

interface RawJobRow {
  id: string
  name: string
  is_cuadro?: boolean
  is_principal_specialist?: boolean
  area: { id: string | null; name: string | null }[] | { id: string | null; name: string | null } | null
  salary_group:
    | { id: string; salary_scale_id: string; sequence_number: number }[]
    | { id: string; salary_scale_id: string; sequence_number: number }
    | null
}

interface RawPositionRow {
  id: string
  name: string
  code: string | null
  is_active: boolean
  authorized_quantity: number
  work_location: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  schedule_notes: string | null
  job: RawJobRow | RawJobRow[] | null
}

const firstOrSelf = <T>(value: T[] | T | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value

/** Normaliza la fila cruda de PostgREST al modelo de lectura del dominio. */
const toStaffingPosition = (row: RawPositionRow): StaffingPosition => {
  const job = firstOrSelf(row.job)
  const area = job ? firstOrSelf(job.area) : null
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    is_active: row.is_active,
    authorized_quantity: row.authorized_quantity,
    work_location: row.work_location,
    daily_hours: row.daily_hours,
    weekly_hours: row.weekly_hours,
    monthly_hours: row.monthly_hours,
    break_minutes: row.break_minutes,
    schedule_notes: row.schedule_notes,
    job: job
      ? {
          id: job.id,
          name: job.name,
          is_cuadro: job.is_cuadro,
          is_principal_specialist: job.is_principal_specialist,
          area: area ? { id: area.id ?? "", name: area.name ?? "" } : null,
          salary_group: firstOrSelf(job.salary_group),
        }
      : null,
  }
}

const POSITION_COLUMNS = `id, name, code, is_active, authorized_quantity,
   work_location, daily_hours, weekly_hours, monthly_hours, break_minutes, schedule_notes,
   job:organization_jobs(
     id, name, code, is_active, area_id, is_cuadro, is_principal_specialist,
     area:organization_areas(id, name),
     salary_group:salary_groups(id, salary_scale_id, sequence_number)
   )`

/** Puestos de la entidad con su cargo, área y grupo salarial. */
export async function fetchEntityStaffingPositions(
  entityId: string,
  options: { onlyActive?: boolean } = {}
): Promise<StaffingPosition[]> {
  let query = supabase
    .from("organization_positions")
    .select(POSITION_COLUMNS)
    .eq("organization_entity_id", entityId)

  if (options.onlyActive) query = query.eq("is_active", true)

  const { data, error } = await query.order("name", { ascending: true })
  if (error) throw error

  return ((data as RawPositionRow[] | null) || []).map(toStaffingPosition)
}

interface RawOccupancyWorkerRow {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  assignments: { position_id: string; is_current: boolean; end_date: string | null }[] | null
}

/**
 * Ocupación vigente: trabajadores ACTIVOS con asignación actual abierta. Un puesto está
 * ocupado mientras tenga una asignación `is_current` sin fecha de fin; ese es el mismo
 * criterio que usaba la plantilla operativa.
 */
export async function fetchEntityOccupancy(entityId: string): Promise<EntityOccupancy> {
  const { data, error } = await supabase
    .from("workers")
    .select(
      `id, code, first_name, first_surname, second_surname,
       assignments:worker_position_assignments(position_id, is_current, end_date)`
    )
    .eq("organization_entity_id", entityId)
    .eq("employment_status", EMPLOYMENT_STATUS.active)
  if (error) throw error

  const counts: Record<string, number> = {}
  const occupants: Record<string, PositionOccupant[]> = {}

  ;((data as RawOccupancyWorkerRow[] | null) || []).forEach((worker) => {
    const name = [worker.first_name, worker.first_surname, worker.second_surname]
      .filter(Boolean)
      .join(" ")
    ;(worker.assignments || []).forEach((assignment) => {
      if (!assignment.is_current || assignment.end_date) return
      counts[assignment.position_id] = (counts[assignment.position_id] || 0) + 1
      occupants[assignment.position_id] = [
        ...(occupants[assignment.position_id] || []),
        { workerId: worker.id, name, code: worker.code },
      ]
    })
  })

  return { counts, occupants }
}

/**
 * Permiso efectivo sobre la entidad SIN propagar fallos (`can_access_entity`). Es la
 * comprobación que ya hacían estas pantallas, que sólo la usan para habilitar botones y
 * enlaces de configuración: un fallo de la comprobación no habilita nada y no debe tumbar
 * la vista. La autoridad real sigue siendo RLS y las RPC.
 */
export async function fetchEntityPermission(
  entityId: string,
  permissionCode: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("can_access_entity", {
      target_entity_id: entityId,
      permission_code: permissionCode,
    })
    if (error) return false
    return !!data
  } catch {
    return false
  }
}

interface RawHireablePersonRow {
  id: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  email: string | null
  phone: string | null
  worker: EmploymentLink[] | EmploymentLink | null
}

/**
 * Personas candidatas de la entidad con su vínculo laboral. Una persona con vínculo
 * inactivo se reincorpora (no se crea otro expediente); con vínculo activo ya es
 * trabajadora y no se ofrece para contratar. La identidad de persona no se duplica.
 */
export async function fetchEntityHireablePeople(entityId: string): Promise<HireablePerson[]> {
  const { data, error } = await supabase
    .from("candidates")
    .select(
      `id, first_name, first_surname, second_surname, identification, email, phone,
       worker:workers(id, code, employment_status)`
    )
    .eq("organization_entity_id", entityId)
    .order("first_surname", { ascending: true })
    .order("first_name", { ascending: true })
  if (error) throw error

  return ((data as RawHireablePersonRow[] | null) || []).map((row) => ({
    id: row.id,
    first_name: row.first_name,
    first_surname: row.first_surname,
    second_surname: row.second_surname,
    identification: row.identification,
    email: row.email,
    phone: row.phone,
    worker: firstOrSelf(row.worker),
  }))
}

/** Tipos de contrato activos, en el orden del catálogo. */
export async function fetchActiveContractTypes(): Promise<ContractTypeOption[]> {
  const { data, error } = await supabase
    .from("employment_contract_types")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name", { ascending: true })
  if (error) throw error
  return (data as ContractTypeOption[] | null) || []
}

/** Identidad de la persona para los resúmenes contractuales de la reincorporación. */
export async function fetchWorkerIdentity(workerId: string): Promise<WorkerIdentity | null> {
  const { data, error } = await supabase
    .from("workers")
    .select("id, first_name, first_surname, second_surname, identification")
    .eq("id", workerId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as {
    id: string
    first_name: string
    first_surname: string
    second_surname: string | null
    identification: string
  }
  return {
    workerId: row.id,
    fullName: [row.first_name, row.first_surname, row.second_surname].filter(Boolean).join(" "),
    identification: row.identification,
  }
}

/** Motivos de baja activos configurados por el cliente. */
export async function fetchSeparationReasons(): Promise<SeparationReason[]> {
  const { data, error } = await supabase
    .from("worker_separation_reasons")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order")
  if (error) throw error
  return (data as SeparationReason[] | null) || []
}
