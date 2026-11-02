import type { AreaNode, OrganizationArea } from "./entities"

/**
 * Áreas — reglas puras de la jerarquía.
 *
 * El código del área y la validación de la jerarquía (pertenencia a la entidad, ciclos,
 * activación en cadena) son del backend: los triggers `organization_areas_generate_code` y
 * `organization_areas_validate` los imponen. Aquí vive sólo lo que la interfaz debe poder
 * decidir ANTES de escribir: qué áreas pueden ser «Área superior» y cómo se ordena el árbol.
 */

/** Ordena áreas por su posición en la plantilla (`hierarchy_order` ascendente) y luego por nombre. */
export function sortAreasByOrder<T extends Pick<OrganizationArea, "hierarchy_order" | "name">>(
  areas: T[]
): T[] {
  return [...areas].sort(
    (a, b) =>
      (a.hierarchy_order ?? 0) - (b.hierarchy_order ?? 0) ||
      a.name.localeCompare(b.name)
  )
}

/** Ids del área indicada y de todas sus descendientes (ella incluida). */
export function areaDescendantIds(areaId: string, areas: OrganizationArea[]): Set<string> {
  const result = new Set<string>()
  const stack = [areaId]
  while (stack.length > 0) {
    const current = stack.pop()!
    result.add(current)
    areas.filter((a) => a.parent_area_id === current).forEach((child) => stack.push(child.id))
  }
  return result
}

/**
 * Opciones de «Área superior»: áreas ACTIVAS de la entidad, excluyendo el área editada y
 * todas sus descendientes (un área nunca puede colgar de sí misma ni de su propia rama), y
 * excluyendo áreas con un orden mayor al orden actual (un área de orden mayor nunca puede
 * estar por encima de un área de orden menor).
 * Al editar se incluye siempre el área superior actual para que el valor sea visible.
 */
export function areaParentOptions(
  areas: OrganizationArea[],
  editingArea: OrganizationArea | null,
  maxHierarchyOrder?: number
): OrganizationArea[] {
  const excluded = editingArea ? areaDescendantIds(editingArea.id, areas) : new Set<string>()
  const hasMaxOrder = maxHierarchyOrder !== undefined && !Number.isNaN(maxHierarchyOrder)

  let options = areas.filter(
    (a) =>
      a.is_active &&
      !excluded.has(a.id) &&
      (!hasMaxOrder || (a.hierarchy_order ?? 0) <= maxHierarchyOrder!)
  )

  if (editingArea?.parent_area_id) {
    const currentParent = areas.find((a) => a.id === editingArea.parent_area_id)
    if (
      currentParent &&
      !options.some((o) => o.id === currentParent.id) &&
      (!hasMaxOrder || (currentParent.hierarchy_order ?? 0) <= maxHierarchyOrder!)
    ) {
      options = [...options, currentParent]
    }
  }

  return sortAreasByOrder(options)
}

/**
 * Árbol de áreas ordenado por orden y nombre. Un área cuyo padre no está en la lista o tiene
 * un orden mayor al suyo (cuando `node.hierarchy_order > 0`) se muestra como raíz: nunca un
 * área de orden mayor puede estar por encima de una de orden menor.
 */
export function buildAreaTree(areas: OrganizationArea[]): AreaNode[] {
  const byId = new Map<string, AreaNode>()
  areas.forEach((a) => byId.set(a.id, { ...a, children: [] }))

  const roots: AreaNode[] = []
  byId.forEach((node) => {
    const parent = node.parent_area_id ? byId.get(node.parent_area_id) : undefined
    const invalidOrderHierarchy =
      parent !== undefined &&
      (node.hierarchy_order ?? 0) > 0 &&
      (parent.hierarchy_order ?? 0) > (node.hierarchy_order ?? 0)

    if (parent && !invalidOrderHierarchy) parent.children.push(node)
    else roots.push(node)
  })

  const sortNodes = (nodes: AreaNode[]) => {
    nodes.sort(
      (a, b) =>
        (a.hierarchy_order ?? 0) - (b.hierarchy_order ?? 0) ||
        a.name.localeCompare(b.name)
    )
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

/** Valida el alta o edición de un área y devuelve el mensaje de error, o null si es válida. */
export function validateAreaInput(input: {
  name: string
  parentAreaId: string | null
  entityId: string
  areas: OrganizationArea[]
  hierarchyOrder?: number
  editingAreaId?: string | null
}): string | null {
  if (!input.name) return "El nombre es obligatorio"

  const hasOrder = input.hierarchyOrder !== undefined && !Number.isNaN(input.hierarchyOrder)

  if (input.parentAreaId) {
    const parent = input.areas.find((a) => a.id === input.parentAreaId)
    if (!parent || parent.organization_entity_id !== input.entityId) {
      return "El área superior seleccionada no pertenece a esta entidad"
    }
    if (hasOrder && (parent.hierarchy_order ?? 0) > input.hierarchyOrder!) {
      return "Un área de orden mayor no puede estar por encima de un área de orden menor"
    }
  }

  if (input.editingAreaId && hasOrder) {
    const hasLowerOrderChild = input.areas.some(
      (a) =>
        a.parent_area_id === input.editingAreaId &&
        (a.hierarchy_order ?? 0) < input.hierarchyOrder!
    )
    if (hasLowerOrderChild) {
      return "Un área de orden mayor no puede estar por encima de un área de orden menor"
    }
  }

  return null
}

/**
 * Mensaje de error del guardado del área: el conflicto de código único
 * (`organization_areas_organization_entity_id_code_unique`) tiene un texto propio.
 */
export function areaSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error al guardar el área"
  if (message.includes("organization_areas_organization_entity_id_code_unique")) {
    return "Ya existe un área con ese código en esta entidad"
  }
  return message
}
