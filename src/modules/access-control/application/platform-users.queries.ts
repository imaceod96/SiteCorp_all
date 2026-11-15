import type { PlatformRole, PlatformRoleRef, PlatformUser } from "../domain/entities"
import {
  selectActivePlatformRoles,
  selectAllPlatformUserRoles,
  selectPlatformUserEmails,
} from "../infrastructure/platform-users.repository"
import { selectAllUserProfiles } from "../infrastructure/user-profiles.repository"

/**
 * Usuarios de plataforma con sus roles y correo: perfil + roles asignados (en lote) + correo.
 */
export async function loadPlatformUsers(): Promise<PlatformUser[]> {
  const [profiles, emailByUserId] = await Promise.all([
    selectAllUserProfiles(),
    selectPlatformUserEmails(),
  ])

  const allRoleRows = await selectAllPlatformUserRoles(profiles.map((p) => p.id))
  const rolesByUserId = new Map<string, PlatformRoleRef[]>()

  for (const row of allRoleRows) {
    const existing = rolesByUserId.get(row.user_id) || []
    const embedded = Array.isArray(row.platform_roles)
      ? row.platform_roles
      : row.platform_roles
        ? [row.platform_roles as unknown as PlatformRoleRef]
        : []
    rolesByUserId.set(row.user_id, [...existing, ...embedded])
  }

  return profiles.map((profile): PlatformUser => ({
    id: profile.id,
    full_name: profile.full_name,
    username: profile.username,
    email: emailByUserId[profile.id] || "—",
    is_active: profile.is_active,
    created_at: profile.created_at,
    roles: rolesByUserId.get(profile.id) || [],
  }))
}

/** Roles de plataforma ACTIVOS, por nombre (opciones asignables). */
export async function loadActivePlatformRoles(): Promise<PlatformRole[]> {
  return selectActivePlatformRoles()
}
