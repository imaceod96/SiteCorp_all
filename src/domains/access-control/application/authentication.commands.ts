import type { User as AuthSessionUser } from "@supabase/supabase-js"
import type { ProfileAccountInput } from "../domain/entities"
import {
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

/** Edición de los datos de la cuenta propia (nombre, usuario y avatar declarado). */
export async function updateOwnProfile(
  userId: string,
  input: ProfileAccountInput
): Promise<void> {
  await updateUserProfileAccount(userId, input)
}

/** Sustitución del avatar propio: sube el archivo y guarda su URL pública en el perfil. */
export async function updateOwnAvatar(userId: string, file: File): Promise<void> {
  const avatarUrl = await uploadOwnAvatar(userId, file)
  await updateUserProfileAvatar(userId, avatarUrl)
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
