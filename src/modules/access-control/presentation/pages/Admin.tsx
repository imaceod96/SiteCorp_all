import * as React from "react"
import { useNavigate } from "react-router-dom"
import { companyClientMetrics, loadCompanyClients } from "@/modules/company-client"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { Building2, Users, Shield, ArrowRight } from "lucide-react"

const Admin = () => {
  const navigate = useNavigate()
  const [metrics, setMetrics] = React.useState({
    total: 0,
    active: 0,
    inactive: 0,
  })
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const loadMetrics = async () => {
      try {
        // Lectura de LISTA del dominio del cliente propietario: no se sustituye por lecturas
        // unitarias y ninguna consulta se compone aquí. Las cifras las calcula la regla pura
        // del dominio, con el mismo criterio que ya aplicaba la pantalla.
        const companyClients = await loadCompanyClients()
        setMetrics(companyClientMetrics(companyClients))
      } catch (error) {
        console.error("Error loading metrics:", error)
      } finally {
        setLoading(false)
      }
    }
    loadMetrics()
  }, [])

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Administración Global"
        description="Gestión de la plataforma SiteCorp"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SiteCorpCard title="Total de clientes">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-ink">{metrics.total}</p>
              <p className="text-sm text-muted-foreground">Clientes registrados</p>
            </div>
            <Building2 className="h-8 w-8 text-sitecorp-primary" />
          </div>
        </SiteCorpCard>
        <SiteCorpCard title="Clientes activos">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-sitecorp-success">{metrics.active}</p>
              <p className="text-sm text-muted-foreground">Clientes activos</p>
            </div>
            <SiteCorpStatusBadge status="success">Activo</SiteCorpStatusBadge>
          </div>
        </SiteCorpCard>
        <SiteCorpCard title="Clientes inactivos">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-sitecorp-warning">{metrics.inactive}</p>
              <p className="text-sm text-muted-foreground">Clientes inactivos</p>
            </div>
            <SiteCorpStatusBadge status="warning">Inactivo</SiteCorpStatusBadge>
          </div>
        </SiteCorpCard>
      </div>

      <div className="grid gap-4">
        <SiteCorpCard title="Acciones rápidas">
          <div className="space-y-3">
            <SiteCorpButton
              className="w-full justify-start"
              variant="outline"
              onClick={() => navigate("/admin/companies")}
            >
              <Building2 className="h-4 w-4 mr-2" />
              Clientes
            </SiteCorpButton>
            <SiteCorpButton
              className="w-full justify-start"
              variant="outline"
              onClick={() => navigate("/admin/users")}
            >
              <Users className="h-4 w-4 mr-2" />
              Usuarios de plataforma
            </SiteCorpButton>
            <SiteCorpButton
              className="w-full justify-start"
              variant="outline"
              onClick={() => navigate("/admin/roles")}
            >
              <Shield className="h-4 w-4 mr-2" />
              Roles y permisos
            </SiteCorpButton>
          </div>
        </SiteCorpCard>
      </div>

      <div className="mt-6">
        <SiteCorpButton onClick={() => navigate("/admin/companies")}>
          Ir a Clientes <ArrowRight className="h-4 w-4 ml-2" />
        </SiteCorpButton>
      </div>
    </div>
  )
}

export default Admin