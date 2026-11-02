import * as React from "react"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import {
  loadCandidateRegistryCatalogs,
  loadEntityCandidatesView,
  type CatalogOption,
  type PersonCandidate,
} from "@/modules/people"
import { useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/components/ui/table"
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from "@/shared/components/ui/pagination"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Users, Edit3, Plus, Eye } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog"
import { FilterBuilder } from "@/shared/components/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/modules/organization-structure/presentation/hooks/use-entity-filters"
import CandidateForm from "@/modules/people/presentation/components/CandidateForm"
import { CUBA_PROVINCES_FULL } from "@/data/cuba-locations-full"
import { supabase } from "@/lib/supabase"
import { CANDIDATES_CHANGED_EVENT } from "@/modules/people/infrastructure/candidate-pool-meta"

interface Gender {
  id: string
  name: string
}

interface MaritalStatus {
  id: string
  name: string
}

interface EducationLevel {
  id: string
  name: string
}

interface Province {
  id: string
  name: string
}

/**
 * Listado de candidatos de la entidad.
 *
 * El ALTA se resuelve con la MISMA ficha del expediente (`CandidateForm` en modo creación),
 * de modo que no existen dos formularios de candidato: ni campos, ni validaciones, ni
 * documentos duplicados. Esta pantalla solo lista, filtra y abre el expediente.
 */
const EntityCandidates = () => {
  const { currentEntity } = useCurrentEntity()
  const entityId = currentEntity?.id

  const [candidates, setCandidates] = React.useState<PersonCandidate[]>([])
  const [genders, setGenders] = React.useState<Gender[]>([])
  const [maritalStatuses, setMaritalStatuses] = React.useState<MaritalStatus[]>([])
  const [educationLevels, setEducationLevels] = React.useState<EducationLevel[]>([])
  const [skinColors, setSkinColors] = React.useState<CatalogOption[]>([])
  const [, setProvinces] = React.useState<Province[]>([])

  const [searchTerm, setSearchTerm] = React.useState("")
  const [candidatesWithLicense, setCandidatesWithLicense] = React.useState<Set<string>>(new Set())

  const [page, setPage] = React.useState(1)
  const [rowsPerPage, setRowsPerPage] = React.useState(10)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Alta: la ficha unificada se muestra dentro del diálogo del listado.
  const [formOpen, setFormOpen] = React.useState(false)
  const [formSuccess, setFormSuccess] = React.useState(false)

  // Fetch reference data (catálogos cacheados en memoria)
  React.useEffect(() => {
    const fetchReferenceData = async () => {
      try {
        const catalogs = await loadCandidateRegistryCatalogs()

        setGenders(catalogs.genders)
        setMaritalStatuses(catalogs.maritalStatuses)
        setEducationLevels(catalogs.educationLevels)
        setSkinColors(catalogs.skinColors)

        // Provincias: fuente única compartida (sin listas locales duplicadas)
        setProvinces(CUBA_PROVINCES_FULL.map(name => ({ id: name, name })))
      } catch (err) {
        console.error("Error fetching reference data:", err)
        setError("Error al cargar datos de referencia")
      }
    }

    if (entityId) {
      fetchReferenceData()
    }
  }, [entityId])

  // Función reutilizable para cargar o refrescar los candidatos de la entidad
  const fetchCandidates = React.useCallback(
    async (options?: { silent?: boolean }) => {
      if (!entityId) {
        setCandidates([])
        setCandidatesWithLicense(new Set())
        return
      }

      if (!options?.silent) {
        setLoading(true)
      }
      setError(null)

      try {
        // Caso de uso del dominio de personas: filas de la entidad + clasificación por
        // identidad (cliente, identificación) + licencias de conducción.
        const view = await loadEntityCandidatesView({
          entityId,
          companyClientId: currentEntity?.tenant_id,
        })
        setCandidates(view.candidates)
        setCandidatesWithLicense(view.candidatesWithLicense)
      } catch (err) {
        console.error("Error fetching candidates:", err)
        if (!options?.silent) {
          setError("Error al cargar los candidatos")
          setCandidates([])
          setCandidatesWithLicense(new Set())
        }
      } finally {
        if (!options?.silent) {
          setLoading(false)
        }
      }
    },
    [entityId, currentEntity?.tenant_id]
  )

  // Carga inicial al entrar o cambiar de entidad
  React.useEffect(() => {
    if (entityId) {
      fetchCandidates()
    }
  }, [entityId, fetchCandidates])

  // Suscripción automática a cambios locales y en tiempo real (Supabase Realtime)
  React.useEffect(() => {
    if (!entityId) return

    const handleCandidatesChanged = () => {
      fetchCandidates({ silent: true })
    }

    window.addEventListener(CANDIDATES_CHANGED_EVENT, handleCandidatesChanged)

    const channel = supabase
      .channel(`entity_candidates_${entityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidates",
        },
        () => {
          fetchCandidates({ silent: true })
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener(CANDIDATES_CHANGED_EVENT, handleCandidatesChanged)
      supabase.removeChannel(channel)
    }
  }, [entityId, fetchCandidates])

  // ---------- Filtros (constructor común, criterios reales de Candidato) ----------
  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(
    () => [
      {
        key: "gender",
        label: "Sexo",
        type: "select",
        options: genders.map((g) => ({ value: g.id, label: g.name })),
        getValue: (c: PersonCandidate) => c.gender_id,
      },
      {
        key: "marital",
        label: "Estado civil",
        type: "select",
        options: maritalStatuses.map((m) => ({ value: m.id, label: m.name })),
        getValue: (c: PersonCandidate) => c.marital_status_id,
      },
      {
        key: "skin",
        label: "Color de piel",
        type: "select",
        options: skinColors.map((s) => ({ value: s.id, label: s.name })),
        getValue: (c: PersonCandidate) => c.skin_color_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: educationLevels.map((e) => ({ value: e.id, label: e.name })),
        getValue: (c: PersonCandidate) => c.education_level_id,
      },
      { key: "specialty", label: "Especialidad", type: "text", placeholder: "Especialidad", getValue: (c: PersonCandidate) => c.specialty },
      { key: "profession", label: "Profesión u oficio", type: "text", placeholder: "Profesión u oficio", getValue: (c: PersonCandidate) => c.profession_or_trade },
      { key: "province", label: "Provincia", type: "text", placeholder: "Provincia", getValue: (c: PersonCandidate) => c.province },
      { key: "municipality", label: "Municipio", type: "text", placeholder: "Municipio", getValue: (c: PersonCandidate) => c.municipality },
      { key: "license", label: "Licencia de conducción", type: "boolean", getValue: (c: PersonCandidate) => candidatesWithLicense.has(c.id) },
      { key: "masters", label: "Máster", type: "boolean", getValue: (c: PersonCandidate) => c.has_masters_degree },
      { key: "doctorate", label: "Doctorado", type: "boolean", getValue: (c: PersonCandidate) => c.has_doctorate_degree },
      {
        key: "status",
        label: "Estado",
        type: "select",
        options: [
          { value: "active", label: "Activo" },
          { value: "archived", label: "Archivado" },
        ],
        getValue: (c: PersonCandidate) => c.status,
      },
    ],
    [genders, maritalStatuses, educationLevels, skinColors, candidatesWithLicense]
  )

  const filters = useEntityFilters(candidates, filterDefinitions)

  const searchedCandidates = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return filters.result
    return filters.result.filter((c) =>
      [c.first_name, c.first_surname, c.second_surname, c.identification]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
  }, [filters.result, searchTerm])

  React.useEffect(() => {
    setPage(1)
  }, [searchTerm, filters.active])

  const totalPages = Math.ceil(searchedCandidates.length / rowsPerPage)

  const pagedCandidates = React.useMemo(() => {
    const from = (page - 1) * rowsPerPage
    return searchedCandidates.slice(from, from + rowsPerPage)
  }, [searchedCandidates, page, rowsPerPage])

  // Navigation
  const navigate = useNavigate()

  /** Alta terminada: se cierra el diálogo, se refresca el listado de inmediato y se anuncia el resultado. */
  const handleFormCreated = () => {
    setFormOpen(false)
    setFormSuccess(true)
    fetchCandidates({ silent: true })
    setTimeout(() => setFormSuccess(false), 3000)
  }

  /** Cancelar el alta: se cierra el diálogo sin dejar datos a medias. */
  const handleFormCancel = () => {
    setFormOpen(false)
  }

  if (!entityId) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpAlert type="info">
          Seleccione una entidad para ver sus candidatos
        </SiteCorpAlert>
      </div>
    )
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(parseInt(e.target.value))
    setPage(1)
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpLoading rows={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Candidatos"
          description="Gestión de candidatos y procesos de selección"
        />
        <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <SiteCorpPageHeader
          title="Candidatos"
          description={`Listado de candidatos para ${currentEntity?.name}`}
        />
        <SiteCorpButton onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo candidato
        </SiteCorpButton>
      </div>

      {/* Success alert */}
      {formSuccess && (
        <SiteCorpAlert type="success">
          Candidato creado exitosamente
        </SiteCorpAlert>
      )}

      {/* Búsqueda + filtros acumulativos */}
      <SiteCorpCard>
        <div className="space-y-4">
          <div className="max-w-md">
            <SiteCorpInput
              type="text"
              placeholder="Buscar por nombre, apellidos o identificación"
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
          <FilterBuilder
            definitions={filters.definitions}
            active={filters.active}
            available={filters.available}
            onAdd={filters.add}
            onRemove={filters.remove}
            onSetValues={filters.setValues}
            onClear={filters.clear}
            resultCount={searchedCandidates.length}
            totalCount={candidates.length}
          />
        </div>
      </SiteCorpCard>

      {/* Candidates Table */}
      {pagedCandidates.length === 0 ? (
        <SiteCorpCard>
          <SiteCorpAlert type="info">
            No se encontraron candidatos con los criterios especificados
          </SiteCorpAlert>
        </SiteCorpCard>
      ) : (
        <>
          <SiteCorpCard>
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Nombre</TableHead>
                    <TableHead className="w-20">Primer apellido</TableHead>
                    <TableHead className="w-20">Segundo apellido</TableHead>
                    <TableHead className="w-20">Identificación</TableHead>
                    <TableHead className="w-16">Sexo</TableHead>
                    <TableHead className="w-20">Nivel educacional</TableHead>
                    <TableHead className="w-20">Especialidad</TableHead>
                    <TableHead className="w-16">Teléfono</TableHead>
                    <TableHead className="w-16">Estado</TableHead>
                    <TableHead className="w-20">Fecha registro</TableHead>
                    <TableHead className="w-16">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCandidates.map((candidate) => (
                    <TableRow key={candidate.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sitecorp-primary/10">
                            <Users className="h-4 w-4 text-sitecorp-primary" />
                          </div>
                          <div>
                            <button
                              className="text-left hover:underline"
                              onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}`)}
                            >
                              <p className="text-sm font-medium text-ink cursor-pointer">
                                {candidate.first_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {candidate.first_surname} {candidate.second_surname || ""}
                              </p>
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.first_surname}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.second_surname || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium text-ink">{candidate.identification}</p>
                      </TableCell>
                      <TableCell>
                        {candidate.gender_id ? (
                          <p className="text-sm text-muted-foreground">
                            {genders.find(g => g.id === candidate.gender_id)?.name || "Desconocido"}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">-</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {candidate.education_level_id ? (
                          <p className="text-sm text-muted-foreground">
                            {educationLevels.find(e => e.id === candidate.education_level_id)?.name || "Desconocido"}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">-</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.specialty || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{candidate.phone || "-"}</p>
                      </TableCell>
                      <TableCell>
                        <SiteCorpStatusBadge
                          status={candidate.status === "active" ? "success" : "neutral"}
                        >
                          {candidate.status === "active" ? "Activo" : "Archivado"}
                        </SiteCorpStatusBadge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">
                          {new Date(candidate.created_at).toLocaleDateString("es-ES")}
                        </p>
                      </TableCell>
                      <TableCell className="flex items-center gap-2">
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}`)}
                        >
                          <Eye className="mr-1 h-3 w-3" /> Ver
                        </SiteCorpButton>
                        <SiteCorpButton
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/entity/${entityId}/candidates/${candidate.id}/edit`)}
                        >
                          <Edit3 className="mr-1 h-3 w-3" />
                        </SiteCorpButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SiteCorpCard>

          {/* Pagination */}
          <div className="flex justify-center mt-6">
            <Pagination>
              <PaginationContent>
                {totalPages > 0 && (
                  <>
                    <PaginationPrevious
                      onClick={() => handlePageChange(Math.max(1, page - 1))}
                    />
                    {page > 3 && (
                      <>
                        <PaginationItem>
                          <PaginationLink
                            isActive={false}
                            onClick={() => handlePageChange(1)}
                          >
                            1
                          </PaginationLink>
                        </PaginationItem>
                        <PaginationEllipsis />
                      </>
                    )}
                    {page > 2 && (
                      <PaginationItem>
                        <PaginationLink
                          isActive={false}
                          onClick={() => handlePageChange(page - 1)}
                        >
                          {page - 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        isActive={true}
                        onClick={() => handlePageChange(page)}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                    {page < totalPages - 1 && (
                      <PaginationItem>
                        <PaginationLink
                          isActive={false}
                          onClick={() => handlePageChange(page + 1)}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    {page < totalPages - 2 && (
                      <>
                        <PaginationEllipsis />
                        <PaginationItem>
                          <PaginationLink
                            isActive={false}
                            onClick={() => handlePageChange(totalPages)}
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      </>
                    )}
                    <PaginationNext
                      onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                    />
                  </>
                )}
              </PaginationContent>
            </Pagination>
          </div>

          {/* Info bar */}
          <div className="flex justify-between items-center mt-4 text-sm text-muted-foreground">
            <p>
              Mostrando {pagedCandidates.length} de {searchedCandidates.length} candidatos
            </p>
            <div className="flex items-center gap-4">
              <label>
                Filas por página:
                <select
                  value={rowsPerPage}
                  onChange={handleRowsPerPageChange}
                  className="ml-2 SiteCorpInput"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          </div>
        </>
      )}

      {/* Alta de candidato: la ficha del expediente, en modo creación */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) handleFormCancel()
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo candidato</DialogTitle>
            <DialogDescription>
              Complete los datos del candidato. Los campos marcados con * son obligatorios.
            </DialogDescription>
          </DialogHeader>

          {formOpen && (
            <CandidateForm
              mode="create"
              variant="dialog"
              entityId={entityId}
              onSuccess={handleFormCreated}
              onCancel={handleFormCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default EntityCandidates
