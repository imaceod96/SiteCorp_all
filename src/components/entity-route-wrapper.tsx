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
} from "@/domains/organization-structure"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { EntityLayout } from "@/components/entity-layout"
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

  return <EntityLayout><Outlet /></EntityLayout>
}

export default EntityRouteWrapper