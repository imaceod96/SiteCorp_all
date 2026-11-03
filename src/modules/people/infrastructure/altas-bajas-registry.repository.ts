import { supabase } from "@/lib/supabase"
import { resolveSeparationReasonColumnCode } from "../domain/rules"
import type { AltasBajasReasonColumnCode, AltasBajasRegistryRow } from "../domain/entities"

const LOCAL_SOURCE_ORIGIN_STORAGE_KEY = "sitecorp:altas_bajas_source_origin_v1"
const LOCAL_ALTA_NUMBER_STORAGE_KEY = "sitecorp:altas_bajas_alta_number_v1"
const SOURCE_ORIGIN_NOTE_PREFIX = "[Procedencia:"
const ALTA_NUMBER_NOTE_PREFIX = "[NoAlta:"

function readLocalSourceMap(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(LOCAL_SOURCE_ORIGIN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeLocalSourceOrigin(workerId: string, effectiveDate: string | null, source: string): void {
  if (typeof window === "undefined") return
  try {
    const map = readLocalSourceMap()
    if (effectiveDate) {
      map[`${workerId}:${effectiveDate}`] = source
    }
    map[`${workerId}:latest`] = source
    window.localStorage.setItem(LOCAL_SOURCE_ORIGIN_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore storage errors */
  }
}

function readLocalAltaNumberMap(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(LOCAL_ALTA_NUMBER_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeLocalAltaNumber(
  workerId: string,
  effectiveDate: string | null,
  assignmentId: string | null | undefined,
  altaNumber: string
): void {
  if (typeof window === "undefined") return
  try {
    const map = readLocalAltaNumberMap()
    if (assignmentId) {
      map[`assignment:${assignmentId}`] = altaNumber
    }
    if (effectiveDate) {
      map[`${workerId}:${effectiveDate}`] = altaNumber
    }
    map[`${workerId}:initial`] = altaNumber
    window.localStorage.setItem(LOCAL_ALTA_NUMBER_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore storage errors */
  }
}

export function formatNotesWithSourceOfOrigin(
  notes: string | null | undefined,
  sourceOfOrigin: string | null | undefined
): string | null {
  const cleanNotes = (notes ?? "").trim()
  const cleanSource = (sourceOfOrigin ?? "").trim()
  if (!cleanSource) return cleanNotes || null
  const tag = `${SOURCE_ORIGIN_NOTE_PREFIX} ${cleanSource}]`
  if (cleanNotes.includes(SOURCE_ORIGIN_NOTE_PREFIX)) return cleanNotes
  return cleanNotes ? `${tag} ${cleanNotes}` : tag
}

export function extractSourceOfOriginFromText(text: string | null | undefined): string | null {
  if (!text) return null
  const match = /\[Procedencia:\s*([^\]]+)\]/i.exec(text)
  return match?.[1]?.trim() || null
}

export function extractAltaNumberFromText(text: string | null | undefined): string | null {
  if (!text) return null
  const match = new RegExp(`\\${ALTA_NUMBER_NOTE_PREFIX}\\s*([^\\]]+)\\]`, "i").exec(text)
  return match?.[1]?.trim() || null
}

export const formatShortDate = (isoDate: string | null | undefined): string => {
  if (!isoDate) return ""
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!match) return isoDate
  return `${match[3]}/${match[2]}/${match[1]}`
}

export const formatAltaDisplay = (
  altaDate: string | null | undefined,
  altaNumber: string | null | undefined
): string => {
  const formattedDate = formatShortDate(altaDate)
  const cleanNumber = (altaNumber ?? "").trim()
  if (!formattedDate) return cleanNumber ? `No. ${cleanNumber}` : ""
  return cleanNumber ? `${formattedDate} · No. ${cleanNumber}` : formattedDate
}

/**
 * Persiste la Fuente de procedencia (Columna 5) del período laboral al contratar,
 * reincorporar o editar un registro migrado.
 */
export async function persistWorkerSourceOfOrigin(
  workerId: string | null | undefined,
  effectiveDate: string | null | undefined,
  sourceOfOrigin: string | null | undefined
): Promise<void> {
  const cleanSource = (sourceOfOrigin ?? "").trim()
  if (!workerId || !cleanSource) return

  writeLocalSourceOrigin(workerId, effectiveDate ?? null, cleanSource)

  // 1. Intentar RPC `save_worker_source_of_origin` (migración 20261111_02)
  const { error: rpcError } = await supabase.rpc("save_worker_source_of_origin", {
    p_worker_id: workerId,
    p_effective_date: effectiveDate || null,
    p_source_of_origin: cleanSource,
  })
  if (!rpcError) return

  // 2. Fallback directo sobre `worker_position_assignments` y `workers` si las columnas existen
  let query = supabase
    .from("worker_position_assignments")
    .update({ source_of_origin: cleanSource } as Record<string, unknown>)
    .eq("worker_id", workerId)

  if (effectiveDate) {
    query = query.eq("start_date", effectiveDate)
  } else {
    query = query.eq("is_current", true)
  }

  await query
  await supabase
    .from("workers")
    .update({ source_of_origin: cleanSource } as Record<string, unknown>)
    .eq("id", workerId)
}

/**
 * Persiste el Número de alta (Columna 4: Fecha y No. de alta), especialmente útil para
 * trabajadores provenientes de migraciones iniciales o para completar el No. de alta.
 */
export async function persistWorkerAltaNumber(
  workerId: string,
  effectiveDate: string | null | undefined,
  altaNumber: string | null | undefined,
  assignmentId?: string | null
): Promise<void> {
  if (!workerId) return
  const cleanAltaNumber = (altaNumber ?? "").trim()

  writeLocalAltaNumber(workerId, effectiveDate ?? null, assignmentId, cleanAltaNumber)

  // 1. Intentar RPC `save_worker_alta_number` (migración 20261111_02)
  const { error: rpcError } = await supabase.rpc("save_worker_alta_number", {
    p_worker_id: workerId,
    p_effective_date: effectiveDate || null,
    p_alta_number: cleanAltaNumber || null,
  })
  if (!rpcError) return

  // 2. Fallback directo sobre `worker_position_assignments` y `workers` si la columna ya existe
  if (assignmentId) {
    await supabase
      .from("worker_position_assignments")
      .update({ alta_number: cleanAltaNumber || null } as Record<string, unknown>)
      .eq("id", assignmentId)
  } else if (effectiveDate) {
    await supabase
      .from("worker_position_assignments")
      .update({ alta_number: cleanAltaNumber || null } as Record<string, unknown>)
      .eq("worker_id", workerId)
      .eq("start_date", effectiveDate)
  }

  await supabase
    .from("workers")
    .update({ alta_number: cleanAltaNumber || null } as Record<string, unknown>)
    .eq("id", workerId)
}

interface RawWorkerRow {
  id: string
  code: string | null
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  address: string | null
  municipality: string | null
  province: string | null
  hire_date: string
  employment_start_date: string | null
  employment_status: string
  origin?: string | null
  migrated_at?: string | null
  migration_batch_id?: string | null
  alta_number?: string | null
  source_of_origin?: string | null
  created_at: string
}

interface RawAssignmentRow {
  id: string
  worker_id: string
  position_id: string
  start_date: string
  end_date: string | null
  is_current: boolean
  alta_number?: string | null
  source_of_origin?: string | null
  created_at?: string | null
}

interface RawMovementRow {
  id: string
  worker_id: string
  movement_type: string
  previous_assignment_id: string | null
  new_assignment_id: string | null
  effective_date: string
  reason: string | null
  notes: string | null
  alta_number?: string | null
  source_of_origin?: string | null
  separation_reason_id: string | null
  created_at: string
  separation_reason: { name: string } | { name: string }[] | null
}

const firstOf = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null

const buildWorkerFullName = (w: RawWorkerRow): string =>
  [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")

const buildWorkerAddress = (w: RawWorkerRow): string => {
  const parts = [w.address, w.municipality, w.province]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : "—"
}

/**
 * Carga y construye automáticamente todas las entradas del «b) Registro de Altas y Bajas»
 * de una entidad, incluyendo trabajadores actuales, migraciones iniciales (con o sin puesto
 * asignado), reingresos y bajas históricas.
 *
 * Reglas de construcción de períodos laborales:
 *   1. Cada trabajador tiene uno o más períodos laborales (el alta/migración inicial + cada reingreso).
 *   2. Para el alta inicial o las migraciones iniciales, la fecha de alta en Columna 4 toma
 *      automáticamente la fecha de incorporación (`employment_start_date` / `hire_date`),
 *      incluso si el trabajador migrado fue vinculado a un puesto en una fecha posterior.
 *   3. Un cambio de puesto dentro del mismo período laboral continuo NO crea una nueva fila
 *      en el Registro de Altas y Bajas; conserva la fecha de alta original del período.
 *   4. Una BAJA cierra el período correspondiente con su fecha efectiva y marca con «X»
 *      la columna del motivo de baja (columnas 7 a 17).
 *   5. Si el trabajador es reincorporado posteriormente (REINGRESO o nueva asignación tras
 *      una baja), se genera una NUEVA entrada independiente en el registro.
 */
export async function fetchEntityAltasBajasRegistry(
  entityId: string
): Promise<AltasBajasRegistryRow[]> {
  let workers: RawWorkerRow[] = []

  // Intentar consulta extendida con columnas de migración y alta_number/source_of_origin
  const { data: workersExtended, error: workersExtError } = await supabase
    .from("workers")
    .select(
      "id, code, first_name, first_surname, second_surname, identification, address, municipality, province, hire_date, employment_start_date, employment_status, origin, migrated_at, migration_batch_id, alta_number, source_of_origin, created_at"
    )
    .eq("organization_entity_id", entityId)
    .order("hire_date", { ascending: true })
    .order("created_at", { ascending: true })

  if (!workersExtError && workersExtended) {
    workers = workersExtended as unknown as RawWorkerRow[]
  } else {
    // Fallback si `alta_number` o `source_of_origin` aún no se han ejecutado en `workers`
    const { data: workersMigration, error: workersMigError } = await supabase
      .from("workers")
      .select(
        "id, code, first_name, first_surname, second_surname, identification, address, municipality, province, hire_date, employment_start_date, employment_status, origin, migrated_at, migration_batch_id, created_at"
      )
      .eq("organization_entity_id", entityId)
      .order("hire_date", { ascending: true })
      .order("created_at", { ascending: true })

    if (!workersMigError && workersMigration) {
      workers = workersMigration as unknown as RawWorkerRow[]
    } else {
      const { data: workersBasic, error: workersBasicError } = await supabase
        .from("workers")
        .select(
          "id, code, first_name, first_surname, second_surname, identification, address, municipality, province, hire_date, employment_start_date, employment_status, created_at"
        )
        .eq("organization_entity_id", entityId)
        .order("hire_date", { ascending: true })
        .order("created_at", { ascending: true })

      if (workersBasicError) throw workersBasicError
      workers = (workersBasic as unknown as RawWorkerRow[] | null) || []
    }
  }

  if (workers.length === 0) return []

  const workerIds = workers.map((w) => w.id)

  // Consultar asignaciones (con fallback si `source_of_origin` o `alta_number` aún no existen en BD)
  let assignments: RawAssignmentRow[] = []
  const { data: assignWithMeta, error: assignError } = await supabase
    .from("worker_position_assignments")
    .select(
      "id, worker_id, position_id, start_date, end_date, is_current, alta_number, source_of_origin, created_at"
    )
    .in("worker_id", workerIds)
    .order("start_date", { ascending: true })

  if (!assignError && assignWithMeta) {
    assignments = assignWithMeta as unknown as RawAssignmentRow[]
  } else {
    const { data: assignFallback } = await supabase
      .from("worker_position_assignments")
      .select("id, worker_id, position_id, start_date, end_date, is_current, created_at")
      .in("worker_id", workerIds)
      .order("start_date", { ascending: true })
    assignments = (assignFallback as unknown as RawAssignmentRow[] | null) || []
  }

  // Consultar movimientos laborales (BAJA, ALTA, REINGRESO, CAMBIO_PUESTO, etc.)
  let movements: RawMovementRow[] = []
  const { data: movWithMeta, error: movError } = await supabase
    .from("worker_employment_movements")
    .select(
      `id, worker_id, movement_type, previous_assignment_id, new_assignment_id,
       effective_date, reason, notes, alta_number, source_of_origin, separation_reason_id, created_at,
       separation_reason:worker_separation_reasons(name)`
    )
    .in("worker_id", workerIds)
    .order("effective_date", { ascending: true })
    .order("created_at", { ascending: true })

  if (!movError && movWithMeta) {
    movements = movWithMeta as unknown as RawMovementRow[]
  } else {
    const { data: movFallback } = await supabase
      .from("worker_employment_movements")
      .select(
        `id, worker_id, movement_type, previous_assignment_id, new_assignment_id,
         effective_date, reason, notes, separation_reason_id, created_at,
         separation_reason:worker_separation_reasons(name)`
      )
      .in("worker_id", workerIds)
      .order("effective_date", { ascending: true })
      .order("created_at", { ascending: true })
    movements = (movFallback as unknown as RawMovementRow[] | null) || []
  }

  const localSourceMap = readLocalSourceMap()
  const localAltaNumberMap = readLocalAltaNumberMap()

  const assignmentsByWorker = new Map<string, RawAssignmentRow[]>()
  for (const a of assignments) {
    const list = assignmentsByWorker.get(a.worker_id) || []
    list.push(a)
    assignmentsByWorker.set(a.worker_id, list)
  }

  const movementsByWorker = new Map<string, RawMovementRow[]>()
  for (const m of movements) {
    const list = movementsByWorker.get(m.worker_id) || []
    list.push(m)
    movementsByWorker.set(m.worker_id, list)
  }

  interface RawPeriodDraft {
    id: string
    worker: RawWorkerRow
    assignmentId: string | null
    altaDate: string
    altaNumber: string | null
    sourceOfOrigin: string | null
    isInitialMigration: boolean
    isReentryPeriod: boolean
    bajaDate: string | null
    bajaNumber: string | null
    bajaReasonColumn: AltasBajasReasonColumnCode | null
    bajaReasonDetail: string | null
    status: "ACTIVE" | "SEPARATED"
    sortTimestamp: string
  }

  const periodDrafts: RawPeriodDraft[] = []

  for (const worker of workers) {
    const workerAssignments = (assignmentsByWorker.get(worker.id) || []).slice().sort((a, b) =>
      a.start_date.localeCompare(b.start_date)
    )
    const workerMovements = (movementsByWorker.get(worker.id) || []).slice().sort((a, b) =>
      a.effective_date.localeCompare(b.effective_date)
    )

    const isMigratedWorker =
      worker.origin === "MIGRATION" ||
      !!worker.migrated_at ||
      !!worker.migration_batch_id ||
      workerAssignments.length === 0

    // Fecha de incorporación canónica del trabajador (especialmente para alta inicial y migración)
    const canonicalIncorporationDate = worker.employment_start_date || worker.hire_date

    // Movimientos de cambio de puesto internos (para no confundirlos con reingresos)
    const positionChangeNewAssignmentIds = new Set(
      workerMovements
        .filter(
          (m) =>
            m.movement_type === "CAMBIO_PUESTO" ||
            m.movement_type === "POSITION_CHANGE" ||
            m.movement_type === "REUBICACION"
        )
        .map((m) => m.new_assignment_id)
        .filter((id): id is string => !!id)
    )

    const bajaMovements = workerMovements.filter((m) => m.movement_type === "BAJA")
    const usedBajaIds = new Set<string>()

    // Función auxiliar para resolver la fuente de procedencia de un período
    const resolvePeriodSource = (
      startDate: string,
      isInitialPeriod: boolean,
      assignmentSource?: string | null
    ): string | null => {
      if (assignmentSource && assignmentSource.trim()) return assignmentSource.trim()

      // Buscar en movimientos cercanos a la fecha de inicio
      for (const m of workerMovements) {
        if (m.movement_type === "BAJA") continue
        if (m.effective_date === startDate) {
          if (m.source_of_origin && m.source_of_origin.trim()) return m.source_of_origin.trim()
          const fromNotes = extractSourceOfOriginFromText(m.notes)
          if (fromNotes) return fromNotes
        }
      }

      if (isInitialPeriod && worker.source_of_origin && worker.source_of_origin.trim()) {
        return worker.source_of_origin.trim()
      }

      // Buscar en cualquier movimiento de alta/reingreso del trabajador con etiqueta en notas
      for (const m of workerMovements) {
        if (m.movement_type === "BAJA") continue
        const fromNotes = extractSourceOfOriginFromText(m.notes)
        if (fromNotes) return fromNotes
      }

      // Respaldo local
      return (
        localSourceMap[`${worker.id}:${startDate}`] ||
        (isInitialPeriod ? localSourceMap[`${worker.id}:latest`] : null) ||
        null
      )
    }

    // Función auxiliar para resolver el Número de alta (Columna 4)
    const resolvePeriodAltaNumber = (
      startDate: string,
      isInitialPeriod: boolean,
      assignmentId: string | null,
      assignmentAltaNumber?: string | null
    ): string | null => {
      // 1. Si el usuario lo editó localmente (permite también vaciarlo con "")
      if (assignmentId && `assignment:${assignmentId}` in localAltaNumberMap) {
        const val = localAltaNumberMap[`assignment:${assignmentId}`].trim()
        return val || null
      }
      if (`${worker.id}:${startDate}` in localAltaNumberMap) {
        const val = localAltaNumberMap[`${worker.id}:${startDate}`].trim()
        return val || null
      }
      if (isInitialPeriod && `${worker.id}:initial` in localAltaNumberMap) {
        const val = localAltaNumberMap[`${worker.id}:initial`].trim()
        return val || null
      }

      // 2. Columna en BD (asignación, movimiento o trabajador)
      if (assignmentAltaNumber && assignmentAltaNumber.trim()) {
        return assignmentAltaNumber.trim()
      }

      for (const m of workerMovements) {
        if (m.movement_type === "BAJA") continue
        if (m.effective_date === startDate) {
          if (m.alta_number && m.alta_number.trim()) return m.alta_number.trim()
          const fromNotes = extractAltaNumberFromText(m.notes)
          if (fromNotes) return fromNotes
        }
      }

      if (isInitialPeriod && worker.alta_number && worker.alta_number.trim()) {
        return worker.alta_number.trim()
      }

      return null
    }

    if (workerAssignments.length === 0) {
      // Trabajador de migración inicial pendiente de vincular a puesto en plantilla
      const startDate = canonicalIncorporationDate
      const lastBaja = bajaMovements[bajaMovements.length - 1] ?? null
      const isSeparated = worker.employment_status !== "active" || !!lastBaja
      const separationCatalogName = lastBaja ? firstOf(lastBaja.separation_reason)?.name ?? null : null
      const reasonText = lastBaja?.reason || separationCatalogName || null

      periodDrafts.push({
        id: `${worker.id}-period-1`,
        worker,
        assignmentId: null,
        altaDate: startDate,
        altaNumber: resolvePeriodAltaNumber(startDate, true, null, null),
        sourceOfOrigin: resolvePeriodSource(startDate, true, null),
        isInitialMigration: true,
        isReentryPeriod: false,
        bajaDate: isSeparated ? lastBaja?.effective_date ?? null : null,
        bajaNumber: null,
        bajaReasonColumn: isSeparated
          ? resolveSeparationReasonColumnCode(separationCatalogName || reasonText)
          : null,
        bajaReasonDetail: isSeparated ? reasonText : null,
        status: isSeparated ? "SEPARATED" : "ACTIVE",
        sortTimestamp: startDate || worker.created_at,
      })
      continue
    }

    // Agrupar asignaciones en períodos laborales continuos.
    interface GroupedPeriod {
      assignments: RawAssignmentRow[]
      bajaMovement: RawMovementRow | null
    }

    const groupedPeriods: GroupedPeriod[] = []
    let currentGroup: GroupedPeriod | null = null

    for (let i = 0; i < workerAssignments.length; i++) {
      const assignment = workerAssignments[i]
      const isInternalPositionChange = positionChangeNewAssignmentIds.has(assignment.id)

      if (!currentGroup) {
        currentGroup = { assignments: [assignment], bajaMovement: null }
        groupedPeriods.push(currentGroup)
      } else {
        const prevAssignment = currentGroup.assignments[currentGroup.assignments.length - 1]
        const bajaForPrev = bajaMovements.find(
          (b) =>
            !usedBajaIds.has(b.id) &&
            (b.previous_assignment_id === prevAssignment.id ||
              (prevAssignment.end_date &&
                b.effective_date >= prevAssignment.start_date &&
                b.effective_date <= assignment.start_date))
        )

        if (bajaForPrev) {
          usedBajaIds.add(bajaForPrev.id)
          currentGroup.bajaMovement = bajaForPrev
          currentGroup = { assignments: [assignment], bajaMovement: null }
          groupedPeriods.push(currentGroup)
        } else if (
          !isInternalPositionChange &&
          prevAssignment.end_date &&
          assignment.start_date > prevAssignment.end_date
        ) {
          currentGroup = { assignments: [assignment], bajaMovement: null }
          groupedPeriods.push(currentGroup)
        } else {
          currentGroup.assignments.push(assignment)
        }
      }
    }

    // Si quedó una baja final para el último período
    if (currentGroup && !currentGroup.bajaMovement) {
      const lastAssignment = currentGroup.assignments[currentGroup.assignments.length - 1]
      const matchingBaja = bajaMovements.find(
        (b) =>
          !usedBajaIds.has(b.id) &&
          (b.previous_assignment_id === lastAssignment.id ||
            b.effective_date >= currentGroup!.assignments[0].start_date)
      )
      if (matchingBaja) {
        usedBajaIds.add(matchingBaja.id)
        currentGroup.bajaMovement = matchingBaja
      }
    }

    groupedPeriods.forEach((group, periodIdx) => {
      const isInitialPeriod = periodIdx === 0
      const firstAssignment = group.assignments[0]
      const lastAssignment = group.assignments[group.assignments.length - 1]

      // En el período inicial (y especialmente en trabajadores de migración inicial vinculados
      // posteriormente a un puesto), se toma automáticamente la fecha de incorporación del trabajador.
      const startDate = isInitialPeriod
        ? canonicalIncorporationDate || firstAssignment.start_date
        : firstAssignment.start_date

      const altaNumberFromAssignments =
        group.assignments.map((a) => a.alta_number).find((n) => !!n && n.trim().length > 0) ?? null

      const altaNumber = resolvePeriodAltaNumber(
        startDate,
        isInitialPeriod,
        firstAssignment.id,
        altaNumberFromAssignments
      )

      const sourceFromAssignments =
        group.assignments.map((a) => a.source_of_origin).find((s) => !!s && s.trim().length > 0) ??
        null

      const bajaMov = group.bajaMovement
      const isLastPeriod = periodIdx === groupedPeriods.length - 1
      const isSeparated =
        !!bajaMov ||
        (!lastAssignment.is_current &&
          !!lastAssignment.end_date &&
          (!isLastPeriod || worker.employment_status !== "active"))

      const bajaDate = bajaMov?.effective_date ?? (isSeparated ? lastAssignment.end_date : null)
      const separationCatalogName = bajaMov ? firstOf(bajaMov.separation_reason)?.name ?? null : null
      const reasonText = bajaMov?.reason || separationCatalogName || null

      const bajaReasonColumn: AltasBajasReasonColumnCode | null = isSeparated
        ? resolveSeparationReasonColumnCode(separationCatalogName || reasonText)
        : null

      periodDrafts.push({
        id: `${worker.id}-period-${periodIdx + 1}-${firstAssignment.id}`,
        worker,
        assignmentId: firstAssignment.id,
        altaDate: startDate,
        altaNumber,
        sourceOfOrigin: resolvePeriodSource(startDate, isInitialPeriod, sourceFromAssignments),
        isInitialMigration: isInitialPeriod && isMigratedWorker,
        isReentryPeriod: periodIdx > 0,
        bajaDate: bajaDate ?? null,
        bajaNumber: null,
        bajaReasonColumn,
        bajaReasonDetail: isSeparated ? reasonText : null,
        status: isSeparated ? "SEPARATED" : "ACTIVE",
        sortTimestamp: startDate || worker.created_at,
      })
    })
  }

  // Ordenar cronológicamente por fecha de alta y luego por nombre del trabajador
  periodDrafts.sort((a, b) => {
    const byDate = (a.altaDate || "").localeCompare(b.altaDate || "")
    if (byDate !== 0) return byDate
    return buildWorkerFullName(a.worker).localeCompare(buildWorkerFullName(b.worker), "es")
  })

  return periodDrafts.map((draft, index): AltasBajasRegistryRow => {
    const altaDisplay = formatAltaDisplay(draft.altaDate, draft.altaNumber)

    const formattedBajaDate = draft.bajaDate ? formatShortDate(draft.bajaDate) : null
    const bajaDisplay = formattedBajaDate
      ? draft.bajaNumber
        ? `${formattedBajaDate} · No. ${draft.bajaNumber}`
        : formattedBajaDate
      : null

    return {
      id: draft.id,
      sequenceNumber: index + 1,
      workerId: draft.worker.id,
      workerCode: draft.worker.code,
      assignmentId: draft.assignmentId,
      identification: draft.worker.identification,
      fullName: buildWorkerFullName(draft.worker),
      address: buildWorkerAddress(draft.worker),
      altaDate: draft.altaDate,
      altaNumber: draft.altaNumber,
      altaDisplay,
      sourceOfOrigin: draft.sourceOfOrigin,
      isInitialMigration: draft.isInitialMigration,
      isReentryPeriod: draft.isReentryPeriod,
      bajaDate: draft.bajaDate,
      bajaNumber: draft.bajaNumber,
      bajaDisplay,
      bajaReasonColumn: draft.bajaReasonColumn,
      bajaReasonDetail: draft.bajaReasonDetail,
      status: draft.status,
    }
  })
}
