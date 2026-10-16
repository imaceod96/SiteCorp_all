import { AVATAR_SIGNED_URL_TTL_SECONDS, avatarPathFromStored } from "../domain/account.rules"
import { createAvatarSignedUrl } from "../infrastructure/authentication.repository"
import type { SignedAvatarUrl } from "../domain/entities"

/**
 * Control de acceso — Consultas de la CUENTA propia (aplicación).
 *
 * Resuelve la URL con la que la interfaz pinta un avatar. El bucket es privado, así que la
 * única URL válida es la FIRMADA y TEMPORAL: se pide al vuelo y se descarta al caducar. Nunca
 * se devuelve ni se almacena una URL pública.
 *
 * Un avatar ausente, un objeto sin permiso de lectura o un fallo de firma devuelven `null`: la
 * interfaz muestra entonces las iniciales y la pantalla sigue funcionando.
 */
export async function loadAvatarSignedUrl(
  storedAvatar: string | null | undefined,
  expiresInSeconds: number = AVATAR_SIGNED_URL_TTL_SECONDS
): Promise<SignedAvatarUrl | null> {
  const path = avatarPathFromStored(storedAvatar)
  if (!path) return null

  return createAvatarSignedUrl(path, expiresInSeconds)
}
