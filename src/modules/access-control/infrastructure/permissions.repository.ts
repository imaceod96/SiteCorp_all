import { supabase } from "@/lib/supabase"
import { tableName } from "@/integrations/supabase/schema-target"
import { isInternalPermissionCode } from "../domain/permissions.catalog"
import type { EntityPermission, PlatformPermission } from "../domain/entities"

/**
 * Control de acceso — Repositorio de catálogos de permisos (infraestructura).
 *
 * Los catálogos son GLOBALES y NUNCA se filtran por cliente ni por entidad: la
 * definición del permiso es única para todo SiteCorp. El nombre físico de la tabla de
 * permisos internos lo resuelve la frontera de nomenclatura
 * (`tenant_permissions` → `company_client_permissions`).
 *
 * Los códigos legacy se siguen conservando en la base de datos por auditoría; el
 * catálogo ofrecible los excluye con la regla del dominio, que es la única que decide.
 */

/** Catálogo global de permisos INTERNOS de entidad (excluye los códigos legacy). */
export async function fetchEntityPermissionCatalog(): Promise<EntityPermission[]> {
  const { data, error } = await supabase
    .from(tableName("permissions"))
    .select("id,code,description")
    .order("code")

  if (error) throw error
  return ((data as EntityPermission[]) || []).filter((permission) =>
    isInternalPermissionCode(permission.code)
  )
}

/** Catálogo completo de permisos de PLATAFORMA (incluye los retirados, para histórico). */
export async function fetchPlatformPermissionCatalog(): Promise<PlatformPermission[]> {
  const { data, error } = await supabase
    .from("platform_permissions")
    .select("id, code, description, category, is_platform_scope")
    .order("code")

  if (error) throw new Error(error.message)
  return (data as PlatformPermission[]) || []
}
