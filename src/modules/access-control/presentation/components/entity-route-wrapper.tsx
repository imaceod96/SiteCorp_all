import * as React from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { canViewEntity } from "@/modules/access-control"
import {
  SITECORP_MODULES_DISABLED_MESSAGE,
  SITECORP_MODULES_DISABLED_TITLE,
  hasSiteCorpAccount,
  loadEntitySiteCorpFlag,
  loadOrganizationEntity,
  organizationFallbackPath,
} from "@/modules/organization-structure"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { EntityLayout } from "@/modules/organization-structure/presentation/components/entity-layout"
import { useEntityPlan } from "@/modules/entity-plans"
import { Outlet } from "react-router-dom"
import { ShieldOff } from "lucide-react"

const EntityRouteWrapper = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const { setCurrentEntity, clearCurrentEntity } = useCurrentEntity()

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // La entidad existe y el usuario tiene acceso, pero no es Cuenta SiteCorp
  const [modulesDisabled, setModulesDisabled] = React.useState(false)
  const [fallbackPath, setFallbackPath] = React.useState("/organization")
  const initialLoadDone = React.useRef(false)

  // Consulta incondicional del plan activo a nivel superior (§7.5, reglas de hooks)
  const { plan: entityPlan, loading: planLoading } = useEntityPlan(entityId)

  // Bloqueo de acceso por URL directa a módulos desactivados en el plan (§7.5)
  const planRestriction = React.useMemo(() => {
    if (!entityPlan || planLoading) return null

    if (
      location.pathname.includes("/payroll-preparation") &&
      entityPlan.packagePrenomina === false
    ) {
      return {
        moduleName: "El módulo de Prenómina",
        packageName: "Prenómina",
      }
    }

    if (
      (location.pathname.includes("/training") || location.pathname.includes("/sst")) &&
      entityPlan.packageTrainingSst === false
    ) {
      return {
        moduleName: location.pathname.includes("/sst")
          ? "El módulo de Seguridad y Salud en el Trabajo (SST)"
          : "El módulo de Capacitación",
        packageName: "Capacitación y SST",
      }
    }

    return null
  }, [entityPlan, planLoading, location.pathname])

  React.useEffect(() => {
    if (!entityId) {
      setError("ID de entidad no proporcionado")
      setLoading(false)
      return
    }

    const loadEntity = async () => {
      try {
        setLoading(true)
        setError(null)

        // La entidad la devuelve el dominio de estructura organizativa (con la clave
        // JS `tenant_id` que consumen los módulos internos ya resuelta).
        const entity = await loadOrganizationEntity(entityId)

        // Authorization logic
        let isAuthorized = false

        // 1. Platform SuperAdmin always authorized
        if (isPlatformSuperAdmin) {
          isAuthorized = true
        }
        // 2. Platform User with organization view/manage permissions
        else {
          const [viewAllPerm, manageAllPerm] = await Promise.all([
            hasPlatformPermission("organizations.view_all"),
            hasPlatformPermission("organizations.manage_all")
          ])
          
          if (viewAllPerm || manageAllPerm) {
            isAuthorized = true
          }
          // 3. Normal entity-user access check (lo decide el backend).
          else {
            isAuthorized = await canViewEntity(entityId)
          }
        }

        if (!isAuthorized) {
          throw new Error("Acceso no autorizado")
        }

        // Protección de los módulos internos: además del acceso a la entidad, las rutas
        // /entity/:entityId/* requieren que la entidad sea Cuenta SiteCorp.
        if (!hasSiteCorpAccount(entity)) {
          setCurrentEntity(null)
          setModulesDisabled(true)
          return
        }

        setModulesDisabled(false)
        setCurrentEntity(entity)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar la entidad")
      } finally {
        initialLoadDone.current = true
        setLoading(false)
      }
    }

    initialLoadDone.current = false
    loadEntity()
  }, [entityId, isPlatformSuperAdmin, hasPlatformPermission, setCurrentEntity])

  // Ruta externa de retorno (Organizaciones o estructura del cliente)
  React.useEffect(() => {
    let cancelled = false

    const resolveFallback = async () => {
      if (isPlatformSuperAdmin) {
        setFallbackPath("/admin/companies")
        return
      }
      const [viewAllPerm, manageAllPerm] = await Promise.all([
        hasPlatformPermission("organizations.view_all"),
        hasPlatformPermission("organizations.manage_all"),
      ])
      if (!cancelled) {
        setFallbackPath(
          organizationFallbackPath({
            isPlatformSuperAdmin: false,
            hasPlatformOrganizationAccess: viewAllPerm || manageAllPerm,
          })
        )
      }
    }

    resolveFallback()
    return () => {
      cancelled = true
    }
  }, [isPlatformSuperAdmin, hasPlatformPermission])

  // Revalidación de la bandera SiteCorp en cada navegación interna: si la cuenta se
  // desactiva (por ejemplo desde otra pestaña) se bloquea el acceso a los módulos.
  React.useEffect(() => {
    if (!entityId || !initialLoadDone.current) return
    let cancelled = false

    const revalidate = async () => {
      // Un fallo de la lectura no cambia de estado (`null`), igual que antes.
      const siteCorpFlag = await loadEntitySiteCorpFlag(entityId)

      if (cancelled || siteCorpFlag === null) return
      if (!hasSiteCorpAccount({ is_sitecorp_account: siteCorpFlag })) {
        clearCurrentEntity()
        setModulesDisabled(true)
      } else {
        setModulesDisabled(false)
      }
    }

    revalidate()
    return () => {
      cancelled = true
    }
  }, [entityId, location.pathname, clearCurrentEntity])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Cargando entidad..."
          description="Obteniendo información de la entidad organizativa"
        />
        <SiteCorpLoading rows={3} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Error"
          description="No se pudo cargar la entidad organizativa"
        />
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
        <div className="flex justify-end">
          <SiteCorpButton variant="outline" onClick={() => navigate(fallbackPath)}>
            Volver a organizaciones
          </SiteCorpButton>
        </div>
      </div>
    )
  }

  if (modulesDisabled) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title={SITECORP_MODULES_DISABLED_TITLE}
          description="Gestión interna no disponible para esta entidad"
        />
        <SiteCorpCard title="Acceso restringido">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sitecorp-warning/10">
              <ShieldOff className="h-6 w-6 text-sitecorp-warning" />
            </span>
            <p className="max-w-lg text-sm text-muted-foreground">
              {SITECORP_MODULES_DISABLED_MESSAGE} Puedes activarla desde la edición de la entidad
              en la estructura organizativa.
            </p>
            <SiteCorpButton variant="outline" onClick={() => navigate(fallbackPath)}>
              Volver a organizaciones
            </SiteCorpButton>
          </div>
        </SiteCorpCard>
      </div>
    )
  }

  if (planRestriction) {
    return (
      <EntityLayout>
        <div className="space-y-6 p-6">
          <SiteCorpPageHeader
            title="Módulo no disponible en el plan"
            description="Funcionalidad no contratada para esta entidad"
          />
          <SiteCorpCard title="Acceso no habilitado">
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <ShieldOff className="h-7 w-7" />
              </span>
              <h3 className="text-base font-bold text-ink">
                {planRestriction.moduleName} no está incluido en el plan de esta entidad
              </h3>
              <p className="max-w-md text-xs text-muted-foreground">
                Esta cuenta no tiene contratado el paquete <strong>{planRestriction.packageName}</strong>.
                Un administrador autorizado de la plataforma puede habilitarlo desde la sección{" "}
                <strong>Gestión → Plan</strong>.
              </p>
              <div className="pt-2">
                <SiteCorpButton
                  variant="outline"
                  onClick={() => navigate(`/entity/${entityId}/summary`)}
                >
                  Ir al Resumen de la entidad
                </SiteCorpButton>
              </div>
            </div>
          </SiteCorpCard>
        </div>
      </EntityLayout>
    )
  }

  return <EntityLayout><Outlet /></EntityLayout>
}

export default EntityRouteWrapper