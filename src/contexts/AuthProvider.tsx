import * as React from "react"
import { supabase } from "@/lib/supabase"
import { rpcName, selectQuery, tableName } from "@/integrations/supabase/schema-target"
import type { User } from "@supabase/supabase-js"
import { loadPlatformPermissionSafe } from "@/domains/access-control"
import {
  AuthContext,
  type AuthProfile,
  type AuthMembership,
} from "@/contexts/AuthContext"

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

    const loadAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return

        if (session?.user) {
          setUser(session.user)

          // Load profile
          const { data: profileData } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single()

          if (mounted) {
            setProfile(profileData || null)
            const active = profileData?.is_active !== false
            setIsProfileActive(active)
            if (!active) {
              await supabase.auth.signOut()
              return
            }
          }

          // Load SuperAdmin status
          const { data: superAdminData } = await supabase.rpc("is_platform_superadmin")
          if (mounted) {
            setIsPlatformSuperAdmin(!!superAdminData)
          }

          // Load Platform User status (at least one active Platform Role)
          const { data: platformUserData } = await supabase.rpc("is_platform_user")
          if (mounted) {
            setIsPlatformUser(!!platformUserData || !!superAdminData)
          }

          // Load memberships
          const { data: membershipsData } = await supabase
            .from(tableName("memberships"))
            .select(selectQuery(`*, tenant:${tableName("clients")}(*)`))
            .eq("user_id", session.user.id)
            .eq("is_active", true)

          if (mounted) {
            setMemberships(membershipsData || [])
          }
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          if (session?.user) {
            setUser(session.user)
            const { data: profileData } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .single()
            setProfile(profileData || null)
            const active = profileData?.is_active !== false
            setIsProfileActive(active)
            if (!active) {
              await supabase.auth.signOut()
              return
            }

            const { data: superAdminData } = await supabase.rpc("is_platform_superadmin")
            setIsPlatformSuperAdmin(!!superAdminData)

            const { data: platformUserData } = await supabase.rpc("is_platform_user")
            setIsPlatformUser(!!platformUserData || !!superAdminData)

            const { data: membershipsData } = await supabase
              .from(tableName("memberships"))
              .select(selectQuery(`*, tenant:${tableName("clients")}(*)`))
              .eq("user_id", session.user.id)
              .eq("is_active", true)
            setMemberships(membershipsData || [])
          }
        } else if (event === "SIGNED_OUT") {
          setUser(null)
          setProfile(null)
          setIsPlatformSuperAdmin(false)
          setIsPlatformUser(false)
          setIsProfileActive(true)
          setMemberships([])
          setAuthLoading(false)
          setAuthReady(true)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
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

  const hasTenantPermission = async (code: string): Promise<boolean> => {
    try {
      if (isPlatformSuperAdmin) return true
      const { data, error } = await supabase.rpc(rpcName("hasClientPermission"), {
        // Parámetro PRESERVADO por la migración SQL (decisión nº 2).
        permission_code: code,
      })
      if (error) return false
      return !!data
    } catch {
      return false
    }
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
