import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { ArrowRight, Building2, Users, Briefcase } from "lucide-react"

const Index = () => {
  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Panel de control"
        description="Bienvenido a SiteCorp, tu plataforma de gestión de RRHH"
      />

      <SiteCorpAlert type="success">
        La aplicación está funcionando correctamente. Los módulos se irán habilitando progresivamente.
      </SiteCorpAlert>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SiteCorpCard
          title="Organización"
          description="Gestión de la estructura organizativa"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>Estructura, departamentos y puestos</span>
          </div>
        </SiteCorpCard>
        <SiteCorpCard
          title="Candidatos"
          description="Gestión de candidatos"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>Selección y pipeline de candidatos</span>
          </div>
        </SiteCorpCard>
        <SiteCorpCard
          title="Contratación"
          description="Gestión de plantilla y contratación"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Briefcase className="h-4 w-4" />
            <span>Plantilla, contratos y nómina</span>
          </div>
        </SiteCorpCard>
      </div>

      <div className="mt-8 flex gap-3">
        <Link
          to="/organization"
          className="inline-flex items-center gap-2 rounded-md bg-sitecorp-primary px-4 py-2 text-sm font-medium text-white hover:bg-sitecorp-primary-dark"
        >
          Ir a Organización <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/candidates"
          className="inline-flex items-center gap-2 rounded-md bg-sitecorp-primary px-4 py-2 text-sm font-medium text-white hover:bg-sitecorp-primary-dark"
        >
          Ir a Candidatos <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/hiring"
          className="inline-flex items-center gap-2 rounded-md bg-sitecorp-primary px-4 py-2 text-sm font-medium text-white hover:bg-sitecorp-primary-dark"
        >
          Ir a Contratación <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}

export default Index