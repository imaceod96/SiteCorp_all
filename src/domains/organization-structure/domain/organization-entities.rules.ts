import { buildAccountCode } from "./account.rules"
import type {
  OrganizationEntity,
  OrganizationEntityFormData,
  OrganizationEntityRegime,
  OrganizationEntityType,
} from "./entities"

/**
 * Entidades organizativas — Reglas de dominio.
 *
 * Grupo Empresarial → Empresa → UEB, con el régimen (Presupuestada / Empresarial) que
 * determina la escala salarial aplicable y la Cuenta SiteCorp que habilita los módulos
 * internos. Todas las reglas son PURAS: no consultan Supabase ni conocen el formulario.
 *
 * Las reglas, los textos y los cálculos son EXACTAMENTE los que aplicaba el diálogo:
 * la migración a DDD es un traslado estructural, no un cambio de comportamiento.
 */

/** Opciones de tipo de entidad, en el orden en que se ofrecen. */
export const ENTITY_TYPE_OPTIONS: ReadonlyArray<{ value: OrganizationEntityType; label: string }> = [
  { value: "business_group", label: "Grupo empresarial" },
  { value: "company", label: "Empresa" },
  { value: "ueb", label: "UEB" },
]

/**
 * Composición de la JERARQUÍA organizativa a partir de las entidades visibles.
 *
 * Es la única regla que agrupa el árbol: cada cliente (clave `tenant_id`, la columna
 * física del cliente propietario) con sus raíces —las entidades SIN entidad superior— y,
 * para cualquier entidad, sus hijas directas.
 *
 * Es EXACTAMENTE la agrupación que hacían las pantallas: una entidad cuyo padre no está
 * entre las visibles no se convierte en raíz (no se inventa jerarquía) y tampoco se
 * oculta de su padre visible, si lo tuviera.
 *
 * Regla pura: no consulta Supabase y no depende de la interfaz.
 */
export interface OrganizationTree {
  /** Hijas directas por identificador de entidad superior. */
  childrenByParent: Record<string, OrganizationEntity[]>
  /** Entidades raíz por cliente propietario. */
  rootsByCompanyClient: Record<string, OrganizationEntity[]>
}

export function buildOrganizationTree(entities: OrganizationEntity[]): OrganizationTree {
  return entities.reduce<OrganizationTree>(
    (tree, entity) => {
      if (entity.parent_id) {
        tree.childrenByParent[entity.parent_id] = [
          ...(tree.childrenByParent[entity.parent_id] || []),
          entity,
        ]
        return tree
      }

      tree.rootsByCompanyClient[entity.tenant_id] = [
        ...(tree.rootsByCompanyClient[entity.tenant_id] || []),
        entity,
      ]
      return tree
    },
    { childrenByParent: {}, rootsByCompanyClient: {} }
  )
}

/**
 * Camino de entidades superiores (de la raíz a la inmediata) construido con las
 * referencias `parent_id` de las entidades del MISMO cliente. Si un ancestro no está
 * entre las entidades visibles, el camino se corta ahí (nunca se inventa un nodo).
 */
export function resolveEntityAncestors(
  entities: OrganizationEntity[],
  entity: OrganizationEntity | null
): OrganizationEntity[] {
  if (!entity) return []

  const entityById = entities.reduce<Record<string, OrganizationEntity>>((map, row) => {
    map[row.id] = row
    return map
  }, {})

  const ancestorIds: string[] = []
  let parentId = entity.parent_id
  while (parentId) {
    const parent = entityById[parentId]
    if (!parent) break
    ancestorIds.unshift(parent.id)
    parentId = parent.parent_id
  }

  return ancestorIds.map((id) => entityById[id]).filter(Boolean)
}

/** Códigos canónicos del catálogo `entity_regimes`. */
export const REGIME_OPTIONS: ReadonlyArray<{ value: OrganizationEntityRegime; label: string }> = [
  { value: "PRESUPUESTADA", label: "Presupuestada" },
  { value: "EMPRESARIAL", label: "Empresarial" },
]

export const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "active", label: "Activo" },
  { value: "inactive", label: "Inactivo" },
]

/** Prefijo del código interno autogenerado según el tipo de entidad. */
const CODE_PREFIXES: Record<OrganizationEntityType, string> = {
  business_group: "GE",
  company: "EMP",
  ueb: "UEB",
}

/**
 * Código interno autogenerado (`GE-XXXXXX`, `EMP-XXXXXX`, `UEB-XXXXXX`).
 * Se genera en el alta y al cambiar el tipo a Grupo Empresarial; en el resto de
 * ediciones se conserva el código existente.
 */
export function generateEntityCode(entityType: OrganizationEntityType): string {
  const timestamp = Date.now().toString(36).toUpperCase().padStart(6, "0").substring(0, 6)
  return `${CODE_PREFIXES[entityType]}-${timestamp}`
}

/** Un grupo empresarial no tiene entidad superior; una empresa cuelga de un grupo. */
export function isParentTypeAllowed(
  parentType: OrganizationEntityType,
  entityType: OrganizationEntityType
): boolean {
  if (entityType === "business_group") return false
  if (entityType === "company") return parentType === "business_group"
  return parentType === "company"
}

/**
 * Entidades candidatas a ser la entidad superior: SIEMPRE del MISMO cliente
 * (aislamiento por cliente) y nunca la propia entidad que se edita.
 *
 * Al editar se conserva la entidad superior actual aunque esté inactiva, para no
 * perder una jerarquía ya existente.
 */
export function resolveParentCandidates(input: {
  entities: OrganizationEntity[]
  editingEntity: OrganizationEntity | null
  companyClientId: string
  entityType: OrganizationEntityType
}): OrganizationEntity[] {
  const { entities, editingEntity, companyClientId, entityType } = input

  const sameCompanyClient = entities.filter(
    (entity) => entity.id !== editingEntity?.id && entity.tenant_id === companyClientId
  )
  const active = sameCompanyClient.filter((entity) => entity.is_active !== false)

  const currentParent = editingEntity?.parent_id
    ? sameCompanyClient.find((entity) => entity.id === editingEntity.parent_id)
    : undefined

  const candidates =
    currentParent && !active.some((entity) => entity.id === currentParent.id)
      ? [currentParent, ...active]
      : active

  return candidates.filter((candidate) => isParentTypeAllowed(candidate.entity_type, entityType))
}

/**
 * Traduce los errores del backend a un mensaje entendible sin exponer detalles internos.
 * Se conserva la correspondencia de códigos PostgREST que ya usaba el diálogo.
 */
export function describeEntityError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}): string {
  const code = error?.code || ""
  const message = error?.message || ""

  if (code === "23503") {
    return "El cliente o la entidad superior seleccionada no es válida."
  }
  if (code === "23505") {
    return "Ya existe una entidad con ese nombre en este cliente."
  }
  if (code === "23514") {
    return /parent/i.test(message)
      ? "La entidad superior no es válida para este tipo de entidad."
      : "Los datos no cumplen las reglas de la organización."
  }
  if (code === "23502") {
    return "Falta un dato obligatorio para crear la entidad."
  }
  if (code === "22P02") {
    return "Alguno de los identificadores enviados no es válido."
  }
  if (code === "42501" || /row-level security/i.test(message)) {
    return "No tienes permiso para crear o editar entidades en este cliente."
  }
  if (code === "PGRST204") {
    return "La estructura del formulario no coincide con la base de datos. Contacta al administrador."
  }
  return message || "No se pudo guardar la entidad."
}

/**
 * Construye la carga de escritura de la entidad.
 *
 * Reglas que se conservan intactas:
 *   · el CÓDIGO interno se autogenera en el alta y al pasar a Grupo Empresarial; en el
 *     resto de ediciones se mantiene el existente;
 *   · `parent_id` siempre es un UUID real o NULL (nunca cadena vacía), y un Grupo
 *     Empresarial nunca tiene entidad superior;
 *   · la Cuenta SiteCorp es la única fuente de verdad de los módulos internos y su
 *     código se deriva del código interno: se genera al activar y NO se regenera al
 *     reeditar (la operación es idempotente);
 *   · al desactivar una Cuenta SiteCorp se desactiva también la cuenta.
 *
 * El cliente propietario NO forma parte de esta carga: lo añade el repositorio sólo al
 * crear (al editar, el cliente de la entidad no se modifica nunca).
 */
export function buildOrganizationEntityPayload(input: {
  data: OrganizationEntityFormData
  editingEntity: OrganizationEntity | null
}): Record<string, unknown> {
  const { data, editingEntity } = input

  const entityCode =
    data.entity_type === "business_group" || !editingEntity
      ? generateEntityCode(data.entity_type)
      : editingEntity.code || generateEntityCode(data.entity_type)

  const wasSiteCorp = editingEntity?.is_sitecorp_account === true
  const sitecorp = data.is_sitecorp_account === true
  const accountCode = sitecorp
    ? editingEntity?.account_code || buildAccountCode(entityCode)
    : null
  const accountIsActive = sitecorp
    ? wasSiteCorp
      ? editingEntity?.account_is_active === true
      : true
    : false

  return {
    ...data,
    code: entityCode,
    parent_id: data.entity_type === "business_group" ? null : data.parent_id || null,
    is_sitecorp_account: sitecorp,
    account_code: accountCode,
    account_is_active: accountIsActive,
  }
}
