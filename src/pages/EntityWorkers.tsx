import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { FilterBuilder } from "@/components/filters/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/lib/entity-filters"
import { filterActiveWorkers } from "@/lib/people-classification"
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

interface WorkerRow {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  gender_id: string | null
  marital_status_id: string | null
  skin_color_id: string | null
  education_level_id: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  province: string | null
  municipality: string | null
  address: string | null
  employment_start_date: string | null
  has_masters_degree: boolean | null
  has_doctorate_degree: boolean | null
}

interface CatalogRow {
  id: string
  name: string
}

const fullName = (w: WorkerRow) =>
  [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")

const missingFields = (w: WorkerRow): string[] => {
  const fields: string[] = []
  if (!w.birth_date) fields.push("fecha de nacimiento")
  if (!w.gender_id) fields.push("sexo")
  if (!w.marital_status_id) fields.push("estado civil")
  if (!w.skin_color_id) fields.push("color de piel")
  if (!w.address) fields.push("dirección")
  if (!w.employment_start_date) fields.push("fecha de incorporación")
  return fields
}

const toOptions = (rows: CatalogRow[]) =>
  rows.map((row) => ({ value: row.id, label: row.name })).sort((a, b) => a.label.localeCompare(b.label))

const EntityWorkers = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [workers, setWorkers] = React.useState<WorkerRow[]>([])
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
      const { data: canView } = await supabase.rpc("can_access_entity", {
        target_entity_id: entityId,
        permission_code: "workers.view",
      })
      const { data: canManage } = await supabase.rpc("can_access_entity", {
        target_entity_id: entityId,
        permission_code: "workers.manage",
      })
      if (!canView && !canManage) {
        setError("No tiene permiso para ver los trabajadores de esta entidad")
        return
      }

      // Criterio compartido de clasificación: relación laboral vigente
      // (`@/lib/people-classification`). Quien causó baja pasa a Reingresos.
      const { data, error: workersError } = await filterActiveWorkers(
        supabase
          .from("workers")
          .select(
            `id, code, first_name, first_surname, second_surname, identification,
           gender_id, marital_status_id, skin_color_id, education_level_id,
           phone, email, birth_date, province, municipality, address,
           employment_start_date, has_masters_degree, has_doctorate_degree`
          )
          .eq("organization_entity_id", entityId)
      )
        .order("first_surname", { ascending: true })
        .order("first_name", { ascending: true })
      if (workersError) throw workersError
      const rows = (data as WorkerRow[]) || []
      setWorkers(rows)

      const [genders, marital, skins, education] = await Promise.all([
        supabase.from("genders").select("id, name").order("name"),
        supabase.from("marital_statuses").select("id, name").order("name"),
        supabase.from("skin_colors").select("id, name").order("name"),
        supabase.from("education_levels").select("id, name").order("name"),
      ])
      setCatalogs({
        gender: (genders.data as CatalogRow[]) || [],
        marital: (marital.data as CatalogRow[]) || [],
        skin: (skins.data as CatalogRow[]) || [],
        education: (education.data as CatalogRow[]) || [],
      })

      // Vinculación: trabajadores con Assignment actual (para el filtro
      // Vinculado / Pendiente). No se muestra como columna; solo se usa para filtrar.
      const ids = rows.map((row) => row.id)
      if (ids.length > 0) {
        const { data: assignments } = await supabase
          .from("worker_position_assignments")
          .select("worker_id, is_current, end_date")
          .in("worker_id", ids)
          .eq("is_current", true)
          .is("end_date", null)
        const linked = new Set<string>()
        ;((assignments as { worker_id: string }[] | null) || []).forEach((a) => linked.add(a.worker_id))
        setLinkedWorkerIds(linked)
      } else {
        setLinkedWorkerIds(new Set())
      }
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
        getValue: (w: WorkerRow) => w.gender_id,
      },
      {
        key: "marital",
        label: "Estado civil",
        type: "select",
        options: toOptions(catalogs.marital || []),
        getValue: (w: WorkerRow) => w.marital_status_id,
      },
      {
        key: "skin",
        label: "Color de piel",
        type: "select",
        options: toOptions(catalogs.skin || []),
        getValue: (w: WorkerRow) => w.skin_color_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: toOptions(catalogs.education || []),
        getValue: (w: WorkerRow) => w.education_level_id,
      },
      {
        key: "province",
        label: "Provincia",
        type: "text",
        placeholder: "Provincia",
        getValue: (w: WorkerRow) => w.province,
      },
      {
        key: "municipality",
        label: "Municipio",
        type: "text",
        placeholder: "Municipio",
        getValue: (w: WorkerRow) => w.municipality,
      },
      {
        key: "masters",
        label: "Máster",
        type: "boolean",
        getValue: (w: WorkerRow) => w.has_masters_degree,
      },
      {
        key: "doctorate",
        label: "Doctorado",
        type: "boolean",
        getValue: (w: WorkerRow) => w.has_doctorate_degree,
      },
      {
        key: "complete",
        label: "Ficha completa",
        type: "boolean",
        getValue: (w: WorkerRow) => missingFields(w).length === 0,
      },
      {
        key: "linked",
        label: "Vinculación",
        type: "select",
        options: [
          { value: "linked", label: "Vinculado a plantilla" },
          { value: "pending", label: "Pendiente de vinculación" },
        ],
        getValue: (w: WorkerRow) => (linkedWorkerIds.has(w.id) ? "linked" : "pending"),
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
                const missing = missingFields(w)
                return (
                  <Link
                    key={w.id}
                    to={`/entity/${entityId}/workers/${w.id}`}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 transition-colors hover:border-sitecorp-primary/40 hover:bg-sitecorp-primary/5 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-ink">{fullName(w)}</span>
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
