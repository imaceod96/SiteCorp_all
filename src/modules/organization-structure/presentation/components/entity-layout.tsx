import * as React from "react"
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
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

/** Iconos de los elementos del menú (la estructura está en ENTITY_NAV). */
const navIcons: Record<string, React.ReactNode> = {
  summary: <LayoutDashboard className="h-5 w-5" />,
  personas: <Users className="h-5 w-5" />,
  candidates: <Users className="h-5 w-5" />,
  workers: <UserCheck className="h-5 w-5" />,
  reentries: <Undo2 className="h-5 w-5" />,
  staffing: <Briefcase className="h-5 w-5" />,
  hiring: <FileSignature className="h-5 w-5" />,
  training: <GraduationCap className="h-5 w-5" />,
  sst: <ShieldCheck className="h-5 w-5" />,
  prenomina: <Calculator className="h-5 w-5" />,
  vacations: <Palmtree className="h-5 w-5" />,
  "medical-certificates": <HeartPulse className="h-5 w-5" />,
  "pending-documents": <FileArchive className="h-5 w-5" />,
  "contract-alerts": <CalendarClock className="h-5 w-5" />,
  settings: <Settings className="h-5 w-5" />,
}

const isVisible = (entry: EntityNavEntry, permissions: string[]): boolean => {
  if (!entry.permissions || entry.permissions.length === 0) return true
  return entry.permissions.some((code) => permissions.includes(code))
}

const EntityLayout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isPlatformUser } = useAuth()
  const { clearCurrentCompanyClient } = useCurrentCompanyClient()
  const { currentEntity, clearCurrentEntity } = useCurrentEntity()
  const navigate = useNavigate()
  const location = useLocation()

  const handleReturnToAdmin = () => {
    clearCurrentCompanyClient()
    clearCurrentEntity()
    navigate("/admin")
  }

  const entityId = currentEntity?.id

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
  const isNavEntryActive = React.useCallback(
    (item: EntityNavLink): boolean => {
      if (!isModuleEnabledInPlan(item.key, entityPlan)) return false
      return isVisible(item, entityPermissions)
    },
    [entityPlan, entityPermissions]
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

  const renderLink = (item: EntityNavLink) => {
    const active = location.pathname.startsWith(item.path(entityId as string))
    return (
      <Link
        key={item.key}
        to={item.path(entityId as string)}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-sitecorp-primary/10 text-sitecorp-primary"
            : "text-ink hover:bg-muted hover:text-ink"
        )}
      >
        {navIcons[item.key] || <Settings className="h-5 w-5" />}
        <span className="flex-1">{item.label}</span>
      </Link>
    )
  }

  // "Regresar a Administración Global": solo para usuarios con acceso REAL a la
  // administración global de SiteCorp que están navegando dentro de una entidad.
  // Un usuario normal de empresa nunca lo ve.
  const showGlobalAdminReturn = isPlatformUser

  return (
    <div
      ref={ref}
      className={cn("flex h-screen w-full overflow-hidden", className)}
      {...props}
    >
      {/* Sidebar */}
      <div className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-card">
        {/* Logo / Brand */}
        <div className="flex h-16 shrink-0 items-center border-b border-border px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SiteCorpBrand variant="isotype" size="sm" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">SiteCorp</h2>
              <p className="truncate text-xs text-muted-foreground">
                {currentEntity?.name || "Entidad"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation (scrollable) */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {entityId && modulesEnabled && (
              <>
                {visibleNav.map((entry) => {
                  if (entry.kind === "link") return renderLink(entry)

                  const isOpen = !!openGroups[entry.key]
                  const containsActive = entry.items.some((item) =>
                    location.pathname.startsWith(item.path(entityId))
                  )
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
                        {navIcons[entry.key] || <Users className="h-5 w-5" />}
                        <span className="flex-1 text-left">{entry.label}</span>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="ml-4 space-y-1 border-l border-border pl-2">
                          {entry.items.map((item) => renderLink(item))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {entityId && !modulesEnabled && (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Esta entidad no tiene habilitados los módulos internos de SiteCorp.
              </p>
            )}
          </div>
        </nav>

        {/* Footer fijo (no desaparece aunque la navegación tenga scroll) */}
        <div className="shrink-0 space-y-2 border-t border-border p-3">
          {showGlobalAdminReturn && (
            <button
              type="button"
              onClick={handleReturnToAdmin}
              title="Regresar a Administración Global"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">Regresar a Administración Global</span>
            </button>
          )}
          <SidebarUserMenu accountPath={isPlatformUser ? "/admin/account" : null} />
        </div>
      </div>

      {/* Main content */}
      <main className="ml-64 flex-1 overflow-y-auto bg-sitecorp-background">
        <Outlet />
      </main>
    </div>
  )
})

EntityLayout.displayName = "EntityLayout"

export { EntityLayout }
