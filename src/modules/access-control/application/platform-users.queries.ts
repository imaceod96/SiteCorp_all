import type { PlatformRole, PlatformUser } from "../domain/entities"
import {
  selectActivePlatformRoles,
  selectPlatformUserRoles,
} from "../infrastructure/platform-users.repository"
import {
  selectAllUserProfiles,
  selectPlatformUserEmails,
} from "../infrastructure/user-profiles.repository"

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
 * Usuarios de plataforma con sus roles: perfil + correo electrónico + roles asignados.
 */
export async function loadPlatformUsers(): Promise<PlatformUser[]> {
  const [profiles, emailsByUserId] = await Promise.all([
    selectAllUserProfiles(),
    selectPlatformUserEmails(),
  ])

  return Promise.all(
    profiles.map(async (profile): Promise<PlatformUser> => {
      const roleRows = await selectPlatformUserRoles(profile.id)
      const roles = roleRows
        .map((row) => row.platform_roles)
        .flat()
        .filter((role): role is PlatformRole => Boolean(role && role.name))

      const resolvedEmail =
        emailsByUserId[profile.id] ||
        (typeof profile.email === "string" ? profile.email.trim() : "") ||
        ""

      return {
        id: profile.id,
        full_name: profile.full_name ?? "",
        username: profile.username ?? "",
        email: resolvedEmail,
        is_active: profile.is_active,
        created_at: profile.created_at ?? "",
        roles,
      }
    })
  )
}

/** Roles de plataforma ACTIVOS, por nombre (opciones asignables). */
export async function loadActivePlatformRoles(): Promise<PlatformRole[]> {
  return selectActivePlatformRoles()
}
