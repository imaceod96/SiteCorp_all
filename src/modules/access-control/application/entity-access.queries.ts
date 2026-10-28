import {
  rpcCanAccessEntity,
  rpcCanViewEntity,
  rpcListEntityPermissionCodes,
  rpcListEntityUserAccess,
  selectClientMemberships,
  selectEntityRoleOptions,
  selectUserProfiles,
} from "../infrastructure/entity-access.repository"
import type {
  EntityAccessOverview,
  EntityAccessRow,
  EntityAccessWorkspace,
} from "../domain/entities"

/**
 * Control de acceso — Consultas de usuarios y accesos (aplicación).
 *
 * La visibilidad de usuarios la decide SIEMPRE el backend: `list_entity_user_access`
 * devuelve únicamente los accesos (directos y heredados) que el solicitante puede ver,
 * de modo que nunca se filtran usuarios de otro cliente ni de otra entidad.
 *
 * `loadEntityPermission(s)` sólo PREGUNTA por un permiso; no lo concede. La decisión
 * efectiva sigue siendo del backend en cada operación.
 *
 * Este módulo es el ÚNICO punto desde el que se preguntan los permisos internos de una
 * entidad (`can_access_entity`, `can_view_entity`, `list_entity_permissions`): los demás
 * dominios consumen estos casos de uso y no mantienen envoltorios propios. Se conserva la
 * política de errores original de cada consumidor con dos variantes explícitas: la que
 * PROPAGA el fallo (`loadEntityPermission`, `canViewEntity`, `loadEntityPermissionCodes`)
 * y la que lo traduce a «sin permiso» (`loadEntityPermissionSafe`).
 */

/** Permiso interno del solicitante en una entidad (propaga el error del servidor). */
export async function loadEntityPermission(
  entityId: string,
  permissionCode: string
): Promise<boolean> {
  return rpcCanAccessEntity(entityId, permissionCode)
}

/**
 * Permiso interno del solicitante en una entidad SIN propagar fallos.
 *
 * Es la comprobación que usaban las pantallas que sólo la necesitan para habilitar
 * botones, enlaces de configuración o columnas de la vista: un fallo de la comprobación
 * —o la ausencia de permiso— NUNCA habilita nada y no debe tumbar la pantalla. La
 * autoridad real sigue siendo RLS y las RPC.
 */
export async function loadEntityPermissionSafe(
  entityId: string,
  permissionCode: string
): Promise<boolean> {
  try {
    return await rpcCanAccessEntity(entityId, permissionCode)
  } catch {
    return false
  }
}

/** Varios permisos de la misma entidad, resueltos en paralelo. */
export async function loadEntityPermissions(
  entityId: string,
  permissionCodes: string[]
): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    permissionCodes.map((code) => rpcCanAccessEntity(entityId, code))
  )

  return permissionCodes.reduce<Record<string, boolean>>((map, code, index) => {
    map[code] = results[index]
    return map
  }, {})
}

/**
 * Acceso de LECTURA a una entidad (`can_view_entity`). Es la comprobación que decide si
 * se abren los módulos internos de la entidad; el error del servidor se propaga.
 */
export async function canViewEntity(entityId: string): Promise<boolean> {
  return rpcCanViewEntity(entityId)
}

/** Códigos de permiso efectivos del solicitante en una entidad (propaga el error). */
export async function loadEntityPermissionCodes(entityId: string): Promise<string[]> {
  const rows = await rpcListEntityPermissionCodes(entityId)
  return rows.map((row) => row.permission_code).filter(Boolean)
}

/**
 * Accesos de usuarios a la entidad tal como los ve el solicitante (directos y heredados).
 * La visibilidad la decide el backend (`list_entity_user_access`).
 */
export async function loadEntityUserAccess(entityId: string): Promise<EntityAccessRow[]> {
  return rpcListEntityUserAccess(entityId)
}

/** Membresías activas del cliente y perfiles de sus usuarios. */
async function loadClientProfiles(clientId: string) {
  const memberships = await selectClientMemberships(clientId)
  const profiles = await selectUserProfiles(memberships.map((membership) => membership.user_id))
  return { memberships, profiles }
}

/**
 * Vista completa de gestión: accesos visibles, usuarios del cliente, perfiles, roles
 * internos de la entidad y los dos permisos que habilitan la pantalla.
 *
 * Un error al comprobar `users.manage` / `users.invite` NO invalida el listado: la
 * pantalla se muestra en modo consulta (igual que antes), pero la operación sigue
 * estando protegida por el backend.
 */
export async function loadEntityAccessWorkspace(input: {
  entityId: string
  clientId: string
}): Promise<EntityAccessWorkspace> {
  const [accessRows, roles, canManage, canInvite, clientData] = await Promise.all([
    rpcListEntityUserAccess(input.entityId),
    selectEntityRoleOptions(input.entityId),
    rpcCanAccessEntity(input.entityId, "users.manage").catch(() => false),
    rpcCanAccessEntity(input.entityId, "users.invite").catch(() => false),
    loadClientProfiles(input.clientId),
  ])

  return {
    accessRows,
    memberships: clientData.memberships,
    profiles: clientData.profiles,
    roles,
    canManage,
    canInvite,
  }
}

/** Vista de sólo lectura de la pantalla de usuarios de una entidad. */
export async function loadEntityAccessOverview(
  entityId: string
): Promise<EntityAccessOverview> {
  const [accessRows, canManage] = await Promise.all([
    rpcListEntityUserAccess(entityId),
    rpcCanAccessEntity(entityId, "users.manage").catch(() => false),
  ])

  return { accessRows, canManage }
}
