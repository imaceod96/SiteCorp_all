import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { useSalary } from "@/contexts/SalaryContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SalaryGroupDialog } from "@/components/salary-group-dialog"
import ReviewSalaryChangeDialog from "@/components/salary/ReviewSalaryChangeDialog"
import { toRomanNumeral } from "@/utils/roman-numerals"
import { Scale, Plus, Edit3, Clock, AlertTriangle } from "lucide-react"
import type { SalaryGroupWithCurrent, SalaryScale } from "@/contexts/SalaryContext"

interface SalaryGroupRow {
  id: string
  sequence_number: number
  description: string | null
  is_active: boolean
  current_value: { amount: number; currency_code: string; effective_from: string } | null
  roman_numeral: string
}

interface SalaryHistoryValue {
  id: string
  amount: number
  currency_code: string
  effective_from: string
  effective_to: string | null
  is_active: boolean
}

const EntitySettingsSalary = () => {
  const navigate = useNavigate()
  const { currentEntity } = useCurrentEntity()
  const {
    fetchEntityEmpresarialScale,
    fetchScaleWithGroups,
    addSalaryGroup,
    addSalaryValue,
    fetchGlobalPresupuestadaScale,
    createEntityEmpresarialScale,
    canManageSalary,
    fetchSalaryHistory
  } = useSalary()
  const [scale, setScale] = React.useState<SalaryScale | null>(null)
  const [groups, setGroups] = React.useState<SalaryGroupRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showAddGroup, setShowAddGroup] = React.useState(false)
  const [canManageEntitySalary, setCanManageEntitySalary] = React.useState(false)
  // Cambio salarial en revisión (Fase 11A): nunca se guarda directamente.
  const [changeGroup, setChangeGroup] = React.useState<SalaryGroupRow | null>(null)
  const [globalScale, setGlobalScale] = React.useState<SalaryScale | null>(null)
  const [showCreateEnterpriseScale, setShowCreateEnterpriseScale] = React.useState(false)
  const [newScaleName, setNewScaleName] = React.useState("")
  const [newScaleCurrency, setNewScaleCurrency] = React.useState("CUP")
  const [newScaleEffectiveFrom, setNewScaleEffectiveFrom] = React.useState("")
  const [creatingScale, setCreatingScale] = React.useState(false)
  const [enterpriseScaleName, setEnterpriseScaleName] = React.useState("")

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = React.useState(false)
  const [historyGroupId, setHistoryGroupId] = React.useState<string | null>(null)
  const [historyData, setHistoryData] = React.useState<SalaryHistoryValue[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)

  const currentEntityId = currentEntity?.id
  const currentEntityRegimeId = currentEntity?.regime_id

  const loadScale = React.useCallback(async () => {
      if (!currentEntityId) return
      try {
        setLoading(true)
        setError(null)
  
        // PRESUPUESTADA: la escala global se muestra SIEMPRE en solo lectura dentro del
        // contexto de la entidad; su administración vive en la pantalla de plataforma.
        if (currentEntityRegimeId === "PRESUPUESTADA") {
  
          // Load global Presupuestada scale
          const globalScaleData = await fetchGlobalPresupuestadaScale()
          setGlobalScale(globalScaleData)
  
          if (globalScaleData) {
            const scaleWithGroups = await fetchScaleWithGroups(globalScaleData.id)
            if (scaleWithGroups) {
              const mappedGroups: SalaryGroupRow[] = scaleWithGroups.groups.map((g) => ({
                id: g.group.id,
                sequence_number: g.group.sequence_number,
                description: g.group.description,
                is_active: g.group.is_active,
                current_value: g.current_value,
                roman_numeral: g.roman_numeral,
              }))
              setGroups(mappedGroups)
              setScale(globalScaleData)
            }
          }
        } else {
          // EMPRESARIAL: Load entity-specific scale ONLY
          const canManageEntity = await canManageSalary(currentEntityId)
          setCanManageEntitySalary(canManageEntity)

          const scaleData = await fetchEntityEmpresarialScale(currentEntityId)
          if (scaleData) {
            setScale(scaleData)
            const scaleWithGroups = await fetchScaleWithGroups(scaleData.id)
            if (scaleWithGroups) {
              const mappedGroups: SalaryGroupRow[] = scaleWithGroups.groups.map((g) => ({
                id: g.group.id,
                sequence_number: g.group.sequence_number,
                description: g.group.description,
                is_active: g.group.is_active,
                current_value: g.current_value,
                roman_numeral: g.roman_numeral,
              }))
              setGroups(mappedGroups)
            }
          } else {
            setScale(null)
            setGroups([])
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar la escala salarial")
      } finally {
        setLoading(false)
      }
    }, [currentEntityId, currentEntityRegimeId, fetchEntityEmpresarialScale, fetchScaleWithGroups, fetchGlobalPresupuestadaScale, canManageSalary])

  React.useEffect(() => {
    loadScale()
  }, [loadScale])

  const handleAddGroup = async (salary: string, effectiveFrom: string) => {
      if (!scale) return
      try {
        // El grupo se crea sin descripción: ese dato ya no forma parte de la UI.
        const newGroup = await addSalaryGroup(scale.id)
        if (newGroup) {
          const amount = parseFloat(salary)
          if (!isNaN(amount) && amount > 0) {
            await addSalaryValue(newGroup.id, amount, "CUP", effectiveFrom)
          }
          setShowAddGroup(false)
          await loadScale()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al añadir grupo")
      }
    }

  /**
   * Fase 11A: modificar un importe salarial abre la revisión de impacto.
   * Nunca se guarda directamente y nunca se destruye el valor anterior: se crea
   * una nueva vigencia y se registran históricos/anexos de los afectados.
   */
  const openSalaryChange = (group: SalaryGroupRow) => {
    setError(null)
    setChangeGroup(group)
  }

  const groupLabel = (group: SalaryGroupRow) => `Grupo ${group.roman_numeral}`

  const handleViewHistory = async (groupId: string) => {
    setHistoryGroupId(groupId)
    setHistoryLoading(true)
    try {
      const history = await fetchSalaryHistory(groupId)
      // Sort by effective_from descending (most recent first)
      const sortedHistory = [...history].sort((a, b) => 
        new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime()
      )
      setHistoryData(sortedHistory)
    } catch (err) {
      console.error("Error fetching salary history:", err)
      setHistoryData([])
    } finally {
      setHistoryLoading(false)
      setShowHistoryModal(true)
    }
  }

  const handleCreateEnterpriseScale = async () => {
    if (!currentEntity) return
    setCreatingScale(true)
    try {
      const name = newScaleName.trim() || "Escala salarial empresarial"
      const currency = newScaleCurrency.trim() || "CUP"
      const effectiveFrom = newScaleEffectiveFrom || new Date().toISOString().split('T')[0]
      
      const newScale = await createEntityEmpresarialScale(
        currentEntity.id,
        name,
        currency,
        effectiveFrom
      )
      if (newScale) {
        setShowCreateEnterpriseScale(false)
        setNewScaleName("")
        setNewScaleCurrency("CUP")
        setNewScaleEffectiveFrom(new Date().toISOString().split('T')[0])
        await loadScale()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la escala salarial")
    } finally {
      setCreatingScale(false)
    }
  }

  if (!currentEntity) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Cargando entidad..." description="Obteniendo información de la entidad organizativa" />
        <SiteCorpCard title="Cargando"><p className="text-sm text-muted-foreground">Cargando información de la entidad...</p></SiteCorpCard>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Escala salarial"
        description="Gestión de la escala salarial de esta entidad"
      />

      {/* Regimen indicator */}
      <SiteCorpAlert type="info" title={`Régimen: ${currentEntity.regime_id}`}>
        {currentEntity.regime_id === "PRESUPUESTADA" ? (
          <>
            <p className="mb-1">Esta entidad es de régimen PRESUPUESTADA.</p>
            <p>La escala salarial aplicable es la <strong>Escala salarial presupuestada general de SiteCorp</strong>.</p>
            <p className="mt-2">No se permite crear una escala local para entidades presupuestadas.</p>
          </>
        ) : (
          <>
            <p className="mb-1">Esta entidad es de régimen EMPRESARIAL.</p>
            <p>La escala salarial es específica de esta entidad.</p>
          </>
        )}
      </SiteCorpAlert>

      {currentEntity.regime_id === "PRESUPUESTADA" ? (
        /* PRESUPUESTADA: la escala global se muestra SIEMPRE en solo lectura en el contexto
           de la entidad; su administración vive en la pantalla de plataforma de SiteCorp. */
        <>
          {globalScale ? (
            <SiteCorpCard title="Escala salarial presupuestada general de SiteCorp" description="Esta escala es común para todas las entidades presupuestadas del sistema">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">Moneda: {globalScale.currency_code}</p>
                    <p className="text-xs text-muted-foreground">
                      {groups.filter(g => g.is_active).length} grupo(s) activo(s)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <SiteCorpButton variant="outline" onClick={() => navigate("/admin/settings/salary-scale")}>
                      Ver escala
                    </SiteCorpButton>
                  </div>
                </div>

                {/* Groups table */}
                                <div className="space-y-3">
                                  <h4 className="text-sm font-semibold text-ink">Grupos salariales</h4>
                                  {groups.length > 0 ? (
                                    groups.map((group) => (
                                      <div key={group.id} className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sitecorp-primary/10">
                                              <span className="text-sm font-bold text-sitecorp-primary">{group.roman_numeral}</span>
                                            </div>
                                            <div>
                                              <p className="text-sm font-medium text-ink">
                                                Grupo {group.roman_numeral}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                Secuencia: {group.sequence_number}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-3">
                                            {group.current_value ? (
                                              <div className="text-right">
                                                <p className="text-sm font-medium text-ink">
                                                  {group.current_value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} {group.current_value.currency_code}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                  Vigente desde: {group.current_value.effective_from}
                                                </p>
                                              </div>
                                            ) : (
                                              <span className="text-sm text-muted-foreground">Sin valor asignado</span>
                                            )}
                                            <SiteCorpStatusBadge status={group.is_active ? "success" : "warning"}>
                                              {group.is_active ? "Activo" : "Inactivo"}
                                            </SiteCorpStatusBadge>
                                            <SiteCorpButton
                                              size="sm"
                                              variant="outline"
                                              onClick={() => handleViewHistory(group.id)}
                                            >
                                              <Clock className="mr-1 h-3.5 w-3.5" /> Ver historial
                                            </SiteCorpButton>
                                          </div>
                                        </div>
                                      ))
                                    ) : (
                                      <p className="text-sm text-muted-foreground text-center py-4">
                                        No hay grupos salariales configurados aún.
                                      </p>
                                    )}
                </div>

              </div>
            </SiteCorpCard>
          ) : (
            /* No global scale exists yet */
            <SiteCorpCard title="Escala salarial presupuestada">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  No se ha configurado todavía la escala salarial presupuestada general.
                </p>
                <p className="text-sm text-muted-foreground">
                  La escala debe ser configurada por un administrador autorizado de SiteCorp.
                </p>
                              </div>
                            </SiteCorpCard>
                          )}
                    </>
                  ) : (
    /* EMPRESARIAL: Show entity-specific scale */
    <>
      {loading ? (
        <SiteCorpLoading rows={5} />
      ) : error ? (
        <SiteCorpAlert type="danger" title="Error">{error}</SiteCorpAlert>
      ) : !scale ? (
            <SiteCorpCard title="Sin escala salarial empresarial">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Esta empresa todavía no tiene una escala salarial empresarial configurada.
                </p>
                {canManageEntitySalary && (
                  <SiteCorpButton onClick={() => setShowCreateEnterpriseScale(true)}>
                    Configurar escala salarial
                  </SiteCorpButton>
                )}
              </div>
            </SiteCorpCard>
          ) : (
        <>
          <SiteCorpCard title={`Escala salarial de ${currentEntity.name}`} description={scale.description || "Escala salarial empresarial"}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">Moneda: {scale.currency_code}</p>
                  <p className="text-xs text-muted-foreground">
                    {groups.filter(g => g.is_active).length} grupo(s) activo(s)
                  </p>
                </div>
                {canManageEntitySalary && (
                  <SiteCorpButton onClick={() => setShowAddGroup(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Añadir grupo salarial
                  </SiteCorpButton>
                )}
              </div>

              {/* Add group dialog */}
                                <SalaryGroupDialog
                                  open={showAddGroup}
                                  onOpenChange={setShowAddGroup}
                                  onSubmit={handleAddGroup}
                                />
            
                                {/* Groups table */}
                                <div className="space-y-3">
                                  <h4 className="text-sm font-semibold text-ink">Grupos salariales</h4>
                                  {groups.map((group) => (
                                    <div key={group.id} className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sitecorp-primary/10">
                        <span className="text-sm font-bold text-sitecorp-primary">{group.roman_numeral}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">
                          Grupo {group.roman_numeral}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Secuencia: {group.sequence_number}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {group.current_value ? (
                        <div className="text-right">
                          <p className="text-sm font-medium text-ink">
                            {group.current_value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} {group.current_value.currency_code}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Vigente desde: {group.current_value.effective_from}
                          </p>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin valor asignado</span>
                      )}
                      <SiteCorpStatusBadge status={group.is_active ? "success" : "warning"}>
                        {group.is_active ? "Activo" : "Inactivo"}
                      </SiteCorpStatusBadge>
                      {canManageEntitySalary && (
                                                  <SiteCorpButton
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => openSalaryChange(group)}
                                                  >
                                                    <Edit3 className="mr-1 h-3.5 w-3.5" /> Cambiar salario
                                                  </SiteCorpButton>
                                                )}
                      <SiteCorpButton
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewHistory(group.id)}
                      >
                        <Clock className="mr-1 h-3.5 w-3.5" /> Ver historial
                      </SiteCorpButton>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </SiteCorpCard>

          {/* Salary history */}
          <SiteCorpCard title="Historial de salarios" description="Valores históricos por grupo">
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-sitecorp-primary">{group.roman_numeral}</span>
                    <span className="text-sm text-muted-foreground">Grupo {group.sequence_number}</span>
                  </div>
                  <div className="space-y-1">
                    {group.current_value && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Actual: {group.current_value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} {group.current_value.currency_code} desde {group.current_value.effective_from}</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Historial completo disponible en la sección de historial global.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SiteCorpCard>
                  </>
                )}
          
                {/* Create enterprise scale dialog */}
                <CreateEnterpriseScaleDialog
                  open={showCreateEnterpriseScale}
                  onOpenChange={setShowCreateEnterpriseScale}
                  onSubmit={handleCreateEnterpriseScale}
                  loading={creatingScale}
                  name={newScaleName}
                  currency={newScaleCurrency}
                  effectiveFrom={newScaleEffectiveFrom}
                  onNameChange={setNewScaleName}
                  onCurrencyChange={setNewScaleCurrency}
                  onEffectiveFromChange={setNewScaleEffectiveFrom}
                />
              </>
            )}
          
                      {/* Revisión de cambio salarial (Fase 11A): nunca se guarda sin revisar el impacto */}
      <ReviewSalaryChangeDialog
        open={!!changeGroup}
        onOpenChange={(open) => {
          if (!open) setChangeGroup(null)
        }}
        groupId={changeGroup?.id || null}
        groupLabel={changeGroup ? groupLabel(changeGroup) : ""}
        scaleLabel={scale?.name || "Escala salarial"}
        onApplied={async () => {
          await loadScale()
        }}
      />

      {/* Salary History Modal */}
      <SalaryHistoryModal
        open={showHistoryModal}
        onOpenChange={(open) => setShowHistoryModal(open)}
        groupId={historyGroupId}
        historyData={historyData}
        historyLoading={historyLoading}
      />
    </div>
  )
}

// Salary History Modal
const SalaryHistoryModal = ({ 
  open, 
  onOpenChange, 
  groupId, 
  historyData, 
  historyLoading 
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string | null
  historyData: SalaryHistoryValue[]
  historyLoading: boolean
}) => {
  const getStatus = (value: SalaryHistoryValue): string => {
    if (value.is_active) return "Actual"
    
    const today = new Date()
    const effectiveFrom = new Date(value.effective_from)
    
    if (effectiveFrom > today) {
      return "Futuro"
    }
    
    return "Histórico"
  }

  const getStatusClass = (status: string): string => {
    switch (status) {
      case "Actual": return "text-sitecorp-success"
      case "Futuro": return "text-sitecorp-warning"
      default: return "text-muted-foreground"
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="rounded-xl border border-border bg-white p-6 shadow-lg">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold text-ink">
              Historial salarial
            </h2>
            <button 
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 hover:bg-muted/50"
            >
              <XIcon className="h-4 w-4 text-muted-foreground hover:text-ink" />
            </button>
          </div>
          
          {groupId && (
            <div className="space-y-4">
              <div className="border-t border-border pt-4">
                <h3 className="text-lg font-semibold text-ink mb-2">
                  Grupo {groupId}
                </h3>
                
                {historyLoading ? (
                  <div className="text-center py-8">
                    <SiteCorpLoading rows={3} />
                  </div>
                ) : historyData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay historial salarial disponible para este grupo.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historyData.map((value, index) => (
                      <div key={value.id} className="rounded-lg border border-border bg-muted/50 p-4">
                        <div className="grid gap-3 md:grid-cols-4 items-start">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-ink">
                              {value.amount.toLocaleString("es-CU", { minimumFractionDigits: 2 })} {value.currency_code}
                            </p>
                            <p className="text-xs text-muted-foreground">Salario</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">
                              {value.effective_from}
                            </p>
                            <p className="text-xs text-muted-foreground">Vigente desde</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">
                              {value.effective_to || "Sin fecha de fin"}
                            </p>
                            <p className="text-xs text-muted-foreground">Vigente hasta</p>
                          </div>
                          <div className="space-y-1">
                            <p className={`text-sm font-medium ${getStatusClass(getStatus(value))}`}>
                              {getStatus(value)}
                            </p>
                            <p className="text-xs text-muted-foreground">Estado</p>
                          </div>
                        </div>
                        
                        {/* Active indicator */}
                        {value.is_active && (
                                                  <div className="mt-2 flex items-center gap-2">
                                                    <SiteCorpStatusBadge status="success">
                                                      Valor actual
                                                    </SiteCorpStatusBadge>
                                                  </div>
                                                )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const CreateEnterpriseScaleDialog = ({
  open,
  onOpenChange,
  onSubmit,
  loading,
  name,
  currency,
  effectiveFrom,
  onNameChange,
  onCurrencyChange,
  onEffectiveFromChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  loading: boolean
  name: string
  currency: string
  effectiveFrom: string
  onNameChange: (value: string) => void
  onCurrencyChange: (value: string) => void
  onEffectiveFromChange: (value: string) => void
}) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md">
        <div className="rounded-xl border border-border bg-white p-6 shadow-lg">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold text-ink">
              Configurar escala salarial empresarial
            </h2>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 hover:bg-muted/50"
              disabled={loading}
            >
              <XIcon className="h-4 w-4 text-muted-foreground hover:text-ink" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">
                Nombre de la escala
              </label>
              <SiteCorpInput
                placeholder="Ej: Escala salarial 2025"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">
                Moneda
              </label>
              <SiteCorpInput
                placeholder="Ej: CUP"
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">
                Vigente desde
              </label>
              <SiteCorpInput
                type="date"
                value={effectiveFrom}
                onChange={(e) => onEffectiveFromChange(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <SiteCorpButton
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton
                onClick={onSubmit}
                disabled={loading || !name.trim()}
              >
                {loading ? "Creando..." : "Crear escala"}
              </SiteCorpButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const XIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export default EntitySettingsSalary