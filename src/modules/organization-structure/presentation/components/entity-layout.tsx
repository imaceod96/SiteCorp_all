import * as React from "react"
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
import {
  ResponsiveAppShell,
  type ResponsiveShellRenderState,
} from "@/shared/components/responsive-app-shell"
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Undo2,
  Briefcase,
  Settings,
  ArrowLeft,
  CalendarClock,
  Palmtree,
  HeartPulse,
  Calculator,
  FileSignature,
  FileArchive,
  GraduationCap,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  BookOpen,
} from "lucide-react"
import { SidebarUserMenu } from "@/modules/access-control/presentation/components/sidebar-user-menu"
import {
  ENTITY_NAV,
  hasSiteCorpAccount,
  type EntityNavEntry,
  type EntityNavGroup,
  type EntityNavLink,
} from "@/modules/organization-structure"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import { useEntityPlan, isModuleEnabledInPlan } from "@/modules/entity-plans"
import { EntitySwitcher } from "./entity-switcher"

/** Iconos de los elementos del menú (la estructura está en ENTITY_NAV). */
const navIcons: Record<string, React.ReactNode> = {
  summary: <LayoutDashboard className="h-5 w-5 shrink-0" />,
  personas: <Users className="h-5 w-5 shrink-0" />,
  candidates: <Users className="h-5 w-5 shrink-0" />,
  workers: <UserCheck className="h-5 w-5 shrink-0" />,
  reentries: <Undo2 className="h-5 w-5 shrink-0" />,
  staffing: <Briefcase className="h-5 w-5 shrink-0" />,
  hiring: <FileSignature className="h-5 w-5 shrink-0" />,
  training: <GraduationCap className="h-5 w-5 shrink-0" />,
  sst: <ShieldCheck className="h-5 w-5 shrink-0" />,
  prenomina: <Calculator className="h-5 w-5 shrink-0" />,
  vacations: <Palmtree className="h-5 w-5 shrink-0" />,
  "medical-certificates": <HeartPulse className="h-5 w-5 shrink-0" />,
  "pending-documents": <FileArchive className="h-5 w-5 shrink-0" />,
  "contract-alerts": <CalendarClock className="h-5 w-5 shrink-0" />,
  settings: <Settings className="h-5 w-5 shrink-0" />,
  manual: <BookOpen className="h-5 w-5 shrink-0" />,
}

const isVisible = (entry: EntityNavEntry, permissions: string[]): boolean => {
  if (!entry.permissions || entry.permissions.length === 0) return true
  return entry.permissions.some((code) => permissions.includes(code))
}

const EntityLayout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isPlatformUser, isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const { clearCurrentCompanyClient } = useCurrentCompanyClient()
  const { currentEntity, activeEntityId, clearCurrentEntity } = useCurrentEntity()
  const navigate = useNavigate()
  const location = useLocation()

  const [platformEntityCaps, setPlatformEntityCaps] = React.useState<{
    ready: boolean
    canSettings: boolean
    canModules: boolean
  }>(() => ({
    ready: !isPlatformUser || isPlatformSuperAdmin,
    canSettings: isPlatformSuperAdmin,
    canModules: isPlatformSuperAdmin,
  }))

  React.useEffect(() => {
    if (!isPlatformUser || isPlatformSuperAdmin) {
      setPlatformEntityCaps({
        ready: true,
        canSettings: true,
        canModules: true,
      })
      return
    }

    let cancelled = false
    void Promise.all([
      hasPlatformPermission("entity_settings.view"),
      hasPlatformPermission("entity_settings.manage"),
      hasPlatformPermission("entity_modules.view"),
      hasPlatformPermission("entity_modules.manage"),
    ]).then(([settingsView, settingsManage, modulesView, modulesManage]) => {
      if (!cancelled) {
        setPlatformEntityCaps({
          ready: true,
          canSettings: settingsView || settingsManage,
          canModules: modulesView || modulesManage,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [isPlatformUser, isPlatformSuperAdmin, hasPlatformPermission])

  const handleReturnToAdmin = () => {
    clearCurrentCompanyClient()
    clearCurrentEntity()
    navigate("/admin")
  }

  const entityId = currentEntity?.id ?? activeEntityId ?? null

  // Los módulos internos solo existen cuando la entidad es Cuenta SiteCorp
  const modulesEnabled = hasSiteCorpAccount(currentEntity)

  // Cada elemento del menú aparece según el permiso interno REAL del usuario en la
  // entidad actual (mismo motor que usa RLS).
  const { permissions: entityPermissions } = useEntityPermissions(modulesEnabled ? entityId : null)

  // Consulta reactiva del plan activo de la entidad (§7, §8)
  const { plan: entityPlan } = useEntityPlan(modulesEnabled ? entityId : null)

  // Cada elemento del menú aparece según la combinación obligatoria:
  // 1. Módulo habilitado en el plan de la entidad (§7)
  // 2. Permiso interno del usuario en la entidad actual (§8)
  // 3. Para usuarios de plataforma no SuperAdmin, permiso explícito de plataforma
  //    (entity_settings.* para Ajustes / entity_modules.* para módulos operativos)
  const isNavEntryActive = React.useCallback(
    (item: EntityNavLink): boolean => {
      if (!isModuleEnabledInPlan(item.key, entityPlan)) return false
      if (isPlatformUser && !isPlatformSuperAdmin) {
        if (!platformEntityCaps.ready) return item.key === "summary"
        if (item.key === "settings" && !platformEntityCaps.canSettings) {
          return false
        }
        if (
          item.key !== "summary" &&
          item.key !== "settings" &&
          item.key !== "manual" &&
          !platformEntityCaps.canModules
        ) {
          return false
        }
      }
      return isVisible(item, entityPermissions)
    },
    [entityPlan, entityPermissions, isPlatformUser, isPlatformSuperAdmin, platformEntityCaps]
  )

  // Elementos visibles según plan activo Y permisos reales, preservando el orden definitivo.
  const visibleNav = React.useMemo(() => {
    return ENTITY_NAV.map((entry) => {
      if (entry.kind === "group") {
        const items = entry.items.filter((item) => isNavEntryActive(item))
        if (items.length === 0) return null
        return { ...entry, items } as EntityNavGroup
      }
      return isNavEntryActive(entry) ? (entry as EntityNavLink) : null
    }).filter((entry): entry is EntityNavEntry => entry !== null)
  }, [isNavEntryActive])

  // Grupos desplegables: se expanden automáticamente cuando contienen la ruta activa.
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!entityId) return
    setOpenGroups((prev) => {
      const next = { ...prev }
      visibleNav.forEach((entry) => {
        if (entry.kind !== "group") return
        const containsActive = entry.items.some((item) =>
          location.pathname.startsWith(item.path(entityId))
        )
        if (containsActive) next[entry.key] = true
      })
      return next
    })
  }, [location.pathname, entityId, visibleNav])

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))

  const isRouteActive = React.useCallback(
    (path: string) => {
      if (path === "/home") {
        return (
          location.pathname === "/home" ||
          location.pathname === "/" ||
          location.pathname === "/summary"
        )
      }
      return location.pathname.startsWith(path)
    },
    [location.pathname]
  )

  const renderLink = (item: EntityNavLink, shell: ResponsiveShellRenderState) => {
    const targetPath = item.path(entityId ?? undefined)
    const active = isRouteActive(targetPath)
    return (
      <Link
        key={item.key}
        to={targetPath}
        title={item.label}
        aria-label={item.label}
        onClick={() => {
          if (!shell.isDesktop) shell.collapseSidebar()
        }}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium transition-colors",
          shell.collapsed
            ? "mx-auto h-10 w-10 justify-center p-0"
            : "gap-3 px-3 py-2.5",
          active
            ? "bg-sitecorp-primary/10 text-sitecorp-primary"
            : "text-ink hover:bg-muted hover:text-ink"
        )}
      >
        {navIcons[item.key] || <Settings className="h-5 w-5 shrink-0" />}
        {!shell.collapsed && <span className="flex-1 truncate">{item.label}</span>}
      </Link>
    )
  }

  // "Regresar a Administración Global": solo para usuarios con acceso REAL a la
  // administración global de SiteCorp que están navegando dentro de una entidad.
  // Un usuario normal de empresa nunca lo ve.
  const showGlobalAdminReturn = isPlatformUser

  return (
    <ResponsiveAppShell
      ref={ref}
      className={className}
      {...props}
      renderHeader={() => (
        <div className="flex min-w-0 w-full items-center gap-2.5">
          <SiteCorpBrand variant="isotype" size="sm" />
          <div className="min-w-0 flex-1">
            <EntitySwitcher />
          </div>
        </div>
      )}
      renderNav={(shell) => (
        <div className={cn(shell.collapsed ? "space-y-1.5" : "space-y-1")}>
          {entityId && modulesEnabled && (
            <>
              {visibleNav.map((entry) => {
                if (entry.kind === "link") return renderLink(entry, shell)

                const isOpen = !!openGroups[entry.key]
                const containsActive = entry.items.some((item) =>
                  isRouteActive(item.path(entityId))
                )

                if (shell.collapsed) {
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      title={entry.label}
                      aria-label={entry.label}
                      onClick={() => {
                        shell.expandSidebar()
                        setOpenGroups((prev) => ({ ...prev, [entry.key]: true }))
                      }}
                      className={cn(
                        "mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                        containsActive
                          ? "bg-sitecorp-primary/10 text-sitecorp-primary"
                          : "text-ink hover:bg-muted hover:text-ink"
                      )}
                    >
                      {navIcons[entry.key] || <Users className="h-5 w-5 shrink-0" />}
                    </button>
                  )
                }

                return (
                  <div key={entry.key} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(entry.key)}
                      aria-expanded={isOpen}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        containsActive
                          ? "text-sitecorp-primary"
                          : "text-ink hover:bg-muted hover:text-ink"
                      )}
                    >
                      {navIcons[entry.key] || <Users className="h-5 w-5 shrink-0" />}
                      <span className="flex-1 text-left truncate">{entry.label}</span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="ml-4 space-y-1 border-l border-border pl-2">
                        {entry.items.map((item) => renderLink(item, shell))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {entityId && !modulesEnabled && !shell.collapsed && (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Esta entidad no tiene habilitados los módulos internos de SiteCorp.
            </p>
          )}
        </div>
      )}
      renderFooter={(shell) => (
        <div className={cn(shell.collapsed ? "space-y-1.5" : "space-y-2")}>
          {showGlobalAdminReturn && (
            <button
              type="button"
              onClick={handleReturnToAdmin}
              title="Regresar a Administración Global"
              aria-label="Regresar a Administración Global"
              className={cn(
                "flex items-center rounded-lg text-sm font-medium text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                shell.collapsed ? "mx-auto h-10 w-10 justify-center p-0" : "w-full gap-2 px-3 py-2"
              )}
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              {!shell.collapsed && (
                <span className="truncate">Regresar a Administración Global</span>
              )}
            </button>
          )}
          <SidebarUserMenu
            accountPath={isPlatformUser ? "/admin/account" : null}
            compact={shell.collapsed}
          />
        </div>
      )}
    >
      <Outlet />
    </ResponsiveAppShell>
  )
})

EntityLayout.displayName = "EntityLayout"

export { EntityLayout }
