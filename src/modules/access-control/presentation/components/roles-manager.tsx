import * as React from "react"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SelectItem } from "@/components/ui/select"
import {
  deleteRole as deleteRoleCommand,
  entityPermissionLabel,
  friendlyRoleSaveError,
  isProtectedRole as isProtectedRoleRule,
  loadRoleScopeWorkspace,
  permissionGroupsFor,
  platformPermissionLabel,
  saveRole as saveRoleCommand,
  selectablePermissionsFor,
  type PermissionOption,
  type RoleForm,
  type RoleRecord,
    type RoleScope,
  } from "@/modules/access-control"
import {
  BadgeCheck,
  Eye,
  Pencil,
  Plus,
  Power,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react"

export type { RoleScope } from "@/modules/access-control"

/**
 * Gestión de roles de UN ámbito: plataforma (SiteCorp) o una entidad organizativa.
 *
 * Toda la lógica y la persistencia viven en el dominio de control de acceso
 * (`@/domains/access-control`): el catálogo de permisos, el ámbito, la protección de los
 * roles del sistema, la traducción de los errores y los RPC de guardado y borrado.
 * Este componente sólo compone la interfaz.
 *
 * ÁMBITO DE ENTIDAD (Nivel 2): los roles internos pertenecen a UNA entidad
 * (`tenant_roles.organization_entity_id`). El catálogo de permisos que se ofrece es el
 * GLOBAL de permisos internos.
 *
 * ÁMBITO DE PLATAFORMA (Nivel 1): roles globales de SiteCorp con el catálogo de
 * plataforma. `tenant_roles.*` NO vuelve a aparecer aquí: la administración de los roles
 * internos se realiza dentro de cada entidad (`save_entity_role`).
 */

const permissionLabel = (scope: RoleScope, permission: PermissionOption) =>
  scope === "platform"
    ? platformPermissionLabel(permission)
    : entityPermissionLabel(permission)

const emptyForm: RoleForm = {
  name: "",
  description: "",
  is_active: true,
}

export const RolesManager = ({
  scope,
  organizationEntityId,
}: {
  scope: RoleScope
  /**
   * Cliente propietario. Se conserva la firma por compatibilidad, pero el ámbito
   * de entidad se rige SIEMPRE por `organizationEntityId`: el rol interno
   * pertenece a UNA entidad organizativa, nunca al cliente completo.
   */
  companyClientId?: string
  organizationEntityId?: string
}) => {
  const isPlatform = scope === "platform"
  const [roles, setRoles] = React.useState<RoleRecord[]>([])
  const [permissions, setPermissions] = React.useState<PermissionOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  // Clave del último conjunto de datos cargado: evita mostrar roles de otra entidad
  // mientras se resuelve la nueva consulta (nunca se comparte caché entre entidades).
  const [loadedKey, setLoadedKey] = React.useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRole, setEditingRole] = React.useState<RoleRecord | null>(null)
  const [form, setForm] = React.useState<RoleForm>(emptyForm)
  const [selectedPermissionIds, setSelectedPermissionIds] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [viewingRole, setViewingRole] = React.useState<RoleRecord | null>(null)
  // Matriz rol↔permiso de plataforma legible (exige `platform_roles.manage` efectivo o
  // SuperAdmin). En el ámbito de entidad siempre lo es.
  const [canReadPermissionMatrix, setCanReadPermissionMatrix] = React.useState(true)

  const entityReady = scope === "organization" && Boolean(organizationEntityId)
  const dataKey = isPlatform ? "platform" : organizationEntityId || ""

  const loadData = React.useCallback(async () => {
    if (scope === "organization" && !organizationEntityId) {
      setRoles([])
      setPermissions([])
      setCanReadPermissionMatrix(true)
      setLoading(false)
      setLoadedKey(dataKey)
      return
    }

    try {
      setError(null)
      setLoading(true)

      const workspace = await loadRoleScopeWorkspace({ scope, organizationEntityId })

      setRoles(workspace.roles)
      setPermissions(workspace.permissions)
      setCanReadPermissionMatrix(workspace.canReadPermissionMatrix)
      setLoadedKey(dataKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la información de roles.")
    } finally {
      setLoading(false)
    }
  }, [isPlatform, scope, organizationEntityId, dataKey])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const openCreate = () => {
    setEditingRole(null)
    setForm(emptyForm)
    setSelectedPermissionIds([])
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (role: RoleRecord) => {
    setEditingRole(role)
    setForm({
      name: role.name,
      description: role.description || "",
      is_active: role.is_active,
    })
    setSelectedPermissionIds(role.permissionIds)
    setFormError(null)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingRole(null)
    setForm(emptyForm)
    setSelectedPermissionIds([])
    setFormError(null)
  }

  // Cualquier rol del sistema (SuperAdmin en plataforma, Administrador en una entidad)
  // tiene sus permisos y metadatos completamente protegidos.
  const isProtectedRole = (role: RoleRecord | null) => isProtectedRoleRule(role)

  // MODO CONSULTA: con `platform_roles.view` sin `platform_roles.manage` los roles se ven,
  // pero su matriz de permisos no. No se muestran recuentos engañosos ni se permite editar.
  const permissionsReadable = !isPlatform || canReadPermissionMatrix

  const permissionsLocked = isProtectedRole(editingRole) || !permissionsReadable

  const saveRole = async (
    nextForm: RoleForm,
    nextPermissionIds: string[],
    role: RoleRecord | null
  ) => {
    await saveRoleCommand({
      scope,
      organizationEntityId,
      roleId: role?.id || null,
      name: nextForm.name,
      description: nextForm.description,
      isActive: nextForm.is_active,
      permissionIds: nextPermissionIds,
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    try {
      setFormError(null)
      if (!form.name.trim()) {
        throw new Error("Role name is required")
      }

      setSaving(true)
      await saveRole(form, selectedPermissionIds, editingRole)
      setSuccess(
        editingRole
          ? "Rol actualizado correctamente."
          : isPlatform
            ? "Rol de plataforma creado correctamente."
            : "Rol creado correctamente en esta entidad."
      )
      closeDialog()
      await loadData()
    } catch (err) {
      setFormError(friendlyRoleSaveError(scope, err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (role: RoleRecord) => {
    try {
      setError(null)
      setSuccess(null)
      setSaving(true)

      await saveRole(
        {
          name: role.name,
          description: role.description || "",
          is_active: !role.is_active,
        },
        role.permissionIds,
        role
      )

      setSuccess(`Rol ${role.is_active ? "desactivado" : "activado"} correctamente.`)
      await loadData()
    } catch (err) {
      setError(friendlyRoleSaveError(scope, err))
    } finally {
      setSaving(false)
    }
  }

  const deleteRole = async (role: RoleRecord) => {
    try {
      setError(null)
      setSuccess(null)
      setSaving(true)

      if (isProtectedRole(role)) {
        throw new Error(
          isPlatform
            ? "The platform system role is protected"
            : "The system role Administrador is protected"
        )
      }

      if (role.assignedUserCount > 0) {
        throw new Error("A role assigned to users or invitations cannot be deleted")
      }

      await deleteRoleCommand({ scope, roleId: role.id })

      setSuccess("Rol eliminado correctamente.")
      await loadData()
    } catch (err) {
      setError(friendlyRoleSaveError(scope, err))
    } finally {
      setSaving(false)
    }
  }

  const togglePermission = (permissionId: string) => {
    setSelectedPermissionIds((current) =>
      current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId]
    )
  }

  // Nivel 1 (plataforma): sólo el catálogo de plataforma.
  // Nivel 2 (entidad): sólo el catálogo global de permisos INTERNOS.
  const selectablePermissions = React.useMemo(
    () => selectablePermissionsFor(scope, permissions),
    [scope, permissions]
  )

  const allGroups = React.useMemo(
    () => permissionGroupsFor(scope, permissions),
    [scope, permissions]
  )

  const renderPermissionCheckbox = (permission: PermissionOption) => {
    const checked =
      selectedPermissionIds.includes(permission.id) ||
      // Un rol del sistema ya tiene TODOS los permisos internos: se muestran marcados.
      (permissionsLocked && !isPlatform)

    return (
      <label
        key={permission.id}
        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-white p-3 text-sm transition-colors hover:border-sitecorp-primary/40"
      >
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={permissionsLocked}
          onCheckedChange={() => togglePermission(permission.id)}
        />
        <span className="min-w-0">
          <span className="block font-medium text-ink">{permissionLabel(scope, permission)}</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
            {permission.code}
          </span>
        </span>
      </label>
    )
  }

  const showRoles = !loading && loadedKey === dataKey

  return (
    <SiteCorpCard
      title={isPlatform ? "Roles de plataforma" : "Roles internos de la entidad"}
      description={
        isPlatform
          ? "Controlan qué pueden hacer los administradores y operadores de SiteCorp."
          : "Cada entidad tiene sus PROPIOS roles. El rol define QUÉ puede hacer un usuario; el acceso a entidades define DÓNDE puede hacerlo."
      }
    >
      <div className="space-y-4">
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
        {!entityReady && scope === "organization" && (
          <SiteCorpAlert type="warning" title="Entidad requerida">
            Selecciona una entidad organizativa para gestionar sus roles internos.
          </SiteCorpAlert>
        )}
        {!permissionsReadable && (
          <SiteCorpAlert type="info" title="Modo consulta">
            Necesitas permiso de gestión de roles para consultar los permisos de los roles de
            plataforma. Puedes ver los roles y sus usuarios asignados.
          </SiteCorpAlert>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <BadgeCheck className="h-4 w-4 text-sitecorp-primary" />
            {roles.length} {roles.length === 1 ? "rol" : "roles"} ·{" "}
            {selectablePermissions.length} permisos {isPlatform ? "de plataforma" : "internos"}
          </div>
          <SiteCorpButton
            onClick={openCreate}
            disabled={(scope === "organization" && !entityReady) || !permissionsReadable}
          >
            <Plus className="mr-2 h-4 w-4" />
            {isPlatform ? "Nuevo rol de plataforma" : "Nuevo rol"}
          </SiteCorpButton>
        </div>

        {!showRoles ? (
          <SiteCorpLoading rows={5} />
        ) : roles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {isPlatform
              ? "No hay roles de plataforma disponibles."
              : "Esta entidad aún no tiene roles internos."}
          </div>
        ) : (
          <div className="space-y-3">
            {roles.map((role) => {
              const protectedRole = isProtectedRole(role)
              return (
                <article
                  key={role.id}
                  className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">{role.name}</h3>
                      {role.is_system_role ? (
                        <SiteCorpStatusBadge status="info">Rol del sistema</SiteCorpStatusBadge>
                      ) : (
                        <SiteCorpStatusBadge status="neutral">Personalizado</SiteCorpStatusBadge>
                      )}
                      <SiteCorpStatusBadge status={role.is_active ? "success" : "warning"}>
                        {role.is_active ? "Activo" : "Inactivo"}
                      </SiteCorpStatusBadge>
                      {protectedRole && (
                        <SiteCorpStatusBadge status="success">Protegido</SiteCorpStatusBadge>
                      )}
                    </div>

                    {role.description && (
                      <p className="max-w-3xl text-sm text-muted-foreground">{role.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-sitecorp-primary" />
                        {isPlatform && role.name === "SuperAdmin"
                          ? "Acceso completo por diseño"
                          : permissionsReadable
                            ? `${role.permissionIds.length} permisos`
                            : "Permisos no consultables"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-sitecorp-primary" />
                        {role.assignedUserCount} usuarios asignados
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <SiteCorpButton
                      size="sm"
                      variant="outline"
                      disabled={!permissionsReadable}
                      onClick={() => setViewingRole(role)}
                    >
                      <Eye className="mr-1 h-3.5 w-3.5" /> Ver permisos
                    </SiteCorpButton>
                    <SiteCorpButton
                      size="sm"
                      variant="outline"
                      disabled={protectedRole || !permissionsReadable}
                      onClick={() => openEdit(role)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                    </SiteCorpButton>
                    {!protectedRole && (
                      <>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => toggleActive(role)}
                        >
                          <Power className="mr-1 h-3.5 w-3.5" />
                          {role.is_active ? "Desactivar" : "Activar"}
                        </SiteCorpButton>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Eliminar el rol «${role.name}»? Esta acción no puede deshacerse.`
                              )
                            ) {
                              void deleteRole(role)
                            }
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                        </SiteCorpButton>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
          <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <ShieldCheck className="h-5 w-5 text-sitecorp-primary" />
                {editingRole
                  ? `Editar ${editingRole.name}`
                  : isPlatform
                    ? "Nuevo rol de plataforma"
                    : "Nuevo rol interno de la entidad"}
              </DialogTitle>
              <DialogDescription>
                {isPlatform
                  ? "Los permisos seleccionados controlan la administración de la plataforma SiteCorp."
                  : "El rol define las capacidades dentro de ESTA entidad. Los permisos de plataforma no están disponibles aquí."}
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <SiteCorpAlert type="danger" title="Error">
                {formError}
              </SiteCorpAlert>
            )}

            {isProtectedRole(editingRole) ? (
              <SiteCorpAlert type="info" title="Rol del sistema protegido">
                {isPlatform
                  ? "Es un rol del sistema de la plataforma: su nombre, su estado y su conjunto de permisos están protegidos y no pueden reducirse ni cambiarse."
                  : "Administrador es el rol del sistema de esta entidad: conserva todos los permisos internos y no puede modificarse, desactivarse ni eliminarse."}
              </SiteCorpAlert>
            ) : !permissionsReadable ? (
              <SiteCorpAlert type="info" title="Modo consulta">
                Necesitas permiso de gestión de roles para consultar o modificar los permisos de
                este rol.
              </SiteCorpAlert>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-ink">Nombre</label>
                  <SiteCorpInput
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    disabled={permissionsLocked}
                    required
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-ink">Descripción</label>
                  <SiteCorpInput
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder="Descripción opcional"
                    disabled={permissionsLocked}
                  />
                </div>
              </div>

              <SiteCorpSelect
                label="Estado"
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(value) => setForm({ ...form, is_active: value === "active" })}
                disabled={permissionsLocked}
              >
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SiteCorpSelect>

              {!permissionsReadable ? null : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {isPlatform ? "Permisos del sistema" : "Permisos internos de la entidad"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedPermissionIds.length} seleccionados · catálogo controlado por base de
                      datos
                    </p>
                  </div>
                </div>

                {allGroups.map((group) => {
                  const groupPermissions = selectablePermissions.filter((permission) =>
                    group.codes.includes(permission.code)
                  )

                  if (groupPermissions.length === 0) return null

                  return (
                    <section key={group.title} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                      </p>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {groupPermissions.map(renderPermissionCheckbox)}
                      </div>
                    </section>
                  )
                })}
              </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <SiteCorpButton type="button" variant="outline" onClick={closeDialog} disabled={saving}>
                  Cancelar
                </SiteCorpButton>
                <SiteCorpButton type="submit" disabled={saving || permissionsLocked}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Guardando..." : editingRole ? "Guardar cambios" : "Crear rol"}
                </SiteCorpButton>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(viewingRole)}
          onOpenChange={(open) => {
            if (!open) setViewingRole(null)
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <ShieldCheck className="h-5 w-5 text-sitecorp-primary" />
                Permisos de {viewingRole?.name}
              </DialogTitle>
              <DialogDescription>
                {viewingRole?.is_system_role
                  ? "Rol del sistema con controles protegidos."
                  : "Rol personalizado construido a partir del catálogo de permisos internos."}
              </DialogDescription>
            </DialogHeader>

            {viewingRole && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <SiteCorpStatusBadge status={viewingRole.is_active ? "success" : "warning"}>
                    {viewingRole.is_active ? "Activo" : "Inactivo"}
                  </SiteCorpStatusBadge>
                  {permissionsReadable && (
                    <SiteCorpStatusBadge status="neutral">
                      {viewingRole.permissionIds.length} permisos
                    </SiteCorpStatusBadge>
                  )}
                  <SiteCorpStatusBadge status="neutral">
                    {viewingRole.assignedUserCount} usuarios
                  </SiteCorpStatusBadge>
                </div>

                {!permissionsReadable ? (
                  <SiteCorpAlert type="info" title="Modo consulta">
                    Necesitas permiso de gestión de roles para consultar los permisos de este rol.
                  </SiteCorpAlert>
                ) : isPlatform && viewingRole.name === "SuperAdmin" ? (
                  <SiteCorpAlert type="info" title="Acceso completo reservado">
                    SuperAdmin no depende de la lista normal de permisos. La autorización reservada le
                    otorga acceso completo a la plataforma.
                  </SiteCorpAlert>
                ) : viewingRole.permissionCodes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                    Este rol no tiene permisos asignados.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {viewingRole.permissionCodes.map((code) => {
                      const permission = permissions.find((item) => item.code === code)
                      return (
                        <span
                          key={code}
                          className="inline-flex items-center rounded-lg border border-border bg-sitecorp-background px-3 py-1.5 text-xs font-medium text-ink"
                        >
                          {permission ? permissionLabel(scope, permission) : code}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SiteCorpCard>
  )
}

export default RolesManager
