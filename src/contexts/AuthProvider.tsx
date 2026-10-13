import * as React from "react"
import type { User } from "@supabase/supabase-js"
import {
  loadAuthenticatedIdentity,
  loadClientPermissionSafe,
  loadPlatformPermissionSafe,
  loadSessionUser,
  signOut as signOutSession,
  subscribeAuthChanges,
  type AuthenticatedIdentity,
} from "@/domains/access-control"
import {
  AuthContext,
  type AuthProfile,
  type AuthMembership,
} from "@/contexts/AuthContext"

/**
 * Proveedor de autenticación (presentación).
 *
 * NO habla con Supabase: toda la sesión, la identidad y los permisos los resuelve el dominio
 * de control de acceso. Aquí sólo se mantiene el ESTADO que publica el contexto y se decide
 * qué evento actualiza qué, con el MISMO contrato público de `AuthContext` y el mismo
 * comportamiento que antes:
 *
 *   · la carga inicial y los eventos `INITIAL_SESSION` / `SIGNED_IN` aplican la MISMA
 *     secuencia de identidad (antes estaba duplicada);
 *   · un perfil inactivo cierra la sesión;
 *   · `SIGNED_OUT` deja el estado en blanco;
 *   · el superadministrador conserva su atajo en los dos permisos;
 *   · un fallo de la comprobación de permisos devuelve `false` y nunca habilita nada.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<User | null>(null)
  const [profile, setProfile] = React.useState<AuthProfile | null>(null)
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = React.useState(false)
  const [isPlatformUser, setIsPlatformUser] = React.useState(false)
  const [isProfileActive, setIsProfileActive] = React.useState(true)
  const [memberships, setMemberships] = React.useState<AuthMembership[]>([])
  const [authLoading, setAuthLoading] = React.useState(true)
  const [authReady, setAuthReady] = React.useState(false)

  React.useEffect(() => {
    let mounted = true

    /** Estado en blanco al cerrar sesión (se conserva literalmente). */
    const resetAuthState = () => {
      setUser(null)
      setProfile(null)
      setIsPlatformSuperAdmin(false)
      setIsPlatformUser(false)
      setIsProfileActive(true)
      setMemberships([])
      setAuthLoading(false)
      setAuthReady(true)
    }

    /**
     * Aplica la identidad cargada por el dominio.
     *
     * Si el perfil está inactivo se cierra la sesión, y NO se tocan los indicadores de
     * plataforma ni las membresías: es el mismo orden de efectos que ya tenía el proveedor.
     */
    const applyIdentity = async (identity: AuthenticatedIdentity) => {
      if (!mounted) return

      setProfile(identity.profile)
      setIsProfileActive(identity.isProfileActive)

      if (identity.signedOut) {
        await signOutSession()
        return
      }

      setIsPlatformSuperAdmin(identity.isPlatformSuperAdmin)
      setIsPlatformUser(identity.isPlatformUser)
      setMemberships(identity.memberships)
    }

    const loadAuth = async () => {
      try {
        const sessionUser = await loadSessionUser()
        if (!mounted) return

        if (sessionUser) {
          setUser(sessionUser)
          await applyIdentity(await loadAuthenticatedIdentity(sessionUser.id))
        }
      } catch (error) {
        console.error("Auth loading error:", error)
      } finally {
        if (mounted) {
          setAuthLoading(false)
          setAuthReady(true)
        }
      }
    }

    loadAuth()

    const unsubscribe = subscribeAuthChanges(async (event, sessionUser) => {
      if (!mounted) return

      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (sessionUser) {
          setUser(sessionUser)
          await applyIdentity(await loadAuthenticatedIdentity(sessionUser.id))
        }
      } else if (event === "SIGNED_OUT") {
        resetAuthState()
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const logout = async () => {
    await signOutSession()
  }

  /**
   * Permiso de plataforma del usuario. La consulta se delega en el dominio de control de
   * acceso —único lugar desde el que se invoca `has_platform_permission`— y se conserva el
   * atajo del superadministrador para no consultar lo que ya se sabe.
   *
   * El contrato público de `AuthContext` no cambia: la misma firma y la misma política de
   * errores (un fallo de la comprobación devuelve `false`, nunca habilita nada).
   */
  const hasPlatformPermission = async (code: string): Promise<boolean> => {
    if (isPlatformSuperAdmin) return true
    return loadPlatformPermissionSafe(code)
  }

  /**
   * Permiso de cliente del usuario (Nivel 2). También se delega en el dominio, con la misma
   * política de errores: un fallo se traduce a «sin permiso».
   */
  const hasTenantPermission = async (code: string): Promise<boolean> => {
    if (isPlatformSuperAdmin) return true
    return loadClientPermissionSafe(code)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isPlatformSuperAdmin,
        isPlatformUser,
        isProfileActive,
        memberships,
        authLoading,
        authReady,
        logout,
        hasPlatformPermission,
        hasTenantPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
