import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import ReincorporateWorkerDialog from "@/components/workers/ReincorporateWorkerDialog"
import { FilterBuilder } from "@/components/filters/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/lib/entity-filters"
import { filterReentryWorkers, isReentryWorker } from "@/lib/people-classification"
import { fetchClientEmploymentIndex } from "@/lib/people-employment"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { ArrowLeft, Search, Undo2, UserPlus } from "lucide-react"

/**
 * PERSONAS → REINGRESOS (§20–§26).
 *
 * Vista de los Workers dados de baja (estado laboral ≠ activo). NO es una copia ni
 * una tabla paralela: es el MISMO expediente Worker en estado inactivo. Desde aquí
 * puede reingresarse reutilizando el expediente existente (nunca se crea otro Worker).
 */

interface ReentryRow {
  id: string
  code: string
  first_name: string
  first_surname: string
  second_surname: string | null
  identification: string
  gender_id: string | null
  education_level_id: string | null
  employment_status: string
  hire_date: string
  employment_start_date: string | null
}

interface CatalogRow {
  id: string
  name: string
}

interface BajaInfo {
  effective_date: string
  reason: string | null
}

const fullName = (w: ReentryRow) =>
  [w.first_name, w.first_surname, w.second_surname].filter(Boolean).join(" ")

const EntityReentries = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()

  const [workers, setWorkers] = React.useState<ReentryRow[]>([])
  const [bajas, setBajas] = React.useState<Record<string, BajaInfo>>({})
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
      const { data: canView } = await supabase.rpc("can_access_entity", {
        target_entity_id: entityId,
        permission_code: "workers.view",
      })
      const { data: canManageWorkers } = await supabase.rpc("can_access_entity", {
        target_entity_id: entityId,
        permission_code: "workers.manage",
      })
      if (!canView && !canManageWorkers) {
        setError("No tiene permiso para ver los reingresos de esta entidad")
        return
      }
      setCanManage(!!canManageWorkers)

      // Criterio compartido de clasificación: antiguos trabajadores sin relación
      // laboral vigente (`@/lib/people-classification`). Al reincorporarlos vuelven
      // a Trabajadores y salen de aquí.
      const { data, error: workersError } = await filterReentryWorkers(
        supabase
          .from("workers")
          .select(
            `id, code, first_name, first_surname, second_surname, identification,
           gender_id, education_level_id,
           employment_status, hire_date, employment_start_date`
          )
          .eq("organization_entity_id", entityId)
      )
        .order("first_surname", { ascending: true })
        .order("first_name", { ascending: true })
      if (workersError) throw workersError

      const rows = (data as ReentryRow[]) || []

      // Clasificación compartida: si la persona mantiene OTRA relación laboral vigente
      // en el cliente (aunque sea en otra entidad), no es un reingreso.
      const employmentIndex = await fetchClientEmploymentIndex(
        currentEntity?.tenant_id,
        rows.map((row) => row.identification)
      )
      const reentryRows = rows.filter((row) => isReentryWorker(row, employmentIndex))
      setWorkers(reentryRows)

      const [genders, education] = await Promise.all([
        supabase.from("genders").select("id, name").order("name"),
        supabase.from("education_levels").select("id, name").order("name"),
      ])
      setCatalogs({
        gender: (genders.data as CatalogRow[]) || [],
        education: (education.data as CatalogRow[]) || [],
      })

      // Última baja registrada por trabajador (bitácora de movimientos).
      if (reentryRows.length > 0) {
        const { data: movData } = await supabase
          .from("worker_employment_movements")
          .select(
            `worker_id, effective_date, reason, movement_type,
             separation_reason:worker_separation_reasons(name)`
          )
          .in(
            "worker_id",
            reentryRows.map((w) => w.id)
          )
          .eq("movement_type", "BAJA")
          .order("effective_date", { ascending: false })

        const map: Record<string, BajaInfo> = {}
        ;((movData as {
          worker_id: string
          effective_date: string
          reason: string | null
          separation_reason: { name: string | null } | { name: string | null }[] | null
        }[]) || []).forEach((m) => {
          if (map[m.worker_id]) return
          const reason = Array.isArray(m.separation_reason)
            ? m.separation_reason[0]?.name
            : m.separation_reason?.name
          map[m.worker_id] = {
            effective_date: m.effective_date,
            reason: reason || m.reason || null,
          }
        })
        setBajas(map)
      } else {
        setBajas({})
      }
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
        getValue: (w: ReentryRow) => w.gender_id,
      },
      {
        key: "education",
        label: "Nivel educacional",
        type: "select",
        options: (catalogs.education || []).map((row) => ({ value: row.id, label: row.name })),
        getValue: (w: ReentryRow) => w.education_level_id,
      },
      {
        key: "bajaDate",
        label: "Fecha de baja",
        type: "daterange",
        getValue: (w: ReentryRow) => bajas[w.id]?.effective_date ?? null,
      },
      {
        key: "bajaReason",
        label: "Motivo de baja",
        type: "select",
        options: reasonOptions,
        getValue: (w: ReentryRow) => bajas[w.id]?.reason ?? null,
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
                        {fullName(w)}
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
