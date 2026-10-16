import * as React from "react"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import RolesManager from "@/components/roles-manager"
import { Building2, Shield } from "lucide-react"

/**
 * Administración global → Roles y permisos.
 *
 * Nivel 1 — PLATAFORMA SITECORP. Esta pantalla administra EXCLUSIVAMENTE
 * `platform_roles` y el catálogo `platform_permissions` (clientes/workspaces,
 * organizaciones, usuarios, roles de plataforma, informes y configuración).
 *
 * Los roles y permisos INTERNOS de una entidad NO se crean ni editan desde aquí:
 * se administran dentro de cada entidad.
 */
const RolesPermissions = () => {
  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Roles y permisos de plataforma"
        description="Gestión global de los roles y permisos de la plataforma SiteCorp"
      />

      <RolesManager scope="platform" />

      <SiteCorpAlert type="info" title="Alcance de esta pantalla">
        <span className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Estos roles controlan qué pueden hacer los administradores y operadores de{" "}
            <strong className="text-ink">SiteCorp a nivel global</strong> (clientes,
            organizaciones, usuarios, roles de plataforma, informes y configuración).
          </span>
        </span>
      </SiteCorpAlert>

      <SiteCorpAlert type="info" title="Roles internos de las entidades">
        <span className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Los roles y permisos <strong className="text-ink">internos</strong> de cada entidad
            (candidatos, plantilla, contratación, contratos, documentos, etc.) pertenecen al nivel de
            la entidad y se administran <strong className="text-ink">desde dentro de cada entidad</strong>,
            no desde Administración global.
          </span>
        </span>
      </SiteCorpAlert>
    </div>
  )
}

export default RolesPermissions
