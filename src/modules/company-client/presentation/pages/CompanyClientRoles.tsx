import * as React from "react"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { loadEntityPermission, loadPlatformPermission } from "@/modules/access-control"
import { loadClientEntities, type OrganizationEntity } from "@/modules/organization-structure"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SelectItem } from "@/components/ui/select"
import RolesManager from "@/modules/access-control/presentation/components/roles-manager"
import { Building2, Layers, Factory } from "lucide-react"

const entityTypeLabels: Record<OrganizationEntity["entity_type"], string> = {
  business_group: "Grupo empresarial",
  company: "Empresa",
  ueb: "UEB / Unidad Empresarial de Base",
}

const typeIcon = (type: OrganizationEntity["entity_type"]) => {
  if (type === "business_group") return <Layers className="h-4 w-4 text-sitecorp-primary" />
  if (type === "company") return <Building2 className="h-4 w-4 text-sitecorp-primary" />
  return <Factory className="h-4 w-4 text-sitecorp-primary" />
}

const CompanyClientRoles = () => {
  const { currentCompanyClient } = useCurrentCompanyClient()

  // Primitiva estable del cliente: evita depender del objeto completo en el efecto.
  const currentCompanyClientId = currentCompanyClient?.id

  const [entities, setEntities] = React.useState<OrganizationEntity[]>([])
  const [selectedEntityId, setSelectedEntityId] = React.useState<string>("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canConsultRoles, setCanConsultRoles] = React.useState(false)

  React.useEffect(() => {
    if (!currentCompanyClientId) return

    const loadEntities = async () => {
      try {
        setError(null)
        setLoading(true)

        // Las entidades del cliente las devuelve el dominio de estructura
        // organizativa: la pantalla no compone consultas.
        const rows = await loadClientEntities(currentCompanyClientId)
        setEntities(rows)
        setSelectedEntityId((current) => current || rows[0]?.id || "")
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron cargar las entidades.")
      } finally {
        setLoading(false)
      }
    }

    loadEntities()
  }, [currentCompanyClientId])

  // Consultar los roles de otros usuarios exige gestión de roles (`roles.manage` en la
  // entidad o `tenant_roles.manage` de plataforma). `roles.view` NO habilita la pantalla.
  React.useEffect(() => {
    if (!selectedEntityId) {
      setCanConsultRoles(false)
      return
    }

    let cancelled = false

    const check = async () => {
      const [entityAllowed, platformAllowed] = await Promise.all([
        loadEntityPermission(selectedEntityId, "roles.manage").catch(() => false),
        loadPlatformPermission("tenant_roles.manage").catch(() => false),
      ])
      if (!cancelled) setCanConsultRoles(entityAllowed || platformAllowed)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [selectedEntityId])

  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId)

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Roles y permisos"
        description={`Roles de organización para ${currentCompanyClient?.name || "el cliente actual"}`}
      />

      {!currentCompanyClient ? (
        <SiteCorpAlert type="warning" title="Cliente requerido">
          Selecciona un cliente para gestionar sus roles.
        </SiteCorpAlert>
      ) : (
        <>
          {error && (
            <SiteCorpAlert type="danger" title="Error">
              {error}
            </SiteCorpAlert>
          )}

          <SiteCorpCard title="Seleccionar entidad" description="Los roles de organización son específicos de cada entidad organizativa">
            <div className="space-y-4">
              {loading ? (
                <SiteCorpLoading rows={3} />
              ) : entities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No hay entidades en el cliente actual.
                </div>
              ) : (
                <div className="space-y-4">
                  <SiteCorpSelect
                    label="Entidad organizativa"
                    value={selectedEntityId}
                    onValueChange={setSelectedEntityId}
                  >
                    {entities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>
                        <div className="flex items-center gap-2">
                          {typeIcon(entity.entity_type)}
                          <span>{entity.name}</span>
                          <span className="text-xs text-muted-foreground">[{entity.code}]</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SiteCorpSelect>

                  {selectedEntity && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-sitecorp-background/60 p-3 text-sm">
                      {typeIcon(selectedEntity.entity_type)}
                      <span className="font-medium text-ink">{selectedEntity.name}</span>
                      <span className="text-muted-foreground">[{selectedEntity.code}]</span>
                      <SiteCorpStatusBadge status={selectedEntity.is_active ? "success" : "danger"}>
                        {selectedEntity.is_active ? "Activa" : "Inactiva"}
                      </SiteCorpStatusBadge>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SiteCorpCard>

          {selectedEntityId && canConsultRoles && (
            <RolesManager
              scope="organization"
              companyClientId={currentCompanyClient.id}
              organizationEntityId={selectedEntityId}
            />
          )}

          {selectedEntityId && !canConsultRoles && (
            <SiteCorpAlert type="danger">
              No tiene permiso para consultar los roles de otros usuarios de esta entidad.
            </SiteCorpAlert>
          )}
        </>
      )}
    </div>
  )
}

export default CompanyClientRoles