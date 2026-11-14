import * as React from "react"
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { toCompanyClient } from "@/modules/company-client"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
import {
  ResponsiveAppShell,
  type ResponsiveShellRenderState,
} from "@/shared/components/responsive-app-shell"
import { SidebarUserMenu } from "@/modules/access-control/presentation/components/sidebar-user-menu"
import {
  LayoutDashboard,
  Building2,
  Users,
  Shield,
  ArrowLeft,
  Scale,
  Settings,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  History,
  Layers,
  BookOpen,
} from "lucide-react"

const PlatformAdminLayout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const [canViewDocuments, setCanViewDocuments] = React.useState(isPlatformSuperAdmin)
  const [canViewHistory, setCanViewHistory] = React.useState(isPlatformSuperAdmin)
  const [canViewPlans, setCanViewPlans] = React.useState(isPlatformSuperAdmin)

  React.useEffect(() => {
    if (isPlatformSuperAdmin) {
      setCanViewDocuments(true)
      setCanViewHistory(true)
      setCanViewPlans(true)
      return
    }
    let cancelled = false
    void Promise.all([
      hasPlatformPermission("platform_documents.view"),
      hasPlatformPermission("platform_audit.view"),
      hasPlatformPermission("entity_plans.view"),
    ]).then(([docs, hist, plans]) => {
      if (!cancelled) {
        setCanViewDocuments(docs)
        setCanViewHistory(hist)
        setCanViewPlans(plans)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isPlatformSuperAdmin, hasPlatformPermission])

  const { currentCompanyClient, clearCurrentCompanyClient } = useCurrentCompanyClient()
  const { clearCurrentEntity } = useCurrentEntity()
  const navigate = useNavigate()
  const location = useLocation()

  // Cliente activo expresado con el vocabulario de dominio. El mapper solo
  // proyecta el objeto que ya expone el contexto: no consulta, no genera
  // identificadores y no concede permisos. `currentCompanyClient` sigue siendo
  // la única fuente de verdad del cliente activo.
  const companyClient = currentCompanyClient ? toCompanyClient(currentCompanyClient) : null

  const handleReturnToAdmin = () => {
    clearCurrentCompanyClient()
    clearCurrentEntity()
    navigate("/admin")
  }

  const isEntityRoute = location.pathname.startsWith("/organization/")
  // Solo mostramos el regreso cuando el usuario está realmente dentro de un
  // contexto inferior (cliente/entidad); si ya está en Administración Global, no.
  const showGlobalAdminReturn = !!currentCompanyClient || isEntityRoute

  const navItem = (
    shell: ResponsiveShellRenderState,
    to: string,
    icon: React.ReactNode,
    label: string,
    exact = false
  ) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to)
    return (
      <Link
        key={to}
        to={to}
        title={label}
        aria-label={label}
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
        {icon}
        {!shell.collapsed && <span className="truncate">{label}</span>}
      </Link>
    )
  }

  // Sección "Gestión" desplegable: contiene Plan por entidad (§2) y Manual de Gestor
  const gestionRoutes = ["/admin/plans", "/admin/manual"]
  const gestionContainsActive = gestionRoutes.some((route) =>
    location.pathname.startsWith(route)
  )
  const [gestionOpen, setGestionOpen] = React.useState<boolean>(gestionContainsActive || true)

  React.useEffect(() => {
    if (gestionContainsActive) setGestionOpen(true)
  }, [gestionContainsActive])

  // Sección "Ajustes" desplegable: oculta por defecto, se abre al pulsar la
  // pestaña y se expande sola cuando la ruta activa pertenece al grupo.
  const ajustesRoutes = ["/admin/users", "/admin/roles", "/admin/settings"]
  const ajustesContainsActive = ajustesRoutes.some((route) =>
    location.pathname.startsWith(route)
  )
  const [ajustesOpen, setAjustesOpen] = React.useState(ajustesContainsActive)

  React.useEffect(() => {
    if (ajustesContainsActive) setAjustesOpen(true)
  }, [ajustesContainsActive])

  return (
    <ResponsiveAppShell
      ref={ref}
      className={className}
      {...props}
      renderHeader={() => (
        <div className="flex min-w-0 items-center gap-3">
          <SiteCorpBrand variant="isotype" size="sm" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">SiteCorp</h2>
            <p className="truncate text-xs text-muted-foreground">
              {companyClient?.name || "Admin"}
            </p>
          </div>
        </div>
      )}
      renderNav={(shell) => (
        <div className={cn(shell.collapsed ? "space-y-1.5" : "space-y-1")}>
          {navItem(shell, "/admin", <LayoutDashboard className="h-5 w-5 shrink-0" />, "Inicio", true)}
          {navItem(shell, "/admin/companies", <Building2 className="h-5 w-5 shrink-0" />, "Clientes")}
          {navItem(shell, "/admin/candidates", <Users className="h-5 w-5 shrink-0" />, "Bolsa de Candidatos")}

          {/* Documentos globales: Super Admin o usuarios con platform_documents.view */}
          {canViewDocuments &&
            navItem(shell, "/admin/documents", <FolderOpen className="h-5 w-5 shrink-0" />, "Documentos")}

          {/* Historial: auditoría centralizada (Super Admin o platform_audit.view) */}
          {canViewHistory &&
            navItem(shell, "/admin/history", <History className="h-5 w-5 shrink-0" />, "Historial")}

          {/* Sección Gestión: desplegable con Plan (§2) */}
          {canViewPlans && (
            shell.collapsed ? (
              <button
                type="button"
                title="Gestión"
                aria-label="Gestión"
                onClick={() => {
                  shell.expandSidebar()
                  setGestionOpen(true)
                }}
                className={cn(
                  "mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  gestionContainsActive
                    ? "bg-sitecorp-primary/10 text-sitecorp-primary"
                    : "text-ink hover:bg-muted hover:text-ink"
                )}
              >
                <Layers className="h-5 w-5 shrink-0" />
              </button>
            ) : (
              <div className="space-y-1 pt-3">
                <button
                  type="button"
                  onClick={() => setGestionOpen((open) => !open)}
                  aria-expanded={gestionOpen}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    gestionContainsActive
                      ? "text-sitecorp-primary"
                      : "text-ink hover:bg-muted hover:text-ink"
                  )}
                >
                  <Layers className="h-5 w-5 shrink-0" />
                  <span className="flex-1 text-left">Gestión</span>
                  {gestionOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                </button>
                {gestionOpen && (
                  <div className="ml-4 space-y-1 border-l border-border pl-2">
                    {navItem(shell, "/admin/plans", <Layers className="h-5 w-5 shrink-0" />, "Plan")}
                    {navItem(shell, "/admin/manual", <BookOpen className="h-5 w-5 shrink-0" />, "Manual de Gestor")}
                  </div>
                )}
              </div>
            )
          )}

          {/* Sección Ajustes: desplegable que se oculta cuando no se usa. */}
          {shell.collapsed ? (
            <button
              type="button"
              title="Ajustes"
              aria-label="Ajustes"
              onClick={() => {
                shell.expandSidebar()
                setAjustesOpen(true)
              }}
              className={cn(
                "mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                ajustesContainsActive
                  ? "bg-sitecorp-primary/10 text-sitecorp-primary"
                  : "text-ink hover:bg-muted hover:text-ink"
              )}
            >
              <Settings className="h-5 w-5 shrink-0" />
            </button>
          ) : (
            <div className="space-y-1 pt-3">
              <button
                type="button"
                onClick={() => setAjustesOpen((open) => !open)}
                aria-expanded={ajustesOpen}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  ajustesContainsActive
                    ? "text-sitecorp-primary"
                    : "text-ink hover:bg-muted hover:text-ink"
                )}
              >
                <Settings className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">Ajustes</span>
                {ajustesOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
              </button>
              {ajustesOpen && (
                <div className="ml-4 space-y-1 border-l border-border pl-2">
                  {navItem(shell, "/admin/users", <Users className="h-5 w-5 shrink-0" />, "Usuarios")}
                  {navItem(shell, "/admin/roles", <Shield className="h-5 w-5 shrink-0" />, "Roles y permisos")}
                  {navItem(
                    shell,
                    "/admin/settings/salary-scale",
                    <Scale className="h-5 w-5 shrink-0" />,
                    "Escala salarial presupuestada"
                  )}
                </div>
              )}
            </div>
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
          <SidebarUserMenu accountPath="/admin/account" compact={shell.collapsed} />
        </div>
      )}
    >
      <Outlet />
    </ResponsiveAppShell>
  )
})
PlatformAdminLayout.displayName = "PlatformAdminLayout"

export { PlatformAdminLayout }
