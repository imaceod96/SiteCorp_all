/**
 * Estructura organizativa — Catálogo de MÓDULOS INTERNOS de una Cuenta SiteCorp.
 *
 * Es la lista ÚNICA de rutas y de permisos por módulo: la navegación de los módulos internos
 * se compone a partir de aquí, y por eso las entradas y el orden no se tocan. Cada módulo
 * declara los permisos internos que lo habilitan (basta con uno); la ausencia de permisos
 * significa que el módulo está disponible para cualquier usuario con acceso a la entidad.
 *
 * Origen: `src/lib/sitecorp-account.ts`. El catálogo se traslada al dominio —como el catálogo
 * de permisos de control de acceso— para que no existan dos fuentes de verdad de los módulos
 * internos. Es un catálogo PURO: no consulta Supabase ni decide autorización.
 */

/** Módulo interno enrutable de una Cuenta SiteCorp. */
export interface EntityInternalModule {
  key: string
  label: string
  /** Ruta limpia del espacio de trabajo de la entidad */
  path: (entityId?: string) => string
  /**
   * Permisos internos que habilitan el módulo (basta con uno). Ausente = el módulo
   * está disponible para cualquier usuario con acceso a la entidad (p. ej. Resumen).
   */
  permissions?: string[]
}

/**
 * Módulos internos enrutables de una Cuenta SiteCorp. Es la lista ÚNICA de rutas y
 * de permisos por módulo (la navegación se compone a partir de aquí).
 */
export const ENTITY_INTERNAL_MODULES: EntityInternalModule[] = [
  { key: "summary", label: "Resumen", path: () => "/home" },
  {
    key: "candidates",
    label: "Candidatos",
    path: () => "/candidates",
    permissions: ["candidates.view", "candidates.manage"],
  },
  {
    key: "workers",
    label: "Trabajadores",
    path: () => "/workers",
    permissions: ["workers.view", "workers.manage"],
  },
  {
    key: "reentries",
    label: "Reingresos",
    path: () => "/reentries",
    permissions: ["workers.view", "workers.manage"],
  },
  {
    key: "staffing",
    label: "Plantilla",
    path: () => "/staffing",
    permissions: ["workers.view", "workers.manage"],
  },
  {
    key: "vacations",
    label: "Vacaciones",
    path: () => "/vacations",
    permissions: ["vacations.view", "vacations.manage"],
  },
  {
    key: "medical-certificates",
    label: "Licencias y certificados",
    path: () => "/medical-certificates",
    permissions: ["medical_certificates.view", "medical_certificates.manage"],
  },
  {
    key: "prenomina",
    label: "Prenómina",
    path: () => "/payroll-preparation",
    permissions: ["prenomina.view", "prenomina.manage"],
  },
  {
    key: "pending-documents",
    label: "Documentos pendientes",
    path: () => "/documents/pending",
    permissions: ["workers.view", "workers.manage"],
  },
  // Vencimientos YA NO es un elemento directo del sidebar (§36): su página y ruta
  // siguen existiendo y se accede desde Resumen → «Próximos a vencer».
  {
    key: "contract-alerts",
    label: "Vencimientos",
    path: () => "/contracts/alerts",
    permissions: ["contract_alerts.view", "workers.view", "workers.manage"],
  },
  {
    key: "hiring",
    label: "Contratación",
    path: () => "/hiring",
    permissions: ["hiring.view", "hiring.manage", "workers.view", "workers.manage"],
  },
  {
    key: "training",
    label: "Capacitación",
    path: () => "/training",
    permissions: [
      "training.view",
      "training.manage",
      "workers.view",
      "workers.manage",
      "organization.view",
      "organization.manage",
    ],
  },
  {
    key: "sst",
    label: "SST",
    path: () => "/sst",
    permissions: [
      "sst.view",
      "sst.manage",
      "training.view",
      "training.manage",
      "workers.view",
      "workers.manage",
      "organization.view",
      "organization.manage",
    ],
  },
  {
    key: "settings",
    label: "Ajustes",
    path: () => "/settings",
    permissions: [
      "organization.view",
      "organization.manage",
      "users.view",
      "users.manage",
      "users.invite",
      "roles.view",
      "roles.manage",
      "salary.view",
      "salary.manage",
      "tenure_scale.view",
      "tenure_scale.manage",
      "staffing.view",
      "staffing.manage",
      "contract_data.view",
      "contract_data.manage",
      "representatives.view",
      "representatives.manage",
      "document_templates.view",
      "document_templates.manage",
      "workers.initial_import",
    ],
  },
  { key: "manual", label: "Manual de Usuario", path: () => "/manual" },
]

/** Ruta existente de Vencimientos (acceso directo permitido aunque no esté en el menú). */
export const contractAlertsPath = (_entityId?: string) => "/contracts/alerts"

/** Traduce una subruta heredada de `/entity/:entityId/*` a su URL limpia de espacio de trabajo. */
export const resolveLegacyEntityPath = (splat: string): string => {
  const normalized = splat.replace(/^\/+/, "").replace(/\/+$/, "")
  if (!normalized || normalized === "summary" || normalized === "panel" || normalized === "home") {
    return "/home"
  }
  return `/${normalized}`
}

/** Elemento simple del menú lateral. */
export interface EntityNavLink {
  kind: "link"
  key: string
  label: string
  path: (entityId?: string) => string
  permissions?: string[]
}

/** Grupo desplegable del menú lateral. */
export interface EntityNavGroup {
  kind: "group"
  key: string
  label: string
  permissions?: string[]
  items: EntityNavLink[]
}

export type EntityNavEntry = EntityNavLink | EntityNavGroup

const link = (
  module: EntityInternalModule,
  overrides: Partial<EntityNavLink> = {}
): EntityNavLink => ({
  kind: "link",
  key: module.key,
  label: module.label,
  path: module.path,
  permissions: module.permissions,
  ...overrides,
})

const moduleByKey = (key: string): EntityInternalModule => {
  const found = ENTITY_INTERNAL_MODULES.find((m) => m.key === key)
  if (!found) throw new Error(`Módulo interno desconocido: ${key}`)
  return found
}

/**
 * ORDEN DEFINITIVO del menú lateral (§45):
 *   Resumen · Personas (Candidatos / Trabajadores / Reingresos) · Contratación ·
 *   Plantilla · Capacitación · SST · Vacaciones · Licencias y certificados · Prenómina · Ajustes · Manual
 */
export const ENTITY_NAV: EntityNavEntry[] = [
  link(moduleByKey("summary")),
  {
    kind: "group",
    key: "personas",
    label: "Personas",
    permissions: ["candidates.view", "candidates.manage", "workers.view", "workers.manage"],
    items: [
      link(moduleByKey("candidates")),
      link(moduleByKey("workers")),
      link(moduleByKey("reentries")),
    ],
  },
  link(moduleByKey("hiring")),
  link(moduleByKey("staffing")),
  link(moduleByKey("training")),
  link(moduleByKey("sst")),
  link(moduleByKey("vacations")),
  link(moduleByKey("medical-certificates")),
  link(moduleByKey("prenomina")),
  link(moduleByKey("pending-documents")),
  link(moduleByKey("settings")),
]
