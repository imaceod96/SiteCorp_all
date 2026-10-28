import { supabase } from "@/lib/supabase"

/**
 * ÁMBITO (igual que en entity-summary: esta entidad / + descendientes).
 *
 * Se parte del árbol de entidades visible para el usuario (filtrado por RLS),
 * de modo que un usuario con alcance limitado nunca obtiene descendientes
 * inaccesibles.
 */
export async function fetchEntityScope(
  entityId: string,
  scope: "self" | "descendants"
): Promise<{ entityIds: string[]; descendantCount: number }> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select("id, parent_id")
  if (error) throw error

  const rows = (data as { id: string; parent_id: string | null }[]) || []
  const childrenByParent = new Map<string, string[]>()
  rows.forEach((row) => {
    if (!row.parent_id) return
    const list = childrenByParent.get(row.parent_id) || []
    list.push(row.id)
    childrenByParent.set(row.parent_id, list)
  })

  const descendants: string[] = []
  const seen = new Set<string>()
  const stack = [...(childrenByParent.get(entityId) || [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    descendants.push(id)
    const children = childrenByParent.get(id)
    if (children) stack.push(...children)
  }

  const entityIds = scope === "descendants" ? [entityId, ...descendants] : [entityId]
  return { entityIds, descendantCount: descendants.length }
}
