import * as React from "react"
import {
  CurrentCompanyClientContext,
  type CompanyClientSummary,
} from "@/contexts/CurrentCompanyClientContext"
import { useAuth } from "@/contexts/AuthContext"

/**
 * ÚNICA fuente de verdad del cliente activo.
 *
 * Sustituye a `CurrentTenantProvider` conservando EXACTAMENTE el mismo
 * comportamiento: estado en memoria, sin persistencia, con el mismo
 * establecimiento, cambio y limpieza. No concede permisos: la autorización real
 * sigue siendo RLS + las RPC de Supabase.
 *
 * ÁMBITO DE SESIÓN: el cliente activo pertenece a UNA sesión. Al cerrar sesión o al entrar
 * otro usuario (mismo navegador, misma pestaña) este estado se limpia, de modo que ninguna
 * pantalla pueda mostrar el nombre del cliente anterior. Una renovación de token del MISMO
 * usuario no lo limpia: no es un cambio de sesión.
 */
export const CurrentCompanyClientProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentCompanyClient, setCurrentCompanyClient] =
    React.useState<CompanyClientSummary | null>(null)
  const { user } = useAuth()
  const activeUserId = user?.id ?? null
  const previousUserIdRef = React.useRef<string | null>(activeUserId)

  const clearCurrentCompanyClient = React.useCallback(() => {
    setCurrentCompanyClient(null)
  }, [])

  // Cambio de usuario autenticado (incluido el paso a «sin sesión»): se descarta el cliente
  // del usuario anterior. Solo estado local de React.
  React.useEffect(() => {
    if (previousUserIdRef.current === activeUserId) return
    previousUserIdRef.current = activeUserId
    setCurrentCompanyClient(null)
  }, [activeUserId])

  return (
    <CurrentCompanyClientContext.Provider
      value={{
        currentCompanyClient,
        setCurrentCompanyClient,
        clearCurrentCompanyClient,
      }}
    >
      {children}
    </CurrentCompanyClientContext.Provider>
  )
}
