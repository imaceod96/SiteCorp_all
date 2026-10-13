import type { PlatformRole, PlatformUser } from "../domain/entities"
import {
  selectActivePlatformRoles,
  selectPlatformUserRoles,
} from "../infrastructure/platform-users.repository"
import { selectAllUserProfiles } from "../infrastructure/user-profiles.repository"

/**
 * Control de acceso — Consultas de la administración de plataforma (aplicación).
 *
 * Dos lecturas SEPARADAS, como en la pantalla original: el listado de usuarios (que propaga
 * el fallo, porque sin él la tabla no tiene sentido) y el catálogo de roles ACTIVOS (cuyo
 * fallo sólo se registra, sin impedir ver los usuarios).
 *
 * La visibilidad la decide RLS: el dominio no filtra por plataforma ni concede nada.
 */

/**
 * Usuarios de plataforma con sus roles: perfil + roles asignados.
 *
 * La composición es la MISMA que hacía la pantalla (una consulta de roles por perfil y
 * aplanado de la relación embebida), incluida la forma de la proyección: si una respuesta no
 * trae roles, el resultado es una lista vacía.
 */
export async function loadPlatformUsers(): Promise<PlatformUser[]> {
  const profiles = await selectAllUserProfiles()

  return Promise.all(
    profiles.map(async (profile): Promise<PlatformUser> => {
      const roleRows = await selectPlatformUserRoles(profile.id)
      const roles = roleRows.map((row) => row.platform_roles).flat()

      return {
        id: profile.id,
        full_name: profile.full_name,
        username: profile.username,
        is_active: profile.is_active,
        created_at: profile.created_at,
        roles,
      }
    })
  )
}

/** Roles de plataforma ACTIVOS, por nombre (opciones asignables). */
export async function loadActivePlatformRoles(): Promise<PlatformRole[]> {
  return selectActivePlatformRoles()
}
