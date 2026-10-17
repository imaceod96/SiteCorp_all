import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SelectItem } from "@/components/ui/select"
import {
  ACCESS_SCOPE_LABELS,
  accessDisplayName,
  accessRoleLabel,
  accessRowsByOwnership,
  accessUsername,
  assignEntityAccess,
  deactivateEntityAccess,
  friendlyAccessError,
  inviteToEntity,
  loadEntityAccessWorkspace,
  membershipLabel,
  type AccessScope,
  type ClientMembership,
  type EntityAccessRow,
  type EntityRoleOption,
  type UserProfile,
} from "@/modules/access-control"
import { ArrowUpFromLine, Mail, Power, ShieldCheck, UserPlus } from "lucide-react"
import type { OrganizationEntity } from "@/modules/organization-structure"

// Compatibilidad: el tipo de la entidad organizativa se sigue exponiendo desde este
// módulo porque las páginas de organización ya lo importaban desde aquí.
export type { OrganizationEntity } from "@/modules/organization-structure"

/**
 * Usuarios con acceso a UNA entidad organizativa: accesos directos y heredados.
 *
 * Toda la lógica y la persistencia viven en el dominio de control de acceso
 * (`@/domains/access-control`): la visibilidad de usuarios la decide el backend
 * (`list_entity_user_access`), los permisos se preguntan con `can_access_entity` y las
 * escrituras pasan por RLS con los permisos efectivos del solicitante.
 *
 * Este componente sólo compone la interfaz. Ninguna comprobación del servidor se
 * sustituye por una del cliente: ocultar el formulario es una ayuda visual, no un
 * control de acceso.
 */

export const EntityUsersDialog = ({
  entity,
  onClose,
  onAccessChanged,
}: {
  entity: OrganizationEntity | null
  onClose: () => void
  onAccessChanged: () => void
}) => {
  const { user, isPlatformSuperAdmin } = useAuth()
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [inviting, setInviting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [accessRows, setAccessRows] = React.useState<EntityAccessRow[]>([])
  const [memberships, setMemberships] = React.useState<ClientMembership[]>([])
  const [profiles, setProfiles] = React.useState<UserProfile[]>([])
  const [roles, setRoles] = React.useState<EntityRoleOption[]>([])
  const [canManage, setCanManage] = React.useState(false)
  const [canInvite, setCanInvite] = React.useState(false)
  const [membershipId, setMembershipId] = React.useState("")
  const [roleId, setRoleId] = React.useState("")
  const [scope, setScope] = React.useState<AccessScope>("SELF")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviteRoleId, setInviteRoleId] = React.useState("")
  const [inviteScope, setInviteScope] = React.useState<AccessScope>("SELF")

  const loadData = React.useCallback(async () => {
    if (!entity) return

    try {
      setError(null)
      setSuccess(null)
      setLoading(true)

      const workspace = await loadEntityAccessWorkspace({
        entityId: entity.id,
        clientId: entity.tenant_id,
      })

      setAccessRows(workspace.accessRows)
      setMemberships(workspace.memberships)
      setProfiles(workspace.profiles)
      setRoles(workspace.roles)
      setCanManage(workspace.canManage)
      setCanInvite(workspace.canInvite)
    } catch (err) {
      setError(friendlyAccessError(err, "No se pudo cargar el acceso de usuarios."))
    } finally {
      setLoading(false)
    }
  }, [entity])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    setMembershipId("")
    setRoleId("")
    setScope("SELF")
    setInviteEmail("")
    setInviteRoleId("")
    setInviteScope("SELF")
  }, [entity?.id])

  const profileById = React.useMemo(() => {
    return profiles.reduce<Record<string, UserProfile>>((map, profile) => {
      map[profile.id] = profile
      return map
    }, {})
  }, [profiles])

  const { direct: directRows, inherited: inheritedRows } = accessRowsByOwnership(accessRows)

  const assignAccess = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!entity || !user) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      await assignEntityAccess({
        entityId: entity.id,
        membershipId,
        roleId,
        accessScope: scope,
        assignedBy: user.id,
      })

      setMembershipId("")
      setRoleId("")
      setScope("SELF")
      setSuccess("Acceso asignado correctamente.")
      await loadData()
      onAccessChanged()
    } catch (err) {
      setError(friendlyAccessError(err, "No se pudo asignar el acceso."))
    } finally {
      setSaving(false)
    }
  }

  const toggleAccess = async (row: EntityAccessRow) => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      await deactivateEntityAccess(row.access_id)

      setSuccess("Acceso directo desactivado.")
      await loadData()
      onAccessChanged()
    } catch (err) {
      setError(friendlyAccessError(err, "No se pudo desactivar el acceso."))
    } finally {
      setSaving(false)
    }
  }

  const sendInvitation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!entity || !user) return

    try {
      setInviting(true)
      setError(null)
      setSuccess(null)

      await inviteToEntity({
        clientId: entity.tenant_id,
        entityId: entity.id,
        email: inviteEmail.trim(),
        roleId: inviteRoleId,
        accessScope: inviteScope,
        invitedBy: user.id,
      })

      setInviteEmail("")
      setInviteRoleId("")
      setInviteScope("SELF")
      setSuccess("Invitación registrada. La cuenta de acceso se creará al aceptarla.")
    } catch (err) {
      setError(friendlyAccessError(err, "No se pudo registrar la invitación."))
    } finally {
      setInviting(false)
    }
  }

  const renderRows = (rows: EntityAccessRow[], inherited: boolean) => {
    if (rows.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {inherited
            ? "No hay acceso heredado desde entidades superiores."
            : "No hay usuarios con acceso directo."}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {rows.map((row) => {
          const profile = row.user_id ? profileById[row.user_id] : undefined
          const displayName = accessDisplayName(row, profile)
          const username = accessUsername(row, profile)

          return (
            <div
              key={`${row.access_id}-${inherited ? "inherited" : "direct"}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{username}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SiteCorpStatusBadge status="info">{accessRoleLabel(row)}</SiteCorpStatusBadge>
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
              {!inherited && canManage && (
                <SiteCorpButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => toggleAccess(row)}
                >
                  <Power className="mr-1 h-3.5 w-3.5" /> Desactivar
                </SiteCorpButton>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Dialog
      open={Boolean(entity)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-sitecorp-primary" />
            Usuarios — {entity?.name || ""}
          </DialogTitle>
          <DialogDescription>
            Usuarios con acceso directo y heredado a esta entidad organizativa.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <SiteCorpAlert type="danger" title="Error">
            {error}
          </SiteCorpAlert>
        )}
        {success && (
          <SiteCorpAlert type="success" title="Operación realizada">
            {success}
          </SiteCorpAlert>
        )}
        {isPlatformSuperAdmin && !entity?.account_is_active && entity?.is_sitecorp_account && (
          <SiteCorpAlert type="warning" title="Cuenta suspendida">
            Esta cuenta SiteCorp está suspendida. Los usuarios no podrán operarla normalmente, pero
            Platform SuperAdmin puede inspeccionarla y configurarla.
          </SiteCorpAlert>
        )}

        {loading ? (
          <SiteCorpLoading rows={4} />
        ) : (
          <div className="space-y-4">
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

            {canManage && (
              <SiteCorpCard
                title="Asignar usuario"
                description="El rol define qué puede hacer; la entidad y el alcance definen dónde"
              >
                <form onSubmit={assignAccess} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <SiteCorpSelect
                      label="Usuario"
                      value={membershipId}
                      onValueChange={setMembershipId}
                      required
                    >
                      {memberships.map((membership) => (
                        <SelectItem key={membership.id} value={membership.id}>
                          {membershipLabel(membership, profileById[membership.user_id])}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>

                    <SiteCorpSelect label="Rol" value={roleId} onValueChange={setRoleId} required>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>

                    <SiteCorpSelect
                      label="Alcance"
                      value={scope}
                      onValueChange={(value) => setScope(value as AccessScope)}
                      required
                    >
                      <SelectItem value="SELF">Solo esta entidad</SelectItem>
                      <SelectItem value="SELF_AND_DESCENDANTS">
                        Esta entidad y sus descendientes
                      </SelectItem>
                    </SiteCorpSelect>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <SiteCorpButton type="submit" disabled={saving} className="sm:w-auto">
                      <UserPlus className="mr-2 h-4 w-4" />
                      {saving ? "Asignando..." : "Asignar acceso"}
                    </SiteCorpButton>
                    <SiteCorpButton
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMembershipId("")
                        setRoleId("")
                        setScope("SELF")
                      }}
                    >
                      Limpiar
                    </SiteCorpButton>
                  </div>
                </form>
              </SiteCorpCard>
            )}

            {canInvite && (
              <SiteCorpCard
                title="Invitar a esta entidad"
                description="La invitación crea acceso solamente para esta entidad"
              >
                <form onSubmit={sendInvitation} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-ink">Email</label>
                      <SiteCorpInput
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="usuario@empresa.com"
                        required
                      />
                    </div>

                    <SiteCorpSelect label="Rol" value={inviteRoleId} onValueChange={setInviteRoleId} required>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SiteCorpSelect>

                    <SiteCorpSelect
                      label="Alcance"
                      value={inviteScope}
                      onValueChange={(value) => setInviteScope(value as AccessScope)}
                      required
                    >
                      <SelectItem value="SELF">Solo esta entidad</SelectItem>
                      <SelectItem value="SELF_AND_DESCENDANTS">
                        Esta entidad y sus descendientes
                      </SelectItem>
                    </SiteCorpSelect>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <SiteCorpButton type="submit" disabled={inviting} className="sm:w-auto">
                      <Mail className="mr-2 h-4 w-4" />
                      {inviting ? "Registrando..." : "Registrar invitación"}
                    </SiteCorpButton>
                  </div>

                  <SiteCorpAlert type="info">
                    <span className="flex items-start gap-2">
                      <ArrowUpFromLine className="mt-0.5 h-4 w-4 shrink-0" />
                      Al aceptar la invitación se crea o activa la membresía del cliente y el
                      acceso exclusivamente a esta entidad con el rol y alcance seleccionados.
                    </span>
                  </SiteCorpAlert>
                </form>
              </SiteCorpCard>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default EntityUsersDialog
