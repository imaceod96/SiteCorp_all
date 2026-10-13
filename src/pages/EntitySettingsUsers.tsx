import * as React from "react"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { EntityUsersDialog, type OrganizationEntity } from "@/components/entity-users-dialog"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { UserPlus, Users } from "lucide-react"
import {
  ACCESS_SCOPE_LABELS,
  loadEntityAccessOverview,
  type EntityAccessRow,
} from "@/domains/access-control"

/**
 * Ajustes → Usuarios de UNA entidad.
 *
 * Muestra únicamente las personas con acceso a ESTA entidad (directo o heredado
 * desde un ancestro), nunca todos los usuarios del workspace: la visibilidad la
 * decide el backend (`list_entity_user_access`), no un filtro de la interfaz.
 *
 * La consulta y los permisos se resuelven en el dominio de control de acceso.
 */
const EntitySettingsUsers = () => {
  const { currentEntity } = useCurrentEntity()
  const entityId = currentEntity?.id

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<EntityAccessRow[]>([])
  const [canManage, setCanManage] = React.useState(false)
  const [usersEntity, setUsersEntity] = React.useState<OrganizationEntity | null>(null)

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const overview = await loadEntityAccessOverview(entityId)

      setRows(overview.accessRows)
      setCanManage(overview.canManage)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No tiene permiso para consultar los usuarios de esta entidad."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  if (!currentEntity) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Usuarios"
          description="Usuarios con acceso a la entidad organizativa"
        />
        <SiteCorpCard title="Cargando">
          <p className="text-sm text-muted-foreground">Cargando información de la entidad...</p>
        </SiteCorpCard>
      </div>
    )
  }

  const renderRows = (list: EntityAccessRow[], inherited: boolean) => {
    if (list.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {inherited
            ? "No hay acceso heredado desde entidades superiores."
            : "No hay usuarios con acceso directo a esta entidad."}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {list.map((row) => (
          <div
            key={`${row.access_id}-${inherited ? "inherited" : "direct"}`}
            className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {row.full_name || row.username || "Usuario"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                @{row.username || "sin usuario"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SiteCorpStatusBadge status="info">{row.role_name}</SiteCorpStatusBadge>
              <SiteCorpStatusBadge status="neutral">
                {ACCESS_SCOPE_LABELS[row.access_scope]}
              </SiteCorpStatusBadge>
              {inherited && (
                <SiteCorpStatusBadge status="warning">
                  Heredado desde {row.source_entity_name}
                </SiteCorpStatusBadge>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const directRows = rows.filter((row) => row.is_direct)
  const inheritedRows = rows.filter((row) => !row.is_direct)

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Usuarios"
        description={`Usuarios con acceso a ${currentEntity.name}. El rol define qué pueden hacer; el alcance define dónde.`}
      />

      <SiteCorpAlert type="info" title="Contexto actual">
        <div className="flex items-center gap-2">
          <span>Entidad actual:</span>
          <strong className="text-ink">{currentEntity.name}</strong>
          <SiteCorpStatusBadge status="neutral">
            {currentEntity.entity_type === "business_group"
              ? "Grupo empresarial"
              : currentEntity.entity_type === "company"
                ? "Empresa"
                : "UEB"}
          </SiteCorpStatusBadge>
        </div>
      </SiteCorpAlert>

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      )}

      {loading ? (
        <SiteCorpLoading rows={4} />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              {directRows.length} acceso(s) directo(s) · {inheritedRows.length} heredado(s)
            </div>
            {canManage && (
              <SiteCorpButton onClick={() => setUsersEntity(currentEntity as OrganizationEntity)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Gestionar acceso e invitar
              </SiteCorpButton>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SiteCorpCard title="Acceso directo" description="Asignaciones exactas a esta entidad">
              {renderRows(directRows, false)}
            </SiteCorpCard>
            <SiteCorpCard
              title="Acceso heredado"
              description="Acceso derivado desde un ancestro con descendientes"
            >
              {renderRows(inheritedRows, true)}
            </SiteCorpCard>
          </div>
        </>
      )}

      <EntityUsersDialog
        entity={usersEntity}
        onClose={() => setUsersEntity(null)}
        onAccessChanged={() => {
          void loadData()
        }}
      />
    </div>
  )
}

export default EntitySettingsUsers
