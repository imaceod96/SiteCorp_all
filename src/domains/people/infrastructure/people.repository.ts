import { supabase } from "@/lib/supabase"
import { fetchDrivingLicenseCategories, fetchSkinColors } from "@/lib/catalogs"
import { columnName, selectColumn, selectQuery } from "@/integrations/supabase/schema-target"
import {
  buildEmploymentIndex,
  emptyEmploymentIndex,
  filterActiveWorkers,
  filterReentryWorkers,
  filterUnlinkedCandidates,
} from "../domain/rules"
import { EMPLOYMENT_STATUS } from "../domain/entities"
import type {
  CatalogOption,
  CatalogRow,
  EmploymentIndex,
  EntityWorkerOption,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonReentryWorker,
  PersonSeparation,
} from "../domain/entities"

/**
 * Personas — Repositorio de lectura (infraestructura).
 *
 * Único punto del dominio que conoce Supabase para el registro de personas.
 *
 * Política de errores (deliberada y explícita):
 *   · Las lecturas que DETERMINAN LA CLASIFICACIÓN (permiso de la vista, filas de
 *     `candidates`/`workers` e índice de relaciones del cliente) PROPAGAN el error.
 *     Devolver una lista vacía en silencio mostraría personas contratadas como
 *     candidatas, que es exactamente el defecto que se corrigió.
 *   · Las lecturas AUXILIARES (catálogos de filtros, vínculos a plantilla, última baja,
 *     licencias de conducción) conservan la tolerancia que ya tenían: un fallo no debe
 *     vaciar el directorio, y se avisa por consola.
 *
 * Consultas, columnas, ordenación y ámbito (`organization_entity_id` + RLS por
 * `company_client_id`) son EXACTAMENTE los que ya usaban las tres vistas.
 */

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

export async function fetchEntityCandidates(entityId: string): Promise<PersonCandidate[]> {
  // `*` más el alias de la frontera: la fila llega con la clave de JavaScript que el
  // modelo ya consume (`tenant_id`) aunque el nombre físico sea otro.
  const { data, error } = await filterUnlinkedCandidates(
    supabase
      .from("candidates")
      .select(selectQuery(`*, ${selectColumn("clientId")}`))
      .eq("organization_entity_id", entityId)
  ).order("created_at", { ascending: false })

  if (error) throw error
  return (data as PersonCandidate[]) || []
}

/** Candidatos con al menos una categoría de licencia registrada (criterio booleano). */
export async function fetchCandidatesWithLicense(
  candidateIds: string[]
): Promise<Set<string>> {
  const present = new Set<string>()
  if (candidateIds.length === 0) return present

  const { data, error } = await supabase
    .from("candidate_driving_license_categories")
    .select("candidate_id")
    .in("candidate_id", candidateIds)
  if (error) {
    console.warn("[people] no se pudieron leer las licencias de los candidatos", error)
    return present
  }

  ;((data as { candidate_id: string }[] | null) || []).forEach((row) => present.add(row.candidate_id))
  return present
}

// ---------------------------------------------------------------------------
// Trabajadores
// ---------------------------------------------------------------------------

export async function fetchEntityActiveWorkers(
  entityId: string
): Promise<PersonDirectoryWorker[]> {
  const { data, error } = await filterActiveWorkers(
    supabase
      .from("workers")
      .select(
        `id, code, first_name, first_surname, second_surname, identification,
           gender_id, marital_status_id, skin_color_id, education_level_id,
           phone, email, birth_date, province, municipality, address,
           employment_start_date, has_masters_degree, has_doctorate_degree`
      )
      .eq("organization_entity_id", entityId)
  )
    .order("first_surname", { ascending: true })
    .order("first_name", { ascending: true })

  if (error) throw error
  return (data as PersonDirectoryWorker[]) || []
}

/**
 * Trabajadores ACTIVOS de la entidad para los selectores del expediente (nombre e
 * identificación). El error se propaga: sin esta lista el selector no puede funcionar y el
 * usuario debe saberlo.
 */
export async function fetchEntityActiveWorkerOptions(
  entityId: string
): Promise<EntityWorkerOption[]> {
  const { data, error } = await supabase
    .from("workers")
    .select("id, first_name, first_surname, second_surname, identification")
    .eq("organization_entity_id", entityId)
    .eq("employment_status", EMPLOYMENT_STATUS.active)
    .order("first_surname", { ascending: true })

  if (error) throw error

  return ((data || []) as {
    id: string
    first_name: string
    first_surname: string
    second_surname: string | null
    identification: string
  }[]).map((worker) => ({
    id: worker.id,
    full_name: [worker.first_name, worker.first_surname, worker.second_surname]
      .filter(Boolean)
      .join(" "),
    identification: worker.identification,
  }))
}

/**
 * Trabajadores con Assignment vigente (filtro Vinculado / Pendiente de vinculación).
 * No se muestra como columna: solo alimenta un criterio de filtro.
 */
export async function fetchWorkersLinkedToStaffing(workerIds: string[]): Promise<Set<string>> {
  const linked = new Set<string>()
  if (workerIds.length === 0) return linked

  const { data, error } = await supabase
    .from("worker_position_assignments")
    .select("worker_id, is_current, end_date")
    .in("worker_id", workerIds)
    .eq("is_current", true)
    .is("end_date", null)
  if (error) {
    console.warn("[people] no se pudo leer la vinculación a plantilla", error)
    return linked
  }

  ;((data as { worker_id: string }[] | null) || []).forEach((row) => linked.add(row.worker_id))
  return linked
}

// ---------------------------------------------------------------------------
// Reingresos
// ---------------------------------------------------------------------------

export async function fetchEntityReentryWorkers(entityId: string): Promise<PersonReentryWorker[]> {
  const { data, error } = await filterReentryWorkers(
    supabase
      .from("workers")
      .select(
        `id, code, first_name, first_surname, second_surname, identification,
           gender_id, education_level_id,
           employment_status, hire_date, employment_start_date`
      )
      .eq("organization_entity_id", entityId)
  )
    .order("first_surname", { ascending: true })
    .order("first_name", { ascending: true })

  if (error) throw error
  return (data as PersonReentryWorker[]) || []
}

/** Última baja registrada por trabajador (bitácora de movimientos). */
export async function fetchWorkersLastSeparation(
  workerIds: string[]
): Promise<Record<string, PersonSeparation>> {
  const separations: Record<string, PersonSeparation> = {}
  if (workerIds.length === 0) return separations

  const { data, error } = await supabase
    .from("worker_employment_movements")
    .select(
      `worker_id, effective_date, reason, movement_type,
             separation_reason:worker_separation_reasons(name)`
    )
    .in("worker_id", workerIds)
    .eq("movement_type", "BAJA")
    .order("effective_date", { ascending: false })
  if (error) {
    console.warn("[people] no se pudo leer la bitácora de bajas", error)
    return separations
  }

  ;((data as {
    worker_id: string
    effective_date: string
    reason: string | null
    separation_reason: { name: string | null } | { name: string | null }[] | null
  }[]) || []).forEach((movement) => {
    if (separations[movement.worker_id]) return
    const embedded = movement.separation_reason
    const reason = Array.isArray(embedded) ? embedded[0]?.name : embedded?.name
    separations[movement.worker_id] = {
      effective_date: movement.effective_date,
      reason: reason || movement.reason || null,
    }
  })

  return separations
}

// ---------------------------------------------------------------------------
// Índice de relaciones laborales del cliente (identidad de persona)
// ---------------------------------------------------------------------------

/**
 * Relaciones laborales de un cliente para un conjunto de identificaciones.
 *
 * Se consulta SOLO por las identificaciones necesarias y SIEMPRE dentro del cliente, de
 * modo que nunca se mezclan personas de clientes distintos. El nombre físico de la
 * columna lo resuelve la frontera de nomenclatura.
 */
export async function fetchClientEmploymentIndex(
  companyClientId: string | null | undefined,
  identifications: string[]
): Promise<EmploymentIndex> {
  const wanted = Array.from(
    new Set(identifications.map((ci) => (ci ?? "").trim()).filter(Boolean))
  )
  if (!companyClientId || wanted.length === 0) return emptyEmploymentIndex

  const { data, error } = await supabase
    .from("workers")
    .select("identification, employment_status")
    .eq(columnName("clientId"), companyClientId)
    .in("identification", wanted)

  if (error) throw error

  return buildEmploymentIndex(
    (data as { identification: string; employment_status: string | null }[]) || []
  )
}

// ---------------------------------------------------------------------------
// Catálogos de persona
// ---------------------------------------------------------------------------

export async function fetchGenders(): Promise<CatalogRow[]> {
  const { data, error } = await supabase.from("genders").select("id, name").order("name")
  if (error) throw error
  return (data as CatalogRow[]) || []
}

export async function fetchMaritalStatuses(): Promise<CatalogRow[]> {
  const { data, error } = await supabase.from("marital_statuses").select("id, name").order("name")
  if (error) throw error
  return (data as CatalogRow[]) || []
}

export async function fetchEducationLevels(): Promise<CatalogRow[]> {
  const { data, error } = await supabase.from("education_levels").select("id, name").order("name")
  if (error) throw error
  return (data as CatalogRow[]) || []
}

/** Color de piel (catálogo global, compartido por candidato y trabajador). */
export async function fetchSkinColorsCatalog(): Promise<CatalogOption[]> {
  return fetchSkinColors()
}

/** Categorías de licencia de conducción (A, B, C, D, E), en el orden del catálogo. */
export async function fetchLicenseCategories(): Promise<CatalogOption[]> {
  return fetchDrivingLicenseCategories()
}
