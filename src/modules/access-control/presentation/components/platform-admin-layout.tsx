import * as React from "react"
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { toCompanyClient } from "@/domains/company-client"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/components/sitecorp-brand"
import { SidebarUserMenu } from "@/components/sidebar-user-menu"
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
} from "lucide-react"

const PlatformAdminLayout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
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

  const navItem = (to: string, icon: React.ReactNode, label: string, exact = false) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to)
    return (
      <Link
        to={to}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-sitecorp-primary/10 text-sitecorp-primary"
            : "text-ink hover:bg-muted hover:text-ink"
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </Link>
    )
  }

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
                {companyClient?.name || "Admin"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation (scrollable) */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {navItem("/admin", <LayoutDashboard className="h-5 w-5" />, "Inicio", true)}
            {navItem(
              "/admin/companies",
              <Building2 className="h-5 w-5" />,
              "Clientes"
            )}

            {/* Sección Ajustes: desplegable que se oculta cuando no se usa. */}
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
                <Settings className="h-5 w-5" />
                <span className="flex-1 text-left">Ajustes</span>
                {ajustesOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {ajustesOpen && (
                <div className="ml-4 space-y-1 border-l border-border pl-2">
                  {navItem("/admin/users", <Users className="h-5 w-5" />, "Usuarios")}
                  {navItem("/admin/roles", <Shield className="h-5 w-5" />, "Roles y permisos")}
                  {navItem(
                    "/admin/settings/salary-scale",
                    <Scale className="h-5 w-5" />,
                    "Escala salarial presupuestada"
                  )}
                </div>
              )}
            </div>
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
          <SidebarUserMenu accountPath="/admin/account" />
        </div>
      </div>

      {/* Main content */}
      <main className="ml-64 flex-1 overflow-y-auto bg-sitecorp-background">
        <Outlet />
      </main>
    </div>
  )
})
PlatformAdminLayout.displayName = "PlatformAdminLayout"

export { PlatformAdminLayout }
