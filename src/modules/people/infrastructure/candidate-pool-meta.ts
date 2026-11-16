import { supabase } from "@/lib/supabase"

/**
 * Persistencia de metadatos de la Bolsa Global de Candidatos (`area_id` y postulación
 * multi-entidad) sobre `public.candidate_pool_metadata` en Supabase.
 *
 * Incluye caché en memoria con deduplicación de peticiones en vuelo para evitar consultas
 * repetidas al cargar listados de candidatos, y compatibilidad de lectura con registros
 * históricos en `public.candidate_additional_info`.
 */

export const AREA_META_PREFIX = "__SITECORP_AREA__:"
export const ENTITIES_META_PREFIX = "__SITECORP_ENTITIES__:"
export const CANDIDATES_CHANGED_EVENT = "sitecorp:candidates-changed"
const CACHE_TTL_MS = 30_000

interface PoolMetaSnapshot {
  fetchedAt: number
  areaByCandidateId: Map<string, string>
  entitiesByCandidateId: Map<string, string[]>
}

let memorySnapshot: PoolMetaSnapshot | null = null
let inflightSnapshotPromise: Promise<PoolMetaSnapshot> | null = null

/** Notifica a las vistas activas que la lista de candidatos cambió. */
export function notifyCandidatesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CANDIDATES_CHANGED_EVENT))
  }
}

/** Invalida la caché en memoria para forzar una lectura fresca en la siguiente consulta. */
export function invalidatePoolMetaCache(): void {
  memorySnapshot = null
  inflightSnapshotPromise = null
}

/** Carga en una sola consulta todos los metadatos de bolsa desde Supabase y los mantiene en caché. */
async function loadPoolMetaSnapshot(forceRefresh = false): Promise<PoolMetaSnapshot> {
  const now = Date.now()
  if (!forceRefresh && memorySnapshot && now - memorySnapshot.fetchedAt < CACHE_TTL_MS) {
    return memorySnapshot
  }
  if (!forceRefresh && inflightSnapshotPromise) {
    return inflightSnapshotPromise
  }

  inflightSnapshotPromise = (async () => {
    const areaByCandidateId = new Map<string, string>()
    const entitiesByCandidateId = new Map<string, string[]>()

    try {
      const [metaRes, legacyRes] = await Promise.allSettled([
        supabase
          .from("candidate_pool_metadata")
          .select("candidate_id, area_id, entity_ids, updated_at")
          .order("updated_at", { ascending: true }),
        supabase
          .from("candidate_additional_info")
          .select("candidate_id, info_text, created_at")
          .or(`info_text.like.${AREA_META_PREFIX}%,info_text.like.${ENTITIES_META_PREFIX}%`)
          .order("created_at", { ascending: true }),
      ])

      if (legacyRes.status === "fulfilled" && !legacyRes.value.error && legacyRes.value.data) {
        for (const row of legacyRes.value.data as { candidate_id: string; info_text: string }[]) {
          if (row.info_text.startsWith(AREA_META_PREFIX)) {
            const val = row.info_text.slice(AREA_META_PREFIX.length).trim()
            if (val) {
              areaByCandidateId.set(row.candidate_id, val)
            }
          } else if (row.info_text.startsWith(ENTITIES_META_PREFIX)) {
            const rawJson = row.info_text.slice(ENTITIES_META_PREFIX.length).trim()
            try {
              const parsed = JSON.parse(rawJson)
              if (Array.isArray(parsed)) {
                entitiesByCandidateId.set(
                  row.candidate_id,
                  parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
                )
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }

      if (metaRes.status === "fulfilled" && !metaRes.value.error && metaRes.value.data) {
        for (const row of metaRes.value.data as {
          candidate_id: string
          area_id?: string | null
          entity_ids?: string[] | null
        }[]) {
          if (row.area_id) {
            areaByCandidateId.set(row.candidate_id, row.area_id)
          } else {
            areaByCandidateId.delete(row.candidate_id)
          }
          if (Array.isArray(row.entity_ids)) {
            entitiesByCandidateId.set(
              row.candidate_id,
              row.entity_ids.filter((item): item is string => typeof item === "string" && item.length > 0)
            )
          }
        }
      }
    } catch (err) {
      console.warn("[people] lectura auxiliar de metadatos de bolsa falló", err)
    }

    const snapshot: PoolMetaSnapshot = {
      fetchedAt: Date.now(),
      areaByCandidateId,
      entitiesByCandidateId,
    }
    memorySnapshot = snapshot
    inflightSnapshotPromise = null
    return snapshot
  })()

  return inflightSnapshotPromise
}

/** Indica si un texto de `candidate_additional_info` es un metadato interno de la Bolsa. */
export function isInternalCandidateMetaText(text: string | null | undefined): boolean {
  if (!text) return false
  return text.startsWith(AREA_META_PREFIX) || text.startsWith(ENTITIES_META_PREFIX)
}

/** Guarda el área de interés (`area_id`) del candidato en `public.candidate_pool_metadata`. */
export async function saveCandidateAreaMeta(
  candidateId: string,
  organizationEntityId: string,
  areaId: string | null | undefined
): Promise<void> {
  const normalizedAreaId = (areaId ?? "").trim() || null

  if (memorySnapshot) {
    if (normalizedAreaId) {
      memorySnapshot.areaByCandidateId.set(candidateId, normalizedAreaId)
    } else {
      memorySnapshot.areaByCandidateId.delete(candidateId)
    }
  }

  try {
    const existingEntities =
      memorySnapshot?.entitiesByCandidateId.get(candidateId) ??
      (organizationEntityId ? [organizationEntityId] : [])

    const { error: upsertErr } = await supabase.from("candidate_pool_metadata").upsert(
      {
        candidate_id: candidateId,
        organization_entity_id: organizationEntityId,
        area_id: normalizedAreaId,
        entity_ids: existingEntities,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "candidate_id" }
    )

    if (upsertErr) {
      // Fallback en caso de que la migración de candidate_pool_metadata aún no esté aplicada
      await supabase
        .from("candidate_additional_info")
        .delete()
        .eq("candidate_id", candidateId)
        .like("info_text", `${AREA_META_PREFIX}%`)

      if (normalizedAreaId) {
        const userId = (await supabase.auth.getUser()).data.user?.id ?? null
        await supabase.from("candidate_additional_info").insert({
          candidate_id: candidateId,
          organization_entity_id: organizationEntityId,
          info_text: `${AREA_META_PREFIX}${normalizedAreaId}`,
          created_by: userId,
        })
      }
    }
  } catch (err) {
    console.warn("[people] no se pudo persistir area_id en candidate_pool_metadata", err)
  }
}

/**
 * Guarda la lista explícita de entidades a las que está postulado un candidato en `public.candidate_pool_metadata`.
 * Un arreglo vacío (`[]`) indica que el candidato está en la Bolsa Global sin entidad asignada.
 */
export async function saveCandidateEntitiesMeta(
  candidateId: string,
  organizationEntityId: string,
  entityIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(entityIds.map((id) => id.trim()).filter(Boolean)))

  if (memorySnapshot) {
    memorySnapshot.entitiesByCandidateId.set(candidateId, uniqueIds)
  }

  try {
    const existingAreaId = memorySnapshot?.areaByCandidateId.get(candidateId) ?? null
    const { error: upsertErr } = await supabase.from("candidate_pool_metadata").upsert(
      {
        candidate_id: candidateId,
        organization_entity_id: organizationEntityId,
        area_id: existingAreaId,
        entity_ids: uniqueIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "candidate_id" }
    )

    if (upsertErr) {
      await supabase
        .from("candidate_additional_info")
        .delete()
        .eq("candidate_id", candidateId)
        .like("info_text", `${ENTITIES_META_PREFIX}%`)

      const userId = (await supabase.auth.getUser()).data.user?.id ?? null
      await supabase.from("candidate_additional_info").insert({
        candidate_id: candidateId,
        organization_entity_id: organizationEntityId,
        info_text: `${ENTITIES_META_PREFIX}${JSON.stringify(uniqueIds)}`,
        created_by: userId,
      })
    }
  } catch (err) {
    console.warn("[people] no se pudo persistir entidades en candidate_pool_metadata", err)
  }
}

export interface CandidatesPoolMetaResult {
  areaByCandidateId: Map<string, string>
  entitiesByCandidateId: Map<string, string[]>
}

/** Obtiene `area_id` y las entidades postuladas para un conjunto de candidatos desde la caché unificada. */
export async function fetchCandidatesPoolMeta(
  candidateIds: string[]
): Promise<CandidatesPoolMetaResult> {
  const areaByCandidateId = new Map<string, string>()
  const entitiesByCandidateId = new Map<string, string[]>()

  const uniqueIds = Array.from(new Set(candidateIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { areaByCandidateId, entitiesByCandidateId }
  }

  const snapshot = await loadPoolMetaSnapshot()
  for (const id of uniqueIds) {
    const area = snapshot.areaByCandidateId.get(id)
    if (area) areaByCandidateId.set(id, area)
    const ents = snapshot.entitiesByCandidateId.get(id)
    if (ents !== undefined) entitiesByCandidateId.set(id, ents)
  }

  return { areaByCandidateId, entitiesByCandidateId }
}

/**
 * Obtiene las asignaciones globales de candidatos para saber qué candidatos adicionales
 * están postulados a una entidad o cuáles fueron desasignados de su entidad base.
 */
export async function fetchEntityPoolCandidateOverrides(entityId: string): Promise<{
  assignedCandidateIds: string[]
  excludedCandidateIds: Set<string>
}> {
  const assignedSet = new Set<string>()
  const excludedSet = new Set<string>()

  const snapshot = await loadPoolMetaSnapshot()
  for (const [candId, list] of snapshot.entitiesByCandidateId.entries()) {
    if (list.includes(entityId)) {
      assignedSet.add(candId)
    } else {
      excludedSet.add(candId)
    }
  }

  return {
    assignedCandidateIds: Array.from(assignedSet),
    excludedCandidateIds: excludedSet,
  }
}

/**
 * Cuando un candidato asignado desde la Bolsa Global a otra entidad del mismo cliente
 * va a ser evaluado o contratado en un puesto de esa entidad, sincroniza su
 * `organization_entity_id` con el del puesto para que las RPC de backend (`validate_hiring_readiness`
 * y `hire_candidate`) reconozcan la pertenencia a la entidad que lo contrata.
 */
export async function syncCandidateEntityWithPosition(
  candidateId: string | null | undefined,
  positionId: string | null | undefined
): Promise<void> {
  if (!candidateId || !positionId) return

  try {
    const [{ data: posData }, { data: candData }] = await Promise.all([
      supabase
        .from("organization_positions")
        .select("organization_entity_id")
        .eq("id", positionId)
        .maybeSingle(),
      supabase
        .from("candidates")
        .select("organization_entity_id")
        .eq("id", candidateId)
        .maybeSingle(),
    ])

    const posEntityId = (posData as { organization_entity_id?: string } | null)?.organization_entity_id
    const candEntityId = (candData as { organization_entity_id?: string } | null)?.organization_entity_id

    if (posEntityId && candEntityId && posEntityId !== candEntityId) {
      await supabase
        .from("candidates")
        .update({
          organization_entity_id: posEntityId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidateId)
    }
  } catch (err) {
    console.warn("[people] no se pudo sincronizar la entidad del candidato con el puesto", err)
  }
}
