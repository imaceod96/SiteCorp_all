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
 * Entidad activa de los módulos internos (memoria + `sessionStorage`/`localStorage`).
 *
 * IMPORTANTE (#25): cuando `user` termina de hidratarse al abrir una ruta interna
 * en una nueva pestaña, `effectiveActiveEntityId` se resuelve de forma SÍNCRONA en el
 * mismo render a partir de `readStoredActiveEntityId(activeUserId)`, evitando que el
 * primer frame con `authReady = true` tenga `activeEntityId === null` y dispare una
 * redirección prematura a `/admin`.
 */
export const CurrentEntityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const activeUserId = user?.id ?? null

  const [currentEntity, setCurrentEntityState] = React.useState<OrganizationEntityRow | null>(null)
  const [activeEntityId, setActiveEntityId] = React.useState<string | null>(() =>
    readStoredActiveEntityId(activeUserId)
  )
  const previousUserIdRef = React.useRef<string | null>(activeUserId)

  const effectiveActiveEntityId = React.useMemo(() => {
    if (activeEntityId) return activeEntityId
    if (activeUserId) {
      return readStoredActiveEntityId(activeUserId)
    }
    return null
  }, [activeEntityId, activeUserId])

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

    // Si había una sesión distinta y se cerró o cambió de usuario, limpia el estado.
    if (prevUserId !== null && prevUserId !== activeUserId) {
      clearStoredActiveEntityId()
      setCurrentEntityState(null)
      setActiveEntityId(null)
      return
    }

    if (!activeUserId) {
      return
    }

    const stored = readStoredActiveEntityId(activeUserId)
    if (stored) {
      setActiveEntityId(stored)
    }
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
        activeEntityId: effectiveActiveEntityId,
        setCurrentEntity,
        enterEntityWorkspace,
        clearCurrentEntity,
      }}
    >
      {children}
    </CurrentEntityContext.Provider>
  )
}
