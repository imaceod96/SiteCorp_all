import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectEmbed,
  selectQuery,
  tableName,
} from "@/integrations/supabase/schema-target"
import type {
  ClientInvitationRow,
  ClientMembershipRow,
  ClientUserRoleRow,
  SendClientInvitationInput,
} from "../domain/entities"

/**
 * Control de acceso — Repositorio de usuarios e invitaciones de un CLIENTE (infraestructura).
 *
 * Único punto que consulta las membresías de un cliente (`tenant_memberships`), sus
 * asignaciones de rol (`tenant_user_roles`) y sus invitaciones (`tenant_invitations`), con la
 * FRONTERA DE NOMENCLATURA resolviendo los nombres físicos: las claves de JavaScript
 * (`tenant_id`, `tenant_membership_id`, `tenant_role_id`) siguen siendo las mismas.
 *
 * Comparte la tabla de invitaciones con las invitaciones de ENTIDAD
 * (`entity-access.repository.ts`), que llevan entidad y alcance: son la misma tabla y el
 * mismo ciclo de vida, pero payloads distintos. Ambos viven en ESTE dominio, de modo que
 * ningún otro dominio escribe `tenant_invitations`.
 *
 * Aislamiento: toda lectura y escritura queda acotada por el cliente indicado Y por RLS. El
 * `company_client_id` del filtro no concede acceso: sólo delimita lo que se pide.
 */

/**
 * Membresías de un cliente, incluidas las INACTIVAS.
 *
 * Es el listado ADMINISTRATIVO: la pantalla muestra el estado de cada usuario, así que no se
 * filtra por `is_active` (a diferencia del selector de accesos, que sólo admite activas).
 */
export async function selectClientMembershipRows(
  companyClientId: string
): Promise<ClientMembershipRow[]> {
  const { data, error } = await supabase
    .from(tableName("memberships"))
    .select(selectQuery(`id,user_id,${selectColumn("clientId")},is_active,created_at`))
    .eq(columnName("clientId"), companyClientId)

  if (error) throw error
  return (data as ClientMembershipRow[] | null) || []
}

/** Asignaciones de rol de las membresías indicadas, con el rol de cliente embebido. */
export async function selectClientUserRoles(
  membershipIds: string[]
): Promise<ClientUserRoleRow[]> {
  if (membershipIds.length === 0) return []

  const { data, error } = await supabase
    .from(tableName("userRoles"))
    .select(
      selectQuery(
        `${selectColumn("membershipId")},${selectColumn("roleId")},${selectEmbed("roles", "tenant_roles")}(name)`
      )
    )
    .in(columnName("membershipId"), membershipIds)

  if (error) throw error
  return (data as ClientUserRoleRow[] | null) || []
}

/** Activación o desactivación de la membresía de un usuario en un cliente. */
export async function updateClientMembershipActive(
  companyClientId: string,
  userId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from(tableName("memberships"))
    .update({ is_active: isActive })
    .eq(columnName("clientId"), companyClientId)
    .eq("user_id", userId)

  if (error) throw error
}

/** Invitaciones de un cliente con su rol embebido, de la más reciente a la más antigua. */
export async function selectClientInvitations(
  companyClientId: string
): Promise<ClientInvitationRow[]> {
  const { data, error } = await supabase
    .from(tableName("invitations"))
    .select(selectQuery(`*, tenant_role:${tableName("roles")}(name)`))
    .eq(columnName("clientId"), companyClientId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as ClientInvitationRow[] | null) || []
}

/**
 * Registro de una invitación a NIVEL DE CLIENTE (sin entidad ni alcance).
 *
 * `invited_by` se omite cuando no hay usuario conocido, igual que antes: la columna queda en
 * su valor por defecto en lugar de escribirse con `null`.
 */
export async function insertClientInvitation(
  input: SendClientInvitationInput,
  expiresAt: string
): Promise<void> {
  const { error } = await supabase.from(tableName("invitations")).insert({
    [columnName("clientId")]: input.clientId,
    email: input.email,
    [columnName("roleId")]: input.roleId,
    invited_by: input.invitedBy,
    status: "pending",
    expires_at: expiresAt,
  })

  if (error) throw error
}

/** Cambio de estado de una invitación (cancelar o reenviar). */
export async function updateClientInvitationStatus(
  invitationId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from(tableName("invitations"))
    .update({ status })
    .eq("id", invitationId)

  if (error) throw error
}
