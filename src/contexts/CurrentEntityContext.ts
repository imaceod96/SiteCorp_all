import * as React from "react"
import { useLocation, useParams } from "react-router-dom"

export interface OrganizationEntityRow {
  id: string
  tenant_id: string
  parent_id: string | null
  entity_type: string
  name: string
  code: string
  regime_id: string
  status: string | null
  description: string | null
  created_at: string | null
  updated_at: string | null
  is_active: boolean | null
  is_sitecorp_account: boolean | null
  account_is_active: boolean | null
  account_code: string | null
  address: string | null
  municipality: string | null
  province: string | null
  postal_code: string | null
  organism: string | null
  branch: string | null
  labor_identification_code: string | null
  revolution_year: string | null
}

const ACTIVE_ENTITY_SESSION_KEY = "sitecorp.activeEntitySession.v1"

interface StoredEntitySession {
  userId: string
  entityId: string
}

function parseStoredEntitySession(
  raw: string | null,
  expectedUserId?: string | null
): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEntitySession>
    if (
      typeof parsed?.userId !== "string" ||
      typeof parsed?.entityId !== "string" ||
      !parsed.entityId
    ) {
      return null
    }
    if (expectedUserId && parsed.userId !== expectedUserId) {
      return null
    }
    return parsed.entityId
  } catch {
    return null
  }
}

export function readStoredActiveEntityId(expectedUserId?: string | null): string | null {
  if (typeof window === "undefined") return null
  try {
    const fromSession = window.sessionStorage
      ? parseStoredEntitySession(
          window.sessionStorage.getItem(ACTIVE_ENTITY_SESSION_KEY),
          expectedUserId
        )
      : null
    if (fromSession) return fromSession

    const rawLocal = window.localStorage
      ? window.localStorage.getItem(ACTIVE_ENTITY_SESSION_KEY)
      : null
    const fromLocal = parseStoredEntitySession(rawLocal, expectedUserId)
    if (fromLocal && rawLocal && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(ACTIVE_ENTITY_SESSION_KEY, rawLocal)
      } catch {
        // Ignorar errores de cuota
      }
    }
    return fromLocal
  } catch {
    return null
  }
}

export function writeStoredActiveEntityId(userId: string, entityId: string): void {
  if (typeof window === "undefined") return
  const serialized = JSON.stringify({ userId, entityId } satisfies StoredEntitySession)
  try {
    window.sessionStorage?.setItem(ACTIVE_ENTITY_SESSION_KEY, serialized)
  } catch {
    // Ignorar errores de cuota o modo privado
  }
  try {
    window.localStorage?.setItem(ACTIVE_ENTITY_SESSION_KEY, serialized)
  } catch {
    // Ignorar errores de cuota o modo privado
  }
}

export function clearStoredActiveEntityId(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage?.removeItem(ACTIVE_ENTITY_SESSION_KEY)
  } catch {
    // Ignorar errores de almacenamiento
  }
  try {
    window.localStorage?.removeItem(ACTIVE_ENTITY_SESSION_KEY)
  } catch {
    // Ignorar errores de almacenamiento
  }
}

interface CurrentEntityContextType {
  currentEntity: OrganizationEntityRow | null
  activeEntityId: string | null
  setCurrentEntity: (entity: OrganizationEntityRow | null) => void
  enterEntityWorkspace: (entityOrId: OrganizationEntityRow | string) => void
  clearCurrentEntity: () => void
}

const CurrentEntityContext = React.createContext<CurrentEntityContextType | undefined>(undefined)

export const useCurrentEntity = (): CurrentEntityContextType => {
  const context = React.useContext(CurrentEntityContext)
  if (context === undefined) {
    throw new Error("useCurrentEntity must be used within a CurrentEntityProvider")
  }
  return context
}

/**
 * Devuelve el identificador de entidad activo para las pantallas del espacio
 * de trabajo de entidad: prioriza `:entityId` si la ruta incluye parámetro y
 * recurre al contexto de sesión en rutas limpias (`/home`, `/workers`, etc.).
 */
export const useActiveEntityId = (): string | undefined => {
  const { entityId } = useParams<{ entityId: string }>()
  const location = useLocation()
  const { activeEntityId, currentEntity } = useCurrentEntity()

  if (entityId) return entityId

  if (
    location.pathname === "/admin" ||
    location.pathname.startsWith("/admin/") ||
    location.pathname === "/organization" ||
    location.pathname.startsWith("/organization/") ||
    location.pathname.startsWith("/tenant/")
  ) {
    return undefined
  }

  return currentEntity?.id ?? activeEntityId ?? undefined
}

export { CurrentEntityContext }
