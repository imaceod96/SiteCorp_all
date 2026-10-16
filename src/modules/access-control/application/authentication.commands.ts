import type { User as AuthSessionUser } from "@supabase/supabase-js"
import { avatarPathFromStored } from "../domain/account.rules"
import type { AvatarPath, ProfileAccountInput } from "../domain/entities"
import {
  deleteAvatarObject,
  signInWithPassword,
  signOut as signOutSession,
  subscribeAuthStateChanges,
  updateOwnPassword,
  uploadOwnAvatar,
} from "../infrastructure/authentication.repository"
import {
  updateUserProfileAccount,
  updateUserProfileAvatar,
} from "../infrastructure/user-profiles.repository"

/**
 * Control de acceso — Comandos de cuenta y sesión (aplicación).
 *
 * Inicio y cierre de sesión, cambio de contraseña y edición de la cuenta propia. Ninguno
 * concede nada por sí mismo: Supabase Auth y RLS siguen siendo la autoridad, y la
 * configuración de autenticación (proveedores, redirecciones, plantillas) no se toca.
 */

/** Inicio de sesión: devuelve el mensaje de error del backend o `null` si se abrió sesión. */
export async function signIn(email: string, password: string): Promise<string | null> {
  return signInWithPassword(email, password)
}

/** Cierre de la sesión actual. */
export async function signOut(): Promise<void> {
  await signOutSession()
}

/**
 * Cambio de la contraseña del propio usuario.
 *
 * Propaga el error: la pantalla conserva su mensaje de usuario. La validación de coincidencia
 * de las contraseñas nuevas es una regla pura del dominio (`passwordChangeError`).
 */
export async function changePassword(newPassword: string): Promise<void> {
  await updateOwnPassword(newPassword)
}

/** Edición de los datos de la cuenta propia (nombre y usuario). El avatar no va por aquí. */
export async function updateOwnProfile(
  userId: string,
  input: ProfileAccountInput
): Promise<void> {
  await updateUserProfileAccount(userId, input)
}

/**
 * Sustitución del avatar propio.
 *
 * Orden de la operación (importa para no dejar referencias rotas):
 *   1. sube el archivo al bucket privado y obtiene su RUTA;
 *   2. guarda la ruta en `profiles.avatar_url` (nunca una URL firmada);
 *   3. retira el objeto anterior, si lo había y es distinto.
 *
 * Devuelve la ruta nueva para que la interfaz pueda resolver su URL firmada. Un fallo al
 * retirar el objeto anterior NO invalida el avatar nuevo: sólo deja un objeto huérfano en la
 * carpeta del propio usuario.
 */
export async function updateOwnAvatar(
  userId: string,
  file: File,
  previousStoredAvatar?: string | null
): Promise<AvatarPath> {
  const avatarPath = await uploadOwnAvatar(userId, file)
  await updateUserProfileAvatar(userId, avatarPath)

  const previousPath = avatarPathFromStored(previousStoredAvatar)
  if (previousPath && previousPath !== avatarPath) {
    await deleteAvatarObject(previousPath).catch(() => undefined)
  }

  return avatarPath
}

/**
 * Baja del avatar propio: se limpia la ruta del perfil ANTES de retirar el objeto, de modo que
 * un fallo de Storage nunca deja el perfil apuntando a un archivo inexistente.
 */
export async function removeOwnAvatar(
  userId: string,
  currentStoredAvatar?: string | null
): Promise<void> {
  await updateUserProfileAvatar(userId, null)

  const currentPath = avatarPathFromStored(currentStoredAvatar)
  if (currentPath) {
    await deleteAvatarObject(currentPath).catch(() => undefined)
  }
}

/**
 * Suscripción a los cambios de estado de Auth.
 *
 * Devuelve la función de baja. El manejador recibe el evento y el usuario de la sesión (o
 * `null`); la interpretación de cada evento (`INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`…)
 * es de la presentación: el dominio no conoce React.
 */
export function subscribeAuthChanges(
  handler: (event: string, user: AuthSessionUser | null) => void
): () => void {
  return subscribeAuthStateChanges(handler)
}
