import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { FilterBuilder } from "@/components/filters/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/modules/organization-structure/presentation/hooks/use-entity-filters"
import {
  loadEntityWorkersDirectory,
  missingPersonProfileFields,
  personFullName,
  type CatalogRow,
  type PersonDirectoryWorker,
} from "@/modules/people"
import { ArrowLeft, Search, Users, UserCheck, AlertTriangle } from "lucide-react"

/**
 * PERSONAS → TRABAJADORES.
 *
 * Directorio de las personas que ACTUALMENTE pertenecen a la entidad
 * (estado laboral activo). Es independiente de la Plantilla: un trabajador
 * aparece aunque no tenga Puesto/Assignment (p. ej. migrado sin vincular).
 * NO muestra información estructural (Área, Cargo, Puesto, salario, Grupo).
 *
 * Filtros: criterios personales y de vinculación (aunque el listado no muestre
 * Cargo/Puesto, se puede filtrar por ellos cuando sea útil).
 */

/**
 * El contrato de fila, el nombre completo y la regla de «ficha completa» viven en el
 * dominio de personas (`@/domains/people`): la vista no declara tipos ni reglas propias.
 */

const toOptions = (rows: CatalogRow[]) =>
  rows.map((row) => ({ value: row.id, label: row.name })).sort((a, b) => a.label.localeCompare(b.label))

const EntityWorkers = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [workers, setWorkers] = React.useState<PersonDirectoryWorker[]>([])
  const [catalogs, setCatalogs] = React.useState<Record<string, CatalogRow[]>>({})
  const [linkedWorkerIds, setLinkedWorkerIds] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setError("Parámetros de URL no válidos")
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Caso de uso del dominio de personas: permiso efectivo, clasificación por
      // relación laboral vigente y datos accesorios de la vista (catálogos y
      // vinculación a plantilla) en una sola operación. Quien causó baja pasa a
      // Reingresos: nunca aparece en las dos vistas a la vez.
      const view = await loadEntityWorkersDirectory(entityId)

      if (!view.canView && !view.canManage) {
        setError("No tiene permiso para ver los trabajadores de esta entidad")
        return
      }

      setWorkers(view.workers)
      setCatalogs({
        gender: view.catalogs.genders,
        marital: view.catalogs.maritalStatuses,
        skin: view.catalogs.skinColors,
        education: view.catalogs.educationLevels,
      })
      setLinkedWorkerIds(view.linkedWorkerIds)
    } catch (err) {
      console.error("Error loading workers directory:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los trabajadores")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(
    () => [
      {
        key: "gender",
        label: "Sexo",
        type: "select",
        options: toOptions(catalogs.gender || []),
        getValue: (w: PersonDirectoryWorker) => w.gender_id,
      },
      {
        key: "marital",
        label: "Estado civil",
        type: "select",
        options: toOptions(catalogs.marital || []),
        getValue: (w: PersonDirectoryWorker) => w.marital_status_id,
      },
      {
        key: "skin",
        label: "Color de piel",
        type: "select",
        options: toOptions(catalogs.skin || []),
        getValue: (w: PersonDirectoryWorker) => w.skin_color_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: toOptions(catalogs.education || []),
        getValue: (w: PersonDirectoryWorker) => w.education_level_id,
      },
      {
        key: "province",
        label: "Provincia",
        type: "text",
        placeholder: "Provincia",
        getValue: (w: PersonDirectoryWorker) => w.province,
      },
      {
        key: "municipality",
        label: "Municipio",
        type: "text",
        placeholder: "Municipio",
        getValue: (w: PersonDirectoryWorker) => w.municipality,
      },
      {
        key: "masters",
        label: "Máster",
        type: "boolean",
        getValue: (w: PersonDirectoryWorker) => w.has_masters_degree,
      },
      {
        key: "doctorate",
        label: "Doctorado",
        type: "boolean",
        getValue: (w: PersonDirectoryWorker) => w.has_doctorate_degree,
      },
      {
        key: "complete",
        label: "Ficha completa",
        type: "boolean",
        getValue: (w: PersonDirectoryWorker) => missingPersonProfileFields(w).length === 0,
      },
      {
        key: "linked",
        label: "Vinculación",
        type: "select",
        options: [
          { value: "linked", label: "Vinculado a plantilla" },
          { value: "pending", label: "Pendiente de vinculación" },
        ],
        getValue: (w: PersonDirectoryWorker) => (linkedWorkerIds.has(w.id) ? "linked" : "pending"),
      },
    ],
    [catalogs, linkedWorkerIds]
  )

  const filters = useEntityFilters(workers, filterDefinitions)

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filters.result
    return filters.result.filter((w) =>
      [w.first_name, w.first_surname, w.second_surname, w.identification, w.code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
  }, [filters.result, search])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Trabajadores" description="Cargando personas..." />
        <SiteCorpLoading rows={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Trabajadores"
          description="Personas que actualmente trabajan en esta entidad."
        />
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
        <div className="flex justify-end">
          <SiteCorpButton variant="outline" onClick={() => navigate(`/entity/${entityId}/summary`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </SiteCorpButton>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Trabajadores"
        description="Directorio de las personas que actualmente pertenecen a esta entidad. No depende de la Plantilla ni del Puesto."
      />

      <SiteCorpCard>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <SiteCorpInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, carné de identidad o código..."
                className="pl-9"
              />
            </div>
          </div>

          <FilterBuilder
            definitions={filters.definitions}
            active={filters.active}
            available={filters.available}
            onAdd={filters.add}
            onRemove={filters.remove}
            onSetValues={filters.setValues}
            onClear={filters.clear}
            resultCount={filtered.length}
            totalCount={workers.length}
          />

          {workers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
              <Users className="mb-4 h-12 w-12 text-muted-foreground" />
              <h4 className="mb-1 text-base font-semibold text-ink">
                No hay trabajadores activos.
              </h4>
              <p className="text-center text-sm text-muted-foreground">
                Las personas aparecerán aquí al contratarlas o al vincularlas a la entidad, aunque
                todavía no tengan un puesto asignado.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
              <UserCheck className="mb-4 h-12 w-12 text-muted-foreground" />
              <h4 className="mb-1 text-base font-semibold text-ink">Sin resultados</h4>
              <p className="text-sm text-muted-foreground">
                Ninguna persona coincide con la búsqueda o los filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((w) => {
                const missing = missingPersonProfileFields(w)
                return (
                  <Link
                    key={w.id}
                    to={`/entity/${entityId}/workers/${w.id}`}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 transition-colors hover:border-sitecorp-primary/40 hover:bg-sitecorp-primary/5 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-ink">{personFullName(w)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {w.code}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        CI: {w.identification}
                      </span>
                      {w.phone && (
                        <span className="text-xs text-muted-foreground">Tel: {w.phone}</span>
                      )}
                      {w.email && (
                        <span className="text-xs text-muted-foreground">{w.email}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {linkedWorkerIds.has(w.id) ? (
                        <SiteCorpStatusBadge status="neutral">Vinculado a plantilla</SiteCorpStatusBadge>
                      ) : (
                        <SiteCorpStatusBadge status="warning">Pendiente de vinculación</SiteCorpStatusBadge>
                      )}
                      {missing.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sitecorp-warning/40 bg-sitecorp-warning/10 px-2.5 py-0.5 text-xs font-medium text-sitecorp-warning">
                          <AlertTriangle className="h-3 w-3" />
                          Ficha incompleta ({missing.length})
                        </span>
                      ) : (
                        <SiteCorpStatusBadge status="success">Ficha completa</SiteCorpStatusBadge>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </SiteCorpCard>
    </div>
  )
}

export default EntityWorkers
