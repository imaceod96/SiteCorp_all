import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { Users, Shield, Scale, FileText, Network, ClipboardList, FileType2, Briefcase, FileSpreadsheet, BookOpen, ArrowUpDown } from "lucide-react"

interface SettingsItem {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  /** Permiso interno que habilita el acceso a la sección. */
  permissions: string[]
}

const EntitySettings = () => {
  const { isPlatformUser, isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const { currentEntity } = useCurrentEntity()
  const navigate = useNavigate()
  const { permissions: entityPermissions, loading } = useEntityPermissions(currentEntity?.id)
  const [platformSettingsState, setPlatformSettingsState] = React.useState<{
    checked: boolean
    allowed: boolean
  }>(() => ({
    checked: !isPlatformUser || isPlatformSuperAdmin,
    allowed: !isPlatformUser || isPlatformSuperAdmin,
  }))

  React.useEffect(() => {
    if (!isPlatformUser || isPlatformSuperAdmin) {
      setPlatformSettingsState({ checked: true, allowed: true })
      return
    }

    let cancelled = false
    void Promise.all([
      hasPlatformPermission("entity_settings.view"),
      hasPlatformPermission("entity_settings.manage"),
    ]).then(([canView, canManage]) => {
      if (!cancelled) {
        setPlatformSettingsState({ checked: true, allowed: canView || canManage })
      }
    })

    return () => {
      cancelled = true
    }
  }, [isPlatformUser, isPlatformSuperAdmin, hasPlatformPermission])

  const settingsItems: SettingsItem[] = React.useMemo(
    () => [
      {
        title: "Usuarios",
        description: "Gestiona el acceso de usuarios a esta entidad.",
        icon: Users,
        href: "/settings/users",
        permissions: ["users.view", "users.manage"],
      },
      {
        title: "Roles y permisos",
        description: "Roles internos propios de esta entidad y sus capacidades.",
        icon: Shield,
        href: "/settings/roles",
        // Consultar/administrar los roles de otros usuarios exige gestión de roles:
        // `roles.view` no habilita esta sección.
        permissions: ["roles.manage"],
      },
      {
        title: "Escala salarial",
        description: "Consulta o gestiona la escala salarial empresarial de esta entidad.",
        icon: Scale,
        href: "/settings/salary",
        permissions: ["salary.view", "salary.manage"],
      },
      {
        title: "Escala de pago de antigüedad",
        description: "Configura los tramos de pago por antigüedad de esta entidad.",
        icon: Briefcase,
        href: "/settings/tenure-scale",
        permissions: ["tenure_scale.view", "tenure_scale.manage"],
      },
      {
        title: "Configuración de plantilla",
        description:
          "Configura las áreas, cargos y puestos que conforman la estructura de plantilla de la entidad.",
        icon: Network,
        href: "/settings/staffing",
        permissions: ["staffing.view", "staffing.manage"],
      },
      {
        title: "Carga inicial de trabajadores",
        description: "Descarga la plantilla Excel, valida filas y carga trabajadores históricos.",
        icon: FileSpreadsheet,
        href: "/settings/initial-import",
        permissions: ["workers.initial_import", "workers.manage"],
      },
      {
        title: "Altas y Bajas",
        description:
          "Registro histórico centralizado de altas, bajas definitivas y reincorporaciones laborales, y exportación al modelo oficial.",
        icon: ArrowUpDown,
        href: "/settings/altas-bajas",
        permissions: ["workers.view", "workers.manage"],
      },
      {
        title: "Datos contractuales",
        description:
          "Datos contractuales de la entidad y representantes autorizados para la formalización de contratos.",
        icon: ClipboardList,
        href: "/settings/contract-data",
        permissions: ["contract_data.view", "contract_data.manage"],
      },
      {
        title: "Plantillas documentales",
        description:
          "Gestiona las plantillas Word (.doc y .docx) de los contratos y anexos de esta entidad, sus versiones y las variables documentales que utilizan.",
        icon: FileType2,
        href: "/settings/document-templates",
        permissions: ["document_templates.view", "document_templates.manage"],
      },
      {
        title: "Documentos rectores",
        description:
          "Registra y consulta los documentos rectores de esta entidad (nombre y archivo).",
        icon: FileText,
        href: "/settings/governing-documents",
        permissions: ["organization.view", "organization.manage"],
      },
      {
        title: "Manual de usuario",
        description:
          "Guía oficial de operación de personal, plantilla, nómina, SST y contratos.",
        icon: BookOpen,
        href: "/manual",
        permissions: [],
      },
    ],
    []
  )

  const configItemsVisible = platformSettingsState.allowed
    ? settingsItems.filter(
        (item) =>
          item.permissions.length > 0 &&
          item.permissions.some((code) => entityPermissions.includes(code))
      )
    : []

  const visibleItems =
    configItemsVisible.length > 0
      ? settingsItems.filter(
          (item) =>
            item.permissions.length === 0 ||
            item.permissions.some((code) => entityPermissions.includes(code))
        )
      : []

  const isChecking = loading || !platformSettingsState.checked

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SiteCorpPageHeader
        title="Ajustes"
        description={`Administración y configuración de ${currentEntity?.name || "esta entidad"}`}
      />

      {!isChecking && visibleItems.length === 0 ? (
        <SiteCorpAlert type="warning" title="Sin permisos de configuración">
          No tiene permisos internos de configuración en esta entidad. Contacte con el
          administrador de la entidad.
        </SiteCorpAlert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.title}
                onClick={() => navigate(item.href)}
                className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:border-sitecorp-primary/30 hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sitecorp-primary/10">
                  <Icon className="h-5 w-5 text-sitecorp-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default EntitySettings
