import * as React from "react"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"

const Candidates = () => {
  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Candidatos"
        description="Gestión de candidatos"
      />

      <SiteCorpAlert type="info">
        Este módulo está en desarrollo. Pronto podrás gestionar los candidatos del proceso de selección.
      </SiteCorpAlert>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SiteCorpCard title="Candidatos activos" description="Lista de candidatos">
          <p className="text-sm text-muted-foreground">
            Lista de candidatos en desarrollo.
          </p>
        </SiteCorpCard>
        <SiteCorpCard title="Pipeline" description="Etapa del proceso">
          <p className="text-sm text-muted-foreground">
            Pipeline de selección en desarrollo.
          </p>
        </SiteCorpCard>
        <SiteCorpCard title="Fuentes" description="Origen de candidatos">
          <p className="text-sm text-muted-foreground">
            Fuentes de captación en desarrollo.
          </p>
        </SiteCorpCard>
      </div>
    </div>
  )
}

export default Candidates