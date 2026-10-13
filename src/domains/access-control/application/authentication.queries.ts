import { profileIsActive, isPlatformUserFlag } from "../domain/authentication.rules"
import type { AuthenticatedIdentity } from "../domain/entities"
import {
  rpcHasClientPermission,
  rpcIsPlatformSuperAdmin,
  rpcIsPlatformUser,
  selectActiveMemberships,
  selectSessionUser,
} from "../infrastructure/authentication.repository"
import { selectUserProfileById } from "../infrastructure/user-profiles.repository"

/**
 * Control de acceso — Consultas de cuenta y sesión (aplicación).
 *
 * `loadAuthenticatedIdentity` es la ÚNICA secuencia de carga de la identidad: la usan la
 * carga inicial y los eventos `INITIAL_SESSION` / `SIGNED_IN`, que antes repetían los mismos
 * pasos por separado. El orden es el mismo y no cambia ninguna política:
 *
 *   perfil → estado del perfil → (si es inactivo, se informa para cerrar la sesión) →
 *   superadministrador → usuario de plataforma → membresías ACTIVAS
 *
 * Las lecturas toleran fallos (perfil `null`, listas vacías) igual que antes: un problema
 * puntual de red no debe dejar la aplicación sin sesión.
 */

/**
 * Usuario de la sesión actual, o `null` si no hay ninguna.
 *
 * Es la lectura que abre la carga inicial. No autoriza nada y no cambia la sesión: sólo
 * devuelve quién está autenticado.
 */
export async function loadSessionUser() {
  return selectSessionUser()
}

/**
 * Identidad completa de la sesión.
 *
 * `signedOut` se limita a INFORMAR de que el perfil está inactivo: quien cierra la sesión es
 * el comando `signOut`, desde la presentación, conservando el mismo orden de efectos que ya
 * tenía el proveedor de autenticación.
 */
export async function loadAuthenticatedIdentity(userId: string): Promise<AuthenticatedIdentity> {
  const profile = await selectUserProfileById(userId)
  const isProfileActive = profileIsActive(profile)

  if (!isProfileActive) {
    return {
      profile,
      isProfileActive: false,
      isPlatformSuperAdmin: false,
      isPlatformUser: false,
      memberships: [],
      signedOut: true,
    }
  }

  const isPlatformSuperAdmin = await rpcIsPlatformSuperAdmin()
  const isPlatformUser = isPlatformUserFlag(await rpcIsPlatformUser(), isPlatformSuperAdmin)
  const memberships = await selectActiveMemberships(userId)

  return {
    profile,
    isProfileActive: true,
    isPlatformSuperAdmin,
    isPlatformUser,
    memberships,
    signedOut: false,
  }
}

/**
 * Permiso de CLIENTE del solicitante (Nivel 2) SIN propagar fallos.
 *
 * Un fallo de la comprobación —o la ausencia de permiso— devuelve `false` y NUNCA habilita
 * nada: la autoridad real es la del backend en cada operación. Es la misma política de
 * errores que ya aplicaba el proveedor de autenticación.
 */
export async function loadClientPermissionSafe(permissionCode: string): Promise<boolean> {
  try {
    return await rpcHasClientPermission(permissionCode)
  } catch {
    return false
  }
}
