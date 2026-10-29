import * as React from "react"
import { toast } from "sonner"
import { useAuth } from "@/contexts/AuthContext"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { Badge } from "@/shared/components/ui/badge"
import { Switch } from "@/shared/components/ui/switch"
import { Label } from "@/shared/components/ui/label"
import { Textarea } from "@/shared/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table"
import {
  Layers,
  Calculator,
  ShieldCheck,
  GraduationCap,
  History,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Save,
  RotateCcw,
  PlusCircle,
  MinusCircle,
  Info,
} from "lucide-react"
import {
  loadEntityPlan,
  loadEntityPlanHistory,
  loadSiteCorpAccounts,
  updateEntityPlan,
  type EntityPlan,
  type EntityPlanHistoryRecord,
  type SiteCorpAccountEntityOption,
} from "../../application/entity-plans.service"
import {
  PLAN_COMBINATION_BADGE_VARIANTS,
  PLAN_COMBINATION_LABELS,
  calculatePlanCombination,
  diffPlanPackages,
} from "../../domain/plan.rules"

export const AdminEntityPlans: React.FC = () => {
  const { user, isPlatformSuperAdmin, hasPlatformPermission } = useAuth()
  const [canManage, setCanManage] = React.useState(isPlatformSuperAdmin)

  React.useEffect(() => {
    if (isPlatformSuperAdmin) {
      setCanManage(true)
      return
    }
    let cancelled = false
    void hasPlatformPermission("entity_plans.manage").then((allowed) => {
      if (!cancelled) setCanManage(allowed)
    })
    return () => {
      cancelled = true
    }
  }, [isPlatformSuperAdmin, hasPlatformPermission])

  const [accounts, setAccounts] = React.useState<SiteCorpAccountEntityOption[]>([])
  const [selectedEntityId, setSelectedEntityId] = React.useState<string>("")
  const [loadingAccounts, setLoadingAccounts] = React.useState(true)
  const [loadingPlan, setLoadingPlan] = React.useState(false)

  // Plan actual de la entidad seleccionada
  const [currentPlan, setCurrentPlan] = React.useState<EntityPlan | null>(null)
  const [planHistory, setPlanHistory] = React.useState<EntityPlanHistoryRecord[]>([])

  // Estado del borrador en edición
  const [draftPrenomina, setDraftPrenomina] = React.useState(false)
  const [draftTrainingSst, setDraftTrainingSst] = React.useState(false)
  const [reason, setReason] = React.useState("")

  // Diálogo de confirmación
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [filterQuery, setFilterQuery] = React.useState("")

  // 1. Cargar selector de cuentas SiteCorp (§3.2)
  const fetchAccounts = React.useCallback(async () => {
    try {
      setLoadingAccounts(true)
      const list = await loadSiteCorpAccounts()
      setAccounts(list)
      if (list.length > 0 && !selectedEntityId) {
        setSelectedEntityId(list[0].id)
      }
    } catch (err) {
      console.error("Error cargando cuentas SiteCorp:", err)
      toast.error("No se pudieron cargar las cuentas SiteCorp")
    } finally {
      setLoadingAccounts(false)
    }
  }, [selectedEntityId])

  React.useEffect(() => {
    void fetchAccounts()
  }, [fetchAccounts])

  // 2. Cargar plan e historial al seleccionar una entidad
  const fetchPlanAndHistory = React.useCallback(async (entityId: string) => {
    if (!entityId) {
      setCurrentPlan(null)
      setPlanHistory([])
      return
    }

    try {
      setLoadingPlan(true)
      const [plan, history] = await Promise.all([
        loadEntityPlan(entityId),
        loadEntityPlanHistory(entityId),
      ])

      setCurrentPlan(plan)
      setPlanHistory(history)

      if (plan) {
        setDraftPrenomina(plan.packagePrenomina)
        setDraftTrainingSst(plan.packageTrainingSst)
      } else {
        // Si aún no tiene plan asignado, predeterminamos Básico
        setDraftPrenomina(false)
        setDraftTrainingSst(false)
      }
      setReason("")
    } catch (err) {
      console.error("Error cargando plan e historial de la entidad:", err)
      toast.error("Error al obtener la configuración del plan")
    } finally {
      setLoadingPlan(false)
    }
  }, [])

  React.useEffect(() => {
    if (selectedEntityId) {
      void fetchPlanAndHistory(selectedEntityId)
    }
  }, [selectedEntityId, fetchPlanAndHistory])

  const selectedAccount = React.useMemo(
    () => accounts.find((a) => a.id === selectedEntityId) || null,
    [accounts, selectedEntityId]
  )

  const filteredAccounts = React.useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.companyClientName && a.companyClientName.toLowerCase().includes(q))
    )
  }, [accounts, filterQuery])

  // Cálculo de cambios en borrador
  const draftCombination = calculatePlanCombination(draftPrenomina, draftTrainingSst)
  const currentDiff = React.useMemo(() => {
    return diffPlanPackages(
      currentPlan
        ? {
            prenomina: currentPlan.packagePrenomina,
            trainingSst: currentPlan.packageTrainingSst,
          }
        : null,
      { prenomina: draftPrenomina, trainingSst: draftTrainingSst }
    )
  }, [currentPlan, draftPrenomina, draftTrainingSst])

  const hasChanges = currentDiff.isChanged
  const hasReduction = currentDiff.removedPackages.length > 0

  const handleOpenConfirm = () => {
    if (!hasChanges) {
      toast.info("No hay modificaciones pendientes en el plan.")
      return
    }
    setConfirmDialogOpen(true)
  }

  const handleResetDraft = () => {
    if (currentPlan) {
      setDraftPrenomina(currentPlan.packagePrenomina)
      setDraftTrainingSst(currentPlan.packageTrainingSst)
    } else {
      setDraftPrenomina(false)
      setDraftTrainingSst(false)
    }
    setReason("")
  }

  const handleSavePlan = async () => {
    if (!selectedEntityId) return

    try {
      setSaving(true)
      const updated = await updateEntityPlan({
        entityId: selectedEntityId,
        packagePrenomina: draftPrenomina,
        packageTrainingSst: draftTrainingSst,
        reason: reason.trim() || undefined,
        actingUserId: user?.id,
        actingUserEmail: user?.email,
      })

      setCurrentPlan(updated)
      setConfirmDialogOpen(false)
      setReason("")

      // Refrescar historial
      const newHistory = await loadEntityPlanHistory(selectedEntityId)
      setPlanHistory(newHistory)

      toast.success("Plan actualizado correctamente", {
        description: `La entidad ahora tiene habilitada la combinación «${PLAN_COMBINATION_LABELS[updated.planCombination]}».`,
      })
    } catch (err) {
      console.error("Error guardando plan:", err)
      toast.error("Error al guardar el plan", {
        description: err instanceof Error ? err.message : "Error inesperado",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Gestión de Planes por Entidad"
        description="Administra individualmente qué paquetes y módulos de la plataforma SiteCorp tiene habilitados cada cuenta cliente."
      />

      {/* SELECTOR DE ENTIDADES CUENTA SITECORP (§3.2) */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Seleccionar Cuenta SiteCorp
              </h2>
              <p className="text-xs text-muted-foreground">
                Solo se muestran entidades con la condición estructural de Cuenta SiteCorp.
              </p>
            </div>
            <div className="w-full sm:w-72">
              <input
                type="text"
                placeholder="Buscar por nombre, código o cliente..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-sitecorp-primary"
              />
            </div>
          </div>

          {loadingAccounts ? (
            <SiteCorpLoading rows={2} />
          ) : accounts.length === 0 ? (
            <SiteCorpAlert type="warning" title="No hay cuentas SiteCorp registradas">
              No existen entidades con la propiedad «Cuenta SiteCorp» activa. Puedes habilitarla
              desde la administración de Organizaciones.
            </SiteCorpAlert>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-56 overflow-y-auto pr-1">
              {filteredAccounts.map((account) => {
                const isSelected = account.id === selectedEntityId
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setSelectedEntityId(account.id)}
                    className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? "border-sitecorp-primary bg-sitecorp-primary/5 shadow-sm ring-1 ring-sitecorp-primary"
                        : "border-border bg-card hover:border-sitecorp-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {account.name}
                      </span>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-sitecorp-primary" />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                        {account.code || "S/C"}
                      </span>
                      {account.accountCode && (
                        <span className="rounded bg-sitecorp-primary/10 px-1.5 py-0.5 font-semibold text-sitecorp-primary">
                          {account.accountCode}
                        </span>
                      )}
                      <span className="truncate text-muted-foreground">
                        • {account.companyClientName || "Cliente"}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* DETALLES DE LA ENTIDAD SELECCIONADA Y CONFIGURACIÓN DEL PLAN (§6) */}
      {selectedAccount && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* COLUMNA IZQUIERDA: RESUMEN DEL PLAN ACTUAL */}
          <div className="space-y-6 lg:col-span-1">
            <SiteCorpCard title="Plan actual de la cuenta" className="rounded-2xl">
              {loadingPlan ? (
                <SiteCorpLoading rows={3} />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Entidad seleccionada
                    </p>
                    <p className="mt-1 text-base font-bold text-ink">
                      {selectedAccount.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedAccount.companyClientName}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono">
                        ID: {selectedAccount.id.slice(0, 8)}...
                      </Badge>
                      <Badge className="bg-sitecorp-primary/10 text-sitecorp-primary text-xs hover:bg-sitecorp-primary/20">
                        Cuenta SiteCorp
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Combinación activa:</p>
                      <div className="mt-1">
                        {currentPlan ? (
                          <Badge
                            variant={
                              PLAN_COMBINATION_BADGE_VARIANTS[currentPlan.planCombination]
                            }
                            className="px-2.5 py-1 text-sm font-semibold"
                          >
                            {PLAN_COMBINATION_LABELS[currentPlan.planCombination]}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 bg-amber-50">
                            Sin plan asignado (Básico por defecto)
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-1">
                      <p>
                        <span className="font-medium text-ink">Creado:</span>{" "}
                        {currentPlan
                          ? new Date(currentPlan.createdAt).toLocaleString("es-ES")
                          : "Pendiente de alta"}
                      </p>
                      <p>
                        <span className="font-medium text-ink">Última modificación:</span>{" "}
                        {currentPlan
                          ? new Date(currentPlan.updatedAt).toLocaleString("es-ES")
                          : "Sin cambios"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </SiteCorpCard>

            {/* AVISO INFORMATIVO DE INDEPENDENCIA Y CONSERVACIÓN DE DATOS (§9, §11) */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-blue-950">
                <Info className="h-4 w-4 shrink-0 text-blue-600" />
                Garantías de la plataforma
              </div>
              <ul className="list-disc pl-4 space-y-1 text-blue-800">
                <li>
                  <strong>Independencia total:</strong> Modificar el plan de esta entidad no afecta
                  a otras entidades ni a su cliente propietario.
                </li>
                <li>
                  <strong>Conservación permanente:</strong> Al retirar un paquete, toda la
                  información histórica permanece íntegra y se recupera si se vuelve a activar.
                </li>
              </ul>
            </div>
          </div>

          {/* COLUMNA DERECHA: CONFIGURACIÓN DE LOS 3 PAQUETES (§4, §5) */}
          <div className="space-y-6 lg:col-span-2">
            <SiteCorpCard
              title="Configuración de paquetes funcionales"
              description="Selecciona los paquetes que estarán habilitados para esta cuenta."
              className="rounded-2xl"
            >
              <div className="space-y-4">
                {/* PAQUETE 1 — BÁSICO (OBLIGATORIO) */}
                <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/10 p-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-sitecorp-primary" />
                      <span className="text-sm font-bold text-ink">Paquete 1 — Básico</span>
                      <Badge variant="outline" className="bg-muted text-[11px] font-semibold">
                        Obligatorio • Siempre activo
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Módulos centrales de gestión de la entidad:
                    </p>
                    <p className="text-xs font-medium text-ink">
                      Resumen • Personas (Candidatos, Trabajadores, Reingresos) • Contratación •
                      Plantilla • Vacaciones y Licencias • Ajustes de entidad.
                    </p>
                    <p className="text-[11px] text-muted-foreground italic">
                      Este paquete es obligatorio en SiteCorp y no se puede desactivar.
                    </p>
                  </div>
                  <div className="pt-1">
                    <Switch checked={true} disabled aria-label="Paquete Básico siempre activo" />
                  </div>
                </div>

                {/* PAQUETE 2 — PRENÓMINA (OPCIONAL) */}
                <div
                  className={`flex items-start justify-between gap-4 rounded-xl border p-4 transition-colors ${
                    draftPrenomina
                      ? "border-sitecorp-primary/40 bg-sitecorp-primary/[0.02]"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Calculator className="h-4 w-4 text-sitecorp-primary" />
                      <span className="text-sm font-bold text-ink">Paquete 2 — Prenómina</span>
                      <Badge variant="secondary" className="text-[11px]">
                        Opcional
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Módulo completo de prenómina de la entidad:
                    </p>
                    <p className="text-xs font-medium text-ink">
                      Incidencias del período • Cálculo salarial • Desglose por trabajador •
                      Historiales de preliquidación.
                    </p>
                  </div>
                  <div className="pt-1">
                    <Switch
                      checked={draftPrenomina}
                      disabled={!canManage}
                      onCheckedChange={(checked) => setDraftPrenomina(checked)}
                      aria-label="Activar o desactivar Prenómina"
                    />
                  </div>
                </div>

                {/* PAQUETE 3 — CAPACITACIÓN Y SST (OPCIONAL, PAQUETE CONJUNTO) */}
                <div
                  className={`flex items-start justify-between gap-4 rounded-xl border p-4 transition-colors ${
                    draftTrainingSst
                      ? "border-sitecorp-primary/40 bg-sitecorp-primary/[0.02]"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center text-sitecorp-primary">
                        <GraduationCap className="h-4 w-4" />
                        <ShieldCheck className="h-4 w-4 -ml-1" />
                      </div>
                      <span className="text-sm font-bold text-ink">
                        Paquete 3 — Capacitación y SST
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        Opcional • Paquete conjunto
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Incluye conjuntamente los dos módulos de prevención y talento:
                    </p>
                    <p className="text-xs font-medium text-ink">
                      Capacitación general (temas, calendario y participantes) + Seguridad y Salud
                      en el Trabajo (SST, matriz de riesgos, EPP, inspecciones y accidentes).
                    </p>
                    <p className="text-[11px] text-muted-foreground italic">
                      Forman un único paquete comercial indivisible: se habilitan o deshabilitan juntos.
                    </p>
                  </div>
                  <div className="pt-1">
                    <Switch
                      checked={draftTrainingSst}
                      disabled={!canManage}
                      onCheckedChange={(checked) => setDraftTrainingSst(checked)}
                      aria-label="Activar o desactivar Capacitación y SST"
                    />
                  </div>
                </div>

                {/* AVISO DE MODO LECTURA SI NO TIENE PERMISO DE GESTIÓN */}
                {!canManage && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center gap-2">
                    <Info className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      Modo solo lectura: Tu rol cuenta con permiso de consulta de planes (<code>entity_plans.view</code>), pero requiere <code>entity_plans.manage</code> para guardar modificaciones.
                    </span>
                  </div>
                )}

                {/* RESUMEN DE LA COMBINACIÓN PROPUESTA Y BOTONES DE ACCIÓN (§6) */}
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Combinación resultante:</p>
                      <p className="text-sm font-bold text-ink">
                        {PLAN_COMBINATION_LABELS[draftCombination]}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasChanges && (
                        <SiteCorpButton
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleResetDraft}
                          disabled={saving}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Descartar cambios
                        </SiteCorpButton>
                      )}
                      <SiteCorpButton
                        type="button"
                        size="sm"
                        onClick={handleOpenConfirm}
                        disabled={!hasChanges || saving || !canManage}
                      >
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        Guardar modificaciones
                      </SiteCorpButton>
                    </div>
                  </div>

                  {hasChanges && (
                    <div className="border-t border-border pt-2 text-xs flex flex-wrap gap-2 items-center">
                      <span className="font-semibold text-ink">Cambios a aplicar:</span>
                      {currentDiff.addedPackages.map((pkg) => (
                        <Badge
                          key={pkg}
                          className="bg-emerald-100 text-emerald-800 border-emerald-300"
                        >
                          <PlusCircle className="mr-1 h-3 w-3" /> Añade {pkg}
                        </Badge>
                      ))}
                      {currentDiff.removedPackages.map((pkg) => (
                        <Badge
                          key={pkg}
                          variant="destructive"
                          className="bg-red-100 text-red-800 border-red-300"
                        >
                          <MinusCircle className="mr-1 h-3 w-3" /> Retira {pkg}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SiteCorpCard>

            {/* HISTORIAL INDIVIDUAL DE MODIFICACIONES (§10) */}
            <SiteCorpCard
              title="Historial de modificaciones del plan"
              description="Registro permanente e inalterable de cambios en los paquetes de esta cuenta."
              className="rounded-2xl"
            >
              {planHistory.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  <History className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                  No existen registros de cambios para esta entidad.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Operación</TableHead>
                        <TableHead>Fecha y hora</TableHead>
                        <TableHead>Responsable</TableHead>
                        <TableHead>Transición</TableHead>
                        <TableHead>Motivo / Observaciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planHistory.map((item) => {
                        const isReduccion = item.operationType === "REDUCCION"
                        const isCreacion = item.operationType === "CREACION"
                        return (
                          <TableRow key={item.id} className="text-xs">
                            <TableCell>
                              <Badge
                                variant={
                                  isCreacion
                                    ? "default"
                                    : isReduccion
                                      ? "destructive"
                                      : "outline"
                                }
                                className={
                                  isCreacion
                                    ? "bg-blue-100 text-blue-800 border-blue-300"
                                    : isReduccion
                                      ? "bg-red-100 text-red-800 border-red-300"
                                      : "bg-emerald-100 text-emerald-800 border-emerald-300"
                                }
                              >
                                {item.operationType}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground whitespace-nowrap">
                              {new Date(item.createdAt).toLocaleString("es-ES")}
                            </TableCell>
                            <TableCell className="font-medium text-ink">
                              {item.changedByEmail || item.changedBy || "Sistema"}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                <div className="font-semibold text-ink">
                                  {item.previousCombination
                                    ? `${PLAN_COMBINATION_LABELS[item.previousCombination]} → `
                                    : ""}
                                  {PLAN_COMBINATION_LABELS[item.newCombination]}
                                </div>
                                <div className="flex flex-wrap gap-1 text-[10px]">
                                  {item.addedPackages.map((p) => (
                                    <span key={p} className="text-emerald-700 font-medium">
                                      +{p}
                                    </span>
                                  ))}
                                  {item.removedPackages.map((p) => (
                                    <span key={p} className="text-red-700 font-medium">
                                      -{p}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground italic max-w-xs truncate">
                              {item.reason || "—"}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SiteCorpCard>
          </div>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMACIÓN DE CAMBIOS EN PLAN (§6, §9.2) */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-ink">
              {hasReduction ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Confirmar reducción de paquetes
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-sitecorp-primary" />
                  Confirmar ampliación del plan
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs pt-1">
              Estás a punto de modificar el plan para la entidad{" "}
              <strong>«{selectedAccount?.name}»</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            {hasReduction && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Consecuencias de la reducción:
                </p>
                <p>
                  Los módulos asociados a{" "}
                  <strong>{currentDiff.removedPackages.join(" y ")}</strong> dejarán de estar
                  visibles en el menú y su acceso por URL quedará bloqueado para los usuarios de la
                  entidad.
                </p>
                <p className="text-[11px] font-medium text-amber-800">
                  ✓ Todos los registros y datos históricos se conservan íntegros en la base de
                  datos y se recuperarán si el paquete se reactiva.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="plan-reason" className="text-xs font-medium text-ink">
                Motivo u observación del cambio (opcional)
              </Label>
              <Textarea
                id="plan-reason"
                placeholder="Ej. Solicitud comercial de ajuste de paquetes contratados..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <SiteCorpButton
              type="button"
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </SiteCorpButton>
            <SiteCorpButton
              type="button"
              onClick={handleSavePlan}
              disabled={saving}
              variant={hasReduction ? "destructive" : "default"}
            >
              {saving ? "Guardando..." : "Confirmar y aplicar cambios"}
            </SiteCorpButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AdminEntityPlans
