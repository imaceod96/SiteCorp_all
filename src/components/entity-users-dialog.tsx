import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectQuery,
  tableName,
} from "@/integrations/supabase/schema-target"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
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
import { ArrowUpFromLine, Mail, Power, ShieldCheck, UserPlus } from "lucide-react"

export interface OrganizationEntity {
  id: string
  tenant_id: string
  parent_id: string | null
  entity_type: "business_group" | "company" | "ueb"
  name: string
  code: string
  regime_id: string
  status: string
  description: string | null
  address: string | null
  municipality: string | null
  province: string | null
  postal_code: string | null
  is_active: boolean
  is_sitecorp_account: boolean
  account_is_active: boolean
  account_code: string | null
}

interface EntityAccessRow {
  access_id: string
  tenant_membership_id: string
  user_id: string
  full_name: string | null
  username: string | null
  profile_is_active: boolean
  tenant_role_id: string
  role_name: string
  source_entity_id: string
  source_entity_name: string
  access_scope: "SELF" | "SELF_AND_DESCENDANTS"
  is_direct: boolean
}

interface TenantMembership {
  id: string
  user_id: string
  tenant_id: string
  is_active: boolean
}

interface TenantRole {
  id: string
  name: string
  is_active: boolean
}

interface Profile {
  id: string
  full_name: string | null
  username: string | null
  is_active: boolean
}

const scopeLabels: Record<EntityAccessRow["access_scope"], string> = {
  SELF: "Solo esta entidad",
  SELF_AND_DESCENDANTS: "Esta entidad y sus descendientes",
}

const errorMessages: Record<string, string> = {
  "users.manage": "Necesitas permiso para gestionar usuarios en esta entidad.",
  "users.invite": "Necesitas permiso para invitar usuarios en esta entidad.",
}

const friendlyError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()

  if (normalized.includes("duplicate key") || normalized.includes("unique constraint")) {
    return "Ya existe una asignación idéntica para este usuario, entidad y rol."
  }
  if (normalized.includes("row-level security")) {
    return "No tienes permiso para realizar esta acción en esta entidad."
  }
  if (normalized.includes("must belong to the same organization entity")) {
    return "El rol seleccionado no pertenece a esta entidad. Selecciona un rol interno de esta entidad."
  }
  if (normalized.includes("invitation role must belong to the invited")) {
    return "El rol de la invitación debe pertenecer a esta entidad."
  }
  if (normalized.includes("entity invitations require an organization role")) {
    return "Las invitaciones desde una entidad requieren un rol interno de esa entidad."
  }
  if (normalized.includes("users.manage") || normalized.includes("users.invite")) {
    const permission = normalized.includes("users.invite") ? "users.invite" : "users.manage"
    return errorMessages[permission]
  }
  return message || fallback
}

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
  const [memberships, setMemberships] = React.useState<TenantMembership[]>([])
  const [profiles, setProfiles] = React.useState<Profile[]>([])
  const [roles, setRoles] = React.useState<TenantRole[]>([])
  const [canManage, setCanManage] = React.useState(false)
  const [canInvite, setCanInvite] = React.useState(false)
  const [membershipId, setMembershipId] = React.useState("")
  const [roleId, setRoleId] = React.useState("")
  const [scope, setScope] = React.useState<EntityAccessRow["access_scope"]>("SELF")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviteRoleId, setInviteRoleId] = React.useState("")
  const [inviteScope, setInviteScope] = React.useState<EntityAccessRow["access_scope"]>("SELF")

  const loadData = React.useCallback(async () => {
    if (!entity) return

    try {
      setError(null)
      setSuccess(null)
      setLoading(true)

      const [accessResult, membershipResult, roleResult, manageResult, inviteResult] =
        await Promise.all([
          supabase.rpc("list_entity_user_access", { target_entity_id: entity.id }),
          supabase
            .from(tableName("memberships"))
            .select(selectQuery(`id,user_id,${selectColumn("clientId")},is_active`))
            .eq(columnName("clientId"), entity.tenant_id)
            .eq("is_active", true),
          // Sólo los roles PROPIOS de esta entidad: un rol de otra entidad del
          // mismo cliente no puede asignarse aquí (el backend lo rechaza además).
          supabase
            .from(tableName("roles"))
            .select("id,name,is_active")
            .eq("organization_entity_id", entity.id)
            .eq("is_active", true)
            .order("name"),
          supabase.rpc("can_access_entity", {
            target_entity_id: entity.id,
            permission_code: "users.manage",
          }),
          supabase.rpc("can_access_entity", {
            target_entity_id: entity.id,
            permission_code: "users.invite",
          }),
        ])

      if (accessResult.error) throw accessResult.error
      if (membershipResult.error) throw membershipResult.error
      if (roleResult.error) throw roleResult.error

      const membershipRows = membershipResult.data || []
      const userIds = membershipRows.map((membership: TenantMembership) => membership.user_id)
      const profileResult = userIds.length
        ? await supabase
            .from("profiles")
            .select("id,full_name,username,is_active")
            .in("id", userIds)
        : { data: [], error: null }

      if (profileResult.error) throw profileResult.error

      setAccessRows((accessResult.data || []) as EntityAccessRow[])
      setMemberships(membershipRows)
      setProfiles((profileResult.data || []) as Profile[])
      setRoles((roleResult.data || []) as TenantRole[])
      setCanManage(Boolean(manageResult.data))
      setCanInvite(Boolean(inviteResult.data))
    } catch (err) {
      setError(friendlyError(err, "No se pudo cargar el acceso de usuarios."))
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
    return profiles.reduce<Record<string, Profile>>((map, profile) => {
      map[profile.id] = profile
      return map
    }, {})
  }, [profiles])

  const directRows = accessRows.filter((row) => row.is_direct)
  const inheritedRows = accessRows.filter((row) => !row.is_direct)

  const assignAccess = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!entity || !user) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const { error: assignError } = await supabase.from("entity_user_access").insert({
        [columnName("membershipId")]: membershipId,
        organization_entity_id: entity.id,
        [columnName("roleId")]: roleId,
        access_scope: scope,
        is_active: true,
        assigned_by: user.id,
      })

      if (assignError) throw assignError

      setMembershipId("")
      setRoleId("")
      setScope("SELF")
      setSuccess("Acceso asignado correctamente.")
      await loadData()
      onAccessChanged()
    } catch (err) {
      setError(friendlyError(err, "No se pudo asignar el acceso."))
    } finally {
      setSaving(false)
    }
  }

  const toggleAccess = async (row: EntityAccessRow) => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      const { error: updateError } = await supabase
        .from("entity_user_access")
        .update({ is_active: false })
        .eq("id", row.access_id)

      if (updateError) throw updateError

      setSuccess("Acceso directo desactivado.")
      await loadData()
      onAccessChanged()
    } catch (err) {
      setError(friendlyError(err, "No se pudo desactivar el acceso."))
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

      const { error: inviteError } = await supabase.from(tableName("invitations")).insert({
        [columnName("clientId")]: entity.tenant_id,
        email: inviteEmail.trim(),
        [columnName("roleId")]: inviteRoleId,
        organization_entity_id: entity.id,
        access_scope: inviteScope,
        invited_by: user.id,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })

      if (inviteError) throw inviteError

      setInviteEmail("")
      setInviteRoleId("")
      setInviteScope("SELF")
      setSuccess("Invitación registrada. La cuenta de acceso se creará al aceptarla.")
    } catch (err) {
      setError(friendlyError(err, "No se pudo registrar la invitación."))
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
          const displayName = row.full_name || profile?.full_name || "Usuario"
          const username = row.username || profile?.username || "sin usuario"

          return (
            <div
              key={`${row.access_id}-${inherited ? "inherited" : "direct"}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{username}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SiteCorpStatusBadge status="info">{row.role_name}</SiteCorpStatusBadge>
                  <SiteCorpStatusBadge status="neutral">
                    {scopeLabels[row.access_scope]}
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
                      {memberships.map((membership) => {
                        const profile = profileById[membership.user_id]
                        return (
                          <SelectItem key={membership.id} value={membership.id}>
                            {profile?.full_name || profile?.username || membership.user_id}
                          </SelectItem>
                        )
                      })}
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
                      onValueChange={(value) => setScope(value as EntityAccessRow["access_scope"])}
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
                      onValueChange={(value) =>
                        setInviteScope(value as EntityAccessRow["access_scope"])
                      }
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
