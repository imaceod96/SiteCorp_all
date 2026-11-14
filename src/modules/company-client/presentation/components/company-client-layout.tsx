import * as React from "react"
import { Outlet, Link, useLocation } from "react-router-dom"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
import { ResponsiveAppShell } from "@/shared/components/responsive-app-shell"
import { SidebarUserMenu } from "@/modules/access-control/presentation/components/sidebar-user-menu"
import { toCompanyClient } from "@/modules/company-client"
import {
  LayoutDashboard,
  Building2,
  Users,
  Briefcase,
  Mail,
  Shield,
} from "lucide-react"

/**
 * Rutas de la aplicación del cliente. Los segmentos `/tenant/*` son el contrato
 * de navegación vigente: se conservan tal cual (no son nomenclatura de dominio).
 */
const companyClientNavItems = [
  { label: "Panel", href: "/", icon: LayoutDashboard },
  { label: "Organización", href: "/organization", icon: Building2 },
  { label: "Usuarios", href: "/tenant/users", icon: Users },
  { label: "Roles y permisos", href: "/tenant/roles", icon: Shield },
  { label: "Invitaciones", href: "/tenant/invitations", icon: Mail },
  { label: "Candidatos", href: "/candidates", icon: Users },
  { label: "Contratación", href: "/hiring", icon: Briefcase },
]

const CompanyClientLayout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { currentCompanyClient } = useCurrentCompanyClient()
  const location = useLocation()

  // Cliente propietario de los datos expresado con el vocabulario de dominio.
  // El mapper solo proyecta el objeto que ya expone el contexto: no consulta,
  // no genera identificadores y no concede permisos. `currentCompanyClient`
  // sigue siendo la única fuente de verdad del cliente activo.
  const companyClient = currentCompanyClient ? toCompanyClient(currentCompanyClient) : null

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
              {companyClient?.name || "Cliente"}
            </p>
          </div>
        </div>
      )}
      renderNav={(shell) => (
        <div className={cn(shell.collapsed ? "space-y-1.5" : "space-y-1")}>
          {companyClientNavItems.map((item) => {
            const active =
              item.href === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                to={item.href}
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
                <item.icon className="h-5 w-5 shrink-0" />
                {!shell.collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            )
          })}
        </div>
      )}
      renderFooter={(shell) => <SidebarUserMenu compact={shell.collapsed} />}
    >
      <Outlet />
    </ResponsiveAppShell>
  )
})
CompanyClientLayout.displayName = "CompanyClientLayout"

export { CompanyClientLayout }
