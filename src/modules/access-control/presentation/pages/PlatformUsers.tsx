import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import {
  assignPlatformRole,
  createPlatformUser,
  deletePlatformUser,
  deletionConfirmationMatches,
  loadActivePlatformRoles,
  loadPlatformPermission,
  loadPlatformUsers,
  platformUserDeletionBlockReason,
  setPlatformUserActive,
  updatePlatformUser,
  type CreatedPlatformUser,
  type PlatformRole,
  type PlatformUser,
} from "@/modules/access-control"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpTable } from "@/shared/components/ui/sitecorp-table"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpFormSection } from "@/shared/components/ui/sitecorp-form-section"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { SiteCorpError } from "@/shared/components/ui/sitecorp-error"
import { SelectItem } from "@/shared/components/ui/select"
import { Checkbox } from "@/shared/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog"
import {
  Check,
  Copy,
  Pencil,
  Plus,
  Power,
  Trash2,
  UserMinus,
  UserCheck,
  Key,
  ShieldCheck,
} from "lucide-react"

const PlatformUsers = () => {
  const { user, isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
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
    is_active: true,
  })
  const [selectedRoleId, setSelectedRoleId] = React.useState("")
  // Contraseña inicial generada por el servidor. Se muestra UNA SOLA VEZ y NO se persiste:
  // vive únicamente en este estado y se limpia al cerrar.
  const [createdUser, setCreatedUser] = React.useState<CreatedPlatformUser | null>(null)
  const [passwordCopied, setPasswordCopied] = React.useState(false)

  // Eliminación DEFINITIVA: estado propio y separado del de desactivación.
  const [userToDelete, setUserToDelete] = React.useState<PlatformUser | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("")
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

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
        // el cliente nunca crea usuarios ni maneja claves privilegiadas. La contraseña
        // inicial la genera el servidor y se devuelve UNA SOLA VEZ para mostrarla.
        const created = await createPlatformUser({
          fullName: formData.full_name,
          username: formData.username,
          email: formData.email,
          isActive: formData.is_active,
          platformRoleId: selectedRoleId || null,
        })
        setCreatedUser(created)
        setPasswordCopied(false)
      }
      setEditingUser(null)
      setShowCreateForm(false)
      setFormData({
        full_name: "",
        username: "",
        email: "",
        is_active: true,
      })
      setSelectedRoleId("")
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el usuario.")
    }
  }

  /** Copia la contraseña inicial al portapapeles (nunca se registra ni se persiste). */
  const copyInitialPassword = async () => {
    if (!createdUser) return
    try {
      await navigator.clipboard.writeText(createdUser.initialPassword)
      setPasswordCopied(true)
    } catch (err) {
      console.error("No se pudo copiar la contraseña inicial.")
    }
  }

  /** Limpia la contraseña del estado al cerrar: no debe quedar retenida en memoria de la vista. */
  const closeCreatedUser = () => {
    setCreatedUser(null)
    setPasswordCopied(false)
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

  /**
   * Abre la confirmación de borrado. El motivo por el que la acción no se ofrece (cuenta
   * propia o última cuenta de SuperAdmin) lo decide la regla del dominio, la misma que
   * revalida el servidor.
   */
  const startDelete = (target: PlatformUser) => {
    const blocked = platformUserDeletionBlockReason({
      currentUserId: user?.id,
      target,
      users,
    })
    if (blocked) {
      setError(blocked)
      return
    }

    setDeleteConfirmation("")
    setDeleteError(null)
    setUserToDelete(target)
  }

  const closeDelete = () => {
    if (deleting) return
    setUserToDelete(null)
    setDeleteConfirmation("")
    setDeleteError(null)
  }

  /**
   * Confirma el borrado. El servidor exige el `username` exacto y vuelve a comprobar rol,
   * cuenta propia y última cuenta de SuperAdmin: la interfaz no autoriza nada.
   */
  const confirmDelete = async () => {
    const target = userToDelete
    if (!target) return

    if (!deletionConfirmationMatches(target.username, deleteConfirmation)) {
      setDeleteError("El nombre de usuario no coincide.")
      return
    }

    setDeleting(true)
    setDeleteError(null)
    try {
      await deletePlatformUser({ userId: target.id, confirmUsername: deleteConfirmation })

      setUserToDelete(null)
      setDeleteConfirmation("")
      await loadUsers()
    } catch (err) {
      console.error("Error deleting platform user:", err)
      setDeleteError(
        err instanceof Error ? err.message : "No se pudo eliminar el usuario."
      )
    } finally {
      setDeleting(false)
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

  // Cuenta que está operando: impide ofrecer el borrado de uno mismo.
  const currentUserId = user?.id

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
        {/* Acción DIFERENCIADA de la desactivación: irreversible y sólo para SuperAdmin. */}
        <SiteCorpButton
          size="sm"
          variant="outline"
          className="border-sitecorp-danger/40 text-sitecorp-danger hover:bg-sitecorp-danger/10"
          onClick={() => startDelete(user)}
          disabled={
            platformUserDeletionBlockReason({ currentUserId, target: user, users }) !== null
          }
          title={
            platformUserDeletionBlockReason({ currentUserId, target: user, users }) ??
            "Eliminar definitivamente el usuario"
          }
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
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

      {createdUser && (
        <SiteCorpFormSection
          title="Usuario creado — contraseña inicial"
          description="La contraseña se genera de forma aleatoria y segura en el servidor. No podrá recuperarse posteriormente desde SiteCorp."
        >
          <SiteCorpAlert type="warning" title="Se muestra una sola vez">
            Anota o copia esta contraseña ahora y comunícala al usuario por un canal seguro
            (nunca por un medio compartido o sin cifrar). Al cerrar, desaparecerá de esta pantalla.
          </SiteCorpAlert>

          <div className="space-y-2">
            <label className="text-sm font-medium text-ink">
              Contraseña inicial de {createdUser.fullName}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 select-all break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-ink">
                {createdUser.initialPassword}
              </code>
              <SiteCorpButton type="button" variant="outline" onClick={copyInitialPassword}>
                {passwordCopied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" /> Copiada
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" /> Copiar
                  </>
                )}
              </SiteCorpButton>
            </div>
            <p className="text-xs text-muted-foreground">
              Usuario: {createdUser.username} · Email: {createdUser.email}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <SiteCorpButton type="button" onClick={closeCreatedUser}>
              Entendido, cerrar
            </SiteCorpButton>
          </div>
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

      {/* Eliminación DEFINITIVA: confirmación explícita e irreversible. */}
      <AlertDialog
        open={!!userToDelete}
        onOpenChange={(open) => {
          if (!open) closeDelete()
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sitecorp-danger">
              <Trash2 className="h-5 w-5" /> Eliminar usuario definitivamente
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Vas a eliminar la cuenta de acceso de{" "}
                  <span className="font-semibold text-ink">
                    {userToDelete?.full_name || userToDelete?.username}
                  </span>
                  . Esta acción es <span className="font-semibold">irreversible</span>: el usuario
                  no podrá volver a iniciar sesión y su cuenta no se puede recuperar.
                </p>

                <SiteCorpAlert type="warning" title="Qué se elimina y qué se conserva">
                  Se eliminan la cuenta, su perfil y sus permisos de acceso.{" "}
                  <strong>No se eliminan</strong> trabajadores, contratos, documentos de empresa ni
                  ningún registro histórico. Si el usuario participa en historial, la operación se
                  rechazará y podrás desactivarlo en su lugar.
                </SiteCorpAlert>

                <div className="space-y-1">
                  <p>
                    Para confirmar, escribe el nombre de usuario{" "}
                    <span className="font-mono text-ink">{userToDelete?.username}</span>:
                  </p>
                  <SiteCorpInput
                    value={deleteConfirmation}
                    onChange={(event) => {
                      setDeleteConfirmation(event.target.value)
                      setDeleteError(null)
                    }}
                    placeholder="Nombre de usuario"
                    disabled={deleting}
                    autoComplete="off"
                  />
                  {deleteError && (
                    <p className="text-xs font-medium text-sitecorp-danger">{deleteError}</p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={closeDelete}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleting ||
                !deletionConfirmationMatches(userToDelete?.username ?? "", deleteConfirmation)
              }
              className="bg-sitecorp-danger text-white hover:bg-sitecorp-danger/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? "Eliminando..." : "Eliminar definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default PlatformUsers
