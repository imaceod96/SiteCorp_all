import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpStatusBadge } from "@/shared/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/shared/components/ui/sitecorp-select"
import { SelectItem } from "@/shared/components/ui/select"
import { Label } from "@/shared/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import {
  SST_EPP_DELIVERY_STATUS_LABELS,
  SST_INSPECTION_STATUS_LABELS,
  type EntityAreaOption,
  type EntityJobOption,
  type EntitySstState,
  type EntityWorkerSstOption,
  type SstInspection,
  type SstInspectionStatus,
} from "../../domain/entities"
import {
  addSstInspectionFinding,
  assignSstJobEppRequirement,
  createSstEppCatalogItem,
  createSstInspection,
  registerWorkerEppDelivery,
} from "../../application/sst.service"
import { useToast } from "@/shared/hooks/use-toast"
import { HardHat, SearchCheck, Plus, CheckCircle2, AlertTriangle } from "lucide-react"

interface SstEppAndInspectionsSectionProps {
  entityId: string
  state: EntitySstState
  areas: EntityAreaOption[]
  jobs: EntityJobOption[]
  workers: EntityWorkerSstOption[]
  canManage: boolean
  onRefresh: () => Promise<void>
}

export const SstEppAndInspectionsSection: React.FC<SstEppAndInspectionsSectionProps> = ({
  entityId,
  state,
  areas,
  jobs,
  workers,
  canManage,
  onRefresh,
}) => {
  const { toast } = useToast()

  // Diálogo: Catálogo de EPP
  const [catalogDialogOpen, setCatalogDialogOpen] = React.useState(false)
  const [eppName, setEppName] = React.useState("")
  const [eppCategory, setEppCategory] = React.useState("CABEZA_Y_ROSTRO")
  const [eppLifespan, setEppLifespan] = React.useState("180")
  const [eppStock, setEppStock] = React.useState("10")
  const [eppMinStock, setEppMinStock] = React.useState("3")

  // Diálogo: Asignar EPP requerido a un cargo
  const [jobReqDialogOpen, setJobReqDialogOpen] = React.useState(false)
  const [reqJobId, setReqJobId] = React.useState("")
  const [reqEppId, setReqEppId] = React.useState("")
  const [reqRenewalMonths, setReqRenewalMonths] = React.useState("6")
  const [reqMandatory, setReqMandatory] = React.useState(true)

  // Diálogo: Registrar entrega individual de EPP a trabajador
  const [deliveryDialogOpen, setDeliveryDialogOpen] = React.useState(false)
  const [delWorkerId, setDelWorkerId] = React.useState("")
  const [delEppId, setDelEppId] = React.useState("")
  const [delCustomName, setDelCustomName] = React.useState("")
  const [delQuantity, setDelQuantity] = React.useState("1")
  const [delDate, setDelDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [delRenewalDate, setDelRenewalDate] = React.useState(
    () => new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)
  )
  const [delSigned, setDelSigned] = React.useState(true)
  const [delNotes, setDelNotes] = React.useState("")

  // Diálogo: Nueva inspección de seguridad
  const [inspDialogOpen, setInspDialogOpen] = React.useState(false)
  const [inspAreaId, setInspAreaId] = React.useState("")
  const [inspFacility, setInspFacility] = React.useState("")
  const [inspType, setInspType] = React.useState("ORDINARIA")
  const [inspInspector, setInspInspector] = React.useState("")
  const [inspDate, setInspDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [inspStatus, setInspStatus] = React.useState<SstInspectionStatus>("ABIERTA")
  const [inspNotes, setInspNotes] = React.useState("")

  // Diálogo: Registrar hallazgo de inspección
  const [activeInspection, setActiveInspection] = React.useState<SstInspection | null>(null)
  const [findingItem, setFindingItem] = React.useState("")
  const [findingConforms, setFindingConforms] = React.useState(false)
  const [findingDesc, setFindingDesc] = React.useState("")
  const [findingSeverity, setFindingSeverity] = React.useState<
    "LEVE" | "MODERADO" | "GRAVE" | "CRITICO"
  >("MODERADO")
  const [findingCreateAction, setFindingCreateAction] = React.useState(true)
  const [findingActionDue, setFindingActionDue] = React.useState(
    () => new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  )

  const jobMap = React.useMemo(() => new Map(jobs.map((j) => [j.id, j.name])), [jobs])
  const areaMap = React.useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas])
  const workerMap = React.useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const eppMap = React.useMemo(
    () => new Map(state.eppCatalog.map((e) => [e.id, e])),
    [state.eppCatalog]
  )

  const handleCreateCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createSstEppCatalogItem({
        entityId,
        name: eppName,
        category: eppCategory,
        defaultLifespanDays: Number(eppLifespan) || 180,
        stockQuantity: Number(eppStock) || 0,
        minStockAlert: Number(eppMinStock) || 3,
      })
      setCatalogDialogOpen(false)
      setEppName("")
      await onRefresh()
      toast({
        title: "EPP registrado en catálogo",
        description: "El equipo ya puede asignarse a cargos y entregarse a trabajadores.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al crear EPP",
        description: err instanceof Error ? err.message : "No se pudo guardar el EPP.",
      })
    }
  }

  const handleAssignJobEpp = async (e: React.FormEvent) => {
    e.preventDefault()
    const epp = eppMap.get(reqEppId)
    if (!reqJobId || !epp) return
    try {
      await assignSstJobEppRequirement({
        entityId,
        jobId: reqJobId,
        jobName: jobMap.get(reqJobId) || null,
        eppId: epp.id,
        eppName: epp.name,
        isMandatory: reqMandatory,
        renewalMonths: Number(reqRenewalMonths) || 6,
      })
      setJobReqDialogOpen(false)
      await onRefresh()
      toast({
        title: "EPP requerido por cargo asignado",
        description: `Se vinculó «${epp.name}» al cargo seleccionado.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al asignar EPP al cargo",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  const handleRegisterDelivery = async (e: React.FormEvent) => {
    e.preventDefault()
    const worker = workerMap.get(delWorkerId)
    if (!worker) return
    const catalogEpp = delEppId && delEppId !== "__custom__" ? eppMap.get(delEppId) : null
    const resolvedName = catalogEpp?.name || delCustomName
    try {
      await registerWorkerEppDelivery({
        entityId,
        workerId: worker.id,
        workerName: worker.fullName,
        jobId: worker.jobId,
        jobName: worker.jobName,
        eppId: catalogEpp?.id || null,
        eppName: resolvedName,
        quantity: Number(delQuantity) || 1,
        deliveryDate: delDate,
        renewalDueDate: delRenewalDate || null,
        signedReceipt: delSigned,
        notes: delNotes,
      })
      setDeliveryDialogOpen(false)
      setDelCustomName("")
      setDelNotes("")
      await onRefresh()
      toast({
        title: "Entrega de EPP registrada",
        description: `Se registró la entrega nominal para ${worker.fullName} y se actualizó su ficha.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al registrar entrega",
        description: err instanceof Error ? err.message : "No se pudo registrar la entrega.",
      })
    }
  }

  const handleCreateInspection = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createSstInspection({
        entityId,
        areaId: inspAreaId || null,
        areaName: inspAreaId ? areaMap.get(inspAreaId) || null : null,
        facilityName: inspFacility || null,
        inspectionType: inspType,
        inspectorName: inspInspector,
        scheduledDate: inspDate,
        executedDate: inspStatus !== "PROGRAMADA" ? inspDate : null,
        status: inspStatus,
        summaryNotes: inspNotes,
      })
      setInspDialogOpen(false)
      setInspFacility("")
      setInspNotes("")
      await onRefresh()
      toast({
        title: "Inspección de seguridad registrada",
        description: "Puedes añadir hallazgos y medidas correctivas a la inspección.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al registrar inspección",
        description: err instanceof Error ? err.message : "Error inesperado.",
      })
    }
  }

  const handleAddFinding = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeInspection) return
    try {
      await addSstInspectionFinding({
        entityId,
        inspectionId: activeInspection.id,
        itemChecked: findingItem,
        conforms: findingConforms,
        findingDescription: findingDesc,
        severity: findingSeverity,
        createCorrectiveAction: !findingConforms && findingCreateAction,
        correctiveActionDueDate: findingActionDue,
        areaId: activeInspection.area_id,
        areaName: activeInspection.area_name_snapshot,
      })
      setFindingItem("")
      setFindingDesc("")
      await onRefresh()
      toast({
        title: "Hallazgo registrado",
        description:
          !findingConforms && findingCreateAction
            ? "Se registró el hallazgo y se creó automáticamente su medida correctiva en el Plan de Prevención."
            : "El punto verificado quedó registrado en la inspección.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al guardar hallazgo",
        description: err instanceof Error ? err.message : "No se pudo guardar.",
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* EQUIPOS DE PROTECCIÓN PERSONAL (EPP) */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <HardHat className="h-5 w-5 text-sitecorp-primary" />
                <h2 className="text-lg font-semibold text-ink">
                  Equipos de Protección Personal (EPP) — Catálogo, Cargos y Entregas
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Control de EPP obligatorios por cargo, entregas nominales a trabajadores, fechas de
                reposición y existencias de esta entidad.
              </p>
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <SiteCorpButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCatalogDialogOpen(true)}
                >
                  + Catálogo EPP
                </SiteCorpButton>
                {state.eppCatalog.length > 0 && (
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setJobReqDialogOpen(true)}
                  >
                    + Asignar EPP a Cargo
                  </SiteCorpButton>
                )}
                <SiteCorpButton
                  type="button"
                  size="sm"
                  onClick={() => setDeliveryDialogOpen(true)}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Registrar entrega a trabajador
                </SiteCorpButton>
              </div>
            )}
          </div>

          {/* Resumen de Catálogo y Requisitos por Cargo */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-ink">
                Catálogo de EPP de la entidad ({state.eppCatalog.length})
              </h3>
              {state.eppCatalog.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Añade equipos al catálogo (cascos, botas dieléctricas, guantes, gafas, arneses)
                  para vincularlos a los cargos.
                </p>
              ) : (
                <div className="space-y-2">
                  {state.eppCatalog.map((item) => {
                    const lowStock = item.stock_quantity <= item.min_stock_alert
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs"
                      >
                        <div>
                          <p className="font-semibold text-ink">{item.name}</p>
                          <p className="text-muted-foreground">
                            Vida útil ref.: {item.default_lifespan_days} días
                          </p>
                        </div>
                        <SiteCorpStatusBadge status={lowStock ? "warning" : "success"}>
                          Stock: {item.stock_quantity} u.
                        </SiteCorpStatusBadge>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-ink">
                EPP obligatorios por Cargo ({state.jobEppRequirements.length})
              </h3>
              {state.jobEppRequirements.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Define qué EPP exige cada cargo de la entidad para controlar entregas pendientes.
                </p>
              ) : (
                <div className="space-y-2">
                  {state.jobEppRequirements.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-ink">{req.epp_name_snapshot}</p>
                        <p className="text-muted-foreground">
                          Cargo: {jobMap.get(req.job_id) || req.job_name_snapshot || "—"}
                        </p>
                      </div>
                      <SiteCorpStatusBadge status={req.is_mandatory ? "info" : "neutral"}>
                        Cada {req.renewal_months} mes(es)
                      </SiteCorpStatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabla de Entregas Individuales de EPP a Trabajadores */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">
              Historial de entregas nominales a trabajadores ({state.workerEppDeliveries.length})
            </h3>
            {state.workerEppDeliveries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                Sin entregas de EPP registradas todavía en esta entidad.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Trabajador</th>
                      <th className="px-4 py-3">Cargo</th>
                      <th className="px-4 py-3">Equipo entregado</th>
                      <th className="px-4 py-3">Entrega / Reposición</th>
                      <th className="px-4 py-3">Constancia</th>
                      <th className="px-4 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {state.workerEppDeliveries.map((del) => {
                      const today = new Date().toISOString().slice(0, 10)
                      const needsRenewal =
                        del.renewal_due_date && del.renewal_due_date <= today
                      return (
                        <tr key={del.id} className="hover:bg-muted/20">
                          <td className="px-4 py-3 font-medium text-ink">
                            {del.worker_name_snapshot}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {del.job_name_snapshot || "—"}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-ink">
                            {del.epp_name_snapshot} (×{del.quantity})
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums">
                            <p className="text-ink">Entregado: {del.delivery_date}</p>
                            {del.renewal_due_date && (
                              <p
                                className={
                                  needsRenewal
                                    ? "font-semibold text-sitecorp-danger"
                                    : "text-muted-foreground"
                                }
                              >
                                Reposición: {del.renewal_due_date}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {del.signed_receipt ? (
                              <span className="inline-flex items-center gap-1 text-sitecorp-success">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Firmada
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Pendiente firma</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <SiteCorpStatusBadge
                              status={needsRenewal ? "warning" : "success"}
                            >
                              {needsRenewal
                                ? "Reposición vencida"
                                : SST_EPP_DELIVERY_STATUS_LABELS[del.status]}
                            </SiteCorpStatusBadge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </SiteCorpCard>

      {/* INSPECCIONES DE SEGURIDAD */}
      <SiteCorpCard className="rounded-2xl">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <SearchCheck className="h-5 w-5 text-sitecorp-primary" />
                <h2 className="text-lg font-semibold text-ink">Inspecciones de Seguridad</h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Listas de chequeo por área o instalación, registro de hallazgos no conformes y
                generación directa de medidas correctivas.
              </p>
            </div>

            {canManage && (
              <SiteCorpButton type="button" onClick={() => setInspDialogOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Registrar inspección
              </SiteCorpButton>
            )}
          </div>

          {state.inspections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              No hay inspecciones de seguridad registradas en esta entidad.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {state.inspections.map((insp) => {
                const findings = state.inspectionFindings.filter(
                  (f) => f.inspection_id === insp.id
                )
                const nonConformingCount = findings.filter((f) => !f.conforms).length
                return (
                  <div
                    key={insp.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-white p-4 shadow-xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-ink tabular-nums">
                          {insp.scheduled_date} • {insp.inspection_type}
                        </span>
                        <SiteCorpStatusBadge
                          status={insp.status === "CERRADA" ? "success" : "info"}
                        >
                          {SST_INSPECTION_STATUS_LABELS[insp.status]}
                        </SiteCorpStatusBadge>
                      </div>
                      <p className="text-sm font-semibold text-ink">
                        Área: {insp.area_name_snapshot || insp.facility_name || "General"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Inspector: {insp.inspector_name}
                      </p>
                      {insp.summary_notes && (
                        <p className="text-xs text-muted-foreground">{insp.summary_notes}</p>
                      )}

                      {findings.length > 0 && (
                        <div className="space-y-1 border-t border-border pt-2">
                          <p className="text-xs font-semibold text-ink">
                            Puntos verificados ({findings.length}) —{" "}
                            <span className="text-sitecorp-danger">
                              {nonConformingCount} no conforme(s)
                            </span>
                          </p>
                          {findings.map((f) => (
                            <div
                              key={f.id}
                              className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-xs"
                            >
                              <span className="truncate">{f.item_checked}</span>
                              {f.conforms ? (
                                <span className="text-sitecorp-success">Conforme</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-medium text-sitecorp-danger">
                                  <AlertTriangle className="h-3 w-3" /> {f.severity}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {canManage && (
                      <div className="flex justify-end border-t border-border pt-2">
                        <SiteCorpButton
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setActiveInspection(insp)}
                        >
                          + Añadir hallazgo / verificación
                        </SiteCorpButton>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SiteCorpCard>

      {/* DIÁLOGO: Nuevo EPP en catálogo */}
      <Dialog open={catalogDialogOpen} onOpenChange={setCatalogDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Añadir equipo al catálogo de EPP</DialogTitle>
            <DialogDescription>
              Define el equipo de protección personal para la entidad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCatalogItem} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre del EPP *</Label>
              <SiteCorpInput
                value={eppName}
                onChange={(e) => setEppName(e.target.value)}
                placeholder="Ej. Casco dieléctrico clase E, Botas de seguridad..."
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Vida útil (días)</Label>
                <SiteCorpInput
                  type="number"
                  value={eppLifespan}
                  onChange={(e) => setEppLifespan(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Stock actual</Label>
                <SiteCorpInput
                  type="number"
                  value={eppStock}
                  onChange={(e) => setEppStock(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Alerta stock mín.</Label>
                <SiteCorpInput
                  type="number"
                  value={eppMinStock}
                  onChange={(e) => setEppMinStock(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setCatalogDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit">Guardar en catálogo</SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Asignar EPP a Cargo */}
      <Dialog open={jobReqDialogOpen} onOpenChange={setJobReqDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Asignar EPP obligatorio por cargo</DialogTitle>
            <DialogDescription>
              Vincula un equipo del catálogo a un cargo existente de la entidad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssignJobEpp} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Cargo de la entidad</Label>
              <SiteCorpSelect
                value={reqJobId || "__none__"}
                onValueChange={(v) => setReqJobId(v === "__none__" ? "" : v)}
              >
                <SelectItem value="__none__">Seleccionar cargo...</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Equipo de protección (EPP)</Label>
              <SiteCorpSelect
                value={reqEppId || "__none__"}
                onValueChange={(v) => setReqEppId(v === "__none__" ? "" : v)}
              >
                <SelectItem value="__none__">Seleccionar EPP...</SelectItem>
                {state.eppCatalog.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Frecuencia de reposición (meses)</Label>
              <SiteCorpInput
                type="number"
                value={reqRenewalMonths}
                onChange={(e) => setReqRenewalMonths(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setJobReqDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={!reqJobId || !reqEppId}>
                Vincular al cargo
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Registrar entrega nominal de EPP a trabajador */}
      <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar entrega de EPP a trabajador</DialogTitle>
            <DialogDescription>
              La entrega quedará registrada en el historial de SST de la entidad y en el bloque SST
              de la ficha del trabajador.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterDelivery} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Trabajador *</Label>
              <SiteCorpSelect
                value={delWorkerId || "__none__"}
                onValueChange={(v) => setDelWorkerId(v === "__none__" ? "" : v)}
              >
                <SelectItem value="__none__">Seleccionar trabajador...</SelectItem>
                {workers
                  .filter((w) => w.employmentStatus === "active")
                  .map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.fullName} ({w.jobName || "Sin cargo"})
                    </SelectItem>
                  ))}
              </SiteCorpSelect>
            </div>

            <div className="space-y-1.5">
              <Label>Equipo de protección (EPP)</Label>
              <SiteCorpSelect value={delEppId} onValueChange={setDelEppId}>
                <SelectItem value="__custom__">Especificar nombre de EPP manualmente</SelectItem>
                {state.eppCatalog.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SiteCorpSelect>
            </div>

            {(!delEppId || delEppId === "__custom__") && (
              <div className="space-y-1.5">
                <Label>Nombre del EPP entregado *</Label>
                <SiteCorpInput
                  value={delCustomName}
                  onChange={(e) => setDelCustomName(e.target.value)}
                  placeholder="Ej. Guantes dieléctricos y casco de seguridad"
                  required
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Cantidad</Label>
                <SiteCorpInput
                  type="number"
                  value={delQuantity}
                  onChange={(e) => setDelQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de entrega</Label>
                <SiteCorpInput
                  type="date"
                  value={delDate}
                  onChange={(e) => setDelDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Próxima reposición</Label>
                <SiteCorpInput
                  type="date"
                  value={delRenewalDate}
                  onChange={(e) => setDelRenewalDate(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={delSigned}
                onChange={(e) => setDelSigned(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Confirmación de recibido firmada por el trabajador
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setDeliveryDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit" disabled={!delWorkerId}>
                Registrar entrega
              </SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Nueva inspección */}
      <Dialog open={inspDialogOpen} onOpenChange={setInspDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Registrar inspección de seguridad</DialogTitle>
            <DialogDescription>
              Programa o registra una inspección ejecutada en un área o instalación de la entidad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateInspection} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Área inspeccionada</Label>
                <SiteCorpSelect
                  value={inspAreaId || "__none__"}
                  onValueChange={(v) => setInspAreaId(v === "__none__" ? "" : v)}
                >
                  <SelectItem value="__none__">General / Instalación</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SiteCorpSelect>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo de inspección</Label>
                <SiteCorpSelect value={inspType} onValueChange={setInspType}>
                  <SelectItem value="ORDINARIA">Ordinaria / Periódica</SelectItem>
                  <SelectItem value="EXTRAORDINARIA">Extraordinaria</SelectItem>
                  <SelectItem value="ESPECIALIZADA">Especializada / Equipos</SelectItem>
                </SiteCorpSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Inspector / Responsable *</Label>
              <SiteCorpInput
                value={inspInspector}
                onChange={(e) => setInspInspector(e.target.value)}
                placeholder="Nombre y cargo del especialista que inspecciona"
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <SiteCorpInput
                  type="date"
                  value={inspDate}
                  onChange={(e) => setInspDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <SiteCorpSelect
                  value={inspStatus}
                  onValueChange={(v) => setInspStatus(v as SstInspectionStatus)}
                >
                  <SelectItem value="PROGRAMADA">Programada</SelectItem>
                  <SelectItem value="ABIERTA">Abierta / Ejecutada</SelectItem>
                  <SelectItem value="EN_SEGUIMIENTO">En seguimiento</SelectItem>
                  <SelectItem value="CERRADA">Cerrada</SelectItem>
                </SiteCorpSelect>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setInspDialogOpen(false)}
              >
                Cancelar
              </SiteCorpButton>
              <SiteCorpButton type="submit">Guardar inspección</SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: Añadir hallazgo a inspección */}
      <Dialog
        open={Boolean(activeInspection)}
        onOpenChange={(open) => {
          if (!open) setActiveInspection(null)
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Registrar punto verificado o hallazgo</DialogTitle>
            <DialogDescription>
              Si se detecta una no conformidad, puedes generar directamente una medida correctiva en
              el Plan de Prevención.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddFinding} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Aspecto o condición verificada *</Label>
              <SiteCorpInput
                value={findingItem}
                onChange={(e) => setFindingItem(e.target.value)}
                placeholder="Ej. Extintores presurizados y pasillos de evacuación libres"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-ink">
              <input
                type="checkbox"
                checked={findingConforms}
                onChange={(e) => setFindingConforms(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Cumple / Conforme con las normas de SST
            </label>

            {!findingConforms && (
              <>
                <div className="space-y-1.5">
                  <Label>Descripción del hallazgo / no conformidad</Label>
                  <SiteCorpInput
                    value={findingDesc}
                    onChange={(e) => setFindingDesc(e.target.value)}
                    placeholder="Detalle del incumplimiento detectado..."
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Severidad</Label>
                    <SiteCorpSelect
                      value={findingSeverity}
                      onValueChange={(v) =>
                        setFindingSeverity(v as "LEVE" | "MODERADO" | "GRAVE" | "CRITICO")
                      }
                    >
                      <SelectItem value="LEVE">Leve</SelectItem>
                      <SelectItem value="MODERADO">Moderado</SelectItem>
                      <SelectItem value="GRAVE">Grave</SelectItem>
                      <SelectItem value="CRITICO">Crítico</SelectItem>
                    </SiteCorpSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Fecha límite de corrección</Label>
                    <SiteCorpInput
                      type="date"
                      value={findingActionDue}
                      onChange={(e) => setFindingActionDue(e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={findingCreateAction}
                    onChange={(e) => setFindingCreateAction(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Crear automáticamente medida correctiva en el Plan de Prevención
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <SiteCorpButton
                type="button"
                variant="outline"
                onClick={() => setActiveInspection(null)}
              >
                Cerrar
              </SiteCorpButton>
              <SiteCorpButton type="submit">Guardar verificación</SiteCorpButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
