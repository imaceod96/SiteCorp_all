/**
 * Catálogo GLOBAL de permisos INTERNOS de entidad.
 *
 * Compatibilidad: este módulo se conserva como FACHADA del dominio de control de acceso
 * (`@/domains/access-control`), que es ahora el único lugar donde viven el catálogo y su
 * lectura. No se ha cambiado ninguna etiqueta, agrupación ni consulta.
 *
 *   import { fetchEntityPermissions } from "@/domains/access-control"
 */

export {
  ENTITY_PERMISSION_GROUPS,
  ENTITY_PERMISSION_LABELS,
  LEGACY_PERMISSION_PATTERN,
  entityPermissionLabel,
  fetchEntityPermissionCatalog as fetchEntityPermissions,
  groupEntityPermissions,
  isInternalPermissionCode,
} from "@/domains/access-control"

export type {
  EntityPermission,
  RolePermissionGroup as EntityPermissionGroup,
} from "@/domains/access-control"
