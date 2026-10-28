/**
 * Estructura organizativa — Reglas de la CUENTA SITECORP de una entidad.
 *
 * Regla única del sistema:
 *   organization_entities.is_sitecorp_account === true
 *   → la entidad usa los MÓDULOS INTERNOS de gestión de SiteCorp
 *
 * No significa: otro tenant/workspace, otro régimen, otra jerarquía ni una cuenta de
 * usuario. Es una propiedad estructural de la entidad y NO sustituye a los permisos:
 * el acceso real sigue siendo entidad SiteCorp + acceso a la entidad + permiso RBAC.
 *
 * Estas reglas vivían en `src/lib/sitecorp-account.ts`; se trasladan al dominio de la
 * estructura organizativa —de la que la entidad forma parte— sin cambiar ni un texto ni una
 * decisión. Son reglas PURAS: no consultan Supabase.
 */

/** ¿La entidad utiliza los módulos internos de SiteCorp? */
export function hasSiteCorpAccount(
  entity: { is_sitecorp_account?: boolean | null } | null | undefined
): boolean {
  return entity?.is_sitecorp_account === true
}

/**
 * Regla central de acceso a módulos internos:
 *   entidad es Cuenta SiteCorp  (condición estructural)
 *   + el usuario tiene acceso a la entidad y permiso para el módulo (RBAC)
 */
export function canUseInternalModules(
  entity: { is_sitecorp_account?: boolean | null } | null | undefined,
  options: { isAuthorized: boolean }
): boolean {
  return hasSiteCorpAccount(entity) && options.isAuthorized
}

/**
 * Código de cuenta SiteCorp. No se introduce a mano y no se regenera al reeditar:
 * se deriva del código interno de la entidad (único por workspace).
 */
export const buildAccountCode = (entityCode: string): string =>
  `CUENTA-${entityCode.toUpperCase()}`

/** Ruta externa equivalente para volver cuando los módulos internos no están disponibles. */
export const organizationFallbackPath = (options: {
  isPlatformSuperAdmin: boolean
  hasPlatformOrganizationAccess: boolean
}): string =>
  options.isPlatformSuperAdmin || options.hasPlatformOrganizationAccess
    ? "/admin/companies"
    : "/organization"

/** Textos del bloqueo de los módulos internos (no cambian). */
export const SITECORP_MODULES_DISABLED_TITLE = "Módulos internos no habilitados"

export const SITECORP_MODULES_DISABLED_MESSAGE =
  "Esta entidad no tiene habilitados los módulos internos de SiteCorp."
