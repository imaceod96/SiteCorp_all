import * as React from "react"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Label } from "@/components/ui/label"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { RepresentativeSelect } from "@/modules/representatives/presentation/components/RepresentativeSelect"
import { fetchEntityContractData, saveEntityContractData } from "@/modules/representatives"
import type { RepresentativePositionRow } from "@/modules/representatives"
import { MISSING_RESOLUTION_TEMPLATE_MESSAGE } from "@/modules/resolutions/domain/rules"
import type {
  ResolutionContext,
  ResolutionTemplateAvailability,
} from "@/modules/resolutions/domain/entities"
// Las consultas de resolución sólo existen en la infraestructura del módulo (no hay capa de
// aplicación): se consumen por su interfaz pública para no invertir presentación → dominio →
// infraestructura.
import {
  fetchResolutionContext,
  fetchResolutionRequiredVariables,
  resolveResolutionTemplateAvailability,
} from "@/modules/resolutions"

/**
 * Formulario de Resolución (Cargo Especialista Principal) — COMPONENTE ÚNICO
 * reutilizado por la contratación de candidato y por el movimiento formal de un
 * trabajador existente (§12).
 *
 * Principio (§13): NO vuelve a pedir lo que SiteCorp ya conoce. Resuelve, muestra
 * y sólo solicita lo que falta o debe seleccionarse (fecha, representante y, si
 * la plantilla lo exige, funciones/municipio/año de la Revolución).
 */

export interface ResolutionFormValues {
  resolutionDate: string
  representativeAssignmentId: string | null
  workContent: string | null
  workContentChanged: boolean
  municipality: string | null
  municipalityChanged: boolean
  revolutionYear: string | null
  revolutionYearChanged: boolean
  templateVersionId: string | null
  valid: boolean
  error: string | null
}

interface ResolutionFormProps {
  entityId: string
  positionId: string
  workerId?: string | null
  personName?: string | null
  initialResolutionDate?: string
  canManageContractData?: boolean
  onValuesChange: (values: ResolutionFormValues) => void
}

const currencyLabel = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${amount.toFixed(2).replace(".", ",")} ${currency || "CUP"}`

const ResolutionForm: React.FC<ResolutionFormProps> = ({
  entityId,
  positionId,
  workerId = null,
  personName = null,
  initialResolutionDate = "",
  canManageContractData = false,
  onValuesChange,
}) => {
  const [context, setContext] = React.useState<ResolutionContext | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [template, setTemplate] = React.useState<ResolutionTemplateAvailability | null>(null)
  const [required, setRequired] = React.useState<string[]>([])
  const [representatives, setRepresentatives] = React.useState<RepresentativePositionRow[]>([])

  const [resolutionDate, setResolutionDate] = React.useState(initialResolutionDate)
  const [representativeAssignmentId, setRepresentativeAssignmentId] = React.useState<string | null>(
    null
  )
  const [workContent, setWorkContent] = React.useState("")
  const [municipality, setMunicipality] = React.useState("")
  const [revolutionYear, setRevolutionYear] = React.useState("")

  // Datos automáticos (no se vuelven a pedir): nombre, cargo, entidad, empresa,
  // salario, grupo escala, funciones, municipio y año de la Revolución.
  React.useEffect(() => {
    if (!entityId || !positionId) return
    let active = true
    setLoading(true)
    fetchResolutionContext({ workerId, positionId, resolutionDate: resolutionDate || null })
      .then((ctx) => {
        if (!active) return
        setContext(ctx)
        setWorkContent(ctx.job.work_content || "")
        setMunicipality(ctx.entity.municipality || "")
        setRevolutionYear(ctx.entity.revolution_year || "")
        const only = ctx.representatives.filter((r) => r.assignment_id && r.person_name)
        if (only.length === 1) setRepresentativeAssignmentId(only[0].assignment_id)
      })
      .catch(() => {
        if (active) setContext(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // El contexto se recalcula al cambiar de puesto/entidad, no al cambiar la fecha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, positionId, workerId])

  React.useEffect(() => {
    if (!entityId) return
    let active = true
    resolveResolutionTemplateAvailability(entityId, resolutionDate || null)
      .then(async (availability) => {
        if (!active) return
        setTemplate(availability)
        if (availability.status === "RESOLVED" && availability.versionId) {
          const vars = await fetchResolutionRequiredVariables(availability.versionId)
          if (active) setRequired(vars)
        } else {
          setRequired([])
        }
      })
      .catch(() => {
        if (active) {
          setTemplate(null)
          setRequired([])
        }
      })
    return () => {
      active = false
    }
  }, [entityId, resolutionDate])

  const templateResolved = template?.status === "RESOLVED" && !!template.versionId
  const templateBlocked =
    !!template &&
    (template.status === "NONE" || template.status === "AMBIGUOUS" || template.status === "UNKNOWN")

  const needs = React.useCallback((key: string) => required.includes(key), [required])
  const jobName = context?.job.name ?? null
  const salary = context?.job.salary_amount ?? null
  const salaryCurrency = context?.job.currency_code ?? null
  const groupSequence = context?.job.salary_group_sequence ?? null
  const parentCompany = context?.parent_company.name ?? null
  const entityName = context?.entity.name ?? null
  const hasReps = representatives.some((r) => r.assignment_id && r.person_name)

  const workContentChanged =
    !!context && (workContent.trim() || "") !== (context.job.work_content || "").trim()
  const municipalityChanged =
    !!context && (municipality.trim() || "") !== (context.entity.municipality || "").trim()
  const revolutionYearChanged =
    !!context && (revolutionYear.trim() || "") !== (context.entity.revolution_year || "").trim()

  const error = React.useMemo<string | null>(() => {
    if (!templateResolved) return null
    if (!resolutionDate) return "La fecha de Resolución es obligatoria."
    if (!representativeAssignmentId) {
      return hasReps
        ? "Seleccione el representante que suscribe la Resolución."
        : "No hay representantes configurados en la información contractual de la entidad."
    }
    if (salary == null) return "No se pudo resolver el salario del Cargo destino."
    if (groupSequence == null) return "No se pudo resolver el Grupo Escala del Cargo destino."
    if (needs("r.fun") && !workContent.trim())
      return "El Cargo no tiene configuradas las funciones/contenido de trabajo."
    if (needs("r.mun") && !municipality.trim())
      return "La entidad no tiene configurado el municipio contractual."
    if (needs("r.rev") && !revolutionYear.trim())
      return "La entidad no tiene configurado el Año de la Revolución."
    if (needs("r.emp") && !parentCompany)
      return "No se ha configurado la Empresa a la que pertenece esta UEB."
    if (needs("r.rep") && !representativeAssignmentId) return "Seleccione el representante."
    return null
  }, [
    templateResolved,
    resolutionDate,
    representativeAssignmentId,
    hasReps,
    salary,
    groupSequence,
    needs,
    workContent,
    municipality,
    revolutionYear,
    parentCompany,
  ])

  const valid = templateResolved && !error

  const parentCompanyMissing = context?.entity.entity_type === "ueb" && !parentCompany

  React.useEffect(() => {
    onValuesChange({
      resolutionDate,
      representativeAssignmentId,
      workContent: workContent.trim() || null,
      workContentChanged,
      municipality: municipality.trim() || null,
      municipalityChanged,
      revolutionYear: revolutionYear.trim() || null,
      revolutionYearChanged,
      templateVersionId: template?.versionId ?? null,
      valid,
      error,
    })
  }, [
    onValuesChange,
    resolutionDate,
    representativeAssignmentId,
    workContent,
    workContentChanged,
    municipality,
    municipalityChanged,
    revolutionYear,
    revolutionYearChanged,
    template,
    valid,
    error,
  ])

  const persistEntityField = async (
    field: "municipality" | "revolution_year",
    value: string
  ) => {
    if (!context || !canManageContractData) return
    try {
      // Se conserva el resto de los datos contractuales: nunca se sobrescriben con vacío.
      const current = await fetchEntityContractData(context.entity.id)
      await saveEntityContractData(context.entity.id, {
        organism: current?.organism ?? null,
        branch: current?.branch ?? null,
        labor_identification_code: current?.labor_identification_code ?? null,
        address: current?.address ?? null,
        province: current?.province ?? null,
        municipality: field === "municipality" ? value.trim() || null : current?.municipality ?? null,
        revolution_year:
          field === "revolution_year" ? value.trim() || null : current?.revolution_year ?? null,
      })
    } catch {
      /* La persistencia es best-effort: el dato se conserva igualmente en el formulario. */
    }
  }

  if (loading && !context) {
    return <p className="text-sm text-muted-foreground">Resolviendo la información de la Resolución…</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resolución — Especialista Principal
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Trabajador</dt>
            <dd className="text-sm font-medium text-ink">
              {context?.worker?.full_name || personName || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cargo destino</dt>
            <dd className="text-sm font-medium text-ink">{jobName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Entidad</dt>
            <dd className="text-sm font-medium text-ink">{entityName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Empresa (UEB)</dt>
            <dd className="text-sm font-medium text-ink">{parentCompany || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Grupo Escala</dt>
            <dd className="text-sm font-medium text-ink">
              {groupSequence == null ? "—" : toRomanNumeral(groupSequence)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Salario</dt>
            <dd className="text-sm font-medium text-ink">{currencyLabel(salary, salaryCurrency)}</dd>
          </div>
        </dl>
      </div>

      {!templateResolved && !templateBlocked && (
        <p className="text-xs text-muted-foreground">Comprobando la plantilla de Resolución…</p>
      )}

      {templateBlocked && (
        <SiteCorpAlert type="warning" title="Plantilla de Resolución requerida">
          <span className="whitespace-pre-line">{MISSING_RESOLUTION_TEMPLATE_MESSAGE}</span>
        </SiteCorpAlert>
      )}

      {templateResolved && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fecha de Resolución *</Label>
              <SiteCorpInput
                type="date"
                value={resolutionDate}
                onChange={(e) => setResolutionDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Plantilla de Resolución</Label>
              <SiteCorpInput
                value={template?.templateName || "Plantilla activa"}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>

          <RepresentativeSelect
            entityId={entityId}
            onDate={resolutionDate}
            value={representativeAssignmentId}
            onChange={setRepresentativeAssignmentId}
            canManage={canManageContractData}
            label="Representante que suscribe la Resolución *"
            dateHint={`Representante vigente en la fecha de Resolución.${
              resolutionDate ? ` (${resolutionDate})` : ""
            }`}
            onOptionsChange={setRepresentatives}
          />

          {needs("r.fun") && (
            <div className="space-y-2">
              <Label>Funciones / contenido de trabajo *</Label>
              <textarea
                value={workContent}
                onChange={(e) => setWorkContent(e.target.value)}
                rows={4}
                disabled={!context?.can_edit_job}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary disabled:bg-muted"
                placeholder="Funciones / contenido de trabajo del Cargo"
              />
              <p className="text-xs text-muted-foreground">
                Las funciones pertenecen al Cargo: si las completa, se guardan en el Cargo (fuente de
                verdad).
                {!context?.can_edit_job && " No tiene permiso para editar el Cargo."}
              </p>
            </div>
          )}

          {needs("r.mun") && (
            <div className="space-y-2">
              <Label>Municipio donde se firma *</Label>
              <SiteCorpInput
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                onBlur={() => persistEntityField("municipality", municipality)}
                disabled={!canManageContractData}
                placeholder="Municipio contractual de la entidad"
              />
            </div>
          )}

          {needs("r.rev") && (
            <div className="space-y-2">
              <Label>Año de la Revolución *</Label>
              <SiteCorpInput
                value={revolutionYear}
                onChange={(e) => setRevolutionYear(e.target.value)}
                onBlur={() => persistEntityField("revolution_year", revolutionYear)}
                disabled={!canManageContractData}
                placeholder="Texto configurado (p. ej. 68)"
              />
            </div>
          )}

          {parentCompanyMissing && (
            <SiteCorpAlert type="warning">
              No se ha configurado la Empresa a la que pertenece esta UEB. Complete la jerarquía
              organizativa de la entidad.
            </SiteCorpAlert>
          )}

          {error && <SiteCorpAlert type="warning">{error}</SiteCorpAlert>}
        </>
      )}
    </div>
  )
}

export default ResolutionForm
