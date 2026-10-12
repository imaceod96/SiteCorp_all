import { supabase } from "@/lib/supabase"
import { tableName } from "@/integrations/supabase/schema-target"

/**
 * Catálogo GLOBAL de permisos INTERNOS de entidad.
 *
 * Decisión de arquitectura (fase «roles y permisos internos independientes por entidad»):
 *   - la DEFINICIÓN del permiso es global (catálogo único, tabla física resuelta por
 *     la frontera de nomenclatura: `tenant_permissions` → `company_client_permissions`);
 *   - el ROL es propiedad de UNA entidad (`organization_entity_id`).
 *
 * Este catálogo es exclusivamente el de los módulos internos de una entidad SiteCorp.
 * Nunca se mezcla con el catálogo de plataforma (`platform_permissions`), que se
 * administra en /admin/roles.
 */

export interface EntityPermission {
  id: string
  code: string
  description: string | null
}

export interface EntityPermissionGroup {
  title: string
  codes: string[]
}

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

export const ENTITY_PERMISSION_GROUPS: EntityPermissionGroup[] = [
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
}): string => ENTITY_PERMISSION_LABELS[permission.code] || permission.description || permission.code

/** Permisos internos desde el catálogo global, excluyendo los códigos legacy. */
export async function fetchEntityPermissions(): Promise<EntityPermission[]> {
  const { data, error } = await supabase
    .from(tableName("permissions"))
    .select("id,code,description")
    .order("code")

  if (error) throw error
  return ((data as EntityPermission[]) || []).filter((permission) =>
    isInternalPermissionCode(permission.code)
  )
}

/** Agrupa los permisos internos por módulo, dejando los no catalogados en un grupo final. */
export function groupEntityPermissions(
  permissions: EntityPermission[]
): EntityPermissionGroup[] {
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
