import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/AuthContext"
import { useCurrentCompanyClient } from "@/contexts/CurrentCompanyClientContext"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Checkbox } from "@/shared/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { SelectItem } from "@/shared/components/ui/select"
import EntityUsersDialog from "@/modules/organization-structure/presentation/components/entity-users-dialog"
import {
  companyClientNameError,
  createCompanyClient,
  deleteCompanyClient,
  loadCompanyClientDeletionSummary,
  loadCompanyClients,
  updateCompanyClient,
  type CompanyClient,
  type CompanyClientDeletionSummary,
  type CompanyClientRecord,
} from "@/modules/company-client"
import {
  buildOrganizationTree,
  deleteOrganizationEntity,
  loadVisibleEntities,
  type OrganizationEntity,
} from "@/modules/organization-structure"
import {
  OrganizationEntityDialog,
} from "@/modules/organization-structure/presentation/components/organization-entity-dialog"
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Factory,
  Landmark,
  Layers,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  LogIn,
} from "lucide-react"

interface CompanyClientForm {
  name: string
  description: string
  is_active: boolean
}

const emptyCompanyClientForm: CompanyClientForm = {
  name: "",
  description: "",
  is_active: true,
}

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

/**
 * Proyección del cliente de dominio al registro legacy que ya consumen la interfaz, el
 * contexto del cliente activo y el adaptador de escritura. La correspondencia es la
 * IDENTIDAD: `companyClientId === id`.
 */
const toCompanyClientRecord = (companyClient: CompanyClient): CompanyClientRecord => ({
  id: companyClient.companyClientId,
  name: companyClient.name,
  code: companyClient.code ?? "",
  description: companyClient.description,
  is_active: companyClient.isActive === true,
  created_at: companyClient.createdAt ?? undefined,
})


const Organizations = () => {
  const { isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const { currentCompanyClient, setCurrentCompanyClient, clearCurrentCompanyClient } =
    useCurrentCompanyClient()
  const { clearCurrentEntity } = useCurrentEntity()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [companyClients, setCompanyClients] = React.useState<CompanyClientRecord[]>([])
  const [entities, setEntities] = React.useState<OrganizationEntity[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  const [companyClientDialogOpen, setCompanyClientDialogOpen] = React.useState(false)
  const [editingCompanyClient, setEditingCompanyClient] =
    React.useState<CompanyClientRecord | null>(null)
  const [companyClientForm, setCompanyClientForm] =
    React.useState<CompanyClientForm>(emptyCompanyClientForm)
  const [companyClientSaving, setCompanyClientSaving] = React.useState(false)
  const [companyClientError, setCompanyClientError] = React.useState<string | null>(null)

  const [entityDialogOpen, setEntityDialogOpen] = React.useState(false)
  const [editingEntity, setEditingEntity] = React.useState<OrganizationEntity | null>(null)
  const [entityDefaultCompanyClient, setEntityDefaultCompanyClient] = React.useState("")
  const [entityDefaultParent, setEntityDefaultParent] = React.useState<string | undefined>()
  const [entityDefaultType, setEntityDefaultType] = React.useState<
    OrganizationEntity["entity_type"]
  >("business_group")

  const [usersEntity, setUsersEntity] = React.useState<OrganizationEntity | null>(null)
  const [deleteEntity, setDeleteEntity] = React.useState<OrganizationEntity | null>(null)
  // Estado del diálogo de eliminación de cliente. NO se llama `deleteCompanyClient`
  // para no ensombrecer la operación homónima del adaptador de escritura.
  const [deletingCompanyClient, setDeletingCompanyClient] =
    React.useState<CompanyClientRecord | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("")
  const [deleteSummary, setDeleteSummary] = React.useState<CompanyClientDeletionSummary | null>(
    null
  )
  const [deleteSummaryLoading, setDeleteSummaryLoading] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [canDeleteEntities, setCanDeleteEntities] = React.useState(false)
  const [canDeleteCompanyClients, setCanDeleteCompanyClients] = React.useState(false)
  
    const loadData = React.useCallback(async () => {
    try {
      setError(null)
      setLoading(true)

      // Es una lectura de LISTA: no se sustituye por lecturas unitarias. Los clientes
      // los devuelve su dominio y las entidades el de estructura organizativa (con el
      // alias de la columna del cliente propietario ya resuelto).
      const [companyClientList, entityRows] = await Promise.all([
        loadCompanyClients(),
        loadVisibleEntities(),
      ])

      const companyClientRows = companyClientList.map(toCompanyClientRecord)

      setCompanyClients(companyClientRows)
      setEntities(entityRows)
      setExpanded((current) => {
        if (Object.keys(current).length > 0) return current
        return entityRows.reduce<Record<string, boolean>>((map, entity) => {
          if (entity.parent_id) map[entity.id] = true
          return map
        }, {})
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la organización.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    const checkDeletePermissions = async () => {
      // Los CÓDIGOS DE PERMISO son el contrato del backend: no se traducen aquí.
      const [entitiesPermission, companyClientsPermission] = await Promise.all([
        hasPlatformPermission("organizations.delete"),
        hasPlatformPermission("tenants.delete"),
      ])

      setCanDeleteEntities(entitiesPermission)
      setCanDeleteCompanyClients(companyClientsPermission)
    }

    checkDeletePermissions()
  }, [hasPlatformPermission])

  // Composición de la jerarquía (Grupo Empresarial → Empresa → UEB): regla única del
  // dominio de estructura organizativa.
  const { childrenByParent, rootsByCompanyClient } = React.useMemo(
    () => buildOrganizationTree(entities),
    [entities]
  )

  const normalizedSearch = search.trim().toLowerCase()

  const entityMatchesSearch = (entity: OrganizationEntity) => {
    if (!normalizedSearch) return true
    return [entity.name, entity.code, entity.account_code || "", entityTypeLabels[entity.entity_type]]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch)
  }

  const subtreeMatchesSearch = (entity: OrganizationEntity): boolean => {
    if (entityMatchesSearch(entity)) return true
    return (childrenByParent[entity.id] || []).some((child) => subtreeMatchesSearch(child))
  }

  const companyClientMatchesSearch = (companyClient: CompanyClientRecord) => {
    if (!normalizedSearch) return true
    const companyClientMatches = [
      companyClient.name,
      companyClient.code,
      companyClient.description || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch)
    return (
      companyClientMatches ||
      (rootsByCompanyClient[companyClient.id] || []).some((root) => subtreeMatchesSearch(root))
    )
  }

  const openCreateCompanyClient = () => {
    setEditingCompanyClient(null)
    setCompanyClientForm(emptyCompanyClientForm)
    setCompanyClientError(null)
    setCompanyClientDialogOpen(true)
  }

  const openEditCompanyClient = (companyClient: CompanyClientRecord) => {
    setEditingCompanyClient(companyClient)
    setCompanyClientForm({
      name: companyClient.name,
      description: companyClient.description || "",
      is_active: companyClient.is_active,
    })
    setCompanyClientError(null)
    setCompanyClientDialogOpen(true)
  }

  const submitCompanyClient = async (event: React.FormEvent) => {
    event.preventDefault()

    try {
      setCompanyClientError(null)
      if (!companyClientForm.name.trim()) throw new Error("El nombre es obligatorio.")

      setCompanyClientSaving(true)

      // El código del cliente lo genera la base de datos (nombre normalizado +
      // sufijo único) y es inmutable: nunca se envía desde el formulario.
      if (editingCompanyClient) {
        await updateCompanyClient(editingCompanyClient.id, {
          name: companyClientForm.name,
          description: companyClientForm.description,
          isActive: companyClientForm.is_active,
        })
      } else {
        await createCompanyClient({
          name: companyClientForm.name,
          description: companyClientForm.description,
          isActive: companyClientForm.is_active,
        })
      }

      setCompanyClientDialogOpen(false)
      setEditingCompanyClient(null)
      setCompanyClientForm(emptyCompanyClientForm)
      await loadData()
    } catch (err) {
      // El mensaje lo decide la regla pura del dominio: la pantalla no traduce errores.
      setCompanyClientError(companyClientNameError(err))
    } finally {
      setCompanyClientSaving(false)
    }
  }

  const openCreateRootEntity = (companyClientId: string) => {
    setEditingEntity(null)
    setEntityDefaultCompanyClient(companyClientId)
    setEntityDefaultParent(undefined)
    setEntityDefaultType("business_group")
    setEntityDialogOpen(true)
  }

  const openCreateChildEntity = (parent: OrganizationEntity) => {
    setEditingEntity(null)
    setEntityDefaultCompanyClient(parent.tenant_id)
    setEntityDefaultParent(parent.id)
    setEntityDefaultType(parent.entity_type === "business_group" ? "company" : "ueb")
    setEntityDialogOpen(true)
  }

  const openEditEntity = (entity: OrganizationEntity) => {
    setEditingEntity(entity)
    setEntityDefaultCompanyClient(entity.tenant_id)
    setEntityDefaultParent(entity.parent_id || undefined)
    setEntityDefaultType(entity.entity_type)
    setEntityDialogOpen(true)
  }

  const removeOrganizationEntity = async (entity: OrganizationEntity) => {
    try {
      setDeleting(true)
      await deleteOrganizationEntity(entity.id)
      setDeleteEntity(null)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la organización.")
    } finally {
      setDeleting(false)
    }
  }

  const openDeleteCompanyClient = async (companyClient: CompanyClientRecord) => {
    setDeletingCompanyClient(companyClient)
    setDeleteConfirmation("")
    setDeleteError(null)
    setDeleteSummary(null)
    setDeleteSummaryLoading(true)

    try {
      const summary = await loadCompanyClientDeletionSummary(companyClient.id)
      setDeleteSummary(summary)
    } catch (err) {
      console.error("No se pudo preparar la eliminación del cliente.", {
        companyClientId: companyClient.id,
        error: err,
      })
      setDeleteError(
        err instanceof Error ? err.message : "No se pudo preparar la eliminación del cliente.",
      )
    } finally {
      setDeleteSummaryLoading(false)
    }
  }

  const closeDeleteCompanyClient = () => {
    if (deleting) return
    setDeletingCompanyClient(null)
    setDeleteConfirmation("")
    setDeleteSummary(null)
    setDeleteError(null)
  }

  const confirmDeleteCompanyClient = async (companyClient: CompanyClientRecord) => {
    if (deleting) return

    if (deleteConfirmation.trim() !== companyClient.name) {
      setDeleteError("Escribe el nombre exacto del cliente para confirmar la eliminación.")
      return
    }

    try {
      setDeleting(true)
      setDeleteError(null)

      // Autorización, confirmación y borrado transaccional los aplica el backend.
      const result = await deleteCompanyClient(companyClient.id, deleteConfirmation.trim())

      // El cliente eliminado no puede seguir siendo el contexto actual.
      if (currentCompanyClient?.id === companyClient.id) {
        clearCurrentCompanyClient()
        clearCurrentEntity()
      }

      // Ninguna vista puede seguir mostrando datos del cliente eliminado.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["entity-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["contract-alerts"] }),
      ])

      setDeletingCompanyClient(null)
      setDeleteConfirmation("")
      setDeleteSummary(null)
      await loadData()

      if (result.storage?.failed) {
        toast.warning(
          `Cliente eliminado, pero ${result.storage.failed} archivo(s) privados no pudieron borrarse del almacenamiento.`,
        )
        console.error("Objetos de Storage no eliminados del cliente.", {
          companyClientId: companyClient.id,
          failures: result.storage.failures,
        })
      } else {
        toast.success("Cliente eliminado correctamente.")
      }

      if (currentCompanyClient?.id === companyClient.id) {
        navigate("/admin/companies", { replace: true })
      }
    } catch (err) {
      console.error("No se pudo eliminar el cliente.", {
        companyClientId: companyClient.id,
        error: err,
      })
      setDeleteError(err instanceof Error ? err.message : "No se pudo eliminar el cliente.")
    } finally {
      setDeleting(false)
    }
  }

  const enterCompanyClient = (companyClient: CompanyClientRecord) => {
      setCurrentCompanyClient(companyClient)
      navigate("/")
    }
  
    const enterEntity = (entity: OrganizationEntity) => {
      navigate(`/entity/${entity.id}/panel`)
    }

  const renderEntity = (entity: OrganizationEntity, depth: number): React.ReactNode => {
    if (normalizedSearch && !subtreeMatchesSearch(entity)) return null

    const children = childrenByParent[entity.id] || []
    const isOpen = normalizedSearch ? true : expanded[entity.id] === true
    const hasChildren = children.length > 0

    return (
      <div key={entity.id} className="min-w-0">
        <div
          className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-3 transition-colors hover:border-sitecorp-primary/30 sm:flex-row sm:items-center sm:justify-between"
          style={{ marginLeft: depth === 0 ? undefined : depth * 14 }}
        >
          <div className="flex min-w-0 items-start gap-3">
            {hasChildren ? (
              <button
                type="button"
                aria-label={isOpen ? "Colapsar entidad" : "Expandir entidad"}
                onClick={() => setExpanded((current) => ({ ...current, [entity.id]: !isOpen }))}
                className="mt-0.5 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-sitecorp-primary"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="mt-0.5 h-6 w-6" />
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {typeIcon(entity.entity_type)}
                <p className="truncate text-sm font-semibold text-ink">{entity.name}</p>
                <SiteCorpStatusBadge status="neutral">{entityTypeLabels[entity.entity_type]}</SiteCorpStatusBadge>
                <SiteCorpStatusBadge status="info">{entity.regime_id}</SiteCorpStatusBadge>
                {entity.is_sitecorp_account ? (
                  <>
                    <SiteCorpStatusBadge status="success">Cuenta SiteCorp</SiteCorpStatusBadge>
                    <SiteCorpStatusBadge status={entity.account_is_active ? "success" : "warning"}>
                      {entity.account_is_active ? "Cuenta activa" : "Cuenta suspendida"}
                    </SiteCorpStatusBadge>
                  </>
                ) : (
                  <SiteCorpStatusBadge status="neutral">Sin gestión SiteCorp</SiteCorpStatusBadge>
                )}
                {!entity.is_active && <SiteCorpStatusBadge status="danger">Entidad inactiva</SiteCorpStatusBadge>}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Código interno: {entity.code}
                {entity.account_code ? ` · Cuenta: ${entity.account_code}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {entity.entity_type === "business_group" && (
                          <SiteCorpButton size="sm" variant="outline" onClick={() => openCreateChildEntity(entity)}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> Empresa
                          </SiteCorpButton>
                        )}
                        {entity.entity_type === "company" && (
                          <SiteCorpButton size="sm" variant="outline" onClick={() => openCreateChildEntity(entity)}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> UEB
                          </SiteCorpButton>
                        )}
                        {/* Gestionar solo existe cuando la entidad es Cuenta SiteCorp */}
                        {entity.is_sitecorp_account && (
                          <SiteCorpButton size="sm" variant="outline" onClick={() => enterEntity(entity)}>
                            <LogIn className="mr-1 h-3.5 w-3.5" /> Gestionar
                          </SiteCorpButton>
                        )}
                        <SiteCorpButton size="sm" variant="outline" onClick={() => openEditEntity(entity)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                        </SiteCorpButton>
                        {canDeleteEntities && (
                          <SiteCorpButton
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleteEntity(entity)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                          </SiteCorpButton>
                        )}
                        <SiteCorpButton size="sm" onClick={() => setUsersEntity(entity)}>
                          <Users className="mr-1 h-3.5 w-3.5" /> Usuarios
                        </SiteCorpButton>
                      </div>
                    </div>

        {hasChildren && isOpen && (
          <div className="mt-2 space-y-2">
            {children.map((child) => renderEntity(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const sitecorpAccountCount = entities.filter((entity) => entity.is_sitecorp_account).length
  const activeAccountCount = entities.filter(
    (entity) => entity.is_sitecorp_account && entity.account_is_active
  ).length

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Clientes"
        description="Clientes independientes con grupos empresariales, empresas y UEB. Cada nodo puede tener su propia cuenta SiteCorp."
        actions={
          <SiteCorpButton onClick={openCreateCompanyClient}>
            <Plus className="mr-2 h-4 w-4" /> Crear cliente
          </SiteCorpButton>
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      )}
      {!isPlatformSuperAdmin && (
        <SiteCorpAlert type="info" title="Vista autorizada">
          Solo se muestran los clientes y entidades a los que tu usuario tiene acceso.
        </SiteCorpAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SiteCorpCard title="Clientes">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-bold text-ink">{companyClients.length}</p>
            <Landmark className="h-8 w-8 text-sitecorp-primary" />
          </div>
        </SiteCorpCard>
        <SiteCorpCard title="Entidades organizativas">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-bold text-ink">{entities.length}</p>
            <Layers className="h-8 w-8 text-sitecorp-primary" />
          </div>
        </SiteCorpCard>
        <SiteCorpCard title="Cuentas SiteCorp">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-bold text-ink">{sitecorpAccountCount}</p>
            <ShieldCheck className="h-8 w-8 text-sitecorp-primary" />
          </div>
        </SiteCorpCard>
        <SiteCorpCard title="Cuentas activas">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-bold text-sitecorp-success">{activeAccountCount}</p>
            <Building2 className="h-8 w-8 text-sitecorp-success" />
          </div>
        </SiteCorpCard>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <SiteCorpInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar cliente, grupo, empresa, UEB o código..."
          className="pl-9"
        />
      </div>

      <SiteCorpCard
        title="Árbol organizativo"
        description="La jerarquía permanece visible aunque un nodo no sea cuenta SiteCorp."
      >
        {loading ? (
          <SiteCorpLoading rows={6} />
        ) : companyClients.filter(companyClientMatchesSearch).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No se encontraron clientes o entidades.
          </div>
        ) : (
          <div className="space-y-5">
            {companyClients.filter(companyClientMatchesSearch).map((companyClient) => {
              const roots = (rootsByCompanyClient[companyClient.id] || []).filter(
                (root) => !normalizedSearch || subtreeMatchesSearch(root)
              )

              return (
                <section
                  key={companyClient.id}
                  className="rounded-2xl border border-border bg-sitecorp-background/60 p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Landmark className="h-5 w-5 text-sitecorp-primary" />
                        <h3 className="text-base font-semibold text-ink">{companyClient.name}</h3>
                        <SiteCorpStatusBadge status="neutral">{companyClient.code}</SiteCorpStatusBadge>
                        <SiteCorpStatusBadge status={companyClient.is_active ? "success" : "warning"}>
                          {companyClient.is_active ? "Cliente activo" : "Cliente inactivo"}
                        </SiteCorpStatusBadge>
                      </div>
                      {companyClient.description && (
                        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                          {companyClient.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <SiteCorpButton size="sm" variant="outline" onClick={() => openEditCompanyClient(companyClient)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                      </SiteCorpButton>
                      <SiteCorpButton size="sm" variant="outline" onClick={() => openCreateRootEntity(companyClient.id)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Grupo
                      </SiteCorpButton>
                      {canDeleteCompanyClients && (
                        <SiteCorpButton size="sm" variant="outline" onClick={() => openDeleteCompanyClient(companyClient)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                        </SiteCorpButton>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {roots.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-white/70 p-5 text-sm text-muted-foreground">
                        Este cliente aún no tiene grupos empresariales.
                      </div>
                    ) : (
                      roots.map((root) => renderEntity(root, 0))
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </SiteCorpCard>

      <Dialog open={companyClientDialogOpen} onOpenChange={setCompanyClientDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Landmark className="h-5 w-5 text-sitecorp-primary" />
              {editingCompanyClient ? `Editar ${editingCompanyClient.name}` : "Crear cliente"}
            </DialogTitle>
            <DialogDescription>
              Un cliente es un árbol organizativo aislado técnicamente y agrupa sus grupos
              empresariales, empresas y UEB. No sustituye a las cuentas SiteCorp de cada entidad.
            </DialogDescription>
          </DialogHeader>

          {companyClientError && (
            <SiteCorpAlert type="danger" title="Error">
              {companyClientError}
            </SiteCorpAlert>
          )}

          <form onSubmit={submitCompanyClient} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Nombre</label>
              <SiteCorpInput
                value={companyClientForm.name}
                onChange={(event) =>
                  setCompanyClientForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Ej.: Grupo Empresarial Mayabeque"
                required
              />
            </div>

            {/* El código no se introduce: se genera automáticamente en el servidor. */}
            {editingCompanyClient ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Código</label>
                <SiteCorpInput value={editingCompanyClient.code} disabled />
                <p className="text-xs text-muted-foreground">
                  Identificador estable generado automáticamente. No cambia al renombrar el
                  cliente.
                </p>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                El código del cliente se genera automáticamente a partir del nombre (por ejemplo{" "}
                <span className="font-mono">GRUPO-EMPRESARIAL-MAYABEQUE-A7K4P2</span>) y no se
                modifica al renombrarlo.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Descripción</label>
              <SiteCorpInput
                value={companyClientForm.description}
                onChange={(event) =>
                  setCompanyClientForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <Checkbox
                checked={companyClientForm.is_active}
                onCheckedChange={(checked) =>
                  setCompanyClientForm((current) => ({ ...current, is_active: checked === true }))
                }
              />
              Cliente activo
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setCompanyClientDialogOpen(false)}
                disabled={companyClientSaving}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={companyClientSaving}>
                <Save className="mr-2 h-4 w-4" />
                {companyClientSaving ? "Guardando..." : editingCompanyClient ? "Guardar cambios" : "Crear cliente"}
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <OrganizationEntityDialog
        open={entityDialogOpen}
        onOpenChange={setEntityDialogOpen}
        onSaved={loadData}
        companyClientId={entityDefaultCompanyClient}
        entities={entities}
        editingEntity={editingEntity}
        defaultEntityType={entityDefaultType}
        defaultParentId={entityDefaultParent}
        defaultRegime="PRESUPUESTADA"
      />

      <EntityUsersDialog
              entity={usersEntity}
              onClose={() => setUsersEntity(null)}
              onAccessChanged={loadData}
            />

            <Dialog open={Boolean(deleteEntity)} onOpenChange={(open) => !open && setDeleteEntity(null)}>
              <DialogContent className="max-w-md rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <Trash2 className="h-5 w-5 text-destructive" />
                    Eliminar entidad
                  </DialogTitle>
                  <DialogDescription>
                    ¿Estás seguro de que deseas eliminar la entidad "{deleteEntity?.name}"?
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
                    onClick={() => deleteEntity && removeOrganizationEntity(deleteEntity)}
                    disabled={deleting}
                  >
                    {deleting ? "Eliminando..." : "Eliminar"}
                  </SiteCorpButton>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deletingCompanyClient)} onOpenChange={(open) => !open && closeDeleteCompanyClient()}>
                          <DialogContent className="max-w-lg rounded-2xl">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-xl">
                                <Trash2 className="h-5 w-5 text-destructive" />
                                Eliminar cliente
                              </DialogTitle>
                              <DialogDescription asChild>
                                <div className="space-y-3 pt-1 text-sm text-muted-foreground">
                                  <p>
                                    Esta acción eliminará permanentemente el cliente{" "}
                                    <strong className="text-ink">{deletingCompanyClient?.name}</strong> y los datos
                                    pertenecientes a sus entidades: grupos empresariales, empresas, UEB,
                                    áreas, cargos, puestos, candidatos, plantilla, trabajadores,
                                    contratos, anexos, documentos y plantillas documentales, además de
                                    los roles internos y los accesos a esas entidades.
                                  </p>
                                  <p>
                                    Se conservan intactos los usuarios, sus perfiles, sus accesos a
                                    otros clientes, los roles de plataforma y todos los catálogos
                                    globales.
                                  </p>
                                  <p className="font-medium text-destructive">
                                    Esta acción no se puede deshacer.
                                  </p>
                                </div>
                              </DialogDescription>
                            </DialogHeader>

                            {deleteSummaryLoading ? (
                              <p className="text-sm text-muted-foreground">Analizando dependencias...</p>
                            ) : null}

                            {deleteSummary ? (
                              <div className="rounded-xl border border-sitecorp-border bg-sitecorp-background p-3 text-sm">
                                <p className="font-medium text-ink">Contenido actual del cliente</p>
                                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                  <li>Entidades: {deleteSummary.entities}</li>
                                  <li>Puestos: {deleteSummary.positions}</li>
                                  <li>Trabajadores: {deleteSummary.workers}</li>
                                  <li>Candidatos: {deleteSummary.candidates}</li>
                                  <li>Contratos: {deleteSummary.contracts}</li>
                                  <li>Anexos: {deleteSummary.addendums}</li>
                                  <li>Documentos de trabajador: {deleteSummary.worker_documents}</li>
                                  <li>Documentos de candidato: {deleteSummary.candidate_documents}</li>
                                  <li>Plantillas: {deleteSummary.document_templates}</li>
                                  <li>Roles internos: {deleteSummary.roles}</li>
                                  <li>Membresías: {deleteSummary.memberships}</li>
                                  <li>Invitaciones: {deleteSummary.invitations}</li>
                                </ul>
                              </div>
                            ) : null}

                            <div className="space-y-2">
                              <label
                                htmlFor="delete-company-client-confirmation"
                                className="text-sm font-medium text-ink"
                              >
                                Escribe «{deletingCompanyClient?.name}» para confirmar:
                              </label>
                              <SiteCorpInput
                                id="delete-company-client-confirmation"
                                value={deleteConfirmation}
                                onChange={(event) => setDeleteConfirmation(event.target.value)}
                                placeholder={deletingCompanyClient?.name ?? ""}
                                disabled={deleting || Boolean(deleteError && !deleteSummary)}
                                autoComplete="off"
                              />
                            </div>

                            {deleteError ? (
                              <SiteCorpAlert type="danger" title="No se pudo eliminar el cliente">
                                {deleteError}
                              </SiteCorpAlert>
                            ) : null}

                            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                              <SiteCorpButton
                                type="button"
                                variant="outline"
                                onClick={closeDeleteCompanyClient}
                                disabled={deleting}
                              >
                                Cancelar
                              </SiteCorpButton>
                              <SiteCorpButton
                                type="button"
                                variant="destructive"
                                onClick={() => deletingCompanyClient && confirmDeleteCompanyClient(deletingCompanyClient)}
                                disabled={
                                  deleting ||
                                  deleteSummaryLoading ||
                                  !deletingCompanyClient ||
                                  deleteConfirmation.trim() !== deletingCompanyClient.name
                                }
                              >
                                {deleting ? "Eliminando cliente..." : "Eliminar definitivamente"}
                              </SiteCorpButton>
                            </div>
                          </DialogContent>
                        </Dialog>
                </div>
              )
            }
            
            export default Organizations
