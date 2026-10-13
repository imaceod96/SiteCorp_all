import * as React from "react"
import type { User } from "@supabase/supabase-js"
import type {
  AuthMembershipRecord,
  AuthProfileRecord,
  AuthTenantSummary as AuthTenantSummaryRecord,
} from "@/domains/access-control"

/**
 * Contrato PÚBLICO del contexto de autenticación.
 *
 * Las formas del perfil y de la membresía son las del dominio de control de acceso: NO se
 * duplican aquí. Los nombres públicos se conservan como alias, de modo que ningún consumidor
 * cambia su importación y el contrato sigue siendo el mismo:
 *
 *   import { useAuth, type AuthProfile } from "@/contexts/AuthContext"
 *
 * La autenticación (sesión, inicio y cierre de sesión, contraseña) vive en el dominio; este
 * contexto sólo publica el estado ya cargado a la presentación.
 */
export type AuthProfile = AuthProfileRecord

export type AuthTenantSummary = AuthTenantSummaryRecord

export type AuthMembership = AuthMembershipRecord

interface AuthContextType {
  user: User | null
  profile: AuthProfile | null
  isPlatformSuperAdmin: boolean
  isPlatformUser: boolean
  isProfileActive: boolean
  memberships: AuthMembership[]
  authLoading: boolean
  authReady: boolean
  logout: () => Promise<void>
  hasPlatformPermission: (code: string) => Promise<boolean>
  hasTenantPermission: (code: string) => Promise<boolean>
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

export const useAuth = (): AuthContextType => {
  const context = React.useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export { AuthContext }
