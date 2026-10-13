/**
 * Catálogo de permisos de PLATAFORMA (Nivel 1 — Administración global de SiteCorp).
 *
 * Compatibilidad: este módulo se conserva como FACHADA del dominio de control de acceso
 * (`@/domains/access-control`), que es ahora el único lugar donde viven el catálogo y su
 * lectura. No se ha cambiado ninguna etiqueta, agrupación ni consulta.
 *
 *   import { fetchPlatformPermissions } from "@/domains/access-control"
 */

export {
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_PERMISSION_LABELS,
  fetchPlatformPermissionCatalog as fetchPlatformPermissions,
  groupPlatformPermissions,
  platformPermissionLabel,
} from "@/domains/access-control"

export type {
  PlatformPermission,
  RolePermissionGroup as PlatformPermissionGroup,
} from "@/domains/access-control"
