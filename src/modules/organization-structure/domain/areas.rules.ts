import type { AreaNode, OrganizationArea } from "./entities"

/**
 * Áreas — reglas puras de la jerarquía.
 *
 * El código del área y la validación de la jerarquía (pertenencia a la entidad, ciclos,
 * activación en cadena) son del backend: los triggers `organization_areas_generate_code` y
 * `organization_areas_validate` los imponen. Aquí vive sólo lo que la interfaz debe poder
 * decidir ANTES de escribir: qué áreas pueden ser «Área superior» y cómo se ordena el árbol.
 */

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
 * todas sus descendientes (un área nunca puede colgar de sí misma ni de su propia rama).
 * Al editar se incluye siempre el área superior actual para que el valor sea visible.
 */
export function areaParentOptions(
  areas: OrganizationArea[],
  editingArea: OrganizationArea | null
): OrganizationArea[] {
  const excluded = editingArea ? areaDescendantIds(editingArea.id, areas) : new Set<string>()
  let options = areas.filter((a) => a.is_active && !excluded.has(a.id))

  if (editingArea?.parent_area_id) {
    const currentParent = areas.find((a) => a.id === editingArea.parent_area_id)
    if (currentParent && !options.some((o) => o.id === currentParent.id)) {
      options = [...options, currentParent]
    }
  }

  return options.sort(
    (a, b) => a.hierarchy_order - b.hierarchy_order || a.name.localeCompare(b.name)
  )
}

/**
 * Árbol de áreas ordenado por orden y nombre. Un área cuyo padre no está en la lista se
 * muestra como raíz: la vista nunca oculta información por un padre ausente o inactivo.
 */
export function buildAreaTree(areas: OrganizationArea[]): AreaNode[] {
  const byId = new Map<string, AreaNode>()
  areas.forEach((a) => byId.set(a.id, { ...a, children: [] }))

  const roots: AreaNode[] = []
  byId.forEach((node) => {
    const parent = node.parent_area_id ? byId.get(node.parent_area_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })

  const sortNodes = (nodes: AreaNode[]) => {
    nodes.sort((a, b) => a.hierarchy_order - b.hierarchy_order || a.name.localeCompare(b.name))
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
}): string | null {
  if (!input.name) return "El nombre es obligatorio"

  if (input.parentAreaId) {
    const parent = input.areas.find((a) => a.id === input.parentAreaId)
    if (!parent || parent.organization_entity_id !== input.entityId) {
      return "El área superior seleccionada no pertenece a esta entidad"
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
