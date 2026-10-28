import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import ReincorporateWorkerDialog from "@/modules/people/presentation/components/ReincorporateWorkerDialog"
import { FilterBuilder } from "@/shared/components/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/modules/organization-structure/presentation/hooks/use-entity-filters"
import {
  loadEntityReentriesView,
  personFullName,
  type CatalogRow,
  type PersonReentryWorker,
  type PersonSeparation,
} from "@/modules/people"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { ArrowLeft, Search, Undo2, UserPlus } from "lucide-react"

/**
 * PERSONAS → REINGRESOS (§20–§26).
 *
 * Vista de los Workers dados de baja (estado laboral ≠ activo). NO es una copia ni
 * una tabla paralela: es el MISMO expediente Worker en estado inactivo. Desde aquí
 * puede reingresarse reutilizando el expediente existente (nunca se crea otro Worker).
 */

/**
 * El contrato de fila, el nombre completo y la regla de clasificación viven en el
 * dominio de personas (`@/domains/people`): la vista no declara tipos ni reglas propias.
 */

const EntityReentries = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()

  const [workers, setWorkers] = React.useState<PersonReentryWorker[]>([])
  const [bajas, setBajas] = React.useState<Record<string, PersonSeparation>>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [reentryWorkerId, setReentryWorkerId] = React.useState<string | null>(null)
  const [catalogs, setCatalogs] = React.useState<Record<string, CatalogRow[]>>({})

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setError("Parámetros de URL no válidos")
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Caso de uso del dominio de personas: permiso efectivo, clasificación
      // (relación laboral finalizada y sin otra vigente en el cliente) y los datos
      // accesorios de la vista (catálogos y última baja) en una sola operación. Al
      // reincorporar a la persona vuelve a Trabajadores y sale de aquí.
      const view = await loadEntityReentriesView({
        entityId,
        companyClientId: currentEntity?.tenant_id,
      })

      if (!view.canView && !view.canManage) {
        setError("No tiene permiso para ver los reingresos de esta entidad")
        return
      }
      setCanManage(view.canManage)

      setWorkers(view.workers)
      setCatalogs({
        gender: view.catalogs.genders,
        education: view.catalogs.educationLevels,
      })
      setBajas(view.separations)
    } catch (err) {
      console.error("Error loading reentries:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los reingresos")
    } finally {
      setLoading(false)
    }
  }, [entityId, currentEntity?.tenant_id])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(() => {
    const reasonOptions = Array.from(
      new Set(Object.values(bajas).map((b) => b.reason).filter((v): v is string => !!v))
    )
      .sort()
      .map((reason) => ({ value: reason, label: reason }))

    return [
      {
        key: "gender",
        label: "Sexo",
        type: "select",
        options: (catalogs.gender || []).map((row) => ({ value: row.id, label: row.name })),
        getValue: (w: PersonReentryWorker) => w.gender_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: (catalogs.education || []).map((row) => ({ value: row.id, label: row.name })),
        getValue: (w: PersonReentryWorker) => w.education_level_id,
      },
      {
        key: "bajaDate",
        label: "Fecha de baja",
        type: "daterange",
        getValue: (w: PersonReentryWorker) => bajas[w.id]?.effective_date ?? null,
      },
      {
        key: "bajaReason",
        label: "Motivo de baja",
        type: "select",
        options: reasonOptions,
        getValue: (w: PersonReentryWorker) => bajas[w.id]?.reason ?? null,
      },
    ]
  }, [catalogs, bajas])

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
        <SiteCorpPageHeader title="Reingresos" description="Cargando trabajadores dados de baja..." />
        <SiteCorpLoading rows={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Reingresos"
          description="Trabajadores dados de baja que pueden reincorporarse."
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
        title="Reingresos"
        description="Personas dadas de baja en esta entidad. Su expediente completo se conserva y puede reingresarse sin crear un nuevo trabajador."
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
              <Undo2 className="mb-4 h-12 w-12 text-muted-foreground" />
              <h4 className="mb-1 text-base font-semibold text-ink">No hay reingresos.</h4>
              <p className="text-center text-sm text-muted-foreground">
                Aquí aparecerán las personas al darlas de baja. No se eliminan: conservan todo su
                expediente.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
              <Undo2 className="mb-4 h-12 w-12 text-muted-foreground" />
              <h4 className="mb-1 text-base font-semibold text-ink">Sin resultados</h4>
              <p className="text-sm text-muted-foreground">
                Ninguna persona coincide con la búsqueda.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((w) => {
                const baja = bajas[w.id]
                return (
                  <div
                    key={w.id}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        to={`/entity/${entityId}/workers/${w.id}`}
                        className="text-sm font-medium text-ink underline-offset-2 hover:text-sitecorp-primary hover:underline"
                      >
                        {personFullName(w)}
                      </Link>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {w.code}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        CI: {w.identification}
                      </span>
                      {baja ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            Baja: {baja.effective_date}
                          </span>
                          {baja.reason && (
                            <span className="text-xs text-muted-foreground">{baja.reason}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          Sin baja registrada
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <SiteCorpButton
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/entity/${entityId}/workers/${w.id}`)}
                      >
                        Ver expediente
                      </SiteCorpButton>
                      {canManage && (
                        <SiteCorpButton size="sm" onClick={() => setReentryWorkerId(w.id)}>
                          <UserPlus className="mr-2 h-4 w-4" /> Reingresar
                        </SiteCorpButton>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SiteCorpCard>

      {reentryWorkerId && entityId && (
        <ReincorporateWorkerDialog
          open={!!reentryWorkerId}
          onOpenChange={(open) => {
            if (!open) setReentryWorkerId(null)
          }}
          workerId={reentryWorkerId}
          entityId={entityId}
          onSuccess={async () => {
            setReentryWorkerId(null)
            await loadData()
          }}
        />
      )}
    </div>
  )
}

export default EntityReentries
