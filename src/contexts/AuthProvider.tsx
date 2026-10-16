import * as React from "react"
import type { User } from "@supabase/supabase-js"
import {
  avatarSignedUrlNeedsRenewal,
  loadAuthenticatedIdentity,
  loadAvatarSignedUrl,
  loadClientPermissionSafe,
  loadPlatformPermissionSafe,
  loadSessionUser,
  signOut as signOutSession,
  subscribeAuthChanges,
  type AuthenticatedIdentity,
} from "@/modules/access-control"
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
 *
 * ORDEN DE PUBLICACIÓN (corrección de la interfaz provisional):
 *   la sesión NO se publica como «lista para decidir interfaz» antes de que la identidad esté
 *   resuelta. Al llegar un evento con usuario se marca `authReady = false` EN EL MISMO turno
 *   en el que se publica el usuario, de modo que la presentación muestra la pantalla de carga
 *   neutral y nunca elige layout por descarte. `authReady` sólo vuelve a `true` cuando la
 *   resolución termina (o no hay sesión que resolver).
 *
 * COORDINACIÓN (sin duplicar la resolución de identidad):
 *   · una ÚNICA función aplica la identidad, la use la carga inicial o un evento de Auth;
 *   · cada resolución lleva un número de orden (`epoch`): una respuesta antigua se descarta
 *     y nunca sobrescribe una sesión más reciente ni reaparece tras un cierre de sesión;
 *   · no se repite la resolución del mismo usuario ya resuelto, ni se solapan dos
 *     resoluciones del mismo usuario a la vez;
 *   · un fallo de la resolución no concede nada: se publica un mensaje de usuario y la
 *     presentación ofrece reintentar (siempre manual, nunca en bucle).
 */

/** Mensaje de usuario del fallo de identidad: deliberadamente genérico, sin detalle técnico. */
const IDENTITY_ERROR_MESSAGE =
  "No se pudo verificar tu identidad. Comprueba tu conexión e inténtalo de nuevo."

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<User | null>(null)
  const [profile, setProfile] = React.useState<AuthProfile | null>(null)
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = React.useState(false)
  const [isPlatformUser, setIsPlatformUser] = React.useState(false)
  const [isProfileActive, setIsProfileActive] = React.useState(true)
  const [memberships, setMemberships] = React.useState<AuthMembership[]>([])
  const [authLoading, setAuthLoading] = React.useState(true)
  const [authReady, setAuthReady] = React.useState(false)
  const [identityError, setIdentityError] = React.useState<string | null>(null)

  // Coordinación de resoluciones (referencias: no provocan renders).
  const mountedRef = React.useRef(true)
  const resolutionEpochRef = React.useRef(0)
  const sessionUserRef = React.useRef<User | null>(null)
  const inFlightUserIdRef = React.useRef<string | null>(null)
  const resolvedUserIdRef = React.useRef<string | null>(null)
  const identityErrorRef = React.useRef<string | null>(null)
  // Ruta guardada del avatar (`profiles.avatar_url`) y caducidad de su URL firmada (ms).
  const storedAvatarRef = React.useRef<string | null>(null)
  const avatarExpiresAtRef = React.useRef(0)

  /**
   * Resuelve la URL FIRMADA del avatar a partir de la ruta guardada. El bucket es privado, así
   * que `profiles.avatar_url` nunca se pinta directamente.
   *
   * Un fallo de firma NO rompe la pantalla: se publica `null` y la interfaz muestra las
   * iniciales. Nunca se concede nada por el hecho de tener avatar.
   */
  const applyAvatar = React.useCallback(async (storedAvatar: string | null) => {
    storedAvatarRef.current = storedAvatar

    if (!storedAvatar) {
      avatarExpiresAtRef.current = 0
      if (mountedRef.current) setAvatarUrl(null)
      return
    }

    try {
      const signed = await loadAvatarSignedUrl(storedAvatar)
      if (!mountedRef.current) return
      avatarExpiresAtRef.current = signed?.expiresAt ?? 0
      setAvatarUrl(signed?.url ?? null)
    } catch {
      if (!mountedRef.current) return
      avatarExpiresAtRef.current = 0
      setAvatarUrl(null)
    }
  }, [])

  /**
   * Renueva la URL firmada si ya alcanzó el 80 % de su vida útil. Se invoca al recuperar el
   * foco de la ventana y de forma periódica: así una imagen visible no caduca nunca en
   * pantalla, y no se firma de más.
   */
  const renewAvatarIfNeeded = React.useCallback(() => {
    const storedAvatar = storedAvatarRef.current
    if (!storedAvatar) return
    if (!avatarSignedUrlNeedsRenewal(avatarExpiresAtRef.current, Date.now())) return
    void applyAvatar(storedAvatar)
  }, [applyAvatar])

  /** Reintento manual (o publicación inmediata de un avatar recién subido o eliminado). */
  const refreshAvatar = React.useCallback(
    async (storedAvatar?: string | null) => {
      await applyAvatar(storedAvatar === undefined ? storedAvatarRef.current : storedAvatar)
    },
    [applyAvatar]
  )

  /**
   * Fallo de la resolución de identidad: se registra para diagnóstico y se publica un mensaje
   * de usuario. NUNCA se concede un privilegio por defecto ni se elige interfaz.
   */
  const publishIdentityFailure = React.useCallback((error: unknown) => {
    console.error("Auth identity resolution error:", error)
    identityErrorRef.current = IDENTITY_ERROR_MESSAGE
    setIdentityError(IDENTITY_ERROR_MESSAGE)
    setAuthReady(false)
  }, [])

  /**
   * ÚNICA aplicación de la identidad resuelta por el dominio.
   *
   * Los cinco estados de identidad se aplican conjuntamente (mismo turno de render), y sólo
   * al final se marca la identidad como preparada.
   */
  const resolveIdentity = React.useCallback(
    async (sessionUser: User) => {
      const epoch = resolutionEpochRef.current + 1
      resolutionEpochRef.current = epoch
      inFlightUserIdRef.current = sessionUser.id
      sessionUserRef.current = sessionUser

      // Nada de layout hasta que la identidad esté determinada.
      setAuthReady(false)
      setIdentityError(null)
      identityErrorRef.current = null
      setUser(sessionUser)

      try {
        const identity: AuthenticatedIdentity = await loadAuthenticatedIdentity(sessionUser.id)

        // Respuesta antigua: otra sesión (o un cierre de sesión) la ha invalidado.
        if (!mountedRef.current || epoch !== resolutionEpochRef.current) return

        if (identity.signedOut) {
          await signOutSession()
          return
        }

        setProfile(identity.profile)
        setIsProfileActive(identity.isProfileActive)
        setIsPlatformSuperAdmin(identity.isPlatformSuperAdmin)
        setIsPlatformUser(identity.isPlatformUser)
        setMemberships(identity.memberships)

        resolvedUserIdRef.current = sessionUser.id
        setAuthReady(true)

        // El avatar no bloquea la publicación de la identidad: se resuelve en paralelo y
        // mientras tanto se muestran las iniciales.
        void applyAvatar(identity.profile?.avatar_url ?? null)
      } catch (error) {
        // Un fallo no se interpreta como «no tiene privilegios».
        if (!mountedRef.current || epoch !== resolutionEpochRef.current) return
        publishIdentityFailure(error)
      } finally {
        if (epoch === resolutionEpochRef.current) inFlightUserIdRef.current = null
      }
    },
    [publishIdentityFailure]
  )

  /**
   * ¿Hace falta resolver? No si el mismo usuario ya está resuelto, ni si su resolución está
   * en curso. Tras un fallo sí se permite reintentar con el siguiente evento.
   */
  const needsResolution = React.useCallback((sessionUser: User): boolean => {
    if (inFlightUserIdRef.current === sessionUser.id) return false
    return resolvedUserIdRef.current !== sessionUser.id || identityErrorRef.current !== null
  }, [])

  React.useEffect(() => {
    mountedRef.current = true

    /** Estado en blanco al cerrar sesión (se conserva literalmente). */
    const resetAuthState = () => {
      // Invalida cualquier resolución pendiente: su resultado ya no puede pintar nada.
      resolutionEpochRef.current += 1
      inFlightUserIdRef.current = null
      resolvedUserIdRef.current = null
      sessionUserRef.current = null
      identityErrorRef.current = null

      storedAvatarRef.current = null
      avatarExpiresAtRef.current = 0

      setUser(null)
      setProfile(null)
      setAvatarUrl(null)
      setIsPlatformSuperAdmin(false)
      setIsPlatformUser(false)
      setIsProfileActive(true)
      setMemberships([])
      setIdentityError(null)
      setAuthLoading(false)
      setAuthReady(true)
    }

    const loadAuth = async () => {
      try {
        const sessionUser = await loadSessionUser()
        if (!mountedRef.current) return

        if (sessionUser) {
          await resolveIdentity(sessionUser)
        } else {
          // Sin sesión no hay identidad que resolver: la pantalla de acceso puede mostrarse.
          setAuthReady(true)
        }
      } catch (error) {
        if (!mountedRef.current) return
        publishIdentityFailure(error)
      } finally {
        if (mountedRef.current) {
          setAuthLoading(false)
        }
      }
    }

    loadAuth()

    const unsubscribe = subscribeAuthChanges(async (event, sessionUser) => {
      if (!mountedRef.current) return

      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        if (sessionUser && needsResolution(sessionUser)) {
          await resolveIdentity(sessionUser)
        }
      } else if (event === "SIGNED_OUT") {
        resetAuthState()
      }
    })

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [needsResolution, publishIdentityFailure, resolveIdentity])

  /**
   * Renovación de la URL firmada del avatar: al recuperar el foco de la ventana, al volver a
   * la pestaña y de forma periódica. Sólo vuelve a firmar cuando la URL ha alcanzado el 80 %
   * de su vida útil, así que no se generan firmas innecesarias.
   */
  React.useEffect(() => {
    const handleWake = () => {
      if (document.visibilityState === "visible") renewAvatarIfNeeded()
    }

    window.addEventListener("focus", handleWake)
    document.addEventListener("visibilitychange", handleWake)
    const timer = window.setInterval(handleWake, 60_000)

    return () => {
      window.removeEventListener("focus", handleWake)
      document.removeEventListener("visibilitychange", handleWake)
      window.clearInterval(timer)
    }
  }, [renewAvatarIfNeeded])

  /**
   * Reintento manual: vuelve a resolver la identidad de la sesión conocida. No hay reintento
   * automático, así que no puede entrar en bucle.
   */
  const retryIdentity = React.useCallback(() => {
    const sessionUser = sessionUserRef.current

    if (!sessionUser) {
      identityErrorRef.current = null
      setIdentityError(null)
      setAuthReady(true)
      return
    }

    void resolveIdentity(sessionUser)
  }, [resolveIdentity])

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
        avatarUrl,
        isPlatformSuperAdmin,
        isPlatformUser,
        isProfileActive,
        memberships,
        authLoading,
        authReady,
        identityError,
        retryIdentity,
        refreshAvatar,
        logout,
        hasPlatformPermission,
        hasTenantPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
