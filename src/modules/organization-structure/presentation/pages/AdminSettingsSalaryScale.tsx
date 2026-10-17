import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useSalary, type SalaryScale } from "@/contexts/SalaryContext"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/components/ui/sitecorp-loading"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SalaryGroupDialog } from "@/modules/organization-structure/presentation/components/salary-group-dialog"
import ReviewSalaryChangeDialog from "@/modules/contracts/presentation/components/ReviewSalaryChangeDialog"
import { showSuccess } from "@/utils/toast"
import { Plus, Edit3, Clock, PlusCircle } from "lucide-react"

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

const AdminSettingsSalaryScale = () => {
  const navigate = useNavigate()
  const { fetchGlobalPresupuestadaScale, fetchScaleWithGroups, addSalaryGroup, addSalaryValue, createGlobalPresupuestadaScale, canManageGlobalSalary, fetchSalaryHistory } = useSalary()
  const [scale, setScale] = React.useState<SalaryScale | null>(null)
  const [groups, setGroups] = React.useState<SalaryGroupRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showAddGroup, setShowAddGroup] = React.useState(false)
  const [changeGroup, setChangeGroup] = React.useState<SalaryGroupRow | null>(null)
  const [showCreateScale, setShowCreateScale] = React.useState(false)
  const [newScaleName, setNewScaleName] = React.useState("Escala salarial presupuestada general")
  const [newScaleCurrency, setNewScaleCurrency] = React.useState("CUP")
  const [newScaleEffectiveFrom, setNewScaleEffectiveFrom] = React.useState(() => new Date().toISOString().split("T")[0])
  const [canManageGlobal, setCanManageGlobal] = React.useState(false)
  
  // History modal state
  const [showHistoryModal, setShowHistoryModal] = React.useState(false)
  const [historyGroupId, setHistoryGroupId] = React.useState<string | null>(null)
  const [historyData, setHistoryData] = React.useState<SalaryHistoryValue[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)

  const loadScale = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const scaleData = await fetchGlobalPresupuestadaScale()
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la escala salarial")
    } finally {
      setLoading(false)
    }
  }, [fetchGlobalPresupuestadaScale, fetchScaleWithGroups])

  const checkPermission = React.useCallback(async () => {
    const canManage = await canManageGlobalSalary()
    setCanManageGlobal(canManage)
  }, [canManageGlobalSalary])

  React.useEffect(() => {
    loadScale()
    checkPermission()
  }, [loadScale, checkPermission])

  const handleAddGroup = async (salary: string, effectiveFrom: string) => {
      if (!scale) return
      try {
        // El grupo se crea sin descripción: ese dato ya no forma parte de la UI.
        const newGroup = await addSalaryGroup(scale.id)
        if (newGroup) {
          const amount = parseFloat(salary)
          if (!isNaN(amount) && amount > 0) {
            // Valor inicial del grupo: se registra con la misma función atómica
            await addSalaryValue(newGroup.id, amount, "CUP", effectiveFrom)
          }
          setShowAddGroup(false)
          await loadScale()
          showSuccess("Grupo salarial añadido correctamente.")
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al añadir grupo")
      }
    }

  // El cambio de importe de un grupo siempre pasa por la revisión de impacto
  const openSalaryChange = (group: SalaryGroupRow) => {
    setError(null)
    setChangeGroup(group)
  }

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

  const handleCreateScale = async () => {
    if (!newScaleName.trim() || !newScaleCurrency.trim() || !newScaleEffectiveFrom) return
    try {
      const newScale = await createGlobalPresupuestadaScale(newScaleName.trim(), newScaleCurrency.trim(), newScaleEffectiveFrom)
      if (newScale) {
        setShowCreateScale(false)
        setNewScaleName("Escala salarial presupuestada general")
        setNewScaleCurrency("CUP")
        setNewScaleEffectiveFrom(new Date().toISOString().split("T")[0])
        await loadScale()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la escala salarial")
    }
  }

  if (!scale) {
    return (
      <div className="space-y-6 p-6">
        <SiteCorpPageHeader title="Escala salarial presupuestada" description="Gestión de la escala salarial global de SiteCorp" />
        {loading ? (
          <SiteCorpLoading rows={5} />
        ) : error ? (
          <SiteCorpAlert type="danger" title="Error">{error}</SiteCorpAlert>
        ) : (
          <SiteCorpCard title="Sin escala salarial presupuestada">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No se ha configurado todavía la escala salarial presupuestada general.
              </p>
              {(canManageGlobal) && (
                <div className="space-y-3">
                  <SiteCorpButton onClick={() => setShowCreateScale(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Crear escala salarial
                  </SiteCorpButton>
                  {showCreateScale && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                      <h4 className="text-sm font-semibold text-ink">Crear escala salarial presupuestada global</h4>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Nombre</label>
                          <SiteCorpInput
                            placeholder="Escala salarial presupuestada general"
                            value={newScaleName}
                            onChange={(e) => setNewScaleName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Moneda</label>
                          <SiteCorpInput
                            placeholder="CUP"
                            value={newScaleCurrency}
                            onChange={(e) => setNewScaleCurrency(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Fecha de vigencia</label>
                          <SiteCorpInput
                            type="date"
                            value={newScaleEffectiveFrom}
                            onChange={(e) => setNewScaleEffectiveFrom(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <SiteCorpButton onClick={handleCreateScale}>Crear</SiteCorpButton>
                        <SiteCorpButton variant="outline" onClick={() => { setShowCreateScale(false); setNewScaleName("Escala salarial presupuestada general"); setNewScaleCurrency("CUP"); setNewScaleEffectiveFrom(new Date().toISOString().split("T")[0]) }}>Cancelar</SiteCorpButton>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {(!canManageGlobal) && (
                <p className="text-sm text-muted-foreground">
                  La escala debe ser configurada por un administrador autorizado de SiteCorp.
                </p>
              )}
            </div>
          </SiteCorpCard>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Escala salarial presupuestada"
        description="Gestión de la escala salarial global de SiteCorp"
      />

      <SiteCorpAlert type="info" title="Escala global PRESUPUESTADA">
        <>
          <p className="mb-1">Esta es la escala salarial global de SiteCorp.</p>
          <p>Es aplicable a todas las entidades de régimen PRESUPUESTADA.</p>
          <p className="mt-2">Solo los administradores de plataforma pueden gestionar esta escala.</p>
        </>
      </SiteCorpAlert>

      {loading ? (
        <SiteCorpLoading rows={5} />
      ) : error ? (
        <SiteCorpAlert type="danger" title="Error">{error}</SiteCorpAlert>
      ) : (
        <>
          <SiteCorpCard title={`Escala salarial presupuestada de ${scale.name}`} description={scale.description || "Escala salarial global de SiteCorp"}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Moneda: {scale.currency_code}</p>
                <p className="text-xs text-muted-foreground">
                  {groups.filter(g => g.is_active).length} grupo(s) activo(s)
                </p>
              </div>
              {canManageGlobal && (
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
                      {canManageGlobal && (
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

              <p className="text-xs text-muted-foreground">
                «Cambiar salario» abre la revisión de impacto: se muestran el importe vigente, el
                nuevo importe, la fecha efectiva y los trabajadores afectados antes de aplicar el
                cambio. Cada cambio conserva los importes anteriores y prepara un anexo contractual
                pendiente de generar.
              </p>
            </div>
          </SiteCorpCard>
        </>
      )}

      {/* Revisión de cambio salarial (nueva vigencia + impacto + anexos pendientes) */}
      <ReviewSalaryChangeDialog
        open={!!changeGroup}
        onOpenChange={(open) => {
          if (!open) setChangeGroup(null)
        }}
        groupId={changeGroup?.id || null}
        groupLabel={changeGroup ? `Grupo ${changeGroup.roman_numeral}` : ""}
        scaleLabel={scale?.name || ""}
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

export default AdminSettingsSalaryScale