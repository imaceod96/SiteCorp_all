import { supabase } from "@/lib/supabase"

/**
 * Estructura organizativa — Repositorio de la configuración de la entidad
 * (infraestructura).
 *
 * Lo que la configuración de la estructura necesita SABER de la entidad antes de escribir:
 * su régimen (que decide la escala aplicable) y el nombre de la escala.
 * `organization_entity_id` es la ENTIDAD organizativa (Grupo Empresarial → Empresa →
 * UEB), nunca el cliente: el cliente lo impone RLS.
 *
 * Los permisos internos de la entidad NO se comprueban aquí: se preguntan al dominio de
 * control de acceso (`@/domains/access-control`), que es el único punto que conoce
 * `can_access_entity`.
 */

/** Régimen de la entidad (`PRESUPUESTADA`, `EMPRESARIAL`…) en mayúsculas, o null. */
export async function fetchEntityRegime(entityId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("organization_entities")
    .select("id, regime_id")
    .eq("id", entityId)
    .maybeSingle()

  if (error) throw error
  const regimeId = (data as { regime_id: string | null } | null)?.regime_id
  return ((regimeId || "") as string).toUpperCase() || null
}

/** Detalles de una escala salarial: el nombre sólo es informativo en la interfaz. */
export async function selectSalaryScaleSummary(
  scaleId: string
): Promise<{ id: string; name: string | null; scope_type: string | null } | null> {
  const { data, error } = await supabase
    .from("salary_scales")
    .select("id, name, scope_type")
    .eq("id", scaleId)

  if (error) throw error
  return (
    (data as { id: string; name: string | null; scope_type: string | null }[] | null)?.[0] || null
  )
}
