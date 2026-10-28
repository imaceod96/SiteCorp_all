import * as React from "react"
import {
  CurrentEntityContext,
  type OrganizationEntityRow,
} from "@/contexts/CurrentEntityContext"
import { useAuth } from "@/contexts/AuthContext"

/**
 * Entidad activa de los módulos internos (estado en memoria, sin persistencia).
 *
 * ÁMBITO DE SESIÓN: la entidad activa pertenece a UNA sesión. Al cerrar sesión o al entrar
 * otro usuario (mismo navegador, misma pestaña) este estado se limpia, de modo que ningún
 * módulo interno pueda quedar apuntando a la entidad del usuario anterior. Una renovación de
 * token del MISMO usuario no lo limpia: no es un cambio de sesión.
 */
export const CurrentEntityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentEntity, setCurrentEntity] = React.useState<OrganizationEntityRow | null>(null)
  const { user } = useAuth()
  const activeUserId = user?.id ?? null
  const previousUserIdRef = React.useRef<string | null>(activeUserId)

  const clearCurrentEntity = React.useCallback(() => {
    setCurrentEntity(null)
  }, [])

  // Cambio de usuario autenticado (incluido el paso a «sin sesión»): se descarta la entidad
  // del usuario anterior. Solo estado local de React.
  React.useEffect(() => {
    if (previousUserIdRef.current === activeUserId) return
    previousUserIdRef.current = activeUserId
    setCurrentEntity(null)
  }, [activeUserId])

  return (
    <CurrentEntityContext.Provider
      value={{
        currentEntity,
        setCurrentEntity,
        clearCurrentEntity,
      }}
    >
      {children}
    </CurrentEntityContext.Provider>
  )
}
