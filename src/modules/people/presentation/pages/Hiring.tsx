import * as React from "react"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"

const Hiring = () => {
  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Contratación"
        description="Gestión de plantilla y contratación"
      />

      <SiteCorpAlert type="info">
        Este módulo está en desarrollo. Pronto podrás gestionar la plantilla y los procesos de contratación.
      </SiteCorpAlert>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SiteCorpCard title="Plantilla" description="Empleados activos">
          <p className="text-sm text-muted-foreground">
            Lista de empleados en desarrollo.
          </p>
        </SiteCorpCard>
        <SiteCorpCard title="Contratos" description="Gestión de contratos">
          <p className="text-sm text-muted-foreground">
            Gestión de contratos en desarrollo.
          </p>
        </SiteCorpCard>
        <SiteCorpCard title="Nómina" description="Procesos de nómina">
          <p className="text-sm text-muted-foreground">
            Procesos de nómina en desarrollo.
          </p>
        </SiteCorpCard>
      </div>
    </div>
  )
}

export default Hiring