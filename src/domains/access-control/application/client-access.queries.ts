import type { ClientInvitation, ClientUser } from "../domain/entities"
import { accessRoleLabel } from "../domain/access.rules"
import {
  selectClientInvitations,
  selectClientMembershipRows,
  selectClientUserRoles,
} from "../infrastructure/client-access.repository"
import { selectUserProfiles } from "../infrastructure/entity-access.repository"

/**
 * Control de acceso — Consultas de usuarios e invitaciones de un cliente (aplicación).
 *
 * Compone el listado administrativo de un cliente con LAS MISMAS lecturas y el MISMO
 * aplanado que hacía la pantalla: membresías (sin filtrar por estado) + perfiles de sus
 * usuarios + roles asignados a cada membresía.
 *
 * Nada de esto autoriza: el aislamiento entre clientes lo impone RLS, y el cliente activo
 * sólo acota lo que se pide.
 */

/**
 * Usuarios de un cliente con su rol y estado de membresía.
 *
 * Un usuario sin perfil visible se muestra igual que antes (nombre «Usuario», usuario
 * «sin usuario»): no se inventan datos ni se oculta la fila.
 */
export async function loadClientUsers(companyClientId: string): Promise<ClientUser[]> {
  const memberships = await selectClientMembershipRows(companyClientId)

  const [profiles, roleRows] = await Promise.all([
    selectUserProfiles(memberships.map((member) => member.user_id)),
    selectClientUserRoles(memberships.map((member) => member.id)),
  ])

  const profilesById = profiles.reduce<Record<string, (typeof profiles)[number]>>(
    (map, profile) => {
      map[profile.id] = profile
      return map
    },
    {}
  )

  const rolesByMembership = roleRows.reduce<Record<string, { name: string | null } | null>>(
    (map, roleAssignment) => {
      map[roleAssignment.tenant_membership_id] = roleAssignment.tenant_roles
      return map
    },
    {}
  )

  return memberships.map((member) => {
    const profile = profilesById[member.user_id]

    return {
      id: member.user_id,
      full_name: profile?.full_name || "Usuario",
      username: profile?.username || "sin usuario",
      email: profile?.username || "",
      is_active: member.is_active,
      membership_status: member.is_active ? "active" : "inactive",
      invitation_status: "none",
      role_name: rolesByMembership[member.id]?.name || "Sin rol",
      created_at: member.created_at,
    }
  })
}

/**
 * Invitaciones de un cliente, ya compuestas para el listado.
 *
 * El rol lo enmascara el backend (`list_company_client_invitations`) para quien no puede
 * gestionar roles: aquí se etiqueta con la MISMA regla que los accesos de usuario, de modo
 * que la interfaz distingue «restringido» de «sin rol».
 */
export async function loadClientInvitations(
  companyClientId: string
): Promise<ClientInvitation[]> {
  const rows = await selectClientInvitations(companyClientId)

  return rows.map((invitation) => ({
    id: invitation.invitation_id,
    email: invitation.email,
    role_name: accessRoleLabel(invitation),
    status: invitation.status,
    expires_at: invitation.expires_at,
    created_at: invitation.created_at,
  }))
}
