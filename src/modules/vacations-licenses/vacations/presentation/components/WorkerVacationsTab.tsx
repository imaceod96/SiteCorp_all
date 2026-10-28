import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpLoading } from "@/shared/components/ui/sitecorp-loading"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import VacationBalanceCard from "./VacationBalanceCard"
import VacationPeriodsList from "./VacationPeriodsList"
import VacationMovementsList from "./VacationMovementsList"
import RegisterVacationDialog from "./RegisterVacationDialog"
import { invalidateVacationData, useWorkerVacation } from "../hooks/use-vacations"
import { useSc404Generation } from "@/modules/access-control/presentation/hooks/use-sc404"
import { cancelWorkerVacation, type VacationPeriod } from "@/modules/vacations-licenses/vacations"
import { CalendarPlus } from "lucide-react"

/** Contrato (asignación) con su etiqueta visible, para seleccionar el contrato. */
export interface VacationContractOption {
  assignmentId: string
  label: string
}

interface WorkerVacationsTabProps {
  workerId: string
  entityId: string
  workerName: string
  canManage: boolean
  /**
   * Contratos VIGENTES del trabajador. Con dos contratos (pluriempleo) el saldo, las
   * solicitudes y los movimientos son independientes y hay que seleccionar el contrato.
   */
  contracts?: VacationContractOption[]
}

/** Pestaña «Vacaciones» dentro de la ficha del trabajador (Fase 18). */
const WorkerVacationsTab = ({
  workerId,
  entityId,
  workerName,
  canManage,
  contracts,
}: WorkerVacationsTabProps) => {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const { generate: generateSc404, generatingId: generatingSc404Id } = useSc404Generation()

  // Pluriempleo: cada contrato tiene sus propias vacaciones. Con uno solo no se muestra
  // ningún selector y el comportamiento es el de siempre.
  const contractOptions = contracts ?? []
  const isPluriempleo = contractOptions.length > 1
  const [assignmentId, setAssignmentId] = React.useState<string | null>(
    contractOptions[0]?.assignmentId ?? null
  )

  React.useEffect(() => {
    setAssignmentId((current) => {
      if (current && contractOptions.some((option) => option.assignmentId === current)) {
        return current
      }
      return contractOptions[0]?.assignmentId ?? null
    })
  }, [contractOptions])

  const query = useWorkerVacation(workerId, assignmentId, true)
  const data = query.data
  const activeContractLabel =
    contractOptions.find((option) => option.assignmentId === assignmentId)?.label ?? null

  // El diálogo de registro es el MISMO: se le entrega el trabajador con su contrato ya
  // resuelto, de modo que la solicitud queda identificada con el contrato seleccionado.
  const workerOptions = React.useMemo(
    () => [
      {
        key: `${workerId}:${assignmentId ?? ""}`,
        id: workerId,
        full_name: activeContractLabel ? `${workerName} · ${activeContractLabel}` : workerName,
        balance: data?.summary.balance ?? 0,
        assignmentId,
      },
    ],
    [workerId, assignmentId, workerName, activeContractLabel, data]
  )

  const handleCancel = async (period: VacationPeriod) => {
    if (!confirm("¿Cancelar este período de vacaciones? El consumo se revertirá al saldo.")) return
    setActionError(null)
    try {
      await cancelWorkerVacation(period.id, "Cancelado desde la ficha del trabajador")
      invalidateVacationData(queryClient)
      await query.refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo cancelar el período.")
    }
  }

  if (query.isLoading) {
    return (
      <SiteCorpCard>
        <SiteCorpLoading rows={5} />
      </SiteCorpCard>
    )
  }

  if (query.isError || !data) {
    return (
      <SiteCorpAlert type="danger" title="Error">
        {(query.error as Error)?.message || "No se pudo cargar la información de vacaciones."}
      </SiteCorpAlert>
    )
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <SiteCorpAlert type="danger" title="No se pudo completar la acción">
          {actionError}
        </SiteCorpAlert>
      )}

      {/* Pluriempleo: selección del contrato cuyas vacaciones se consultan */}
      {isPluriempleo && (
        <SiteCorpCard>
          <div className="space-y-3 p-6">
            <h3 className="text-base font-semibold text-ink">Contrato</h3>
            <p className="text-sm text-muted-foreground">
              Las vacaciones son independientes por contrato: selecciona el contrato cuyo saldo,
              solicitudes y movimientos quieres consultar.
            </p>
            <div className="flex flex-wrap gap-2">
              {contractOptions.map((option) => {
                const isSelected = option.assignmentId === assignmentId
                return (
                  <button
                    key={option.assignmentId}
                    type="button"
                    onClick={() => setAssignmentId(option.assignmentId)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "border-sitecorp-primary bg-sitecorp-primary/5 font-medium text-ink"
                        : "border-border text-ink hover:bg-muted/40"
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        </SiteCorpCard>
      )}

      <VacationBalanceCard summary={data.summary} />

      {canManage && (
        <div className="flex justify-end">
          <SiteCorpButton type="button" onClick={() => setDialogOpen(true)}>
            <CalendarPlus className="mr-2 h-4 w-4" /> Registrar vacaciones
          </SiteCorpButton>
        </div>
      )}

      <VacationPeriodsList
        periods={data.periods}
        canManage={canManage}
        onCancel={handleCancel}
        onGenerateSc404={canManage ? (period) => generateSc404("VACATION", period.id) : undefined}
        generatingSc404Id={generatingSc404Id}
      />

      <VacationMovementsList movements={data.movements} />

      <RegisterVacationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityId={entityId}
        workers={workerOptions}
        preselectedWorkerId={workerOptions[0]?.key ?? workerId}
        preselectedWorkerName={workerOptions[0]?.full_name ?? workerName}
        preselectedBalance={data.summary.balance}
        preselectedAssignmentId={assignmentId}
        onSuccess={() => query.refetch()}
      />
    </div>
  )
}

export default WorkerVacationsTab
