import * as React from "react"
import { loadEntityPermissionCodes } from "@/modules/access-control"

/**
 * Permisos internos efectivos del usuario en UNA entidad.
 *
 * La resolución es del dominio de control de acceso (`list_entity_permissions` en el
 * backend), que aplica exactamente la misma regla que las políticas RLS: acceso a la
 * entidad, pertenencia del rol a esa entidad, jerarquía y scope (SELF /
 * SELF_AND_DESCENDANTS). La interfaz nunca decide el acceso por sí sola.
 *
 * Tolerancia (la misma de siempre): sin permisos o ante un fallo de red no se concede
 * ninguna capacidad — el hook devuelve una lista vacía.
 */
export function useEntityPermissions(entityId: string | undefined | null) {
  const [codes, setCodes] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!entityId) {
        setCodes([])
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const resolved = await loadEntityPermissionCodes(entityId)
        if (!cancelled) setCodes(resolved)
      } catch {
        // Sin permisos o error de red: no se concede ninguna capacidad.
        if (!cancelled) setCodes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [entityId])

  const has = React.useCallback(
    (permission: string | string[]) => {
      const list = Array.isArray(permission) ? permission : [permission]
      return list.some((code) => codes.includes(code))
    },
    [codes]
  )

  return { permissions: codes, loading, has }
}
