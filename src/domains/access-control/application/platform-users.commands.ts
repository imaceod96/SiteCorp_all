import type { CreatePlatformUserInput, UpdatePlatformUserInput } from "../domain/entities"
import {
  deletePlatformUserRole,
  insertPlatformUserRole,
  invokeCreatePlatformUser,
} from "../infrastructure/platform-users.repository"
import {
  setUserProfileActive,
  updateUserProfileNames,
} from "../infrastructure/user-profiles.repository"

/**
 * Control de acceso — Comandos de la administración de plataforma (aplicación).
 *
 * Todos propagan el error del backend: la pantalla conserva sus mensajes y nada se da por
 * hecho sin la confirmación del servidor. Ninguna comprobación de la interfaz sustituye a
 * RLS ni a los privilegios de plataforma.
 */

/**
 * ALTA de un usuario de plataforma.
 *
 * Pasa por la Edge Function del backend —el cliente nunca crea usuarios ni maneja claves
 * privilegiadas— y conserva su mensaje de respuesta vacía.
 */
export async function createPlatformUser(input: CreatePlatformUserInput): Promise<void> {
  await invokeCreatePlatformUser(input)
}

/** EDICIÓN de los datos editables de un usuario de plataforma. */
export async function updatePlatformUser(input: UpdatePlatformUserInput): Promise<void> {
  await updateUserProfileNames(input)
}

/** Activación o desactivación del usuario de plataforma. */
export async function setPlatformUserActive(userId: string, isActive: boolean): Promise<void> {
  await setUserProfileActive(userId, isActive)
}

/** Asignación de un rol de plataforma. */
export async function assignPlatformRole(userId: string, roleId: string): Promise<void> {
  await insertPlatformUserRole(userId, roleId)
}

/** Retirada de un rol de plataforma. */
export async function removePlatformRole(userId: string, roleId: string): Promise<void> {
  await deletePlatformUserRole(userId, roleId)
}
