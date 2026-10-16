import {
  deactivateEntityUserAccess,
  insertEntityInvitation,
  insertEntityUserAccess,
} from "../infrastructure/entity-access.repository"
import { invitationExpiresAt } from "../domain/access.rules"
import type { AssignEntityAccessInput, InviteToEntityInput } from "../domain/entities"

/**
 * Control de acceso — Comandos de usuarios y accesos (aplicación).
 *
 * Asignar, revocar e invitar. Ninguna de estas operaciones amplía permisos: cada una
 * pasa por RLS y por los permisos efectivos del solicitante en la entidad
 * (`users.manage` para asignar y revocar, `users.invite` para invitar), que el backend
 * comprueba de nuevo aunque la interfaz oculte el formulario.
 *
 * La vigencia de la invitación (una semana) se calcula con la regla del dominio.
 */

/** Asigna un acceso DIRECTO a la entidad con rol y alcance. */
export async function assignEntityAccess(input: AssignEntityAccessInput): Promise<void> {
  await insertEntityUserAccess(input)
}

/** Revoca un acceso directo (se desactiva; el registro histórico se conserva). */
export async function deactivateEntityAccess(accessId: string): Promise<void> {
  await deactivateEntityUserAccess(accessId)
}

/** Registra una invitación a la entidad con su vigencia. */
export async function inviteToEntity(
  input: InviteToEntityInput,
  now: Date = new Date()
): Promise<void> {
  await insertEntityInvitation(input, invitationExpiresAt(now))
}
