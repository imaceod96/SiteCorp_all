import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import {
  accessRoleLabel,
  loadEntityPermission,
  loadEntityUserAccess,
  loadPlatformPermission,
  type EntityAccessRow,
} from "@/modules/access-control"
import {
  deleteOrganizationEntity,
  loadOrganizationEntityDetail,
  type OrganizationEntity,
} from "@/modules/organization-structure"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Factory,
  Layers,
  LayoutDashboard,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Mail,
  ArrowUpFromLine,
  Power,
  ArrowLeft,
  LogOut,
} from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EntityUsersDialog } from "@/components/entity-users-dialog"
import { OrganizationEntityDialog } from "@/components/organization-entity-dialog"
import RolesManager from "@/modules/access-control/presentation/components/roles-manager"

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

const scopeLabels: Record<EntityAccessRow["access_scope"], string> = {
  SELF: "Solo esta entidad",
  SELF_AND_DESCENDANTS: "Esta entidad y sus descendientes",
}

const OrganizationDetail = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { user, isPlatformSuperAdmin } = useAuth()
  const { currentCompanyClient } = useCurrentCompanyClient()

  // Primitiva estable del cliente: evita depender del objeto completo en los callbacks.
  const currentCompanyClientId = currentCompanyClient?.id

  const [entity, setEntity] = React.useState<OrganizationEntity | null>(null)
  const [ancestors, setAncestors] = React.useState<OrganizationEntity[]>([])
  const [children, setChildren] = React.useState<OrganizationEntity[]>([])
  const [directUsers, setDirectUsers] = React.useState<EntityAccessRow[]>([])
  const [inheritedUsers, setInheritedUsers] = React.useState<EntityAccessRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tenantEntities, setTenantEntities] = React.useState<OrganizationEntity[]>([])
  
  const [entityDialogOpen, setEntityDialogOpen] = React.useState(false)
  const [editingEntity, setEditingEntity] = React.useState<OrganizationEntity | null>(null)
  const [usersEntity, setUsersEntity] = React.useState<OrganizationEntity | null>(null)
  const [deleteEntity, setDeleteEntity] = React.useState<OrganizationEntity | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [canDeleteEntities, setCanDeleteEntities] = React.useState(false)
  const [canConsultRoles, setCanConsultRoles] = React.useState(false)
  
  const loadEntityData = React.useCallback(async () => {
    if (!entityId) return
    
    try {
      setError(null)
      setLoading(true)
      
      // La entidad, su camino de entidades superiores, sus hijas directas y las
      // entidades de su cliente (conmutador) las compone el dominio de estructura
      // organizativa; la comprobación de cliente activo y su mensaje no cambian.
      const detail = await loadOrganizationEntityDetail({
        entityId,
        currentCompanyClientId,
        isPlatformSuperAdmin,
      })

      setEntity(detail.entity)
      setTenantEntities(detail.tenantEntities)
      setAncestors(detail.ancestors)
      setChildren(detail.children)

      // Accesos de usuarios (directos y heredados): los decide el backend.
      const accessRows = await loadEntityUserAccess(entityId)

      setDirectUsers(accessRows.filter(row => row.is_direct))
      setInheritedUsers(accessRows.filter(row => !row.is_direct))
      
          } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cargar la entidad")
          } finally {
            setLoading(false)
          }
        }, [entityId, currentCompanyClientId, isPlatformSuperAdmin])
  
  React.useEffect(() => {
    loadEntityData()
  }, [loadEntityData])
  
  const checkDeletePermissions = React.useCallback(async () => {
    // Primitiva estable: la identidad del callback depende solo del id de la entidad.
    const targetEntityId = entity?.id
    if (!targetEntityId) return
    
    try {
      const allowed = await loadEntityPermission(targetEntityId, "organization.manage")
      
      setCanDeleteEntities(allowed)
    } catch (err) {
      console.error("Error checking delete permissions:", err)
      setCanDeleteEntities(false)
    }
  }, [entity?.id])
  
  React.useEffect(() => {
    checkDeletePermissions()
  }, [checkDeletePermissions])

  // Consultar los roles de otros usuarios exige gestión de roles: `roles.manage` en la
  // entidad (lo concede `can_access_entity`, incluido el superadministrador) o el permiso
  // de plataforma `tenant_roles.manage`. `roles.view` NO habilita esta superficie.
  const checkRolePermissions = React.useCallback(async () => {
    const targetEntityId = entity?.id
    if (!targetEntityId) return

    const [entityAllowed, platformAllowed] = await Promise.all([
      loadEntityPermission(targetEntityId, "roles.manage").catch(() => false),
      loadPlatformPermission("tenant_roles.manage").catch(() => false),
    ])

    setCanConsultRoles(entityAllowed || platformAllowed)
  }, [entity?.id])

  React.useEffect(() => {
    checkRolePermissions()
  }, [checkRolePermissions])
  
  const openCreateChildEntity = () => {
    if (!entity) return
    
    setEditingEntity(null)
    setEntityDialogOpen(true)
  }
  
  const openEditEntity = () => {
    if (!entity) return
    
    setEditingEntity(entity)
    setEntityDialogOpen(true)
  }
  
  const removeOrganizationEntity = async () => {
    if (!entity) return
    
    try {
      setDeleting(true)
      await deleteOrganizationEntity(entity.id)
      
      setDeleteEntity(null)
      // Navigate back to organization overview
      navigate("/organization")
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la entidad")
    } finally {
      setDeleting(false)
    }
  }
  
  const openUsersDialog = () => {
    if (!entity) return
    setUsersEntity(entity)
  }
  
  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Cargando entidad..."
          description="Obteniendo información de la entidad organizativa"
        />
        <SiteCorpLoading rows={3} />
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Error"
          description="No se pudo cargar la entidad organizativa"
        />
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
        <div className="flex justify-end">
          <SiteCorpButton
            onClick={() => navigate("/organization")}
            variant="outline"
          >
            Volver a organización
          </SiteCorpButton>
        </div>
      </div>
    )
  }
  
  if (!entity) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Entidad no encontrada"
          description="La entidad solicitada no existe o no tienes permiso para acceder a ella"
        />
        <SiteCorpAlert type="warning">
          La entidad con ID {entityId} no fue encontrada en el cliente actual.
        </SiteCorpAlert>
        <div className="flex justify-end">
          <SiteCorpButton
            onClick={() => navigate("/organization")}
            variant="outline"
          >
            Volver a organización
          </SiteCorpButton>
        </div>
      </div>
    )
  }
  
  return (
    <div className="space-y-6 p-6">
      {/* Header with breadcrumbs and actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <SiteCorpPageHeader
            title={entity.name}
            description={`${entityTypeLabels[entity.entity_type]} • ${entity.code}`}
          />
          
          {/* Breadcrumb navigation */}
          <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Breadcrumb>
              <BreadcrumbItem>
                <BreadcrumbLink href="/organization">Organización</BreadcrumbLink>
              </BreadcrumbItem>
              {ancestors.map((ancestor, index) => (
                <BreadcrumbItem key={ancestor.id}>
                  <BreadcrumbLink
                    href={`/organization/${ancestor.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      navigate(`/organization/${ancestor.id}`)
                    }}
                  >
                    {ancestor.name}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              ))}
              <BreadcrumbItem>
                <span className="text-ink">{entity.name}</span>
              </BreadcrumbItem>
            </Breadcrumb>
          </nav>
        </div>
        
        {/* Entity switcher */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-ink">Cambiar entidad:</label>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-10 w-56 items-center gap-2 rounded-lg border border-input bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-muted hover:text-ink transition-colors"
            >
              {typeIcon(entity.entity_type)}
              <span className="truncate">{entity.name}</span>
              <ChevronDown className="ml-auto h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {tenantEntities.map((tenantEntity) => (
                <DropdownMenuItem
                  key={tenantEntity.id}
                  onClick={() => {
                    navigate(`/organization/${tenantEntity.id}`)
                  }}
                  className={entity.id === tenantEntity.id
                    ? "bg-sitecorp-primary text-white"
                    : "text-ink hover:bg-muted"}
                >
                  {typeIcon(tenantEntity.entity_type)}
                  <span className="flex-1">{tenantEntity.name}</span>
                  <SiteCorpStatusBadge
                    status={tenantEntity.is_sitecorp_account ? "success" : "neutral"}
                  >
                    {tenantEntity.is_sitecorp_account ? "Cuenta SiteCorp" : "Sin gestión SiteCorp"}
                  </SiteCorpStatusBadge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Entity details and actions */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Entity information card */}
        <SiteCorpCard title="Información de la entidad" description="Detalles completos de la entidad organizativa">
          <div className="space-y-4">
            {/* Entity type and status */}
            <div className="flex flex-wrap items-center gap-3">
              {typeIcon(entity.entity_type)}
              <p className="text-sm font-semibold text-ink">{entityTypeLabels[entity.entity_type]}</p>
              <SiteCorpStatusBadge
                status={entity.is_active ? "success" : "danger"}
              >
                {entity.is_active ? "Activa" : "Inactiva"}
              </SiteCorpStatusBadge>
            </div>
            
            {/* Basic information */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Código interno</p>
              <p className="text-base font-mono text-ink">{entity.code}</p>
            </div>
            
            {entity.description && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Descripción</p>
                <p className="text-sm text-ink">{entity.description}</p>
              </div>
            )}
            
            {/* Address information */}
            {entity.address || entity.municipality || entity.province || entity.postal_code && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Dirección</p>
                <div className="space-y-1">
                  {entity.address && (
                    <>
                      <p className="truncate text-sm text-ink">{entity.address}</p>
                    </>
                  )}
                  {entity.municipality && entity.province && (
                    <p className="text-sm text-ink">
                      {entity.municipality}, {entity.province}
                      {entity.postal_code && ` - ${entity.postal_code}`}
                    </p>
                  )}
                </div>
              </div>
            )}
            
            {/* Regime */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Régimen</p>
              <p className="text-sm text-ink">{entity.regime_id}</p>
            </div>
          </div>
        </SiteCorpCard>
        
        {/* Account status card */}
        <SiteCorpCard title="Estado de la cuenta SiteCorp" description="Información sobre la cuenta SiteCorp asociada a esta entidad">
          <div className="space-y-4">
            {entity.is_sitecorp_account ? (
              <>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-sitecorp-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink">Cuenta SiteCorp</p>
                    <p className="text-base font-mono text-ink">{entity.account_code}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">Estado de la cuenta</p>
                    <SiteCorpStatusBadge
                      status={entity.account_is_active ? "success" : "warning"}
                    >
                      {entity.account_is_active ? "Activa" : "Suspendida"}
                    </SiteCorpStatusBadge>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-muted-foreground">Entidad activa</p>
                    <SiteCorpStatusBadge
                      status={entity.is_active ? "success" : "danger"}
                    >
                      {entity.is_active ? "Sí" : "No"}
                    </SiteCorpStatusBadge>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  Esta entidad no tiene habilitados los módulos internos de SiteCorp. Puedes
                  activarlos desde «Editar entidad»; los módulos quedarán disponibles sin recargar
                  la aplicación.
                </p>
                <SiteCorpButton
                  className="mt-3"
                  variant="outline"
                  onClick={openEditEntity}
                >
                  Activar Cuenta SiteCorp
                </SiteCorpButton>
              </div>
            )}
          </div>
        </SiteCorpCard>
      </div>
      
      {/* Users section */}
      <div className="grid gap-6">
        {/* Direct users */}
        <SiteCorpCard title="Acceso directo" description="Usuarios con acceso asignado directamente a esta entidad">
          <div className="flex justify-end mb-4">
            <SiteCorpButton
              size="sm"
              variant="outline"
              onClick={openUsersDialog}
            >
              <Users className="mr-2 h-4 w-4" />
              Gestionar acceso
            </SiteCorpButton>
          </div>
          
          {loading && directUsers.length === 0 && inheritedUsers.length === 0 ? (
            <SiteCorpLoading rows={2} />
          ) : directUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No hay usuarios con acceso directo a esta entidad.
            </div>
          ) : (
            <div className="space-y-3">
              {directUsers.map((user) => (
                <div
                  key={user.access_id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {user.full_name || user.username || "Usuario"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      @{user.username || "sin usuario"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SiteCorpStatusBadge status="info">{accessRoleLabel(user)}</SiteCorpStatusBadge>
                      <SiteCorpStatusBadge status="neutral">{scopeLabels[user.access_scope]}</SiteCorpStatusBadge>
                    </div>
                  </div>
                  {isPlatformSuperAdmin && (
                    <SiteCorpButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // TODO: Implement direct access removal
                      }}
                    >
                      <Power className="mr-1 h-3.5 w-3.5" />
                      Revocar
                    </SiteCorpButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </SiteCorpCard>
        
        {/* Inherited users */}
        <SiteCorpCard title="Acceso heredado" description="Usuarios con acceso derivado desde entidades superiores">
          {loading && directUsers.length === 0 && inheritedUsers.length === 0 ? (
            <SiteCorpLoading rows={2} />
          ) : inheritedUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No hay usuarios con acceso heredado a esta entidad.
            </div>
          ) : (
            <div className="space-y-3">
              {inheritedUsers.map((user) => (
                <div
                  key={user.access_id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {user.full_name || user.username || "Usuario"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      @{user.username || "sin usuario"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SiteCorpStatusBadge status="info">{accessRoleLabel(user)}</SiteCorpStatusBadge>
                      <SiteCorpStatusBadge status="neutral">{scopeLabels[user.access_scope]}</SiteCorpStatusBadge>
                      {user.source_entity_name && (
                        <SiteCorpStatusBadge status="warning">
                          Heredado desde {user.source_entity_name}
                        </SiteCorpStatusBadge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SiteCorpCard>
      </div>
      
      {/* Roles y permisos de la entidad. Solo con permiso de GESTIÓN de roles: sin él
          no se consulta el catálogo de roles de otros usuarios. */}
      {canConsultRoles && (
        <SiteCorpCard title="Roles y permisos" description="Gestiona los roles y permisos específicos para esta entidad organizativa">
          <RolesManager scope="organization" companyClientId={currentCompanyClient?.id} organizationEntityId={entity?.id} />
        </SiteCorpCard>
      )}
      
      {/* Entity actions */}
      <div className="flex flex-col gap-3 md:flex-row md:justify-end">
        {entity.parent_id && (
          <SiteCorpButton
            variant="outline"
            onClick={() => {
              navigate(`/organization/${entity.parent_id}`)
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Ver entidad padre
          </SiteCorpButton>
        )}
        
        {children.length > 0 && (
          <SiteCorpButton
            variant="outline"
            onClick={openCreateChildEntity}
          >
            <Plus className="mr-2 h-4 w-4" />
            Crear entidad hija
          </SiteCorpButton>
        )}
        
        {/* Gestionar solo cuando la entidad es Cuenta SiteCorp (módulos internos) */}
        {entity.is_sitecorp_account && (
          <SiteCorpButton
            onClick={() => navigate(`/entity/${entity.id}/summary`)}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Gestionar módulos internos
          </SiteCorpButton>
        )}

        <SiteCorpButton
          variant="outline"
          onClick={openEditEntity}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Editar entidad
        </SiteCorpButton>
        
        {canDeleteEntities && (
          <SiteCorpButton
            type="button"
            variant="destructive"
            onClick={() => setDeleteEntity(entity)}
            disabled={deleting}
          >
            {deleting ? "Eliminando..." : (
              <>
                <Trash2 className="mr-2 h-4 w-4" /> Eliminar entidad
              </>
            )}
          </SiteCorpButton>
        )}
      </div>
      
      {/* Modals */}
      <OrganizationEntityDialog
              open={entityDialogOpen}
              onOpenChange={setEntityDialogOpen}
              onSaved={loadEntityData}
              companyClientId={entity?.tenant_id || currentCompanyClient?.id || ""}
              entities={tenantEntities}
              editingEntity={editingEntity}
              defaultEntityType={
                entity?.entity_type === "business_group" ? "company" :
                entity?.entity_type === "company" ? "ueb" :
                "business_group"
              }
              defaultParentId={entity?.id}
              defaultRegime="PRESUPUESTADA"
            />
      
      <EntityUsersDialog
        entity={usersEntity}
        onClose={() => setUsersEntity(null)}
        onAccessChanged={loadEntityData}
      />
      
      <Dialog
        open={Boolean(deleteEntity)}
        onOpenChange={(open) => !open && setDeleteEntity(null)}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Trash2 className="h-5 w-5 text-destructive" />
              Eliminar entidad
            </DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar la entidad "{entity?.name}"?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setDeleteEntity(null)}
              disabled={deleting}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              variant="destructive"
              onClick={removeOrganizationEntity}
              disabled={deleting}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </SiteCorpButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default OrganizationDetail