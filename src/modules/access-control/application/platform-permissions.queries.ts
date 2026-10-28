import { rpcHasPlatformPermission } from "../infrastructure/platform-permissions.repository"

/**
 * Control de acceso — Consultas de permisos de PLATAFORMA (aplicación).
 *
 * Nivel 1 (SiteCorp): un permiso de plataforma NO depende de ninguna entidad ni de
 * ninguna membresía de cliente; lo resuelve el backend a partir de los roles de plataforma
 * del solicitante (y de su condición de superadministrador).
 *
 * `loadPlatformPermission` sólo PREGUNTA por un permiso; no lo concede. La decisión
 * efectiva sigue siendo del backend en cada operación.
 *
 * Igual que en los permisos internos de entidad, se conservan las DOS políticas de error
 * que ya tenían los consumidores, para no cambiar su comportamiento: la que PROPAGA el
 * fallo (dominios que lo tratan como error real) y la que lo traduce a «sin permiso»
 * (pantallas que sólo habilitan botones, donde un fallo NUNCA debe habilitar nada).
 */

/** Permiso de plataforma del solicitante (propaga el error del servidor). */
export async function loadPlatformPermission(permissionCode: string): Promise<boolean> {
  return rpcHasPlatformPermission(permissionCode)
}

/**
 * Permiso de plataforma SIN propagar fallos.
 *
 * Un fallo de la comprobación —o la ausencia de permiso— devuelve `false` y NUNCA
 * habilita nada: la autoridad real es la del backend en cada operación.
 */
export async function loadPlatformPermissionSafe(permissionCode: string): Promise<boolean> {
  try {
    return await rpcHasPlatformPermission(permissionCode)
  } catch {
    return false
  }
}
