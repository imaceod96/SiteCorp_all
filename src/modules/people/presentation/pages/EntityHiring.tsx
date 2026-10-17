import * as React from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Network,
  Search,
  Settings,
  UserPlus,
  Users,
} from "lucide-react"
import { toRomanNumeral } from "@/utils/roman-numerals"
import {
  resolveApplicableScaleId,
  fetchSalaryValuesForGroups,
  salaryForGroup,
  formatSalary,
  type SalaryValue,
} from "@/modules/organization-structure"
import HireCandidateDialog from "@/modules/people/presentation/components/HireCandidateDialog"
import { FilterBuilder } from "@/shared/components/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/modules/organization-structure/presentation/hooks/use-entity-filters"
import {
  loadEntityStaffingBoard,
  type PositionOccupant,
  type StaffingPosition,
} from "@/modules/people"

const EntityHiring = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [positions, setPositions] = React.useState<StaffingPosition[]>([])
  const [occupancy, setOccupancy] = React.useState<Record<string, number>>({})
  const [occupants, setOccupants] = React.useState<Record<string, PositionOccupant[]>>({})
  const [applicableScaleId, setApplicableScaleId] = React.useState<string | null>(null)
  const [salaryValuesByGroup, setSalaryValuesByGroup] = React.useState<
    Record<string, SalaryValue | null>
  >({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [hiredWorkerId, setHiredWorkerId] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState("")
  const [expandedPositionId, setExpandedPositionId] = React.useState<string | null>(null)

  const [hirePositionId, setHirePositionId] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setError("Parámetros de URL no válidos")
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Caso de uso (lectura): puestos activos, ocupación vigente y permisos de la
      // entidad. Sin permiso de ver ni de gestionar no se lee plantilla alguna.
      const board = await loadEntityStaffingBoard(entityId)
      if (!board.authorized) {
        setError("No tiene permiso para ver la contratación de esta entidad")
        return
      }
      setCanManage(board.canManage)

      setPositions(board.positions)
      setOccupancy(board.occupancy.counts)
      setOccupants(board.occupancy.occupants)

      setApplicableScaleId(await resolveApplicableScaleId(entityId))
      const groupIds = board.positions
        .map((p) => p.job?.salary_group?.id)
        .filter((id): id is string => !!id)
      setSalaryValuesByGroup(await fetchSalaryValuesForGroups(groupIds))
    } catch (err) {
      console.error("Error loading hiring data:", err)
      setError(err instanceof Error ? err.message : "Error al cargar los puestos de la entidad")
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const vacanciesOf = React.useCallback(
    (position: StaffingPosition) =>
      Math.max(0, (position.authorized_quantity || 0) - (occupancy[position.id] || 0)),
    [occupancy]
  )

  const salaryForPosition = React.useCallback(
    (position: StaffingPosition | null): SalaryValue | null =>
      salaryForGroup(applicableScaleId, position?.job?.salary_group, salaryValuesByGroup),
    [applicableScaleId, salaryValuesByGroup]
  )

  const areas = React.useMemo(() => {
    const map = new Map<string, string>()
    positions.forEach((p) => {
      const area = p.job?.area
      if (area?.id) map.set(area.id, area.name)
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [positions])

  const jobOptions = React.useMemo(() => {
    const map = new Map<string, string>()
    positions.forEach((p) => {
      if (p.job?.id) map.set(p.job.id, p.job.name)
    })
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    )
  }, [positions])

  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(
    () => [
      {
        key: "area",
        label: "Área",
        type: "select",
        options: areas.map((a) => ({ value: a.id, label: a.name })),
        getValue: (p: StaffingPosition) => p.job?.area?.id,
      },
      {
        key: "job",
        label: "Cargo",
        type: "select",
        options: jobOptions,
        getValue: (p: StaffingPosition) => p.job?.id,
      },
      {
        key: "coverage",
        label: "Estado",
        type: "select",
        options: [
          { value: "with-vacancies", label: "Con vacantes" },
          { value: "covered", label: "Cubiertos" },
        ],
        getValue: (p: StaffingPosition) => (vacanciesOf(p) > 0 ? "with-vacancies" : "covered"),
      },
    ],
    [areas, jobOptions, vacanciesOf]
  )

  const filters = useEntityFilters(positions, filterDefinitions)

  const filteredPositions = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filters.result
    return filters.result.filter((p) => {
      const haystack = [p.name, p.code, p.job?.name, p.job?.area?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [filters.result, search])

  const kpis = React.useMemo(() => {
    let withVacancies = 0
    let totalVacancies = 0
    let covered = 0
    positions.forEach((p) => {
      const vacancies = vacanciesOf(p)
      if (vacancies > 0) {
        withVacancies += 1
        totalVacancies += vacancies
      } else {
        covered += 1
      }
    })
    return { withVacancies, totalVacancies, covered }
  }, [positions, vacanciesOf])

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Contratación"
          description="Cargando puestos con vacantes de la entidad..."
        />
        <SiteCorpLoading rows={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Contratación"
          description="Cubra las vacantes de la plantilla autorizada de la entidad."
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

  const kpiCards = [
    {
      label: "Puestos con vacantes",
      value: kpis.withVacancies,
      icon: Briefcase,
      accent: "text-sitecorp-secondary-orange",
    },
    {
      label: "Vacantes totales",
      value: kpis.totalVacancies,
      icon: Users,
      accent: "text-sitecorp-primary",
    },
    {
      label: "Puestos cubiertos",
      value: kpis.covered,
      icon: CheckCircle2,
      accent: "text-sitecorp-success",
    },
  ]

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Contratación"
        description="Cubra las vacantes de la plantilla autorizada de la entidad incorporando trabajadores."
      />

      {hiredWorkerId && (
        <SiteCorpAlert type="success">
          <span className="flex flex-wrap items-center gap-2">
            La contratación se registró correctamente y la ocupación del puesto fue actualizada.
            <Link
              to={`/entity/${entityId}/staffing/workers/${hiredWorkerId}`}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              Ver expediente del trabajador <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </span>
        </SiteCorpAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {kpiCards.map((kpi) => (
          <SiteCorpCard key={kpi.label}>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl bg-muted",
                  kpi.accent
                )}
              >
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink">{kpi.value}</p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </div>
            </div>
          </SiteCorpCard>
        ))}
      </div>

      {positions.length === 0 ? (
        <SiteCorpCard>
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
            <Network className="mb-4 h-12 w-12 text-muted-foreground" />
            <h4 className="mb-1 text-base font-semibold text-ink">No hay puestos configurados.</h4>
            <p className="mb-4 text-sm text-muted-foreground">
              Configure la estructura de plantilla de la entidad para poder contratar.
            </p>
            <SiteCorpButton onClick={() => navigate(`/entity/${entityId}/settings/staffing`)}>
              <Settings className="mr-2 h-4 w-4" /> Configurar plantilla
            </SiteCorpButton>
          </div>
        </SiteCorpCard>
      ) : (
        <SiteCorpCard>
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <SiteCorpInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por puesto, código, cargo o área..."
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
              resultCount={filteredPositions.length}
              totalCount={positions.length}
            />

            {filteredPositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12">
                <Briefcase className="mb-4 h-12 w-12 text-muted-foreground" />
                <h4 className="mb-1 text-base font-semibold text-ink">
                  {kpis.withVacancies === 0
                    ? "No hay puestos con vacantes."
                    : "Sin resultados"}
                </h4>
                <p className="text-center text-sm text-muted-foreground">
                  {kpis.withVacancies === 0
                    ? "Toda la plantilla autorizada está cubierta. Los nuevos puestos se solicitan desde Configuración de plantilla."
                    : "Ningún puesto coincide con la búsqueda o los filtros aplicados."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPositions.map((position) => {
                  const occupied = occupancy[position.id] || 0
                  const authorized = position.authorized_quantity || 0
                  const vacancies = vacanciesOf(position)
                  const positionOccupants = occupants[position.id] || []
                  const salary = salaryForPosition(position)
                  const expanded = expandedPositionId === position.id

                  let statusLabel: string
                  let statusVariant: "success" | "warning" | "neutral"
                  if (occupied === 0) {
                    statusLabel = "SIN OCUPAR"
                    statusVariant = "warning"
                  } else if (vacancies > 0) {
                    statusLabel = "CON VACANTES"
                    statusVariant = "success"
                  } else {
                    statusLabel = "CUBIERTO"
                    statusVariant = "neutral"
                  }

                  return (
                    <div
                      key={position.id}
                      className="rounded-xl border border-border bg-white p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-sm font-medium text-ink">{position.name}</span>
                            {position.code && (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {position.code}
                              </span>
                            )}
                            <SiteCorpStatusBadge status={statusVariant}>
                              {statusLabel}
                            </SiteCorpStatusBadge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>Área: {position.job?.area?.name || "—"}</span>
                            <span>Cargo: {position.job?.name || "—"}</span>
                            <span>
                              Grupo:{" "}
                              {position.job?.salary_group
                                ? toRomanNumeral(position.job.salary_group.sequence_number)
                                : "—"}
                            </span>
                            <span className="font-medium text-ink">
                              {salary ? formatSalary(salary) : "Salario no configurado"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="text-muted-foreground">
                              Ocupación: {occupied}/{authorized}
                            </span>
                            <span
                              className={cn(
                                "font-medium",
                                vacancies > 0 ? "text-sitecorp-primary" : "text-muted-foreground"
                              )}
                            >
                              {vacancies} vacante(s)
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {positionOccupants.length > 0 && (
                            <SiteCorpButton
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setExpandedPositionId(expanded ? null : position.id)
                              }
                            >
                              {expanded ? (
                                <ChevronUp className="mr-2 h-4 w-4" />
                              ) : (
                                <ChevronDown className="mr-2 h-4 w-4" />
                              )}
                              Ver ocupantes ({positionOccupants.length})
                            </SiteCorpButton>
                          )}
                          {canManage && vacancies > 0 && (
                            <SiteCorpButton
                              size="sm"
                              onClick={() => setHirePositionId(position.id)}
                            >
                              <UserPlus className="mr-2 h-4 w-4" /> Cubrir puesto
                            </SiteCorpButton>
                          )}
                        </div>
                      </div>

                      {expanded && positionOccupants.length > 0 && (
                        <div className="mt-3 space-y-1 border-t border-border pt-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            Trabajadores que ocupan el puesto:
                          </p>
                          {positionOccupants.map((o) => (
                            <div
                              key={o.workerId}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1"
                            >
                              <Link
                                to={`/entity/${entityId}/staffing/workers/${o.workerId}`}
                                className="text-sm text-sitecorp-primary underline-offset-2 hover:underline"
                              >
                                {o.name}
                              </Link>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                {o.code}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {kpis.withVacancies > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5" />
                «Cubrir puesto» contrata a un candidato de esta entidad: se crea (o reactiva) su
                expediente laboral, su asignación de puesto y su contrato.
              </p>
            )}
          </div>
        </SiteCorpCard>
      )}

      <HireCandidateDialog
        open={!!hirePositionId}
        onOpenChange={(open) => {
          if (!open) setHirePositionId(null)
        }}
        entityId={entityId as string}
        presetPositionId={hirePositionId}
        onSuccess={async (workerId) => {
          setHiredWorkerId(workerId)
          await loadData()
        }}
      />
    </div>
  )
}

export default EntityHiring
