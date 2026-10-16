import * as React from "react"
import { useParams } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { CUBA_PROVINCES, MUNICIPIOS_BY_PROVINCE } from "@/data/cuba-locations"
import { showSuccess, showError } from "@/utils/toast"
import {
  MAX_REPRESENTATIVE_POSITIONS,
  changeRepresentative,
  createRepresentativePosition,
  fetchRepresentativeHistory,
  formatRepresentativeDate,
  loadEntityContractDataWorkspace,
  representativePeriodLabel,
  saveEntityContractData,
  updateRepresentativePosition,
  type EntityContractDataInput,
  type RepresentativeHistoryRow,
  type RepresentativePositionConfig,
} from "@/modules/representatives"
import { Building2, Clock, Edit3, Plus, Replace, UserPlus, Users } from "lucide-react"

type PositionWithOccupant = RepresentativePositionConfig

const emptyContractData: EntityContractDataInput = {
  organism: null,
  branch: null,
  labor_identification_code: null,
  address: null,
  province: null,
  municipality: null,
  revolution_year: null,
}

/** Desplaza una fecha ISO (YYYY-MM-DD) en días sin desfases de zona horaria. */
const shiftIsoDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const EntitySettingsContractData = () => {
  const { entityId: routeEntityId } = useParams<{ entityId: string }>()
  const { currentEntity } = useCurrentEntity()
  const entityId = routeEntityId || currentEntity?.id || ""

  const [loading, setLoading] = React.useState(true)
  const [notAllowed, setNotAllowed] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [internalCode, setInternalCode] = React.useState<string>("")
  const [entityName, setEntityName] = React.useState<string>("")

  const [contractData, setContractData] = React.useState<EntityContractDataInput>(emptyContractData)
  /** Fase 11A.7 — Año de la Revolución: se edita como texto y se guarda como entero. */
  const [revolutionYearText, setRevolutionYearText] = React.useState("")
  const [savingData, setSavingData] = React.useState(false)

  const [positions, setPositions] = React.useState<PositionWithOccupant[]>([])
  const [showCreate, setShowCreate] = React.useState(false)
  const [changeTarget, setChangeTarget] = React.useState<PositionWithOccupant | null>(null)
  const [historyTarget, setHistoryTarget] = React.useState<PositionWithOccupant | null>(null)
  const [editTarget, setEditTarget] = React.useState<PositionWithOccupant | null>(null)

  const loadData = React.useCallback(async () => {
    if (!entityId) {
      setNotAllowed("No se pudo determinar la entidad.")
      setLoading(false)
      return
    }

    setLoading(true)
    setNotAllowed(null)

    try {
      const workspace = await loadEntityContractDataWorkspace(entityId)

      if (!workspace) {
        setNotAllowed("No tiene permiso para ver los datos contractuales de esta entidad.")
        return
      }

      setCanManage(workspace.canManage)

      const data = workspace.contractData
      if (data) {
        setEntityName(data.name)
        setInternalCode(data.code)
        setContractData({
          organism: data.organism,
          branch: data.branch,
          labor_identification_code: data.labor_identification_code,
          address: data.address,
          province: data.province,
          municipality: data.municipality,
          revolution_year: data.revolution_year,
        })
        setRevolutionYearText(data.revolution_year || "")
      }

      setPositions(workspace.positions)
    } catch (err) {
      console.error("Error loading contractual data:", err)
      setNotAllowed(
        err instanceof Error ? err.message : "No se pudieron cargar los datos contractuales."
      )
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const activePositions = positions.filter((position) => position.is_active)
  const canAddPosition = activePositions.length < MAX_REPRESENTATIVE_POSITIONS

  const handleSaveContractData = async () => {
    if (!entityId) return
    setSavingData(true)
    try {
      await saveEntityContractData(entityId, {
        organism: contractData.organism?.trim() || null,
        branch: contractData.branch?.trim() || null,
        labor_identification_code: contractData.labor_identification_code?.trim() || null,
        address: contractData.address?.trim() || null,
        province: contractData.province || null,
        municipality: contractData.municipality || null,
        revolution_year: revolutionYearText.trim() || null,
      })
      showSuccess("Datos contractuales actualizados.")
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudieron guardar los datos contractuales.")
    } finally {
      setSavingData(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Datos contractuales"
          description="Información contractual de la entidad y representantes autorizados"
        />
        <SiteCorpLoading rows={5} />
      </div>
    )
  }

  if (notAllowed) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader
          title="Datos contractuales"
          description="Información contractual de la entidad y representantes autorizados"
        />
        <SiteCorpAlert type="danger">{notAllowed}</SiteCorpAlert>
      </div>
    )
  }

  const municipalityOptions = contractData.province
    ? MUNICIPIOS_BY_PROVINCE[contractData.province] || []
    : []

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Datos contractuales"
        description={`Información contractual de ${entityName || "la entidad"} y representantes autorizados`}
      />

      {/* ---------- Datos contractuales ---------- */}
      <SiteCorpCard
        title="Datos contractuales de la entidad"
        description="Datos que se conservan en el snapshot contractual de cada contrato formalizado."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Organismo al que pertenece</Label>
            <SiteCorpInput
              value={contractData.organism || ""}
              onChange={(e) => setContractData({ ...contractData, organism: e.target.value })}
              placeholder="Organismo"
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label>Rama</Label>
            <SiteCorpInput
              value={contractData.branch || ""}
              onChange={(e) => setContractData({ ...contractData, branch: e.target.value })}
              placeholder="Rama"
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label>Código de identificación laboral/organizacional</Label>
            <SiteCorpInput
              value={contractData.labor_identification_code || ""}
              onChange={(e) =>
                setContractData({ ...contractData, labor_identification_code: e.target.value })
              }
              placeholder="Código laboral"
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">
              Código interno de SiteCorp (generado automáticamente):{" "}
              <span className="font-mono">{internalCode || "—"}</span>
            </p>
          </div>
          <div className="space-y-2">
            <Label>Dirección</Label>
            <SiteCorpInput
              value={contractData.address || ""}
              onChange={(e) => setContractData({ ...contractData, address: e.target.value })}
              placeholder="Dirección"
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label>Provincia</Label>
            <SiteCorpSelect
              value={contractData.province || ""}
              onValueChange={(value) =>
                setContractData({
                  ...contractData,
                  province: value || null,
                  municipality: null,
                })
              }
              disabled={!canManage}
            >
              <option value="">Seleccionar provincia</option>
              {CUBA_PROVINCES.map((province) => (
                <option key={province.id} value={province.id}>
                  {province.name}
                </option>
              ))}
            </SiteCorpSelect>
          </div>
          <div className="space-y-2">
            <Label>Municipio</Label>
            <SiteCorpSelect
              value={contractData.municipality || ""}
              onValueChange={(value) => setContractData({ ...contractData, municipality: value || null })}
              disabled={!canManage || !contractData.province}
            >
              <option value="">Seleccionar municipio</option>
              {municipalityOptions.map((municipality) => (
                <option key={municipality} value={municipality}>
                  {municipality}
                </option>
              ))}
            </SiteCorpSelect>
          </div>
          <div className="space-y-2">
            <Label>Año de la Revolución</Label>
            <SiteCorpInput
              value={revolutionYearText}
              onChange={(e) => setRevolutionYearText(e.target.value)}
              placeholder="Ej.: 68"
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">
              Dato institucional interno (texto libre). Se guarda tal cual se escriba (p. ej. 68) y
              se preserva en el snapshot de cada contrato formalizado: no se calcula ni se deriva de
              ninguna fecha.
            </p>
          </div>
        </div>

        {canManage ? (
          <div className="flex justify-end pt-4">
            <SiteCorpButton onClick={handleSaveContractData} disabled={savingData}>
              {savingData ? "Guardando…" : "Guardar datos contractuales"}
            </SiteCorpButton>
          </div>
        ) : (
          <p className="pt-4 text-xs text-muted-foreground">
            Solo los usuarios con el permiso «Gestionar datos contractuales» en esta entidad pueden
            modificar estos datos.
          </p>
        )}
      </SiteCorpCard>

      {/* ---------- Representantes autorizados ---------- */}
      <SiteCorpCard
        title="Representantes autorizados"
        description={`Cargos de representación de la entidad. Máximo ${MAX_REPRESENTATIVE_POSITIONS} cargos activos.`}
      >
        <div className="space-y-4">
          {positions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
              <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Esta entidad todavía no tiene cargos de representación configurados.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sin un representante vigente no es posible formalizar contratos.
              </p>
            </div>
          ) : (
            positions.map((position, index) => (
              <div
                key={position.id}
                className="rounded-xl border border-border bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sitecorp-primary/10">
                      <span className="text-sm font-bold text-sitecorp-primary">{index + 1}</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{position.title}</p>
                        {!position.is_active && (
                          <SiteCorpStatusBadge status="warning">Inactivo</SiteCorpStatusBadge>
                        )}
                      </div>
                      <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Representante actual
                      </p>
                      <p className="text-sm font-medium text-ink">
                        {position.person_name || "Sin representante vigente"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Desde: {formatRepresentativeDate(position.effective_from)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canManage && position.is_active && (
                      <>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          onClick={() => setChangeTarget(position)}
                        >
                          <Replace className="mr-1 h-3.5 w-3.5" />
                          {position.person_name ? "Cambiar representante" : "Asignar representante"}
                        </SiteCorpButton>
                        <SiteCorpButton
                          size="sm"
                          variant="outline"
                          onClick={() => setEditTarget(position)}
                        >
                          <Edit3 className="mr-1 h-3.5 w-3.5" />
                          Editar cargo
                        </SiteCorpButton>
                      </>
                    )}
                    <SiteCorpButton
                      size="sm"
                      variant="outline"
                      onClick={() => setHistoryTarget(position)}
                    >
                      <Clock className="mr-1 h-3.5 w-3.5" />
                      Ver historial
                    </SiteCorpButton>
                  </div>
                </div>

                {position.is_active && (
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    Los cambios de representante se registran con fecha efectiva y no modifican los
                    contratos ya formalizados.
                  </p>
                )}
              </div>
            ))
          )}

          {canManage && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Máximo {MAX_REPRESENTATIVE_POSITIONS} cargos de representación ·{" "}
                {activePositions.length} configurado(s).
              </p>
              <SiteCorpButton onClick={() => setShowCreate(true)} disabled={!canAddPosition}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar cargo de representación
              </SiteCorpButton>
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* ---------- Diálogos ---------- */}
      <CreateRepresentativePositionDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        entityId={entityId}
        entityName={entityName}
        displayOrder={activePositions.length + 1}
        onCreated={async () => {
          await loadData()
        }}
      />

      <ChangeRepresentativeDialog
        open={!!changeTarget}
        onOpenChange={(open) => {
          if (!open) setChangeTarget(null)
        }}
        position={changeTarget}
        onChanged={async () => {
          await loadData()
        }}
      />

      <RepresentativeHistoryDialog
        open={!!historyTarget}
        onOpenChange={(open) => {
          if (!open) setHistoryTarget(null)
        }}
        position={historyTarget}
      />

      <EditRepresentativePositionDialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
        position={editTarget}
        onUpdated={async () => {
          await loadData()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

const CreateRepresentativePositionDialog = ({
  open,
  onOpenChange,
  entityId,
  entityName,
  displayOrder,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  entityName: string
  displayOrder: number
  onCreated: () => Promise<void>
}) => {
  const [title, setTitle] = React.useState("")
  const [personName, setPersonName] = React.useState("")
  const [effectiveFrom, setEffectiveFrom] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setTitle("")
      setPersonName("")
      setEffectiveFrom("")
      setError(null)
    }
  }, [open])

  const handleSubmit = async () => {
    setError(null)
    if (!title.trim()) {
      setError("El cargo de representación es obligatorio.")
      return
    }
    if (!personName.trim()) {
      setError("El nombre de la persona que ocupa el cargo es obligatorio.")
      return
    }
    if (!effectiveFrom) {
      setError("Indique la fecha desde la que ocupa el cargo.")
      return
    }

    setSaving(true)
    try {
      await createRepresentativePosition({
        entityId,
        title: title.trim(),
        personName: personName.trim(),
        effectiveFrom,
        displayOrder,
      })
      showSuccess("Cargo de representación creado.")
      onOpenChange(false)
      await onCreated()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo crear el cargo de representación."
      setError(message)
      showError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-sitecorp-primary" />
            Nuevo cargo de representación
          </DialogTitle>
          <DialogDescription>
            El cargo se crea para {entityName || "esta entidad"} con la persona que lo ocupa
            actualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cargo de representación *</Label>
            <SiteCorpInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej.: Director de la Empresa"
            />
          </div>
          <div className="space-y-2">
            <Label>Nombre de la persona *</Label>
            <SiteCorpInput
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Nombre y apellidos"
            />
          </div>
          <div className="space-y-2">
            <Label>Fecha desde la que ocupa el cargo *</Label>
            <SiteCorpInput
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <SiteCorpButton variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton onClick={handleSubmit} disabled={saving}>
              {saving ? "Creando…" : "Crear cargo"}
            </SiteCorpButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ChangeRepresentativeDialog = ({
  open,
  onOpenChange,
  position,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: PositionWithOccupant | null
  onChanged: () => Promise<void>
}) => {
  const [personName, setPersonName] = React.useState("")
  const [effectiveFrom, setEffectiveFrom] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setPersonName("")
      setEffectiveFrom("")
      setError(null)
    }
  }, [open])

  const closingDate = effectiveFrom ? shiftIsoDate(effectiveFrom, -1) : ""

  const handleSubmit = async () => {
    if (!position) return
    setError(null)
    if (!personName.trim()) {
      setError("El nombre del nuevo representante es obligatorio.")
      return
    }
    if (!effectiveFrom) {
      setError("La fecha efectiva del cambio es obligatoria.")
      return
    }

    setSaving(true)
    try {
      const result = await changeRepresentative({
        positionId: position.id,
        personName: personName.trim(),
        effectiveFrom,
      })
      showSuccess(
        result?.status === "UNCHANGED"
          ? "El representante ya estaba registrado para esa fecha."
          : "Representante actualizado. Los contratos históricos no se modifican."
      )
      onOpenChange(false)
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo cambiar el representante."
      setError(message)
      showError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Replace className="h-5 w-5 text-sitecorp-primary" />
            Cambiar representante
          </DialogTitle>
          <DialogDescription>
            El período anterior se cierra en la fecha indicada y se abre uno nuevo. El historial se
            conserva completo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Cargo</p>
              <p className="text-sm font-medium text-ink">{position?.title || "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Representante actual</p>
              <p className="text-sm font-medium text-ink">
                {position?.person_name || "Sin representante vigente"}
              </p>
              <p className="text-xs text-muted-foreground">
                Desde: {formatRepresentativeDate(position?.effective_from)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Nuevo representante *</Label>
            <SiteCorpInput
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Nombre y apellidos"
            />
          </div>
          <div className="space-y-2">
            <Label>Fecha efectiva *</Label>
            <SiteCorpInput
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Puede registrar un cambio retroactivo (ocurrido días antes) o programar un cambio
              futuro: hasta esa fecha seguirá considerándose vigente el representante actual.
            </p>
          </div>

          {effectiveFrom && (
            <div className="rounded-xl border border-sitecorp-primary/30 bg-sitecorp-primary/5 p-3 text-sm text-ink">
              <p>
                <span className="font-medium">{position?.person_name || "El representante actual"}</span>{" "}
                {position?.person_name
                  ? `dejará de ocupar el cargo de ${position?.title} el ${formatRepresentativeDate(
                      closingDate
                    )}.`
                  : "no tiene período vigente que cerrar."}
              </p>
              <p className="mt-1">
                <span className="font-medium">{personName.trim() || "El nuevo representante"}</span>{" "}
                ocupará el cargo desde el {formatRepresentativeDate(effectiveFrom)}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Los contratos históricos no serán modificados.
              </p>
            </div>
          )}

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <SiteCorpButton variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton onClick={handleSubmit} disabled={saving}>
              {saving ? "Confirmando…" : "Confirmar cambio"}
            </SiteCorpButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const RepresentativeHistoryDialog = ({
  open,
  onOpenChange,
  position,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: PositionWithOccupant | null
}) => {
  const [history, setHistory] = React.useState<RepresentativeHistoryRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!open || !position) return
      setLoading(true)
      setError(null)
      try {
        const rows = await fetchRepresentativeHistory(position.id)
        if (!cancelled) setHistory(rows)
      } catch (err) {
        console.error("Error loading representative history:", err)
        if (!cancelled) setError("No se pudo cargar el historial del cargo.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [open, position])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-sitecorp-primary" />
            Historial del cargo
          </DialogTitle>
          <DialogDescription>
            {position?.title} · personas que han ocupado el cargo (más reciente primero)
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <SiteCorpLoading rows={3} />
        ) : error ? (
          <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este cargo no tiene representantes registrados.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{row.person_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {representativePeriodLabel(row.effective_from, row.effective_to)}
                  </p>
                </div>
                {!row.effective_to && <SiteCorpStatusBadge status="success">Actualidad</SiteCorpStatusBadge>}
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Los contratos ya formalizados conservan el representante registrado en su snapshot y no
              cambian al producirse un relevo.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const EditRepresentativePositionDialog = ({
  open,
  onOpenChange,
  position,
  onUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: PositionWithOccupant | null
  onUpdated: () => Promise<void>
}) => {
  const [title, setTitle] = React.useState("")
  const [isActive, setIsActive] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open && position) {
      setTitle(position.title)
      setIsActive(position.is_active)
      setError(null)
    }
  }, [open, position])

  const handleSubmit = async () => {
    if (!position) return
    if (!title.trim()) {
      setError("El título del cargo no puede quedar vacío.")
      return
    }
    setSaving(true)
    try {
      await updateRepresentativePosition({
        positionId: position.id,
        title: title.trim(),
        isActive,
      })
      showSuccess("Cargo de representación actualizado.")
      onOpenChange(false)
      await onUpdated()
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo actualizar el cargo."
      setError(message)
      showError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sitecorp-primary" />
            Editar cargo de representación
          </DialogTitle>
          <DialogDescription>
            El cambio de título es administrativo: los contratos existentes conservan el cargo
            registrado en su snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Título del cargo *</Label>
            <SiteCorpInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="position-active"
              type="checkbox"
              className="h-4 w-4 rounded border-input text-sitecorp-primary focus:ring-sitecorp-primary"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="position-active" className="text-sm text-ink">
              Cargo activo (cuenta para el máximo de {MAX_REPRESENTATIVE_POSITIONS} cargos)
            </label>
          </div>

          {error && <SiteCorpAlert type="danger">{error}</SiteCorpAlert>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <SiteCorpButton variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton onClick={handleSubmit} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </SiteCorpButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EntitySettingsContractData
