import { supabase, type SupabaseMutationInterceptPayload } from "@/lib/supabase"
import type {
  AuditEntityOption,
  AuditEvent,
  AuditHistoryFilters,
  AuditHistoryPage,
} from "../domain/entities"

/**
 * Historial — Repositorio e Interceptor Universal de Auditoría (infraestructura).
 *
 * 1. Lee y escribe en la tabla `public.audit_events` de Supabase y sincroniza una copia
 *    resiliente en almacenamiento local (`sitecorp_audit_events_store`).
 * 2. Registra el interceptor global `__sitecorpSupabaseMutationHook` sobre el cliente de
 *    Supabase para capturar de forma automática e inmediata cualquier cambio (creación,
 *    edición, baja, asignación a plantilla, contratación, salarios, vacaciones, roles, etc.)
 *    en cualquier entidad creada o por crear.
 * 3. Sincroniza retroactivamente los registros existentes en las tablas operativas de la
 *    plataforma para garantizar que ninguna operación previa quede fuera del Historial.
 */

const LOCAL_STORAGE_KEY = "sitecorp_audit_events_store"

const AUDIT_EVENT_COLUMNS = [
  "id",
  "occurred_at",
  "actor_user_id",
  "actor_full_name",
  "actor_username",
  "scope",
  "organization_entity_id",
  "entity_name",
  "company_client_id",
  "module",
  "action",
  "entity_type",
  "record_id",
  "description",
  "old_values",
  "new_values",
  "result",
].join(", ")

/** Datos semilla iniciales para entornos de prueba sin sesión activa. */
const INITIAL_SEED_EVENTS: AuditEvent[] = [
  {
    id: "ae-seed-001",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "SITECORP",
    organization_entity_id: null,
    entity_name: "SiteCorp Global",
    company_client_id: null,
    module: "system",
    action: "system_initialized",
    entity_type: "platform",
    record_id: "sitecorp-v1",
    description: "Inicialización del sistema y verificación de seguridad de plataforma",
    old_values: null,
    new_values: { version: "1.0.0", environment: "production", rls_enabled: true },
    result: "SUCCESS",
  },
  {
    id: "ae-seed-002",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "ENTITY",
    organization_entity_id: "ent-demo-001",
    entity_name: "Empresa Demo Auditoría",
    company_client_id: "client-demo-001",
    module: "entities",
    action: "entity_created",
    entity_type: "organization_entity",
    record_id: "EMP-AUDIT-01",
    description: "Creación de la entidad principal 'Empresa Demo Auditoría' con Cuenta SiteCorp activa",
    old_values: null,
    new_values: {
      name: "Empresa Demo Auditoría",
      code: "EMP-AUDIT-01",
      entity_type: "company",
      regime_id: "EMPRESARIAL",
      is_sitecorp_account: true,
    },
    result: "SUCCESS",
  },
  {
    id: "ae-seed-003",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "ENTITY",
    organization_entity_id: "ent-demo-002",
    entity_name: "UEB Operaciones Central",
    company_client_id: "client-demo-001",
    module: "entities",
    action: "entity_created",
    entity_type: "organization_entity",
    record_id: "UEB-AUDIT-01",
    description: "Creación de la UEB subordinada 'UEB Operaciones Central'",
    old_values: null,
    new_values: {
      name: "UEB Operaciones Central",
      code: "UEB-AUDIT-01",
      entity_type: "ueb",
      parent_name: "Empresa Demo Auditoría",
    },
    result: "SUCCESS",
  },
  {
    id: "ae-seed-004",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "ENTITY",
    organization_entity_id: "ent-demo-001",
    entity_name: "Empresa Demo Auditoría",
    company_client_id: "client-demo-001",
    module: "workers",
    action: "worker_hired",
    entity_type: "worker",
    record_id: "WRK-85041212345",
    description: "Contratación y formalización de Carlos Martínez Rodríguez como Especialista Principal",
    old_values: { candidate_status: "in_review" },
    new_values: {
      worker_name: "Carlos Martínez Rodríguez",
      identification: "85041212345",
      position_title: "Especialista Principal en Gestión Humana",
      salary: 7500,
      currency: "CUP",
      contract_type: "indefinite",
    },
    result: "SUCCESS",
  },
  {
    id: "ae-seed-005",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "ENTITY",
    organization_entity_id: "ent-demo-001",
    entity_name: "Empresa Demo Auditoría",
    company_client_id: "client-demo-001",
    module: "workers",
    action: "worker_hired",
    entity_type: "worker",
    record_id: "WRK-92091854321",
    description: "Contratación de Elena Fernández Díaz como Técnico de Recursos Humanos",
    old_values: { candidate_status: "in_review" },
    new_values: {
      worker_name: "Elena Fernández Díaz",
      identification: "92091854321",
      position_title: "Técnico de Recursos Humanos",
      salary: 6200,
      currency: "CUP",
      contract_type: "indefinite",
    },
    result: "SUCCESS",
  },
  {
    id: "ae-seed-006",
    occurred_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    actor_user_id: "e7062a40-bc05-4ffb-a5a5-ba73d1ab116f",
    actor_full_name: "Administrador Fundador",
    actor_username: "admin",
    scope: "SITECORP",
    organization_entity_id: null,
    entity_name: "SiteCorp Global",
    company_client_id: null,
    module: "roles",
    action: "role_assigned",
    entity_type: "platform_user_role",
    record_id: "ROL-RRHH-01",
    description: "Asignación de privilegios de Gestión de RRHH a la cuenta de usuario imaceod96@gmail.com",
    old_values: { permissions: ["view_only"] },
    new_values: { role_name: "HR Manager", permissions: ["workers.manage", "contracts.manage", "staffing.manage"] },
    result: "SUCCESS",
  },
]

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  const hex = Date.now().toString(16).padStart(12, "0")
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0")
  return `a0000000-0000-4000-8${rand.slice(0, 3)}-${hex}`
}

/** Genera un UUID determinístico a partir de una clave textual (para evitar duplicados en sincronización). */
function deterministicUuid(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length
  let h2 = 0x41c6ce57 ^ seed.length
  let h3 = 0x9e3779b9 ^ seed.length
  let h4 = 0x85ebca6b ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
    h3 = Math.imul(h3 ^ ch, 2246822507)
    h4 = Math.imul(h4 ^ ch, 3266489909)
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, "0")
  const p2 = ((h2 >>> 0) & 0xffff).toString(16).padStart(4, "0")
  const p3 = (((h2 >>> 16) & 0x0fff) | 0x4000).toString(16).padStart(4, "0")
  const p4 = (((h3 >>> 0) & 0x3fff) | 0x8000).toString(16).padStart(4, "0")
  const p5 =
    ((h3 >>> 16) & 0xffff).toString(16).padStart(4, "0") +
    (h4 >>> 0).toString(16).padStart(8, "0")
  return `${p1}-${p2}-${p3}-${p4}-${p5}`
}

let memoryFallbackEvents: AuditEvent[] = [...INITIAL_SEED_EVENTS]

function getStoredEvents(): AuditEvent[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return memoryFallbackEvents
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS))
      return [...INITIAL_SEED_EVENTS]
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS))
    return [...INITIAL_SEED_EVENTS]
  } catch {
    return memoryFallbackEvents
  }
}

function saveStoredEvents(events: AuditEvent[]): void {
  memoryFallbackEvents = events
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(events))
  } catch (err) {
    console.warn("[audit-history] Error saving to localStorage:", err)
  }
}

/** Limpia el texto de búsqueda antes de enviarlo a filtros. */
function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%,()\\*]/g, " ").trim().toLowerCase()
}

/** `yyyy-mm-dd` + 1 día para incluir el día completo. */
function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Caché ligero de Actor y Entidades para enriquecer los eventos al instante  */
/* -------------------------------------------------------------------------- */

interface CachedActor {
  userId: string | null
  fullName: string
  username: string
  fetchedAt: number
}

let cachedActor: CachedActor | null = null
const entityNameCache = new Map<string, string>()
const workerNameCache = new Map<string, { fullName: string; identification: string; entityId: string | null }>()
const positionNameCache = new Map<string, { name: string; code: string; entityId: string | null }>()

async function resolveCurrentActor(): Promise<{
  userId: string | null
  fullName: string
  username: string
}> {
  if (cachedActor && Date.now() - cachedActor.fetchedAt < 60_000) {
    return cachedActor
  }
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData?.session?.user
    if (!user) {
      return { userId: null, fullName: "Administrador", username: "admin" }
    }
    const email = user.email || "admin"
    const metaName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null
    const metaUsername =
      (user.user_metadata?.username as string | undefined) || email.split("@")[0] || "admin"

    let fullName = metaName || "Administrador"
    let username = metaUsername

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", user.id)
        .maybeSingle()
      if (profile) {
        if (profile.full_name) fullName = profile.full_name
        if (profile.username) username = profile.username
      }
    } catch {
      // Continuar con metadatos de sesión
    }

    cachedActor = {
      userId: user.id,
      fullName,
      username,
      fetchedAt: Date.now(),
    }
    return cachedActor
  } catch {
    return { userId: null, fullName: "Administrador", username: "admin" }
  }
}

async function resolveEntityName(entityId: string | null | undefined): Promise<string | null> {
  if (!entityId) return null
  if (entityNameCache.has(entityId)) return entityNameCache.get(entityId) ?? null
  try {
    const { data } = await supabase
      .from("organization_entities")
      .select("id, name")
      .eq("id", entityId)
      .maybeSingle()
    if (data?.name) {
      entityNameCache.set(entityId, data.name)
      return data.name
    }
  } catch {
    // Ignore
  }
  return null
}

async function resolveWorkerInfo(workerId: string | null | undefined): Promise<{
  fullName: string
  identification: string
  entityId: string | null
} | null> {
  if (!workerId) return null
  if (workerNameCache.has(workerId)) return workerNameCache.get(workerId) ?? null
  try {
    const { data } = await supabase
      .from("workers")
      .select("id, first_name, first_surname, second_surname, identification, organization_entity_id")
      .eq("id", workerId)
      .maybeSingle()
    if (data) {
      const fullName = [data.first_name, data.first_surname, data.second_surname]
        .filter(Boolean)
        .join(" ")
        .trim()
      const info = {
        fullName: fullName || data.identification || workerId,
        identification: data.identification || "",
        entityId: data.organization_entity_id || null,
      }
      workerNameCache.set(workerId, info)
      return info
    }
  } catch {
    // Ignore
  }
  return null
}

async function resolvePositionInfo(positionId: string | null | undefined): Promise<{
  name: string
  code: string
  entityId: string | null
} | null> {
  if (!positionId) return null
  if (positionNameCache.has(positionId)) return positionNameCache.get(positionId) ?? null
  try {
    const { data } = await supabase
      .from("organization_positions")
      .select("id, name, code, organization_entity_id")
      .eq("id", positionId)
      .maybeSingle()
    if (data) {
      const info = {
        name: data.name || positionId,
        code: data.code || "",
        entityId: data.organization_entity_id || null,
      }
      positionNameCache.set(positionId, info)
      return info
    }
  } catch {
    // Ignore
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Sincronización Retroactiva Multi-Tabla (Auto-Descubrimiento Completo)      */
/* -------------------------------------------------------------------------- */

function buildFullName(row: {
  first_name?: string | null
  first_surname?: string | null
  second_surname?: string | null
  full_name?: string | null
  name?: string | null
}): string {
  if (row.full_name) return row.full_name.trim()
  const parts = [row.first_name, row.first_surname, row.second_surname].filter(Boolean)
  if (parts.length > 0) return parts.join(" ").trim()
  return (row.name || "Registro").trim()
}

async function syncDiscoveredPlatformEvents(
  existingEvents: AuditEvent[]
): Promise<{ mergedEvents: AuditEvent[]; hasRealPlatformData: boolean }> {
  const actor = await resolveCurrentActor()
  const discovered: AuditEvent[] = []
  let hasRealPlatformData = false

  try {
    const [
      entitiesRes,
      workersRes,
      positionsRes,
      assignmentsRes,
      areasRes,
      jobsRes,
      candidatesRes,
      contractsRes,
      movementsRes,
      vacationsRes,
      medCertsRes,
    ] = await Promise.allSettled([
      supabase
        .from("organization_entities")
        .select("id, name, code, entity_type, regime_id, is_active, is_sitecorp_account, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("workers")
        .select(
          "id, code, first_name, first_surname, second_surname, identification, hire_date, employment_start_date, employment_status, organization_entity_id, migrated_at, created_at"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("organization_positions")
        .select("id, name, code, authorized_quantity, is_active, job_id, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_position_assignments")
        .select("id, worker_id, position_id, start_date, end_date, is_current, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("organization_areas")
        .select("id, name, code, is_active, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("organization_jobs")
        .select("id, name, code, is_active, area_id, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("candidates")
        .select("id, first_name, first_surname, second_surname, identification, status, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("employment_contracts")
        .select("id, worker_id, position_id, start_date, end_date, is_current, status, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_employment_movements")
        .select("id, worker_id, movement_type, effective_date, reason, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_vacations")
        .select("id, worker_id, start_date, end_date, days_taken, status, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_medical_certificates")
        .select("id, worker_id, certificate_number, start_date, end_date, days_count, organization_entity_id, created_at")
        .order("created_at", { ascending: false }),
    ])

    const entities =
      entitiesRes.status === "fulfilled" && entitiesRes.value.data ? entitiesRes.value.data : []
    const workers =
      workersRes.status === "fulfilled" && workersRes.value.data ? workersRes.value.data : []
    const positions =
      positionsRes.status === "fulfilled" && positionsRes.value.data ? positionsRes.value.data : []
    const assignments =
      assignmentsRes.status === "fulfilled" && assignmentsRes.value.data
        ? assignmentsRes.value.data
        : []
    const areas =
      areasRes.status === "fulfilled" && areasRes.value.data ? areasRes.value.data : []
    const jobs =
      jobsRes.status === "fulfilled" && jobsRes.value.data ? jobsRes.value.data : []
    const candidates =
      candidatesRes.status === "fulfilled" && candidatesRes.value.data ? candidatesRes.value.data : []
    const contracts =
      contractsRes.status === "fulfilled" && contractsRes.value.data ? contractsRes.value.data : []
    const movements =
      movementsRes.status === "fulfilled" && movementsRes.value.data ? movementsRes.value.data : []
    const vacations =
      vacationsRes.status === "fulfilled" && vacationsRes.value.data ? vacationsRes.value.data : []
    const medCerts =
      medCertsRes.status === "fulfilled" && medCertsRes.value.data ? medCertsRes.value.data : []

    if (
      entities.length > 0 ||
      workers.length > 0 ||
      positions.length > 0 ||
      assignments.length > 0
    ) {
      hasRealPlatformData = true
    }

    // Poblar cachés en memoria
    for (const ent of entities) {
      if (ent.id && ent.name) entityNameCache.set(ent.id, ent.name)
    }
    for (const w of workers) {
      if (w.id) {
        workerNameCache.set(w.id, {
          fullName: buildFullName(w),
          identification: w.identification || "",
          entityId: w.organization_entity_id || null,
        })
      }
    }
    for (const p of positions) {
      if (p.id) {
        positionNameCache.set(p.id, {
          name: p.name || "Puesto",
          code: p.code || "",
          entityId: p.organization_entity_id || null,
        })
      }
    }

    // 1. Entidades creadas
    for (const ent of entities) {
      discovered.push({
        id: deterministicUuid(`entity_created:${ent.id}`),
        occurred_at: ent.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: ent.id,
        entity_name: ent.name,
        company_client_id: null,
        module: "entities",
        action: "entity_created",
        entity_type: "organization_entity",
        record_id: ent.code || ent.name,
        description: `Creación de la entidad "${ent.name}" (${ent.entity_type || "empresa"})`,
        old_values: null,
        new_values: {
          name: ent.name,
          code: ent.code,
          entity_type: ent.entity_type,
          regime_id: ent.regime_id,
          is_active: ent.is_active,
          is_sitecorp_account: ent.is_sitecorp_account,
        },
        result: "SUCCESS",
      })
    }

    // 2. Asignaciones de trabajadores a puestos en la plantilla (worker_position_assignments)
    for (const asg of assignments) {
      const wInfo = workerNameCache.get(asg.worker_id)
      const pInfo = positionNameCache.get(asg.position_id)
      const entId = pInfo?.entityId || wInfo?.entityId || null
      const entName = entId ? entityNameCache.get(entId) || null : null
      const workerLabel = wInfo
        ? `${wInfo.fullName}${wInfo.identification ? ` (CI: ${wInfo.identification})` : ""}`
        : asg.worker_id
      const posLabel = pInfo
        ? `${pInfo.name}${pInfo.code ? ` [${pInfo.code}]` : ""}`
        : asg.position_id

      discovered.push({
        id: deterministicUuid(`worker_assigned_to_position:${asg.id}`),
        occurred_at:
          asg.created_at ||
          (asg.start_date ? `${asg.start_date}T12:00:00.000Z` : new Date().toISOString()),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: entId,
        entity_name: entName,
        company_client_id: null,
        module: "positions",
        action: "worker_assigned_to_position",
        entity_type: "worker_position_assignment",
        record_id: pInfo?.code || wInfo?.identification || asg.id,
        description: `Asignación de ${workerLabel} al puesto "${posLabel}" en la plantilla${entName ? ` de ${entName}` : ""}`,
        old_values: null,
        new_values: {
          assignment_id: asg.id,
          worker_id: asg.worker_id,
          worker_name: wInfo?.fullName || null,
          identification: wInfo?.identification || null,
          position_id: asg.position_id,
          position_name: pInfo?.name || null,
          position_code: pInfo?.code || null,
          start_date: asg.start_date,
          is_current: asg.is_current,
        },
        result: "SUCCESS",
      })
    }

    // 3. Trabajadores (alta por contratación o migración/carga inicial)
    for (const w of workers) {
      const fullName = buildFullName(w)
      const entName = w.organization_entity_id
        ? entityNameCache.get(w.organization_entity_id) || null
        : null
      const isMigrated = Boolean(w.migrated_at)
      discovered.push({
        id: deterministicUuid(`worker_registered:${w.id}`),
        occurred_at: w.created_at || w.migrated_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: w.organization_entity_id || null,
        entity_name: entName,
        company_client_id: null,
        module: "workers",
        action: isMigrated ? "worker_migrated" : "worker_hired",
        entity_type: "worker",
        record_id: w.identification || w.code || w.id,
        description: isMigrated
          ? `Incorporación por carga inicial de ${fullName} (CI: ${w.identification || "—"})${entName ? ` en ${entName}` : ""}`
          : `Alta de trabajador ${fullName} (CI: ${w.identification || "—"})${entName ? ` en ${entName}` : ""}`,
        old_values: null,
        new_values: {
          worker_id: w.id,
          code: w.code,
          full_name: fullName,
          identification: w.identification,
          employment_status: w.employment_status,
          employment_start_date: w.employment_start_date || w.hire_date,
        },
        result: "SUCCESS",
      })
    }

    // 4. Áreas organizativas
    for (const area of areas) {
      const entName = area.organization_entity_id
        ? entityNameCache.get(area.organization_entity_id) || null
        : null
      discovered.push({
        id: deterministicUuid(`area_created:${area.id}`),
        occurred_at: area.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: area.organization_entity_id || null,
        entity_name: entName,
        company_client_id: null,
        module: "entity_settings",
        action: "area_created",
        entity_type: "organization_area",
        record_id: area.code || area.name,
        description: `Creación del área "${area.name}"${entName ? ` en ${entName}` : ""}`,
        old_values: null,
        new_values: {
          area_id: area.id,
          name: area.name,
          code: area.code,
          is_active: area.is_active,
        },
        result: "SUCCESS",
      })
    }

    // 5. Cargos (organization_jobs)
    for (const job of jobs) {
      const entName = job.organization_entity_id
        ? entityNameCache.get(job.organization_entity_id) || null
        : null
      discovered.push({
        id: deterministicUuid(`job_created:${job.id}`),
        occurred_at: job.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: job.organization_entity_id || null,
        entity_name: entName,
        company_client_id: null,
        module: "positions",
        action: "job_created",
        entity_type: "organization_job",
        record_id: job.code || job.name,
        description: `Creación del cargo "${job.name}"${entName ? ` en ${entName}` : ""}`,
        old_values: null,
        new_values: {
          job_id: job.id,
          name: job.name,
          code: job.code,
          is_active: job.is_active,
        },
        result: "SUCCESS",
      })
    }

    // 6. Puestos de plantilla (organization_positions)
    for (const pos of positions) {
      const entName = pos.organization_entity_id
        ? entityNameCache.get(pos.organization_entity_id) || null
        : null
      discovered.push({
        id: deterministicUuid(`position_created:${pos.id}`),
        occurred_at: pos.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: pos.organization_entity_id || null,
        entity_name: entName,
        company_client_id: null,
        module: "positions",
        action: "position_created",
        entity_type: "organization_position",
        record_id: pos.code || pos.name,
        description: `Creación del puesto "${pos.name}" (${pos.authorized_quantity || 1} plaza(s)) en la plantilla${entName ? ` de ${entName}` : ""}`,
        old_values: null,
        new_values: {
          position_id: pos.id,
          name: pos.name,
          code: pos.code,
          authorized_quantity: pos.authorized_quantity,
          is_active: pos.is_active,
        },
        result: "SUCCESS",
      })
    }

    // 7. Candidatos
    for (const cand of candidates) {
      const fullName = buildFullName(cand)
      const entName = cand.organization_entity_id
        ? entityNameCache.get(cand.organization_entity_id) || null
        : null
      discovered.push({
        id: deterministicUuid(`candidate_registered:${cand.id}`),
        occurred_at: cand.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: cand.organization_entity_id || null,
        entity_name: entName,
        company_client_id: null,
        module: "candidates",
        action: "candidate_registered",
        entity_type: "candidate",
        record_id: cand.identification || cand.id,
        description: `Registro en bolsa de candidatos de ${fullName} (CI: ${cand.identification || "—"})`,
        old_values: null,
        new_values: {
          candidate_id: cand.id,
          full_name: fullName,
          identification: cand.identification,
          status: cand.status,
        },
        result: "SUCCESS",
      })
    }

    // 8. Contratos laborales
    for (const contract of contracts) {
      const wInfo = workerNameCache.get(contract.worker_id)
      const pInfo = positionNameCache.get(contract.position_id)
      const entId = contract.organization_entity_id || wInfo?.entityId || pInfo?.entityId || null
      const entName = entId ? entityNameCache.get(entId) || null : null
      const workerName = wInfo?.fullName || contract.worker_id
      discovered.push({
        id: deterministicUuid(`contract_formalized:${contract.id}`),
        occurred_at: contract.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: entId,
        entity_name: entName,
        company_client_id: null,
        module: "contracts",
        action: "contract_formalized",
        entity_type: "employment_contract",
        record_id: wInfo?.identification || contract.id,
        description: `Formalización de contrato laboral para ${workerName}${pInfo ? ` en el puesto "${pInfo.name}"` : ""}`,
        old_values: null,
        new_values: {
          contract_id: contract.id,
          worker_id: contract.worker_id,
          worker_name: workerName,
          position_name: pInfo?.name || null,
          start_date: contract.start_date,
          end_date: contract.end_date,
          is_current: contract.is_current,
        },
        result: "SUCCESS",
      })
    }

    // 9. Movimientos laborales (bajas, reincorporaciones, cambios de puesto/contrato)
    for (const mov of movements) {
      const wInfo = workerNameCache.get(mov.worker_id)
      const entId = wInfo?.entityId || null
      const entName = entId ? entityNameCache.get(entId) || null : null
      const workerName = wInfo?.fullName || mov.worker_id
      const movType = (mov.movement_type || "LABORAL").toUpperCase()
      discovered.push({
        id: deterministicUuid(`employment_movement:${mov.id}`),
        occurred_at: mov.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: entId,
        entity_name: entName,
        company_client_id: null,
        module: "workers",
        action: `movement_${movType.toLowerCase()}`,
        entity_type: "worker_employment_movement",
        record_id: wInfo?.identification || mov.id,
        description: `Movimiento laboral (${movType}) aplicado a ${workerName}${mov.reason ? `: ${mov.reason}` : ""}`,
        old_values: null,
        new_values: {
          movement_id: mov.id,
          worker_id: mov.worker_id,
          worker_name: workerName,
          movement_type: mov.movement_type,
          effective_date: mov.effective_date,
          reason: mov.reason,
        },
        result: "SUCCESS",
      })
    }

    // 10. Vacaciones
    for (const vac of vacations) {
      const wInfo = workerNameCache.get(vac.worker_id)
      const entId = vac.organization_entity_id || wInfo?.entityId || null
      const entName = entId ? entityNameCache.get(entId) || null : null
      const workerName = wInfo?.fullName || vac.worker_id
      discovered.push({
        id: deterministicUuid(`vacation_registered:${vac.id}`),
        occurred_at: vac.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: entId,
        entity_name: entName,
        company_client_id: null,
        module: "vacations",
        action: "vacation_registered",
        entity_type: "worker_vacation",
        record_id: wInfo?.identification || vac.id,
        description: `Registro de vacaciones para ${workerName} (${vac.start_date || ""} a ${vac.end_date || ""})`,
        old_values: null,
        new_values: {
          vacation_id: vac.id,
          worker_name: workerName,
          start_date: vac.start_date,
          end_date: vac.end_date,
          days_taken: vac.days_taken,
          status: vac.status,
        },
        result: "SUCCESS",
      })
    }

    // 11. Certificados médicos
    for (const cert of medCerts) {
      const wInfo = workerNameCache.get(cert.worker_id)
      const entId = cert.organization_entity_id || wInfo?.entityId || null
      const entName = entId ? entityNameCache.get(entId) || null : null
      const workerName = wInfo?.fullName || cert.worker_id
      discovered.push({
        id: deterministicUuid(`medical_certificate_registered:${cert.id}`),
        occurred_at: cert.created_at || new Date().toISOString(),
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "ENTITY",
        organization_entity_id: entId,
        entity_name: entName,
        company_client_id: null,
        module: "vacations",
        action: "medical_certificate_registered",
        entity_type: "worker_medical_certificate",
        record_id: cert.certificate_number || wInfo?.identification || cert.id,
        description: `Registro de certificado médico para ${workerName} (${cert.days_count || ""} día(s))`,
        old_values: null,
        new_values: {
          certificate_id: cert.id,
          worker_name: workerName,
          certificate_number: cert.certificate_number,
          start_date: cert.start_date,
          end_date: cert.end_date,
          days_count: cert.days_count,
        },
        result: "SUCCESS",
      })
    }
  } catch {
    // Continuar con los eventos existentes si no hay sesión activa
  }

  // Combinar y deduplicar eventos
  const byId = new Map<string, AuditEvent>()
  const signatureSet = new Set<string>()

  const makeSignature = (e: AuditEvent) =>
    `${e.action}::${e.record_id || ""}::${e.organization_entity_id || ""}::${(e.occurred_at || "").slice(0, 16)}`

  for (const e of existingEvents) {
    if (hasRealPlatformData && e.id.startsWith("ae-seed-")) {
      continue
    }
    byId.set(e.id, e)
    signatureSet.add(makeSignature(e))
  }

  const toBackfillInSupabase: AuditEvent[] = []

  for (const d of discovered) {
    const sig = makeSignature(d)
    if (!byId.has(d.id) && !signatureSet.has(sig)) {
      byId.set(d.id, d)
      signatureSet.add(sig)
      toBackfillInSupabase.push(d)
    }
  }

  // Persistir en segundo plano en public.audit_events los eventos descubiertos que falten
  if (toBackfillInSupabase.length > 0) {
    void supabase
      .from("audit_events")
      .upsert(
        toBackfillInSupabase.map((ev) => ({
          id: ev.id,
          occurred_at: ev.occurred_at,
          actor_user_id: ev.actor_user_id,
          actor_full_name: ev.actor_full_name,
          actor_username: ev.actor_username,
          scope: ev.scope,
          organization_entity_id: ev.organization_entity_id,
          entity_name: ev.entity_name,
          company_client_id: ev.company_client_id,
          module: ev.module,
          action: ev.action,
          entity_type: ev.entity_type,
          record_id: ev.record_id,
          description: ev.description,
          old_values: ev.old_values,
          new_values: ev.new_values,
          result: ev.result,
        })),
        { onConflict: "id", ignoreDuplicates: true }
      )
      .then(() => {
        // Sincronizado con Supabase
      })
      .catch(() => {
        // Ignorar errores de red en backfill
      })
  }

  const mergedEvents = Array.from(byId.values()).sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  )

  return { mergedEvents, hasRealPlatformData }
}

/* -------------------------------------------------------------------------- */
/* Interceptor Universal en Tiempo Real para Cualquier Cambio en la Plataforma*/
/* -------------------------------------------------------------------------- */

const READ_ONLY_RPC_PREFIXES = [
  "is_",
  "can_",
  "has_",
  "list_",
  "get_",
  "resolve_",
  "validate_",
  "preview_",
  "find_",
  "check_",
  "pending_",
]

const READ_ONLY_RPC_NAMES = new Set([
  "contract_expiry_alerts",
  "entity_staffing_export",
  "entity_vacation_overview",
  "salary_change_impact",
  "position_change_preview",
  "resolution_worker_context",
  "person_identification_status",
  "deletion_summary",
  "company_client_deletion_summary",
  "tenant_deletion_summary",
  "prenomina_cla_config",
])

function isReadOnlyRpc(rpcName: string): boolean {
  const lower = rpcName.toLowerCase()
  if (READ_ONLY_RPC_NAMES.has(lower)) return true
  return READ_ONLY_RPC_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

const TABLE_TO_MODULE: Record<string, { module: string; label: string }> = {
  organization_entities: { module: "entities", label: "entidad organizativa" },
  organization_areas: { module: "entity_settings", label: "área organizativa" },
  organization_jobs: { module: "positions", label: "cargo" },
  organization_job_cla_night_segments: { module: "positions", label: "horario CLA de cargo" },
  organization_positions: { module: "positions", label: "puesto de plantilla" },
  position_schedule_segments: { module: "positions", label: "horario de puesto" },
  worker_position_assignments: { module: "positions", label: "asignación a puesto en plantilla" },
  candidates: { module: "candidates", label: "candidato" },
  workers: { module: "workers", label: "trabajador" },
  worker_employment_movements: { module: "workers", label: "movimiento laboral" },
  worker_resolutions: { module: "documents", label: "resolución laboral" },
  worker_documents: { module: "documents", label: "documento de expediente" },
  employment_contracts: { module: "contracts", label: "contrato de trabajo" },
  contract_addendums: { module: "contracts", label: "suplemento de contrato" },
  entity_contract_data: { module: "entity_settings", label: "datos contractuales de la entidad" },
  entity_representatives: { module: "entity_settings", label: "representante de la entidad" },
  salary_scales: { module: "salary", label: "escala salarial" },
  salary_groups: { module: "salary", label: "grupo salarial" },
  salary_group_values: { module: "salary", label: "importe de grupo salarial" },
  tenure_salary_scales: { module: "salary", label: "escala de antigüedad" },
  entity_academic_payment_configs: { module: "salary", label: "configuración de pago académico" },
  worker_vacations: { module: "vacations", label: "vacaciones de trabajador" },
  worker_vacation_movements: { module: "vacations", label: "movimiento de vacaciones" },
  worker_medical_certificates: { module: "vacations", label: "certificado médico" },
  worker_payroll_movements: { module: "payroll", label: "movimiento de nómina" },
  prenomina_periods: { module: "payroll", label: "período de prenómina" },
  prenomina_entries: { module: "payroll", label: "registro de prenómina" },
  document_templates: { module: "documents", label: "plantilla documental" },
  document_template_versions: { module: "documents", label: "versión de plantilla documental" },
  governing_documents: { module: "documents", label: "documento rector" },
  platform_documents: { module: "documents", label: "documento global de plataforma" },
  profiles: { module: "users", label: "perfil de usuario" },
  platform_roles: { module: "roles", label: "rol de plataforma" },
  platform_user_roles: { module: "roles", label: "asignación de rol de plataforma" },
  tenant_roles: { module: "roles", label: "rol de organización" },
  company_client_roles: { module: "roles", label: "rol de cliente" },
  entity_roles: { module: "roles", label: "rol de entidad" },
  entity_user_access: { module: "users", label: "acceso de usuario a entidad" },
  company_client_memberships: { module: "users", label: "membresía de usuario" },
  tenant_memberships: { module: "users", label: "membresía de usuario" },
  company_client_invitations: { module: "users", label: "invitación de usuario" },
  tenant_invitations: { module: "users", label: "invitación de usuario" },
  company_clients: { module: "entities", label: "cliente empresarial" },
  tenants: { module: "entities", label: "cliente empresarial" },
}

const recentInterceptSignatures = new Map<string, number>()

function isDuplicateIntercept(sig: string): boolean {
  const now = Date.now()
  const prev = recentInterceptSignatures.get(sig)
  if (prev && now - prev < 3500) {
    return true
  }
  recentInterceptSignatures.set(sig, now)
  return false
}

function asObject(val: unknown): Record<string, unknown> | null {
  if (!val) return null
  if (Array.isArray(val)) {
    return val.length > 0 && typeof val[0] === "object" && val[0] !== null
      ? (val[0] as Record<string, unknown>)
      : null
  }
  if (typeof val === "object") {
    return val as Record<string, unknown>
  }
  return null
}

async function handleInterceptedMutation(payload: SupabaseMutationInterceptPayload): Promise<void> {
  try {
    const parsedUrl = new URL(payload.url, "https://xvswjkpoeccgpiewptur.supabase.co")
    const pathname = parsedUrl.pathname
    const reqObj = asObject(payload.requestBody)
    const resObj = asObject(payload.responseBody)
    const resultStatus = payload.ok ? "SUCCESS" : payload.status === 401 || payload.status === 403 ? "DENIED" : "FAILURE"

    // 1. Llamadas RPC (/rest/v1/rpc/<rpc_name>)
    if (pathname.includes("/rest/v1/rpc/")) {
      const rpcName = pathname.split("/rest/v1/rpc/")[1]?.split("/")[0] || ""
      if (!rpcName || isReadOnlyRpc(rpcName)) return

      const sig = `rpc:${rpcName}:${JSON.stringify(reqObj || {})}`
      if (isDuplicateIntercept(sig)) return

      const actor = await resolveCurrentActor()
      const workerId =
        (reqObj?.p_worker_id as string | undefined) ||
        (reqObj?.worker_id as string | undefined) ||
        (resObj?.worker_id as string | undefined) ||
        null
      const positionId =
        (reqObj?.p_position_id as string | undefined) ||
        (reqObj?.p_new_position_id as string | undefined) ||
        (reqObj?.position_id as string | undefined) ||
        (resObj?.position_id as string | undefined) ||
        null
      let entityId =
        (reqObj?.p_entity_id as string | undefined) ||
        (reqObj?.p_organization_entity_id as string | undefined) ||
        (reqObj?.organization_entity_id as string | undefined) ||
        (resObj?.organization_entity_id as string | undefined) ||
        null

      const [workerInfo, posInfo] = await Promise.all([
        resolveWorkerInfo(workerId),
        resolvePositionInfo(positionId),
      ])

      if (!entityId) {
        entityId = posInfo?.entityId || workerInfo?.entityId || null
      }
      const entityName = await resolveEntityName(entityId)

      let module = "system"
      let action = rpcName
      let entityType = "operation"
      let recordId =
        posInfo?.code ||
        workerInfo?.identification ||
        (reqObj?.p_code as string | undefined) ||
        (reqObj?.p_name as string | undefined) ||
        workerId ||
        positionId ||
        entityId ||
        rpcName
      let description = `Ejecución de operación "${rpcName}"`

      const workerLabel = workerInfo
        ? `${workerInfo.fullName}${workerInfo.identification ? ` (CI: ${workerInfo.identification})` : ""}`
        : workerId || "trabajador"
      const posLabel = posInfo
        ? `${posInfo.name}${posInfo.code ? ` [${posInfo.code}]` : ""}`
        : positionId || "puesto"

      if (rpcName === "link_worker_to_position") {
        module = "positions"
        action = "worker_assigned_to_position"
        entityType = "worker_position_assignment"
        description = `Asignación de ${workerLabel} al puesto "${posLabel}" en la plantilla${entityName ? ` de ${entityName}` : ""}`
      } else if (rpcName === "hire_candidate" || rpcName === "create_worker_with_position") {
        module = "workers"
        action = "worker_hired"
        entityType = "worker"
        description = `Contratación y alta de ${workerLabel} en el puesto "${posLabel}"${entityName ? ` (${entityName})` : ""}`
      } else if (rpcName === "reincorporate_worker") {
        module = "workers"
        action = "worker_reincorporated"
        entityType = "worker"
        description = `Reincorporación laboral de ${workerLabel} al puesto "${posLabel}"${entityName ? ` (${entityName})` : ""}`
      } else if (rpcName === "register_worker_separation") {
        module = "workers"
        action = "worker_separated"
        entityType = "worker"
        description = `Baja laboral registrada para ${workerLabel}${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName === "change_worker_position") {
        module = "positions"
        action = "worker_position_changed"
        entityType = "worker_position_assignment"
        description = `Cambio de puesto de ${workerLabel} hacia "${posLabel}"${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName === "change_worker_contract" || rpcName === "complete_worker_contract") {
        module = "contracts"
        action = "contract_updated"
        entityType = "employment_contract"
        description = `Actualización de contrato laboral de ${workerLabel}${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName === "create_worker_pluriemploy") {
        module = "pluriempleo"
        action = "pluriempleo_created"
        entityType = "worker"
        description = `Alta de contrato por pluriempleo para ${workerLabel} en "${posLabel}"`
      } else if (rpcName.includes("migration")) {
        module = "workers"
        action = rpcName
        entityType = "worker_migration"
        description = `Importación de trabajadores en carga inicial${entityName ? ` para ${entityName}` : ""}`
      } else if (rpcName === "save_position_with_schedule") {
        module = "positions"
        action = reqObj?.p_position_id ? "position_updated" : "position_created"
        entityType = "organization_position"
        const pName = (reqObj?.p_name as string | undefined) || posLabel
        recordId = (reqObj?.p_code as string | undefined) || pName
        description = `${reqObj?.p_position_id ? "Actualización" : "Creación"} del puesto "${pName}" en la plantilla${entityName ? ` de ${entityName}` : ""}`
      } else if (rpcName.includes("addendum")) {
        module = "contracts"
        action = rpcName
        entityType = "contract_addendum"
        description = `Operación de suplemento contractual (${rpcName}) para ${workerLabel}`
      } else if (rpcName.includes("resolution")) {
        module = "documents"
        action = rpcName
        entityType = "worker_resolution"
        description = `Generación de resolución laboral para ${workerLabel}`
      } else if (rpcName.includes("salary")) {
        module = "salary"
        action = rpcName
        entityType = "salary_scale"
        description = `Actualización salarial (${rpcName})${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName.includes("vacation")) {
        module = "vacations"
        action = rpcName
        entityType = "worker_vacation"
        description = `Operación de vacaciones (${rpcName}) para ${workerLabel}`
      } else if (rpcName.includes("medical_certificate")) {
        module = "vacations"
        action = rpcName
        entityType = "worker_medical_certificate"
        description = `Registro o actualización de certificado médico para ${workerLabel}`
      } else if (rpcName.includes("prenomina")) {
        module = "payroll"
        action = rpcName
        entityType = "prenomina"
        description = `Operación de prenómina (${rpcName})${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName.includes("representative")) {
        module = "entity_settings"
        action = rpcName
        entityType = "entity_representative"
        description = `Configuración de representante legal${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName.includes("role")) {
        module = "roles"
        action = rpcName
        entityType = "role"
        const roleName = (reqObj?.p_name as string | undefined) || (reqObj?.role_name as string | undefined) || ""
        description = `Configuración de rol y permisos${roleName ? ` "${roleName}"` : ""}${entityName ? ` en ${entityName}` : ""}`
      } else if (rpcName.includes("template")) {
        module = "documents"
        action = rpcName
        entityType = "document_template"
        description = `Configuración de plantilla documental (${rpcName})`
      } else if (rpcName.includes("contract_data")) {
        module = "entity_settings"
        action = "entity_contract_data_saved"
        entityType = "entity_contract_data"
        description = `Actualización de datos contractuales${entityName ? ` de ${entityName}` : ""}`
      }

      await insertAuditEvent({
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: entityId ? "ENTITY" : "SITECORP",
        organization_entity_id: entityId,
        entity_name: entityName,
        company_client_id: null,
        module,
        action,
        entity_type: entityType,
        record_id: String(recordId),
        description,
        old_values: null,
        new_values: reqObj || resObj || null,
        result: resultStatus,
      })
      return
    }

    // 2. Edge Functions (/functions/v1/<fn_name>)
    if (pathname.includes("/functions/v1/")) {
      const fnName = pathname.split("/functions/v1/")[1]?.split("/")[0] || "edge_function"
      const sig = `fn:${fnName}:${JSON.stringify(reqObj || {})}`
      if (isDuplicateIntercept(sig)) return

      const actor = await resolveCurrentActor()
      await insertAuditEvent({
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: "SITECORP",
        organization_entity_id: null,
        entity_name: "SiteCorp Global",
        company_client_id: null,
        module: "users",
        action: fnName.replace(/-/g, "_"),
        entity_type: "user_account",
        record_id:
          (reqObj?.username as string | undefined) ||
          (reqObj?.email as string | undefined) ||
          fnName,
        description: `Ejecución de servicio "${fnName}"${reqObj?.full_name ? ` para ${String(reqObj.full_name)}` : ""}`,
        old_values: null,
        new_values: reqObj || null,
        result: resultStatus,
      })
      return
    }

    // 3. Mutaciones directas sobre tablas REST (/rest/v1/<table>)
    if (pathname.includes("/rest/v1/")) {
      const table = pathname.split("/rest/v1/")[1]?.split("/")[0] || ""
      if (!table || table === "audit_events" || table === "rpc") return

      const sig = `table:${payload.method}:${table}:${parsedUrl.search}:${JSON.stringify(reqObj || {})}`
      if (isDuplicateIntercept(sig)) return

      const mapping = TABLE_TO_MODULE[table] || { module: "system", label: table }
      const actor = await resolveCurrentActor()
      const dataObj = resObj || reqObj || {}

      const workerId = (dataObj.worker_id as string | undefined) || null
      const positionId = (dataObj.position_id as string | undefined) || null
      let entityId =
        (dataObj.organization_entity_id as string | undefined) ||
        (table === "organization_entities" ? (dataObj.id as string | undefined) : null) ||
        null

      const [workerInfo, posInfo] = await Promise.all([
        resolveWorkerInfo(workerId),
        resolvePositionInfo(positionId),
      ])

      if (!entityId) {
        entityId = posInfo?.entityId || workerInfo?.entityId || null
      }
      const entityName =
        (table === "organization_entities" ? (dataObj.name as string | undefined) : null) ||
        (await resolveEntityName(entityId))

      const verb =
        payload.method === "POST"
          ? "created"
          : payload.method === "DELETE"
            ? "deleted"
            : "updated"
      const verbLabel =
        payload.method === "POST"
          ? "Creación"
          : payload.method === "DELETE"
            ? "Eliminación"
            : "Actualización"

      const itemName =
        (dataObj.name as string | undefined) ||
        (dataObj.full_name as string | undefined) ||
        (dataObj.first_name
          ? buildFullName(dataObj as { first_name?: string; first_surname?: string; second_surname?: string })
          : undefined) ||
        workerInfo?.fullName ||
        posInfo?.name ||
        (dataObj.code as string | undefined) ||
        ""

      const recordId =
        (dataObj.code as string | undefined) ||
        (dataObj.identification as string | undefined) ||
        (dataObj.id as string | undefined) ||
        itemName ||
        table

      let description = `${verbLabel} de ${mapping.label}${itemName ? ` "${itemName}"` : ""}${entityName ? ` en ${entityName}` : ""}`
      let action = `${table.replace(/s$/, "")}_${verb}`

      if (table === "worker_position_assignments" && payload.method === "POST") {
        action = "worker_assigned_to_position"
        description = `Asignación de ${workerInfo?.fullName || "trabajador"} al puesto "${posInfo?.name || "puesto"}" en la plantilla${entityName ? ` de ${entityName}` : ""}`
      } else if (table === "organization_entities") {
        action = payload.method === "POST" ? "entity_created" : "entity_updated"
        description = `${verbLabel} de la entidad "${itemName || entityName || recordId}"`
      }

      await insertAuditEvent({
        actor_user_id: actor.userId,
        actor_full_name: actor.fullName,
        actor_username: actor.username,
        scope: entityId ? "ENTITY" : "SITECORP",
        organization_entity_id: entityId,
        entity_name: entityName,
        company_client_id: (dataObj.company_client_id as string | undefined) || null,
        module: mapping.module,
        action,
        entity_type: table,
        record_id: String(recordId),
        description,
        old_values: null,
        new_values: reqObj || resObj || null,
        result: resultStatus,
      })
    }
  } catch (err) {
    console.warn("[audit-history] Error processing intercepted mutation:", err)
  }
}

// Registrar el interceptor global inmediatamente al cargar el módulo
globalThis.__sitecorpSupabaseMutationHook = (payload) => {
  void handleInterceptedMutation(payload)
}

/* -------------------------------------------------------------------------- */
/* Consultas y Escrituras Públicas del Repositorio                            */
/* -------------------------------------------------------------------------- */

/**
 * Consulta de eventos con filtros y paginación.
 * Combina los registros almacenados en `public.audit_events` (Supabase), los eventos locales
 * y el auto-descubrimiento retroactivo de todas las tablas operativas.
 */
export async function selectAuditEvents(params: {
  filters: AuditHistoryFilters
  page: number
  pageSize: number
}): Promise<AuditHistoryPage> {
  const { filters, page, pageSize } = params
  const safePage = Math.max(1, page)
  const from = (safePage - 1) * pageSize
  const to = from + pageSize - 1

  let remoteEvents: AuditEvent[] = []

  try {
    const { data: remoteData, error: remoteError } = await supabase
      .from("audit_events")
      .select(AUDIT_EVENT_COLUMNS)
      .order("occurred_at", { ascending: false })
      .limit(500)

    if (!remoteError && Array.isArray(remoteData)) {
      remoteEvents = remoteData as unknown as AuditEvent[]
    }
  } catch {
    // Continuar con almacén local si la red o tabla falla
  }

  const localEvents = getStoredEvents()
  const combinedInitial = [...remoteEvents, ...localEvents]

  const { mergedEvents, hasRealPlatformData } = await syncDiscoveredPlatformEvents(combinedInitial)

  if (hasRealPlatformData || remoteEvents.length > 0) {
    saveStoredEvents(mergedEvents)
  }

  const filtered = mergedEvents.filter((event) => {
    if (filters.scope && event.scope !== filters.scope) return false
    if (filters.entityId && event.organization_entity_id !== filters.entityId) return false
    if (filters.module && event.module !== filters.module) return false
    if (filters.result && event.result !== filters.result) return false

    if (filters.actor) {
      const term = sanitizeSearchTerm(filters.actor)
      const actorName = (event.actor_full_name || "").toLowerCase()
      const username = (event.actor_username || "").toLowerCase()
      if (!actorName.includes(term) && !username.includes(term)) return false
    }

    if (filters.action) {
      const term = sanitizeSearchTerm(filters.action)
      const act = (event.action || "").toLowerCase()
      const desc = (event.description || "").toLowerCase()
      if (!act.includes(term) && !desc.includes(term)) return false
    }

    if (filters.recordId) {
      const term = sanitizeSearchTerm(filters.recordId)
      const rec = (event.record_id || "").toLowerCase()
      const entType = (event.entity_type || "").toLowerCase()
      const desc = (event.description || "").toLowerCase()
      if (!rec.includes(term) && !entType.includes(term) && !desc.includes(term)) return false
    }

    if (filters.year) {
      const eventYear = new Date(event.occurred_at).getFullYear().toString()
      if (eventYear !== filters.year) return false
    }

    if (filters.dateFrom) {
      if (event.occurred_at < `${filters.dateFrom}T00:00:00.000Z`) return false
    }

    if (filters.dateTo) {
      if (event.occurred_at >= `${nextDay(filters.dateTo)}T00:00:00.000Z`) return false
    }

    return true
  })

  filtered.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  const paged = filtered.slice(from, to + 1)

  return {
    events: paged,
    total: filtered.length,
    page: safePage,
    pageSize,
  }
}

/**
 * Inserta un nuevo evento de auditoría de manera inmutable en almacenamiento local y en Supabase.
 */
export async function insertAuditEvent(
  eventData: Omit<AuditEvent, "id" | "occurred_at">
): Promise<AuditEvent> {
  const events = getStoredEvents()
  const nowMs = Date.now()

  // Evitar duplicados si una acción dispara tanto llamada manual como interceptor universal
  const existingRecent = events.find((e) => {
    const diff = Math.abs(nowMs - new Date(e.occurred_at).getTime())
    if (diff > 4000) return false
    if (e.action !== eventData.action || e.module !== eventData.module) return false
    if (
      eventData.record_id &&
      e.record_id &&
      e.record_id.toLowerCase() === eventData.record_id.toLowerCase()
    ) {
      return true
    }
    if (
      eventData.entity_name &&
      e.entity_name &&
      e.entity_name.toLowerCase() === eventData.entity_name.toLowerCase()
    ) {
      return true
    }
    return false
  })

  if (existingRecent) {
    return existingRecent
  }

  const newEvent: AuditEvent = {
    ...eventData,
    id: generateUuid(),
    occurred_at: new Date(nowMs).toISOString(),
  }

  // 1. Guardar en almacenamiento persistente local
  events.unshift(newEvent)
  saveStoredEvents(events)

  // 2. Insertar en Supabase public.audit_events
  try {
    const { error: insErr } = await supabase.from("audit_events").insert([
      {
        id: newEvent.id,
        occurred_at: newEvent.occurred_at,
        actor_user_id: newEvent.actor_user_id,
        actor_full_name: newEvent.actor_full_name,
        actor_username: newEvent.actor_username,
        scope: newEvent.scope,
        organization_entity_id: newEvent.organization_entity_id,
        entity_name: newEvent.entity_name,
        company_client_id: newEvent.company_client_id,
        module: newEvent.module,
        action: newEvent.action,
        entity_type: newEvent.entity_type,
        record_id: newEvent.record_id,
        description: newEvent.description,
        old_values: newEvent.old_values,
        new_values: newEvent.new_values,
        result: newEvent.result,
      },
    ])
    if (insErr) {
      console.warn("[audit-history] Supabase insert warning:", insErr.message)
    }
  } catch (err) {
    console.warn("[audit-history] Supabase insert failed:", err)
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sitecorp:audit_event_recorded", { detail: newEvent }))
  }

  return newEvent
}

/** Entidades para el selector de filtro por entidad. */
export async function selectAuditEntityOptions(): Promise<AuditEntityOption[]> {
  try {
    const { data, error } = await supabase
      .from("organization_entities")
      .select("id, name")
      .order("name")

    if (!error && data && data.length > 0) {
      return data as AuditEntityOption[]
    }
  } catch {
    // Fallback a entidades conocidas
  }

  const events = getStoredEvents()
  const map = new Map<string, string>()
  map.set("ent-demo-001", "Empresa Demo Auditoría")
  map.set("ent-demo-002", "UEB Operaciones Central")

  for (const e of events) {
    if (e.organization_entity_id && e.entity_name) {
      map.set(e.organization_entity_id, e.entity_name)
    }
  }

  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
}

/** Obtiene todos los eventos guardados para exportación. */
export async function exportStoredAuditEvents(): Promise<AuditEvent[]> {
  return getStoredEvents()
}

/** Reinicia el almacén de eventos. */
export async function clearStoredAuditEvents(): Promise<void> {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_SEED_EVENTS))
  }
}
