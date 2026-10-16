/**
 * Control de acceso — Reglas puras de la CUENTA propia (dominio).
 *
 * El bucket de avatares es PRIVADO: `profiles.avatar_url` guarda la RUTA del objeto
 * (`<user_id>/<archivo>`), nunca una URL. La imagen que pinta la interfaz se resuelve con una
 * URL TEMPORAL (firmada) que se renueva antes de caducar, de modo que ninguna URL con
 * caducidad queda almacenada como identificador permanente.
 */

/** Vida útil de la URL firmada del avatar, en segundos. */
export const AVATAR_SIGNED_URL_TTL_SECONDS = 3600

/**
 * Proporción de la vida útil tras la cual la URL firmada se considera renovable (80 %).
 * Renovar antes de ese punto evita que una imagen visible caduque entre dos comprobaciones.
 */
const AVATAR_SIGNED_URL_RENEWAL_RATIO = 0.8

/** Nombre de archivo admitido en el bucket: sin separadores de ruta ni caracteres raros. */
const UNSAFE_FILE_NAME_CHARS = /[^A-Za-z0-9._-]/g

/** Tamaño máximo del avatar, en bytes (mismo límite que el bucket privado). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** Tipos MIME admitidos por el bucket privado de avatares. */
export const AVATAR_ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

/**
 * Validación del archivo elegido por el usuario, o `null` si es admisible.
 *
 * Es un aviso TEMPRANO para no subir lo que el bucket va a rechazar; la autoridad sigue siendo
 * el límite y los tipos configurados en Storage.
 */
export function avatarFileError(file: { type: string; size: number }): string | null {
  if (!(AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "La imagen debe ser PNG, JPG o WEBP."
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "La imagen no puede superar 2 MB."
  }
  return null
}

/**
 * Ruta del objeto de avatar de un usuario: `<user_id>/<archivo>`.
 *
 * El saneado del nombre es deliberadamente conservador: el nombre del archivo lo elige el
 * usuario, así que no puede introducir separadores de ruta (un `../` escaparía de su carpeta).
 */
export function avatarObjectPath(userId: string, fileName: string): string {
  const safeName = fileName
    .trim()
    .replace(UNSAFE_FILE_NAME_CHARS, "_")
    .replace(/^\.+/, "")

  return `${userId}/${safeName || "avatar"}`
}

/**
 * Ruta del objeto a partir del valor guardado en `profiles.avatar_url`.
 *
 * Acepta la ruta relativa y también las URLs heredadas (públicas o firmadas) del formato
 * anterior: un avatar guardado antes de este cambio se sigue resolviendo, sin migrar datos.
 */
export function avatarPathFromStored(value: string | null | undefined): string | null {
  if (!value) return null

  const raw = value.trim()
  if (!raw) return null

  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "") || null
  }

  const match = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/avatars\/(.+)$/i)
  if (!match) return null

  const path = decodeURIComponent(match[1].split("?")[0].split("#")[0]).replace(/^\/+/, "")
  return path || null
}

/**
 * ¿Debe renovarse la URL firmada? `expiresAt` en milisegundos (0 = no hay URL vigente).
 * Se renueva al alcanzar el 80 % de la vida útil, y también si no hay caducidad conocida.
 */
export function avatarSignedUrlNeedsRenewal(expiresAt: number, now: number): boolean {
  if (!expiresAt) return true

  const renewalThreshold = expiresAt - AVATAR_SIGNED_URL_TTL_SECONDS * 1000 * (1 - AVATAR_SIGNED_URL_RENEWAL_RATIO)
  return now >= renewalThreshold
}
