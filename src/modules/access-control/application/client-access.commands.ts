import { invitationExpiresAt } from "../domain/access.rules"
import type { SendClientInvitationInput, UpdatePlatformUserInput } from "../domain/entities"
import {
  insertClientInvitation,
  updateClientInvitationStatus,
  updateClientMembershipActive,
} from "../infrastructure/client-access.repository"
import { updateUserProfileNames } from "../infrastructure/user-profiles.repository"

/**
 * Control de acceso — Comandos de usuarios e invitaciones de un cliente (aplicación).
 *
 * Mismos efectos y mismos errores propagados que la pantalla original. La vigencia de la
 * invitación NO se escribe a mano: se pide a la regla única del dominio
 * (`invitationExpiresAt`, una semana), la misma que usan las invitaciones de entidad.
 */

/** Edición de los datos editables de un usuario (nunca el correo ni la contraseña). */
export async function updateClientUser(input: UpdatePlatformUserInput): Promise<void> {
  await updateUserProfileNames(input)
}

/** Activación o desactivación de la membresía de un usuario en un cliente. */
export async function setClientMembershipActive(
  companyClientId: string,
  userId: string,
  isActive: boolean
): Promise<void> {
  await updateClientMembershipActive(companyClientId, userId, isActive)
}

/**
 * Envío de una invitación de cliente.
 *
 * El ROL se conserva tal cual llega (`null` cuando no se eligió ninguno): la pantalla ofrece
 * la misma selección que antes y no se añade ninguna carga de roles.
 */
export async function sendClientInvitation(input: SendClientInvitationInput): Promise<void> {
  await insertClientInvitation(input, invitationExpiresAt())
}

/** Cancelación de una invitación pendiente. */
export async function cancelClientInvitation(invitationId: string): Promise<void> {
  await updateClientInvitationStatus(invitationId, "cancelled")
}

/** Reenvío de una invitación: vuelve a quedar pendiente. */
export async function resendClientInvitation(invitationId: string): Promise<void> {
  await updateClientInvitationStatus(invitationId, "pending")
}
