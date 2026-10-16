import * as React from "react"
import { useNavigate } from "react-router-dom"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { SiteCorpCheckbox } from "@/components/ui/sitecorp-checkbox"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  NO_OCCUPATIONAL_CATEGORY_LABEL,
  jobSaveErrorMessage,
  loadCurrentSalaryValueForGroup,
  loadJobFormWorkspace,
  parseJobCla,
  saveJob,
  validateJobInput,
  type JobClaDraft,
  type JobFormScaleInfo,
  type OccupationalCategory,
  type OrganizationArea,
  type OrganizationJob,
  type PreparationLevel,
  type SalaryGroupWithCurrent,
  type SalaryValue,
} from "@/domains/organization-structure"

/**
 * Cargo de la entidad: alta y edición.
 *
 * El formulario no compone consultas ni habla con Supabase. Los casos de uso del dominio le
 * entregan el catálogo global de categorías ocupacionales y de niveles de preparación, las
 * áreas activas de la entidad y los grupos de la ESCALA APLICABLE a la entidad con su
 * importe vigente; las reglas puras del dominio validan y él sólo conserva los campos.
 *
 * El salario NUNCA se escribe desde el cargo: se deriva del grupo salarial y de la escala.
 * La CLA (Condiciones Laborales Anormales) es un concepto del CARGO, independiente de la
 * Nocturnidad, con dos tramos nocturnos propios.
 */
interface JobFormProps {
  entityId: string
  editingJob?: OrganizationJob | null
  onSuccess: () => void
  onCancel: () => void
}

export const JobForm: React.FC<JobFormProps> = ({
  entityId,
  editingJob,
  onSuccess,
  onCancel,
}) => {
  const [areas, setAreas] = React.useState<OrganizationArea[]>([])
  const [groups, setGroups] = React.useState<SalaryGroupWithCurrent[]>([])
  const [categories, setCategories] = React.useState<OccupationalCategory[]>([])
  const [preparationLevels, setPreparationLevels] = React.useState<PreparationLevel[]>([])
  const [selectedPreparationLevels, setSelectedPreparationLevels] = React.useState<string[]>([])
  const [isCuadro, setIsCuadro] = React.useState(false)
  const [isPrincipalSpecialist, setIsPrincipalSpecialist] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = React.useState<string>("")
  const [selectedCategory, setSelectedCategory] = React.useState<string>("")
  const [salaryVigente, setSalaryVigente] = React.useState<SalaryValue | null>(null)
    const [scaleInfo, setScaleInfo] = React.useState<JobFormScaleInfo | null>(null)
    // CLA — Condiciones Laborales Anormales (configuración del CARGO).
    // Reutiliza la opción existente "Condiciones anormales"; NO es Nocturnidad.
    const [hasAbnormalConditions, setHasAbnormalConditions] = React.useState(false)
    const [claDayEnabled, setClaDayEnabled] = React.useState(false)
    const [claDayRate, setClaDayRate] = React.useState("")
    const [claNightEnabled, setClaNightEnabled] = React.useState(false)
    const [claNight1Start, setClaNight1Start] = React.useState("")
    const [claNight1End, setClaNight1End] = React.useState("")
    const [claNight1Rate, setClaNight1Rate] = React.useState("")
    const [claNight2Start, setClaNight2Start] = React.useState("")
    const [claNight2End, setClaNight2End] = React.useState("")
    const [claNight2Rate, setClaNight2Rate] = React.useState("")

  const navigate = useNavigate()

  const editingJobId = editingJob?.id || null
  const editingSalaryGroupId = editingJob?.salary_group_id || null

  const loadData = React.useCallback(async () => {
    if (!entityId) return

    setLoading(true)
    setError(null)

    try {
      // Caso de uso: áreas activas, catálogos globales, escala aplicable con sus grupos y,
      // al editar, los tramos de CLA, los niveles de preparación y el salario vigente.
      const workspace = await loadJobFormWorkspace(entityId, {
        jobId: editingJobId,
        salaryGroupId: editingSalaryGroupId,
      })

      setAreas(workspace.areas)
      setCategories(workspace.categories)
      setPreparationLevels(workspace.preparationLevels)
      setScaleInfo(workspace.scaleInfo)
      setGroups(workspace.groups)
      setSalaryVigente(workspace.currentSalaryValue)
      setSelectedPreparationLevels(workspace.preparationLevelIds)

      // Tramos nocturnos CLA ya configurados para este Cargo (tabla hija).
      const segment1 = workspace.claNightSegments.find((s) => s.segment_order === 1)
      const segment2 = workspace.claNightSegments.find((s) => s.segment_order === 2)
      if (segment1) {
        setClaNight1Start(segment1.start_time)
        setClaNight1End(segment1.end_time)
        setClaNight1Rate(String(segment1.hourly_rate))
      }
      if (segment2) {
        setClaNight2Start(segment2.start_time)
        setClaNight2End(segment2.end_time)
        setClaNight2Rate(String(segment2.hourly_rate))
      }
    } catch (err) {
      console.error("Error loading data:", err)
      setError(
        err instanceof Error ? err.message : "No se pudieron cargar los grupos salariales."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId, editingJobId, editingSalaryGroupId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    if (!editingJob) {
      // Cargo nuevo: clasificación y retribución parten vacías
      setSelectedGroup("")
      setSelectedCategory("")
      setIsCuadro(false)
      setIsPrincipalSpecialist(false)
      setHasAbnormalConditions(false)
      setClaDayEnabled(false)
      setClaDayRate("")
      setClaNightEnabled(false)
      setClaNight1Start("")
      setClaNight1End("")
      setClaNight1Rate("")
      setClaNight2Start("")
      setClaNight2End("")
      setClaNight2Rate("")
      return
    }

    setSelectedGroup(editingJob.salary_group_id)
        setSelectedCategory(editingJob.occupational_category_id || "")
        setIsCuadro(!!editingJob.is_cuadro)
        setIsPrincipalSpecialist(!!editingJob.is_principal_specialist)
        setHasAbnormalConditions(editingJob.has_abnormal_conditions || false)
        setClaDayEnabled(!!editingJob.cla_day_enabled)
        setClaDayRate(
          editingJob.cla_day_hourly_rate != null ? String(editingJob.cla_day_hourly_rate) : ""
        )
        setClaNightEnabled(!!editingJob.cla_night_enabled)
  }, [editingJob])

  const buildClaDraft = (): JobClaDraft => ({
    hasAbnormalConditions,
    dayEnabled: claDayEnabled,
    dayRate: claDayRate,
    nightEnabled: claNightEnabled,
    night1: { start: claNight1Start, end: claNight1End, rate: claNight1Rate },
    night2: { start: claNight2Start, end: claNight2End, rate: claNight2Rate },
  })

  const handleGroupChange = async (groupId: string) => {
    setSelectedGroup(groupId)
    setSalaryVigente(null)

    if (!groupId) return

    const value = await loadCurrentSalaryValueForGroup(groupId)
    if (value) setSalaryVigente(value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!entityId) return
  
      setFormError(null)
  
      const form = e.target as HTMLFormElement
      const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim()
      const area_id = (form.elements.namedItem("area_id") as HTMLSelectElement).value
      const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value.trim() || null
      const required_profession_or_trade =
        ((form.elements.namedItem("required_profession_or_trade") as HTMLInputElement)?.value || "").trim() || null
      const work_content =
        ((form.elements.namedItem("work_content") as HTMLTextAreaElement)?.value || "").trim() || null
      const hierarchy_order = parseInt(
        (form.elements.namedItem("hierarchy_order") as HTMLInputElement).value,
        10
      )

    const claDraft = buildClaDraft()

    // Reglas puras del dominio: nombre, área, categoría ocupacional, grupo salarial, CLA y
    // pertenencia del área a esta entidad.
    const validationError = validateJobInput({
      name,
      areaId: area_id,
      categoryId: selectedCategory,
      salaryGroupId: selectedGroup,
      areas,
      entityId,
      cla: claDraft,
    })
    if (validationError) {
      setFormError(validationError)
      return
    }

    setSubmitting(true)

    try {
      await saveJob({
        entityId,
        jobId: editingJobId,
        name,
        areaId: area_id,
        description,
        salaryGroupId: selectedGroup,
        hierarchyOrder: isNaN(hierarchy_order) ? 0 : hierarchy_order,
        occupationalCategoryId: selectedCategory || null,
        requiredProfessionOrTrade: required_profession_or_trade,
        workContent: work_content,
        isCuadro,
        isPrincipalSpecialist,
        preparationLevelIds: selectedPreparationLevels,
        cla: parseJobCla(claDraft),
      })
      onSuccess()
    } catch (err) {
      console.error("Error saving job:", err)
      setFormError(jobSaveErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="p-4 text-center text-sm text-muted-foreground">Cargando...</div>
  }

  if (error) {
    return (
      <SiteCorpAlert type="danger">
        <p className="font-medium">Error</p>
        <p>{error}</p>
      </SiteCorpAlert>
    )
  }

  const missingCategory = !!editingJob && !editingJob.occupational_category_id

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {formError && <SiteCorpAlert type="danger">{formError}</SiteCorpAlert>}

      {/* INFORMACIÓN GENERAL */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Información general
        </p>

        <div className="space-y-2">
          <Label htmlFor="job-name">Nombre *</Label>
          <SiteCorpInput
            id="job-name"
            name="name"
            defaultValue={editingJob?.name || ""}
            placeholder="Ej.: Especialista de Recursos Humanos"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="job-code">Código</Label>
            {editingJob ? (
              <SiteCorpInput
                id="job-code"
                name="code"
                value={editingJob.code || ""}
                readOnly
                className="bg-muted/50"
              />
            ) : (
              <SiteCorpInput
                id="job-code"
                name="code"
                value=""
                readOnly
                placeholder="Se generará automáticamente"
                className="bg-muted/50"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {editingJob
                ? "Código generado automáticamente a partir del área y el nombre. Es de solo lectura."
                : "El código se genera automáticamente al guardar, combinando el código del área y el nombre del cargo."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-order">Orden</Label>
            <SiteCorpInput
              id="job-order"
              name="hierarchy_order"
              type="number"
              defaultValue={editingJob?.hierarchy_order || 0}
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="job-area">Área *</Label>
          <SiteCorpSelect
            name="area_id"
            defaultValue={editingJob?.area_id || ""}
            required
          >
            <option value="">Seleccionar área</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name} ({area.code})
              </option>
            ))}
          </SiteCorpSelect>
          <p className="text-xs text-muted-foreground">
            Solo áreas activas de esta entidad.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="job-description">Descripción</Label>
          <Textarea
            id="job-description"
            name="description"
            defaultValue={editingJob?.description || ""}
            placeholder="Descripción opcional del cargo"
            rows={2}
          />
        </div>
      </div>

      {/* CLASIFICACIÓN LABORAL */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Clasificación laboral
        </p>

        {missingCategory && (
          <SiteCorpAlert type="warning">
            {NO_OCCUPATIONAL_CATEGORY_LABEL}. Complete la clasificación laboral del cargo; no se ha
            asignado ninguna categoría automáticamente.
          </SiteCorpAlert>
        )}

        <div className="space-y-2">
          <Label htmlFor="job-occupational-category">Categoría ocupacional *</Label>
          <SiteCorpSelect
            value={selectedCategory}
            onValueChange={setSelectedCategory}
          >
            <option value="">
              {missingCategory ? "Sin categoría ocupacional configurada" : "Seleccionar categoría"}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SiteCorpSelect>
          <p className="text-xs text-muted-foreground">
            Catálogo global de SiteCorp (Operario, Administrativo, Servicios, Técnico).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="job-preparation-levels">Nivel de Preparación</Label>
          <div className="flex flex-wrap gap-2">
            {preparationLevels.map((level) => {
              const checked = selectedPreparationLevels.includes(level.id)
              return (
                <label
                  key={level.id}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                    checked
                      ? "border-sitecorp-primary bg-sitecorp-primary/10 text-sitecorp-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-sitecorp-primary focus:ring-sitecorp-primary"
                    checked={checked}
                    onChange={(e) => {
                      const id = level.id
                      setSelectedPreparationLevels(
                        e.target.checked
                          ? [...selectedPreparationLevels, id]
                          : selectedPreparationLevels.filter((l) => l !== id)
                      )
                    }}
                  />
                  <span>{level.name}</span>
                  <span className="text-xs opacity-70">({level.code})</span>
                </label>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Puede seleccionar una o varias opciones. Describe la preparación que admite/requiere el cargo.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="job-required-profession">Profesión u oficio requerido</Label>
          <SiteCorpInput
            id="job-required-profession"
            name="required_profession_or_trade"
            defaultValue={editingJob?.required_profession_or_trade || ""}
            placeholder="Ej.: Licenciado en Contabilidad"
          />
          <p className="text-xs text-muted-foreground">
            Requisito del cargo. Es independiente de la profesión u oficio que posea la persona
            contratada.
          </p>
        </div>
      </div>

      {/* RETRIBUCIÓN */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Retribución
        </p>

        <div className="space-y-2">
          <Label htmlFor="job-group">Grupo salarial *</Label>
          <SiteCorpSelect
            value={selectedGroup}
            onValueChange={handleGroupChange}
            required
            disabled={!!scaleInfo && !scaleInfo.scaleId}
          >
            <option value="">Seleccionar grupo salarial</option>
            {groups.map((g) => (
              <option key={g.group.id} value={g.group.id}>
                Grupo {g.roman_numeral}
                {g.current_value
                  ? ` — ${g.current_value.amount.toLocaleString("es-CU", {
                      minimumFractionDigits: 2,
                    })} ${g.current_value.currency_code}`
                  : " — Salario no configurado"}
              </option>
            ))}
          </SiteCorpSelect>
          {scaleInfo && scaleInfo.scaleId ? (
            <>
              <p className="text-xs text-muted-foreground">
                Escala: {scaleInfo.scaleName}
              </p>
              {groups.length === 0 && (
                <p className="text-xs text-sitecorp-danger">
                  {scaleInfo.scopeType === "PRESUPUESTADA_GLOBAL"
                    ? "La escala salarial presupuestada todavía no tiene grupos configurados."
                    : "La escala salarial de esta entidad todavía no tiene grupos configurados."}
                </p>
              )}
            </>
          ) : scaleInfo && scaleInfo.regime === "EMPRESARIAL" ? (
            <div className="space-y-1">
              <p className="text-xs text-sitecorp-danger">
                No hay escala salarial empresarial configurada para esta entidad.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/entity/${entityId}/settings/salary`)}
                className="text-xs font-medium text-sitecorp-primary underline underline-offset-2 hover:opacity-80"
              >
                Ir a Ajustes → Escala salarial
              </button>
            </div>
          ) : scaleInfo ? (
            <p className="text-xs text-sitecorp-danger">
              La escala salarial presupuestada todavía no tiene grupos configurados.
            </p>
          ) : null}
        </div>

        {/* Salario derivado: nunca se escribe manualmente desde el cargo */}
                {salaryVigente && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">Salario actual</p>
                      <SiteCorpStatusBadge status="info">Calculado automáticamente</SiteCorpStatusBadge>
                    </div>
                    <p className="text-lg font-semibold text-ink">
                      {salaryVigente.amount.toLocaleString("es-CU", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {salaryVigente.currency_code}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Derivado del grupo salarial y de la escala aplicable a la entidad.
                    </p>
                  </div>
                )}
              </div>
        
              {/* CLA — CONDICIONES LABORALES ANORMALES (configuración del Cargo) */}
              <div className="space-y-4 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Condiciones Laborales Anormales (CLA)
                </p>
        
                <div className="space-y-2">
                  <SiteCorpCheckbox
                    label="Condiciones anormales"
                    checked={hasAbnormalConditions}
                    onCheckedChange={(checked) => setHasAbnormalConditions(!!checked)}
                  />
                  <p className="text-xs text-muted-foreground">
                    CLA es un concepto independiente de la Nocturnidad. Las tarifas pertenecen al Cargo,
                    no al trabajador ni a la Prenómina.
                  </p>
                </div>
        
                {hasAbnormalConditions && (
                  <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                    {/* Pago diurno */}
                    <div className="space-y-3">
                      <SiteCorpCheckbox
                        label="Pago diurno"
                        checked={claDayEnabled}
                        onCheckedChange={(checked) => setClaDayEnabled(!!checked)}
                      />
                      {claDayEnabled && (
                        <div className="space-y-2 pl-6">
                          <Label htmlFor="job-cla-day-rate">Pago por hora diurna (CUP/h)</Label>
                          <SiteCorpInput
                            id="job-cla-day-rate"
                            type="number"
                            min="0"
                            step="0.01"
                            value={claDayRate}
                            onChange={(e) => setClaDayRate(e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                      )}
                    </div>
        
                    {/* Pago nocturno: dos tramos configurables */}
                    <div className="space-y-3 border-t pt-3">
                      <SiteCorpCheckbox
                        label="Pago nocturno"
                        checked={claNightEnabled}
                        onCheckedChange={(checked) => setClaNightEnabled(!!checked)}
                      />
                      {claNightEnabled && (
                        <div className="space-y-4 pl-6">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-ink">Tramo nocturno 1</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="space-y-1">
                                <Label>Desde</Label>
                                <input
                                  type="time"
                                  value={claNight1Start}
                                  onChange={(e) => setClaNight1Start(e.target.value)}
                                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Hasta</Label>
                                <input
                                  type="time"
                                  value={claNight1End}
                                  onChange={(e) => setClaNight1End(e.target.value)}
                                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Pago por hora (CUP/h)</Label>
                                <SiteCorpInput
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={claNight1Rate}
                                  onChange={(e) => setClaNight1Rate(e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                          </div>
        
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-ink">Tramo nocturno 2</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="space-y-1">
                                <Label>Desde</Label>
                                <input
                                  type="time"
                                  value={claNight2Start}
                                  onChange={(e) => setClaNight2Start(e.target.value)}
                                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Hasta</Label>
                                <input
                                  type="time"
                                  value={claNight2End}
                                  onChange={(e) => setClaNight2End(e.target.value)}
                                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label>Pago por hora (CUP/h)</Label>
                                <SiteCorpInput
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={claNight2Rate}
                                  onChange={(e) => setClaNight2Rate(e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                          </div>
        
                          <p className="text-xs text-muted-foreground">
                            Los dos tramos son independientes y admiten horarios que cruzan medianoche
                            (p. ej. 23:00 → 07:00).
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
                            
                            {/* DOCUMENTACIÓN DEL CARGO */}
                            <div className="space-y-4 border-t border-border pt-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Documentación del cargo
                              </p>
              
                              <div className="space-y-2">
                                <SiteCorpCheckbox
                                  label="Cuadro"
                                  checked={isCuadro}
                                  onCheckedChange={(checked) => {
                                    setIsCuadro(!!checked)
                                    if (checked) setIsPrincipalSpecialist(false)
                                  }}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Si está marcado, el motor documental no generará contrato alguno para este cargo.
                                </p>
                              </div>
              
                              <div className="space-y-2">
                                <SiteCorpCheckbox
                                  label="Especialista Principal"
                                  checked={isPrincipalSpecialist}
                                  onCheckedChange={(checked) => {
                                    setIsPrincipalSpecialist(!!checked)
                                    if (checked) setIsCuadro(false)
                                  }}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Si está marcado, el motor documental espera una Resolución en lugar de contrato.
                                </p>
                              </div>
                            </div>
                            
                            {/* CONTENIDO DE TRABAJO */}
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contenido de trabajo
        </p>

        <div className="space-y-2">
          <Label htmlFor="job-work-content">Funciones / contenido de trabajo</Label>
          <Textarea
            id="job-work-content"
            name="work_content"
            defaultValue={editingJob?.work_content || ""}
            placeholder="Funciones y responsabilidades generales correspondientes al cargo"
            rows={6}
          />
          <p className="text-xs text-muted-foreground">
            Este contenido pertenece al cargo y se reutiliza desde sus puestos.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <SiteCorpButton variant="outline" type="button" onClick={onCancel}>
          Cancelar
        </SiteCorpButton>
        <SiteCorpButton type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : editingJob ? "Guardar cambios" : "Crear cargo"}
        </SiteCorpButton>
      </div>
    </form>
  )
}
