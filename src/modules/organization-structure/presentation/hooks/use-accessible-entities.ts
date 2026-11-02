import * as React from "react"
import { useCurrentEntity } from "@/app/providers/current-entity.context"
import { selectEntitiesByClient, selectVisibleEntities } from "../../infrastructure/organization-entities.repository"
import type { OrganizationEntity } from "../../domain/entities"

export interface HierarchicalEntityNode {
  entity: OrganizationEntity
  depth: number
  typeLabel: string
  typeColor: string
}

/**
 * Obtiene la etiqueta amigable del tipo de entidad.
 */
export function getEntityTypeLabel(type: string): string {
  switch (type) {
    case "business_group":
      return "Grupo"
    case "company":
      return "Empresa"
    case "ueb":
      return "UEB"
    default:
      return "Entidad"
  }
}

/**
 * Estilo visual según el tipo de entidad (SiteCorp badge classes).
 */
export function getEntityTypeBadgeClasses(type: string): string {
  switch (type) {
    case "business_group":
      return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800"
    case "company":
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
    case "ueb":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
    default:
      return "bg-muted text-muted-foreground border-border"
  }
}

/**
 * Hook para cargar y estructurar las entidades accesibles del usuario en la sesión.
 *
 * La seguridad y el alcance real de visibilidad son gobernados por RLS (`public.can_view_entity`),
 * de modo que PostgreSQL entrega exclusivamente las entidades autorizadas para el usuario.
 */
export function useAccessibleEntities() {
  const { currentEntity } = useCurrentEntity()
  const [entities, setEntities] = React.useState<OrganizationEntity[]>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(true)
  const [error, setError] = React.useState<Error | null>(null)

  const clientId = currentEntity?.tenant_id || (currentEntity as unknown as { company_client_id?: string })?.company_client_id

  const loadEntities = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      let data: OrganizationEntity[] = []
      if (clientId) {
        data = await selectEntitiesByClient(clientId)
      } else {
        data = await selectVisibleEntities()
      }
      // FILTRO: Solo entidades que son cuentas activas de SiteCorp (is_sitecorp_account === true)
      // Las entidades organizativas subordinadas que no sean clientes/cuentas de SiteCorp no deben aparecer.
      const sitecorpAccounts = (data || []).filter(
        (e) => e.is_sitecorp_account === true && e.is_active !== false
      )
      setEntities(sitecorpAccounts)
    } catch (err) {
      console.error("[useAccessibleEntities] Error loading entities:", err)
      setError(err instanceof Error ? err : new Error("Error al cargar entidades accesibles"))
      setEntities([])
    } finally {
      setIsLoading(false)
    }
  }, [clientId])

  React.useEffect(() => {
    loadEntities()
  }, [loadEntities])

  // Construcción del árbol jerárquico aplanado con profundidad (depth)
  const hierarchicalList = React.useMemo<HierarchicalEntityNode[]>(() => {
    if (!entities || entities.length === 0) return []

    const entityMap = new Map<string, OrganizationEntity>()
    entities.forEach((e) => entityMap.set(e.id, e))

    // Los nodos raíz son aquellos cuyo parent_id es null o cuyo parent_id no está en la lista visible
    const roots: OrganizationEntity[] = []
    const childrenMap = new Map<string, OrganizationEntity[]>()

    entities.forEach((entity) => {
      const parentId = entity.parent_id
      if (!parentId || !entityMap.has(parentId)) {
        roots.push(entity)
      } else {
        const existing = childrenMap.get(parentId) || []
        existing.push(entity)
        childrenMap.set(parentId, existing)
      }
    })

    // Ordenar raíces por tipo (Grupo -> Empresa -> UEB) y luego por nombre
    const typeOrder: Record<string, number> = {
      business_group: 1,
      company: 2,
      ueb: 3,
    }

    const sortNodes = (a: OrganizationEntity, b: OrganizationEntity) => {
      const orderA = typeOrder[a.entity_type] || 99
      const orderB = typeOrder[b.entity_type] || 99
      if (orderA !== orderB) return orderA - orderB
      return a.name.localeCompare(b.name)
    }

    roots.sort(sortNodes)

    // Recorrido DFS para generar la lista aplanada conservando la jerarquía
    const result: HierarchicalEntityNode[] = []

    function traverse(node: OrganizationEntity, depth: number) {
      result.push({
        entity: node,
        depth,
        typeLabel: getEntityTypeLabel(node.entity_type),
        typeColor: getEntityTypeBadgeClasses(node.entity_type),
      })

      const children = childrenMap.get(node.id) || []
      children.sort(sortNodes)
      children.forEach((child) => traverse(child, depth + 1))
    }

    roots.forEach((root) => traverse(root, 0))

    return result
  }, [entities])

  const canSwitch = entities.length > 1

  return {
    entities,
    hierarchicalList,
    canSwitch,
    isLoading,
    error,
    refreshEntities: loadEntities,
  }
}
