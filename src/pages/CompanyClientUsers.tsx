import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { supabase } from "@/lib/supabase"
import {
  columnName,
  selectColumn,
  selectEmbed,
  selectQuery,
  tableName,
} from "@/integrations/supabase/schema-target"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpTable } from "@/components/ui/sitecorp-table"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpFormSection } from "@/components/ui/sitecorp-form-section"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpError } from "@/components/ui/sitecorp-error"
import { Pencil, Plus, Power, UserMinus, UserCheck, Mail } from "lucide-react"

interface CompanyClientUser {
  id: string
  full_name: string
  username: string
  email: string
  is_active: boolean
  membership_status: string
  invitation_status: string
  role_name: string
  created_at: string
}

const CompanyClientUsers = () => {
  const { isPlatformSuperAdmin } = useAuth()
  const { currentCompanyClient } = useCurrentCompanyClient()
  const navigate = useNavigate()
  const [users, setUsers] = React.useState<CompanyClientUser[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editingUser, setEditingUser] = React.useState<CompanyClientUser | null>(null)
  const [formData, setFormData] = React.useState({
    full_name: "",
    username: "",
    email: "",
  })

  const loadUsers = React.useCallback(async () => {
    try {
      setError(null)
      setLoading(true)
      if (!currentCompanyClient) return

      const { data: membersData, error: membersError } = await supabase
        .from(tableName("memberships"))
        .select(selectQuery(`id,user_id,${selectColumn("clientId")},is_active,created_at`))
        .eq(columnName("clientId"), currentCompanyClient.id)

      if (membersError) throw membersError

      const memberRows = membersData || []
      const userIds = memberRows.map((member: { id: string; user_id: string; is_active: boolean; created_at: string }) => member.user_id)
      const membershipIds = memberRows.map((member: { id: string; user_id: string; is_active: boolean; created_at: string }) => member.id)

      const [profilesResult, rolesResult] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("id,full_name,username,is_active").in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
        membershipIds.length
          ? supabase
              .from(tableName("userRoles"))
              .select(
                selectQuery(
                  `${selectColumn("membershipId")},${selectColumn("roleId")},${selectEmbed("roles", "tenant_roles")}(name)`,
                ),
              )
              .in(columnName("membershipId"), membershipIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (profilesResult.error) throw profilesResult.error
      if (rolesResult.error) throw rolesResult.error

      const profilesById = (profilesResult.data || []).reduce((map: Record<string, { id: string; full_name: string | null; username: string | null; is_active: boolean }>, profile: { id: string; full_name: string | null; username: string | null; is_active: boolean }) => {
        map[profile.id] = profile
        return map
      }, {})
      const rolesByMembership = (rolesResult.data || []).reduce(
        (map: Record<string, { name: string | null } | null>, roleAssignment: { tenant_membership_id: string; tenant_roles: { name: string | null } | null }) => {
          map[roleAssignment.tenant_membership_id] = roleAssignment.tenant_roles
          return map
        },
        {}
      )

      const usersWithDetails = memberRows.map((member: { id: string; user_id: string; is_active: boolean; created_at: string }) => {
        const profile = profilesById[member.user_id]

        return {
          id: member.user_id,
          full_name: profile?.full_name || "Usuario",
          username: profile?.username || "sin usuario",
          email: profile?.username || "",
          is_active: member.is_active,
          membership_status: member.is_active ? "active" : "inactive",
          invitation_status: "none",
          role_name: rolesByMembership[member.id]?.name || "Sin rol",
          created_at: member.created_at,
        }
      })

      setUsers(usersWithDetails)
    } catch (err) {
      console.error("Error loading users:", err)
      setError("No se pudo cargar la lista de usuarios.")
    } finally {
      setLoading(false)
    }
  }, [currentCompanyClient])

  React.useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const startCreate = () => {
    setEditingUser(null)
    setFormData({ full_name: "", username: "", email: "" })
  }

  const startEdit = (user: CompanyClientUser) => {
    setEditingUser(user)
    setFormData({ full_name: user.full_name, username: user.username, email: user.email })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingUser && currentCompanyClient) {
        const { error } = await supabase
          .from("profiles")
          .update({ full_name: formData.full_name, username: formData.username })
          .eq("id", editingUser.id)
        if (error) throw error
      }
      setEditingUser(null)
      setFormData({ full_name: "", username: "", email: "" })
      await loadUsers()
    } catch (err) {
      setError("No se pudo guardar el usuario.")
    }
  }

  const toggleActive = async (user: CompanyClientUser) => {
    try {
      if (!currentCompanyClient) return
      const { error } = await supabase
        .from(tableName("memberships"))
        .update({ is_active: !user.is_active })
        .eq(columnName("clientId"), currentCompanyClient.id)
        .eq("user_id", user.id)
      if (error) throw error
      await loadUsers()
    } catch (err) {
      console.error("Error toggling membership:", err)
      setError("No se pudo cambiar el estado de la membresía.")
    }
  }

  const columns = [
    { header: "Nombre completo", accessor: "full_name" },
    { header: "Usuario", accessor: "username" },
    { header: "Email", accessor: "email" },
    { header: "Rol", accessor: "role_name" },
    { header: "Estado", accessor: "status" },
    { header: "Fecha de creación", accessor: "created_at" },
    { header: "Acciones", accessor: "actions" },
  ]

  const rows = users.map((user) => ({
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    role_name: user.role_name,
    status: (
      <SiteCorpStatusBadge status={user.is_active ? "success" : "warning"}>
        {user.is_active ? "Activo" : "Inactivo"}
      </SiteCorpStatusBadge>
    ),
    created_at: new Date(user.created_at).toLocaleDateString("es-ES"),
    actions: (
      <div className="flex items-center gap-2">
        <SiteCorpButton size="sm" variant="outline" onClick={() => startEdit(user)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
        </SiteCorpButton>
        <SiteCorpButton size="sm" variant="outline" onClick={() => toggleActive(user)}>
          {user.is_active ? (
            <>
              <UserMinus className="h-3.5 w-3.5 mr-1" /> Desactivar
            </>
          ) : (
            <>
              <UserCheck className="h-3.5 w-3.5 mr-1" /> Reactivar
            </>
          )}
        </SiteCorpButton>
      </div>
    ),
  }))

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Usuarios"
        description={`Gestión de usuarios en ${currentCompanyClient?.name || "este cliente"}`}
        actions={
          <SiteCorpButton onClick={startCreate}>
            <Plus className="h-4 w-4 mr-2" /> Invitar usuario
          </SiteCorpButton>
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      )}

      {!isPlatformSuperAdmin && (
        <SiteCorpAlert type="warning" title="Acceso restringido">
          Necesitas permisos de usuario para gestionar usuarios.
        </SiteCorpAlert>
      )}

      <SiteCorpCard title="Usuarios del cliente">
        {loading ? (
          <SiteCorpLoading rows={5} />
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No hay usuarios registrados en este cliente.
          </div>
        ) : (
          <SiteCorpTable columns={columns} data={rows} />
        )}
      </SiteCorpCard>

      {editingUser && (
        <SiteCorpFormSection
          title={editingUser ? "Editar usuario" : "Invitar usuario"}
          description={
            editingUser
              ? "Actualiza los datos del usuario"
              : "Invita a un nuevo usuario al cliente"
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Nombre completo</label>
                <SiteCorpInput
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Usuario</label>
                <SiteCorpInput
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Email</label>
              <SiteCorpInput
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <SiteCorpButton type="submit" className="w-full justify-center">
                Guardar
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingUser(null)
                  setFormData({ full_name: "", username: "", email: "" })
                }}
              >
                Cancelar
              </SiteCorpButton>
            </div>
          </form>
        </SiteCorpFormSection>
      )}
    </div>
  )
}

export default CompanyClientUsers
