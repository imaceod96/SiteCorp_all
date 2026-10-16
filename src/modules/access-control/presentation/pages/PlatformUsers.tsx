import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import {
  assignPlatformRole,
  createPlatformUser,
  loadActivePlatformRoles,
  loadPlatformPermission,
  loadPlatformUsers,
  setPlatformUserActive,
  updatePlatformUser,
  type PlatformRole,
  type PlatformUser,
} from "@/modules/access-control"
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
import { SelectItem } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Pencil, Plus, Power, UserMinus, UserCheck, Key, ShieldCheck } from "lucide-react"

const PlatformUsers = () => {
  const { isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = React.useState<PlatformUser[]>([])
  const [roles, setRoles] = React.useState<PlatformRole[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editingUser, setEditingUser] = React.useState<PlatformUser | null>(null)
  const [showCreateForm, setShowCreateForm] = React.useState(false)
  const [assigningRole, setAssigningRole] = React.useState<PlatformUser | null>(null)
  const [viewingPerms, setViewingPerms] = React.useState<PlatformUser | null>(null)
  const [formData, setFormData] = React.useState({
    full_name: "",
    username: "",
    email: "",
    password: "temp1234!",
    is_active: true,
  })
  const [selectedRoleId, setSelectedRoleId] = React.useState("")

  const loadUsers = React.useCallback(async () => {
    try {
      setError(null)
      setLoading(true)
      // El listado de usuarios de plataforma lo compone el dominio de control de acceso.
      setUsers(await loadPlatformUsers())
    } catch (err) {
      console.error("Error loading users:", err)
      setError("No se pudo cargar la lista de usuarios.")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRoles = React.useCallback(async () => {
    try {
      setRoles(await loadActivePlatformRoles())
    } catch (err) {
      console.error("Error loading roles:", err)
    }
  }, [])

  React.useEffect(() => {
    loadUsers()
    loadRoles()
  }, [loadUsers, loadRoles])

  const startCreate = () => {
    setEditingUser(null)
    setShowCreateForm(true)
    setFormData({
      full_name: "",
      username: "",
      email: "",
      password: "temp1234!",
      is_active: true,
    })
    setSelectedRoleId("")
  }

  const startEdit = (user: PlatformUser) => {
    setEditingUser(user)
    setFormData({
      full_name: user.full_name ?? "",
      username: user.username ?? "",
      email: user.email ?? "",
      password: "",
      is_active: user.is_active,
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingUser) {
        await updatePlatformUser({
          userId: editingUser.id,
          fullName: formData.full_name,
          username: formData.username,
        })
      } else {
        // El alta de usuarios de plataforma sigue pasando por la Edge Function del backend:
        // el cliente nunca crea usuarios ni maneja claves privilegiadas.
        await createPlatformUser({
          fullName: formData.full_name,
          username: formData.username,
          email: formData.email,
          password: formData.password,
          isActive: formData.is_active,
          platformRoleId: selectedRoleId || null,
        })
      }
      setEditingUser(null)
      setShowCreateForm(false)
      setFormData({
        full_name: "",
        username: "",
        email: "",
        password: "temp1234!",
        is_active: true,
      })
      setSelectedRoleId("")
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el usuario.")
    }
  }

  const toggleActive = async (user: PlatformUser) => {
    try {
      await setPlatformUserActive(user.id, !user.is_active)
      await loadUsers()
    } catch (err) {
      console.error("Error toggling user:", err)
      setError("No se pudo cambiar el estado del usuario.")
    }
  }

  const assignRole = async (user: PlatformUser) => {
    if (!selectedRoleId) return
    try {
      await assignPlatformRole(user.id, selectedRoleId)
      setAssigningRole(null)
      setSelectedRoleId("")
      await loadUsers()
    } catch (err) {
      console.error("Error assigning role:", err)
      setError("No se pudo asignar el rol.")
    }
  }

  const loadEffectivePermissions = async (user: PlatformUser) => {
    try {
      // La consulta de un permiso de plataforma vive en el dominio de control de acceso.
      await loadPlatformPermission("users.view_all")
    } catch (err) {
      console.error("Error loading permissions:", err)
    }
  }

  const columns = [
    { header: "Nombre completo", accessor: "full_name" },
    { header: "Usuario", accessor: "username" },
    { header: "Email", accessor: "email" },
    { header: "Rol de plataforma", accessor: "roles" },
    { header: "Estado", accessor: "status" },
    { header: "Fecha de creación", accessor: "created_at" },
    { header: "Acciones", accessor: "actions" },
  ]

  const rows = users.map((user) => ({
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    roles: user.roles.map((r) => r.name).join(", ") || "Sin rol",
    status: (
      <SiteCorpStatusBadge status={user.is_active ? "success" : "warning"}>
        {user.is_active ? "Activo" : "Inactivo"}
      </SiteCorpStatusBadge>
    ),
    created_at: new Date(user.created_at ?? "").toLocaleDateString("es-ES"),
    actions: (
      <div className="flex items-center gap-2">
        <SiteCorpButton size="sm" variant="outline" onClick={() => startEdit(user)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
        </SiteCorpButton>
        <SiteCorpButton
          size="sm"
          variant="outline"
          onClick={() => setAssigningRole(user)}
        >
          <Key className="h-3.5 w-3.5 mr-1" /> Rol
        </SiteCorpButton>
        <SiteCorpButton
          size="sm"
          variant="outline"
          onClick={() => {
            setViewingPerms(user)
            loadEffectivePermissions(user)
          }}
        >
          Permisos
        </SiteCorpButton>
        <SiteCorpButton
          size="sm"
          variant="outline"
          onClick={() => toggleActive(user)}
        >
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
        title="Usuarios de plataforma"
        description="Gestión de administradores y operadores de SiteCorp (sin asignación organizacional)"
        actions={
          <SiteCorpButton onClick={startCreate}>
            <Plus className="h-4 w-4 mr-2" /> Agregar usuario de plataforma
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
          Necesitas ser SuperAdmin para gestionar usuarios de plataforma.
        </SiteCorpAlert>
      )}

      <SiteCorpCard title="Administradores de plataforma">
        {loading ? (
          <SiteCorpLoading rows={5} />
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No hay usuarios registrados.
          </div>
        ) : (
          <SiteCorpTable columns={columns} data={rows} />
        )}
      </SiteCorpCard>

      {(editingUser || showCreateForm) && (
        <SiteCorpFormSection
          title={editingUser ? "Editar usuario" : "Crear usuario de plataforma"}
          description={
            editingUser
              ? "Actualiza los datos del usuario de plataforma"
              : "Registra un nuevo usuario de SiteCorp (solo acceso a nivel de plataforma)"
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Nombre completo *</label>
                <SiteCorpInput
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Usuario *</label>
                <SiteCorpInput
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Email *</label>
              <SiteCorpInput
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            {/* Platform Role Selector for new user creation */}
            {!editingUser && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink">Rol de plataforma *</label>
                  <SiteCorpSelect
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                    required
                  >
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                        {role.is_system_role && (
                          <span className="text-xs text-muted-foreground block">(Sistema)</span>
                        )}
                      </SelectItem>
                    ))}
                  </SiteCorpSelect>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink">Contraseña temporal</label>
                  <SiteCorpInput
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Checkbox
                      checked={formData.is_active}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, is_active: checked === true })
                      }
                    />
                    Usuario activo
                  </label>
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <SiteCorpButton type="submit" className="w-full justify-center">
                {editingUser ? "Guardar cambios" : "Crear usuario de plataforma"}
              </SiteCorpButton>
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingUser(null)
                  setShowCreateForm(false)
                  setFormData({
                    full_name: "",
                    username: "",
                    email: "",
                    password: "temp1234!",
                    is_active: true,
                  })
                  setSelectedRoleId("")
                }}
              >
                Cancelar
              </SiteCorpButton>
            </div>
          </form>
        </SiteCorpFormSection>
      )}

      {assigningRole && (
        <SiteCorpFormSection
          title="Asignar rol de plataforma"
          description={`Asigna un rol a ${assigningRole.full_name}`}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Rol</label>
              <SiteCorpSelect
                value={selectedRoleId}
                onValueChange={setSelectedRoleId}
              >
                {roles
                  .filter((r) => !assigningRole.roles.some((ur) => ur.name === r.name))
                  .map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                      {role.is_system_role && (
                        <span className="text-xs text-muted-foreground block">(Sistema)</span>
                      )}
                    </SelectItem>
                  ))}
              </SiteCorpSelect>
            </div>
            <div className="flex items-center gap-3">
              <SiteCorpButton onClick={() => assignRole(assigningRole)}>
                Asignar
              </SiteCorpButton>
              <SiteCorpButton
                variant="outline"
                onClick={() => {
                  setAssigningRole(null)
                  setSelectedRoleId("")
                }}
              >
                Cancelar
              </SiteCorpButton>
            </div>
          </div>
        </SiteCorpFormSection>
      )}

      {viewingPerms && (
        <SiteCorpFormSection
          title="Permisos efectivos"
          description={`Permisos efectivos para ${viewingPerms.full_name}`}
        >
          <div className="space-y-3">
            {viewingPerms.roles.map((role) => (
              <div key={role.name} className="rounded-lg border p-3">
                <p className="text-sm font-medium text-ink">{role.name}</p>
                <p className="text-xs text-muted-foreground">
                  {role.is_system_role ? "Rol del sistema" : "Rol personalizado"}
                </p>
              </div>
            ))}
            {viewingPerms.roles.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin roles asignados.</p>
            )}
            <SiteCorpButton
              variant="outline"
              onClick={() => setViewingPerms(null)}
            >
              Cerrar
            </SiteCorpButton>
          </div>
        </SiteCorpFormSection>
      )}
    </div>
  )
}

export default PlatformUsers
