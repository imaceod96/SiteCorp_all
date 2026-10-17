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

interface WorkerVacationsTabProps {
  workerId: string
  entityId: string
  workerName: string
  canManage: boolean
}

/** Pestaña «Vacaciones» dentro de la ficha del trabajador (Fase 18). */
const WorkerVacationsTab = ({ workerId, entityId, workerName, canManage }: WorkerVacationsTabProps) => {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const { generate: generateSc404, generatingId: generatingSc404Id } = useSc404Generation()

  const query = useWorkerVacation(workerId, true)
  const data = query.data

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
        workers={[{ id: workerId, full_name: workerName, balance: data.summary.balance }]}
        preselectedWorkerId={workerId}
        preselectedWorkerName={workerName}
        preselectedBalance={data.summary.balance}
        onSuccess={() => query.refetch()}
      />
    </div>
  )
}

export default WorkerVacationsTab
