/**
 * FASE 19 — Licencias / Certificados Médicos a nivel de ENTIDAD.
 *
 * Gestión global de los certificados médicos de los trabajadores de la entidad.
 * Es la misma infraestructura que la pestaña del trabajador (worker_medical_certificates
 * + RPC SECURITY DEFINER): dos vistas sobre un único dominio.
 *
 *   · Lectura: list_entity_medical_certificates(p_entity_id, p_year) — valida
 *     can_access_entity('medical_certificates.view'|'manage') en el backend.
 *   · "Global" = los certificados de los trabajadores de la entidad actualmente
 *     seleccionada, según los permisos/scopes existentes (NO toda la plataforma).
 */

import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { useEntityPermissions } from "@/modules/access-control/presentation/hooks/use-entity-permissions"
import {
  useEntityMedicalCertificates,
} from "../hooks/use-medical-certificates"
import { getCertificateSignedUrl, type EntityMedicalCertificateRow } from "@/modules/vacations-licenses/medical-certificates"
import MedicalCertificateFormDialog from "../components/MedicalCertificateFormDialog"
import { FilterBuilder } from "@/shared/components/filter-builder"
import { useEntityFilters, type EntityFilterDefinition } from "@/modules/organization-structure/presentation/hooks/use-entity-filters"
import { useToast } from "@/shared/hooks/use-toast"
import { useSc404Generation } from "@/modules/access-control/presentation/hooks/use-sc404"
import {
  CalendarDays,
  FileText,
  HeartPulse,
  RefreshCw,
  Search,
  Upload,
  Users,
} from "lucide-react"

const YEAR_WINDOW = 4

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—"
  const [y, m, d] = value.split("-")
  return `${d}/${m}/${y}`
}

const EntityMedicalCertificates = () => {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { has, loading: permissionsLoading } = useEntityPermissions(entityId)

  const canView = has(["medical_certificates.view", "medical_certificates.manage"])
  const canManage = has(["medical_certificates.manage"])

  const [selectedYear, setSelectedYear] = React.useState<number>(new Date().getFullYear())
  const [search, setSearch] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const { generate: generateSc404, generatingId: generatingSc404Id } = useSc404Generation()

  const query = useEntityMedicalCertificates(
    entityId,
    selectedYear,
    !permissionsLoading && canView
  )

  const rows = React.useMemo(() => query.data?.certificates ?? [], [query.data])
  const loading = permissionsLoading || (canView && query.isLoading)

  const filterDefinitions = React.useMemo<EntityFilterDefinition[]>(
    () => [
      {
        key: "area",
        label: "Área",
        type: "select",
        options: Array.from(new Set(rows.map((r) => r.area_name).filter((v): v is string => !!v)))
          .sort()
          .map((value) => ({ value, label: value })),
        getValue: (r: EntityMedicalCertificateRow) => r.area_name,
      },
      { key: "worker", label: "Trabajador", type: "text", placeholder: "Nombre o CI", getValue: (r: EntityMedicalCertificateRow) => `${r.worker_full_name} ${r.worker_identification}` },
      { key: "startDate", label: "Fecha de salida", type: "daterange", getValue: (r: EntityMedicalCertificateRow) => r.start_date },
      { key: "returnDate", label: "Reincorporación", type: "daterange", getValue: (r: EntityMedicalCertificateRow) => r.return_date },
      { key: "hasDocument", label: "Con documento", type: "boolean", getValue: (r: EntityMedicalCertificateRow) => !!r.document?.storage_path },
      {
        key: "days",
        label: "Cantidad de días",
        type: "select",
        options: Array.from(new Set(rows.map((r) => r.days).filter((v) => v !== null && v !== undefined)))
          .sort((a, b) => (a as number) - (b as number))
          .map((value) => ({ value: String(value), label: `${value} día(s)` })),
        getValue: (r: EntityMedicalCertificateRow) => (r.days === null || r.days === undefined ? null : String(r.days)),
      },
    ],
    [rows]
  )

  const filters = useEntityFilters(rows, filterDefinitions)

  const visibleRows = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filters.result
    return filters.result.filter(
      (row) =>
        row.worker_full_name.toLowerCase().includes(term) ||
        row.worker_identification.toLowerCase().includes(term)
    )
  }, [filters.result, search])

  const error = !permissionsLoading && !canView
    ? "No tiene permiso para ver los certificados médicos de esta entidad"
    : !entityId
      ? "Parámetros inválidos"
      : query.isError
        ? (query.error as Error)?.message || "No se pudieron cargar los certificados médicos."
        : null

  const yearOptions = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: YEAR_WINDOW }, (_, i) => current - i)
  }, [])

  const handleViewDocument = async (
    storagePath: string,
    fileName: string | null,
    mimeType: string | null
  ) => {
    const signedUrl = await getCertificateSignedUrl(storagePath)
    if (!signedUrl) {
      toast({
        title: "Error",
        description: "No se pudo generar el enlace de acceso al documento.",
      })
      return
    }

    if (mimeType?.startsWith("image/")) {
      window.open(signedUrl, "_blank", "noopener,noreferrer")
    } else {
      const link = document.createElement("a")
      link.href = signedUrl
      link.download = fileName || "certificado"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const kpiCards = [
    {
      key: "count",
      label: "Certificados",
      value: String(query.data?.count ?? 0),
      icon: <FileText className="h-4 w-4" />,
      tone: "border-sitecorp-primary/40 bg-sitecorp-primary/5 text-sitecorp-primary",
    },
    {
      key: "days",
      label: "Días por certificado",
      value: `${query.data?.total_days ?? 0} d`,
      icon: <CalendarDays className="h-4 w-4" />,
      tone: "border-border bg-muted/40 text-ink",
    },
    {
      key: "workers",
      label: "Trabajadores con certificado",
      value: String(query.data?.worker_count ?? 0),
      icon: <Users className="h-4 w-4" />,
      tone: "border-border bg-muted/40 text-ink",
    },
  ]

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Licencias / Certificados Médicos"
        description="Gestión de los certificados médicos de los trabajadores de la entidad. Cada certificado es un evento del historial del trabajador; no existen saldos ni acumulaciones."
        actions={
          <div className="flex gap-2">
            <SiteCorpButton
              variant="outline"
              type="button"
              onClick={() => query.refetch()}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
            </SiteCorpButton>
            {canManage && (
              <SiteCorpButton type="button" onClick={() => setDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Registrar certificado
              </SiteCorpButton>
            )}
          </div>
        }
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
          {query.isError && (
            <div className="mt-3">
              <SiteCorpButton variant="outline" onClick={() => query.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
              </SiteCorpButton>
            </div>
          )}
        </SiteCorpAlert>
      )}

      {loading ? (
        <SiteCorpCard>
          <SiteCorpLoading rows={6} />
        </SiteCorpCard>
      ) : error ? null : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {kpiCards.map((kpi) => (
              <div key={kpi.key} className={`rounded-2xl border p-4 ${kpi.tone}`}>
                <div className="flex items-center gap-2 opacity-80">
                  {kpi.icon}
                  <span className="text-xs">{kpi.label}</span>
                </div>
                <p className="mt-1 text-2xl font-bold">{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <SiteCorpCard>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Año</label>
                  <SiteCorpSelect
                    value={String(selectedYear)}
                    onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
                  >
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </SiteCorpSelect>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Buscar trabajador</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <SiteCorpInput
                      className="pl-9"
                      placeholder="Nombre o carné de identidad"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
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
                resultCount={visibleRows.length}
                totalCount={rows.length}
              />
            </div>
          </SiteCorpCard>

          {/* Listado */}
          <SiteCorpCard>
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <HeartPulse className="h-5 w-5 text-sitecorp-primary" />
                <h3 className="text-base font-semibold text-ink">
                  Certificados de {selectedYear}
                </h3>
              </div>

              {visibleRows.length === 0 ? (
                <SiteCorpAlert type="info">
                  No hay certificados médicos registrados para este período.
                </SiteCorpAlert>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-3 font-medium">Trabajador</th>
                        <th className="pb-3 font-medium">CI</th>
                        <th className="pb-3 font-medium">Área</th>
                        <th className="pb-3 font-medium">Salida</th>
                        <th className="pb-3 font-medium">Reincorporación</th>
                        <th className="pb-3 font-medium">Días</th>
                        <th className="pb-3 font-medium">Documento</th>
                        {canManage && <th className="pb-3 font-medium">SC-4-04</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.id} className="border-b border-border/50">
                          <td className="py-3">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/entity/${entityId}/staffing/workers/${row.worker_id}`
                                )
                              }
                              className="font-medium text-sitecorp-primary hover:underline"
                            >
                              {row.worker_full_name}
                            </button>
                          </td>
                          <td className="py-3 text-ink">{row.worker_identification}</td>
                          <td className="py-3 text-ink">{row.area_name || "—"}</td>
                          <td className="py-3 text-ink">{formatDate(row.start_date)}</td>
                          <td className="py-3 text-ink">{formatDate(row.return_date)}</td>
                          <td className="py-3 font-semibold text-ink">{row.days}</td>
                          <td className="py-3">
                            {row.document?.storage_path ? (
                              <SiteCorpButton
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleViewDocument(
                                    row.document!.storage_path!,
                                    row.document!.file_name,
                                    row.document!.mime_type
                                  )
                                }
                              >
                                <FileText className="mr-1 h-3 w-3" />
                                {row.document.file_name || "Ver"}
                              </SiteCorpButton>
                            ) : (
                              <span className="text-muted-foreground">Sin documento</span>
                            )}
                          </td>
                          {canManage && (
                            <td className="py-3">
                              <SiteCorpButton
                                variant="outline"
                                size="sm"
                                onClick={() => generateSc404("MEDICAL_CERTIFICATE", row.id)}
                                disabled={generatingSc404Id === row.id || !!generatingSc404Id}
                              >
                                <FileText className="mr-1 h-3 w-3" />
                                {generatingSc404Id === row.id ? "Generando…" : "Generar"}
                              </SiteCorpButton>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </SiteCorpCard>
        </>
      )}

      {/* Diálogo compartido: contexto global → selector de trabajador */}
      <MedicalCertificateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityId={entityId as string}
        workerId={null}
        onSuccess={() => query.refetch()}
      />
    </div>
  )
}

export default EntityMedicalCertificates
