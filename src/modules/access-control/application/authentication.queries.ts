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
 * POLÍTICA DE ERRORES de las lecturas que determinan el NIVEL de acceso: los fallos de
 * infraestructura (red o RPC) de `is_platform_superadmin`, `is_platform_user` y de las
 * membresías PROPAGAN. «No se pudo determinar el privilegio» no es «no tiene el
 * privilegio»: interpretarlos como negativos degradaba a un usuario de plataforma a la
 * interfaz de cliente sin aviso. La lectura del PERFIL sigue siendo tolerante (un perfil
 * `null` no concede nada) y las variantes «seguras» de permisos conservan su política
 * (un fallo se traduce a «sin permiso», nunca a «con permiso»).
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
 *
 * Puede LANZAR si no se puede determinar el nivel de acceso (fallo de red o de RPC): la
 * presentación lo trata como «identidad no resuelta» y ofrece reintentar, en lugar de
 * suponer que el usuario no tiene privilegios.
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
