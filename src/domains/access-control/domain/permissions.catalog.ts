import type {
  EntityPermission,
  PlatformPermission,
  RolePermissionGroup,
} from "./entities"

/**
 * Control de acceso — Catálogos de permisos (reglas puras).
 *
 * La DEFINICIÓN de un permiso es global y vive en la base de datos:
 *   · permisos INTERNOS de entidad → tabla del cliente resuelta por la frontera de
 *     nomenclatura (`tenant_permissions` → `company_client_permissions`).
 *   · permisos de PLATAFORMA       → `platform_permissions`.
 *
 * Aquí sólo viven las etiquetas legibles, la agrupación por módulo y la exclusión de
 * los códigos legacy que siguen existiendo en la base de datos por auditoría. Ningún
 * permiso se inventa ni se filtra por criterios nuevos: los códigos legacy se siguen
 * conservando como contratos válidos (sólo se excluyen del catálogo ofrecible).
 */

/**
 * Códigos legacy que NO forman parte del catálogo interno normalizado:
 *   - areas.*   → normalizados a staffing.*
 *   - jobs.*    → normalizados a staffing.*
 *   - tenant_roles.* → retirados del ámbito plataforma y sustituidos por roles.*
 *   - *_global / *_empresarial → variantes salariales antiguas
 * Se conservan en BD por auditoría, pero no se ofrecen al construir roles internos.
 */
export const LEGACY_PERMISSION_PATTERN = /(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)/

export const isInternalPermissionCode = (code: string): boolean =>
  !LEGACY_PERMISSION_PATTERN.test(code)

export const ENTITY_PERMISSION_LABELS: Record<string, string> = {
  "organization.view": "Ver organización",
  "organization.manage": "Gestionar organización",

  "users.view": "Ver usuarios",
  "users.manage": "Gestionar usuarios",
  "users.invite": "Invitar usuarios",

  "roles.view": "Ver roles y permisos",
  "roles.manage": "Gestionar roles y permisos",

  "candidates.view": "Ver candidatos",
  "candidates.manage": "Gestionar candidatos",

  "staffing.view": "Ver configuración de plantilla",
  "staffing.manage": "Gestionar configuración de plantilla",

  "workers.view": "Ver trabajadores",
  "workers.manage": "Gestionar trabajadores",
  "workers.initial_import": "Carga inicial y migración de trabajadores",

  "hiring.view": "Ver contratación",
  "hiring.manage": "Gestionar contratación",

  "salary.view": "Ver compensación (escala empresarial)",
  "salary.manage": "Gestionar compensación (escala empresarial)",

  "tenure_scale.view": "Ver escala de pago de antigüedad",
  "tenure_scale.manage": "Gestionar escala de pago de antigüedad",

  "contracts.view": "Ver contratos",
  "contracts.manage": "Formalizar y gestionar contratos",

  "contract_addendums.view": "Ver anexos contractuales",
  "contract_addendums.manage": "Gestionar anexos contractuales",

  "worker_documents.view": "Ver documentos de trabajadores",
  "worker_documents.manage": "Subir y administrar documentos de trabajadores",

  "contract_data.view": "Ver datos contractuales",
  "contract_data.manage": "Gestionar datos contractuales",

  "representatives.view": "Ver representantes autorizados",
  "representatives.manage": "Gestionar representantes autorizados",

  "document_templates.view": "Ver plantillas documentales (.doc / .docx)",
  "document_templates.manage": "Administrar plantillas documentales (.doc / .docx)",

  "contract_alerts.view": "Ver alertas de contratos",

  "prenomina.view": "Ver prenómina",
  "prenomina.manage": "Gestionar prenómina",

  "vacations.view": "Ver vacaciones (saldos, períodos e historial)",
  "vacations.manage": "Gestionar vacaciones (registrar, cancelar y ajustar)",

  "reports.view": "Ver informes",
}

export const ENTITY_PERMISSION_GROUPS: RolePermissionGroup[] = [
  { title: "ORGANIZACIÓN", codes: ["organization.view", "organization.manage"] },
  { title: "USUARIOS", codes: ["users.view", "users.manage", "users.invite"] },
  { title: "ROLES Y PERMISOS", codes: ["roles.view", "roles.manage"] },
  { title: "CANDIDATOS", codes: ["candidates.view", "candidates.manage"] },
  { title: "CONFIGURACIÓN DE PLANTILLA", codes: ["staffing.view", "staffing.manage"] },
  { title: "TRABAJADORES", codes: ["workers.view", "workers.manage", "workers.initial_import"] },
  { title: "CONTRATACIÓN", codes: ["hiring.view", "hiring.manage"] },
  { title: "COMPENSACIÓN", codes: ["salary.view", "salary.manage", "tenure_scale.view", "tenure_scale.manage"] },
  { title: "CONTRATOS", codes: ["contracts.view", "contracts.manage"] },
  {
    title: "ANEXOS CONTRACTUALES",
    codes: ["contract_addendums.view", "contract_addendums.manage"],
  },
  {
    title: "DOCUMENTOS DE TRABAJADORES",
    codes: ["worker_documents.view", "worker_documents.manage"],
  },
  { title: "DATOS CONTRACTUALES", codes: ["contract_data.view", "contract_data.manage"] },
  { title: "REPRESENTANTES", codes: ["representatives.view", "representatives.manage"] },
  {
    title: "PLANTILLAS DOCUMENTALES",
    codes: ["document_templates.view", "document_templates.manage"],
  },
  { title: "ALERTAS DE CONTRATOS", codes: ["contract_alerts.view"] },
  { title: "PRENÓMINA", codes: ["prenomina.view", "prenomina.manage"] },
  { title: "VACACIONES", codes: ["vacations.view", "vacations.manage"] },
  { title: "INFORMES", codes: ["reports.view"] },
]

export const entityPermissionLabel = (permission: {
  code: string
  description?: string | null
}): string =>
  ENTITY_PERMISSION_LABELS[permission.code] || permission.description || permission.code

/** Agrupa los permisos internos por módulo, dejando los no catalogados en un grupo final. */
export function groupEntityPermissions(
  permissions: EntityPermission[]
): RolePermissionGroup[] {
  const groupedCodes = new Set(ENTITY_PERMISSION_GROUPS.flatMap((group) => group.codes))
  const extra = permissions.filter((permission) => !groupedCodes.has(permission.code))

  const groups = ENTITY_PERMISSION_GROUPS.map((group) => ({ ...group }))
  if (extra.length > 0) {
    groups.push({
      title: "OTROS PERMISOS INTERNOS",
      codes: extra.map((permission) => permission.code),
    })
  }
  return groups
}

/* ------------------------------------------------------------------ */
/* Catálogo de plataforma                                              */
/* ------------------------------------------------------------------ */

/**
 * Orden canónico de los grupos del gestor global.
 *
 * La base de datos es la fuente de verdad de qué permiso pertenece al catálogo de
 * plataforma (`platform_permissions.is_platform_scope`). El frontend NO decide por su
 * cuenta: sólo agrupa y etiqueta lo que el catálogo marca como de plataforma.
 */
export const PLATFORM_CATEGORY_ORDER = [
  "CLIENTES",
  "ORGANIZACIONES",
  "USUARIOS",
  "ROLES Y PERMISOS",
  "INFORMES",
  "CONFIGURACIÓN",
] as const

/** Etiquetas legibles del catálogo de plataforma. */
export const PLATFORM_PERMISSION_LABELS: Record<string, string> = {
  "tenants.view": "Ver clientes",
  "tenants.create": "Crear clientes",
  "tenants.edit": "Editar clientes",
  "tenants.activate": "Activar clientes",
  "tenants.deactivate": "Desactivar clientes",
  "tenants.delete": "Eliminar clientes",
  "tenants.enter": "Abrir clientes",
  "organizations.view_all": "Ver todas las organizaciones",
  "organizations.manage_all": "Gestionar todas las organizaciones",
  "organizations.delete": "Eliminar organizaciones",
  "users.view_all": "Ver usuarios globales",
  "users.manage_all": "Crear, editar y gestionar usuarios globales",
  "users.invite": "Invitar usuarios de plataforma",
  "platform_roles.view": "Ver roles de plataforma",
  "platform_roles.manage": "Crear y editar roles de plataforma",
  "reports.cross_tenant": "Ver informes globales",
  "platform_settings.view": "Ver configuración de plataforma",
  "platform_settings.manage": "Gestionar configuración de plataforma",
  "salary.view": "Ver escala salarial presupuestada global",
  "salary.manage": "Gestionar escala salarial presupuestada global",
}

export const platformPermissionLabel = (permission: {
  code: string
  description: string | null
}): string =>
  PLATFORM_PERMISSION_LABELS[permission.code] || permission.description || permission.code

/**
 * Agrupa los permisos DE PLATAFORMA según la categoría del catálogo.
 * Sólo se incluyen los permisos marcados como de plataforma.
 */
export function groupPlatformPermissions(
  permissions: PlatformPermission[]
): RolePermissionGroup[] {
  const catalog = permissions.filter((permission) => permission.is_platform_scope)
  const categories = [
    ...PLATFORM_CATEGORY_ORDER.filter((category) =>
      catalog.some((permission) => permission.category === category)
    ),
    ...[
      ...new Set(
        catalog
          .map((permission) => permission.category)
          .filter((category): category is string => !!category)
      ),
    ].filter((category) => !(PLATFORM_CATEGORY_ORDER as readonly string[]).includes(category)),
  ]

  return categories.map((category) => ({
    title: category,
    codes: catalog
      .filter((permission) => permission.category === category)
      .map((permission) => permission.code)
      .sort(),
  }))
}
