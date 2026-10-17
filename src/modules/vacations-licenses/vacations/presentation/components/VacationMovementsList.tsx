import * as React from "react"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import {
  VACATION_MOVEMENT_LABELS,
  formatVacationDays,
  type VacationMovement,
} from "@/modules/vacations-licenses/vacations"
import { History } from "lucide-react"
import { cn } from "@/lib/utils"

const formatDate = (value: string) => {
  const [y, m, d] = value.split("-")
  return `${d}/${m}/${y}`
}

/**
 * Historial de movimientos (ledger) con saldo resultante reconstruido.
 * Orden determinista: el backend devuelve por (effective_date, created_at, id).
 */
const VacationMovementsList = ({ movements }: { movements: VacationMovement[] }) => {
  const rows = React.useMemo(() => {
    let running = 0
    return movements.map((movement) => {
      running = Math.round((running + movement.amount) * 10000) / 10000
      return { movement, running }
    })
  }, [movements])

  return (
    <SiteCorpCard>
      <div className="mb-4 flex items-center gap-2">
        <History className="h-5 w-5 text-sitecorp-primary" />
        <h3 className="text-base font-semibold text-ink">Historial de movimientos</h3>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <History className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-ink">Sin movimientos</p>
          <p className="text-xs text-muted-foreground">
            El saldo se construye con devengos, vacaciones y ajustes.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Descripción</th>
                <th className="px-3 py-2 text-right font-semibold">Movimiento</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo resultante</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ movement, running }) => {
                const negative = movement.amount < 0
                return (
                  <tr key={movement.id} className="border-b border-border/60">
                    <td className="px-3 py-3 text-ink">{formatDate(movement.effective_date)}</td>
                    <td className="px-3 py-3 text-ink">
                      {VACATION_MOVEMENT_LABELS[movement.movement_type]}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {movement.description || movement.reason || "—"}
                      {movement.movement_type === "ACCRUAL" &&
                        movement.calculated_amount !== null &&
                        movement.calculated_amount !== movement.amount && (
                          <span className="block text-xs">
                            Calculado {formatVacationDays(movement.calculated_amount)} · no
                            acreditado {formatVacationDays(movement.calculated_amount - movement.amount)}
                          </span>
                        )}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right font-medium",
                        negative ? "text-sitecorp-danger" : "text-sitecorp-success"
                      )}
                    >
                      {negative ? "" : "+"}
                      {formatVacationDays(movement.amount)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-ink">
                      {formatVacationDays(running)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SiteCorpCard>
  )
}

export default VacationMovementsList
