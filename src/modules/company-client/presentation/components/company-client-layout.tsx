import * as React from "react"
import { Outlet, Link } from "react-router-dom"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { cn } from "@/lib/utils"
import { SiteCorpBrand } from "@/components/sitecorp-brand"
import { SidebarUserMenu } from "@/components/sidebar-user-menu"
import { toCompanyClient } from "@/domains/company-client"
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

  // Cliente propietario de los datos expresado con el vocabulario de dominio.
  // El mapper solo proyecta el objeto que ya expone el contexto: no consulta,
  // no genera identificadores y no concede permisos. `currentCompanyClient`
  // sigue siendo la única fuente de verdad del cliente activo.
  const companyClient = currentCompanyClient ? toCompanyClient(currentCompanyClient) : null

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
              <p className="truncate text-xs text-muted-foreground">{companyClient?.name || "Cliente"}</p>
            </div>
          </div>
        </div>

        {/* Navigation (scrollable) */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {companyClientNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-muted hover:text-ink transition-colors"
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        {/* Footer fijo (no desaparece aunque la navegación tenga scroll) */}
        <div className="shrink-0 border-t border-border p-3">
          <SidebarUserMenu />
        </div>
      </div>

      {/* Main content */}
      <main className="ml-64 flex-1 overflow-y-auto bg-sitecorp-background">
        <Outlet />
      </main>
    </div>
  )
})
CompanyClientLayout.displayName = "CompanyClientLayout"

export { CompanyClientLayout }
