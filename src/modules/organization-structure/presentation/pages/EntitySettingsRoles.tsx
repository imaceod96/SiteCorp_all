import * as React from "react"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { RolesManager } from "@/modules/access-control/presentation/components/roles-manager"
import { loadEntityPermission } from "@/modules/access-control"

/**
 * Ajustes → Roles y permisos de UNA entidad.
 *
 * Muestra exclusivamente los roles internos de la entidad actual: aunque otra
 * entidad del mismo workspace tenga un rol con el mismo nombre, es un rol distinto.
 *
 * Acceso: consultar y administrar los roles de OTROS usuarios exige el permiso de
 * gestión `roles.manage` (no existe una vía de consulta independiente: `roles.view`
 * no habilita esta pantalla). La comprobación de acceso la responde el backend
 * (`can_access_entity`); si falla, se muestra el error en lugar de asumir un permiso.
 */
const EntitySettingsRoles = () => {
  const { currentEntity } = useCurrentEntity()
  const entityId = currentEntity?.id

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canView, setCanView] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    const check = async () => {
      if (!entityId) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const allowed = await loadEntityPermission(entityId, "roles.manage")
        if (!cancelled) setCanView(allowed)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "No se pudo verificar el acceso a los roles."
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [entityId])

  if (!currentEntity) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Roles y permisos"
          description="Roles internos de la entidad organizativa"
        />
        <SiteCorpCard title="Cargando">
          <p className="text-sm text-muted-foreground">Cargando información de la entidad...</p>
        </SiteCorpCard>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Roles y permisos"
        description={`Roles internos de ${currentEntity.name}. Son propios de esta entidad y no afectan a otras entidades del mismo cliente.`}
      />

      {loading ? (
        <SiteCorpLoading rows={4} />
      ) : error ? (
        <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
      ) : !canView ? (
        <SiteCorpAlert type="danger">
          No tiene permiso para consultar los roles y permisos de esta entidad.
        </SiteCorpAlert>
      ) : (
        <RolesManager scope="organization" organizationEntityId={currentEntity.id} />
      )}
    </div>
  )
}

export default EntitySettingsRoles
