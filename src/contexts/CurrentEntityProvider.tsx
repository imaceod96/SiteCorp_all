import * as React from "react"
import {
  CurrentEntityContext,
  clearStoredActiveEntityId,
  readStoredActiveEntityId,
  writeStoredActiveEntityId,
  type OrganizationEntityRow,
} from "@/contexts/CurrentEntityContext"
import { useAuth } from "@/contexts/AuthContext"

/**
 * Entidad activa de los módulos internos (memoria + `sessionStorage` por pestaña).
 *
 * ÁMBITO DE SESIÓN: la entidad activa pertenece a UNA sesión de usuario y a UNA
 * pestaña del navegador (`sessionStorage`), de modo que cada pestaña puede trabajar
 * en su propia entidad sin contaminar otras pestañas y conservando `/home`, `/workers`,
 * etc. al recargar. Al cerrar sesión o cambiar de usuario autenticado este estado y
 * su referencia en sesión se limpian de inmediato.
 */
export const CurrentEntityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const activeUserId = user?.id ?? null

  const [currentEntity, setCurrentEntityState] = React.useState<OrganizationEntityRow | null>(null)
  const [activeEntityId, setActiveEntityId] = React.useState<string | null>(() =>
    activeUserId ? readStoredActiveEntityId(activeUserId) : null
  )
  const previousUserIdRef = React.useRef<string | null>(activeUserId)

  // Hidrata si `user` termina de cargar después del montaje inicial del Provider.
  React.useEffect(() => {
    if (previousUserIdRef.current === activeUserId) {
      if (activeUserId && !activeEntityId) {
        const stored = readStoredActiveEntityId(activeUserId)
        if (stored) setActiveEntityId(stored)
      }
      return
    }

    const prevUserId = previousUserIdRef.current
    previousUserIdRef.current = activeUserId

    // Si había sesión anterior o se cerró sesión, limpia cualquier rastro anterior.
    if (prevUserId !== null || !activeUserId) {
      clearStoredActiveEntityId()
      setCurrentEntityState(null)
      setActiveEntityId(null)
      return
    }

    // Primer montaje con sesión autenticada resuelta: restaura solo si coincide con userId.
    const stored = readStoredActiveEntityId(activeUserId)
    setActiveEntityId(stored)
  }, [activeUserId, activeEntityId])

  const setCurrentEntity = React.useCallback(
    (entity: OrganizationEntityRow | null) => {
      setCurrentEntityState(entity)
      if (entity) {
        setActiveEntityId(entity.id)
        if (activeUserId) {
          writeStoredActiveEntityId(activeUserId, entity.id)
        }
      } else {
        setActiveEntityId(null)
        clearStoredActiveEntityId()
      }
    },
    [activeUserId]
  )

  const enterEntityWorkspace = React.useCallback(
    (entityOrId: OrganizationEntityRow | string) => {
      if (typeof entityOrId === "string") {
        const nextId = entityOrId.trim()
        if (!nextId) return
        setCurrentEntityState((prev) => (prev?.id === nextId ? prev : null))
        setActiveEntityId(nextId)
        if (activeUserId) {
          writeStoredActiveEntityId(activeUserId, nextId)
        }
        return
      }

      setCurrentEntityState(entityOrId)
      setActiveEntityId(entityOrId.id)
      if (activeUserId) {
        writeStoredActiveEntityId(activeUserId, entityOrId.id)
      }
    },
    [activeUserId]
  )

  const clearCurrentEntity = React.useCallback(() => {
    setCurrentEntityState(null)
    setActiveEntityId(null)
    clearStoredActiveEntityId()
  }, [])

  return (
    <CurrentEntityContext.Provider
      value={{
        currentEntity,
        activeEntityId,
        setCurrentEntity,
        enterEntityWorkspace,
        clearCurrentEntity,
      }}
    >
      {children}
    </CurrentEntityContext.Provider>
  )
}
