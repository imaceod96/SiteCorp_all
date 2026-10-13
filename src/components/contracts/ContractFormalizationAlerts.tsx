import * as React from "react"
import { Link } from "react-router-dom"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { AlertTriangle, Settings2, Info } from "lucide-react"
import {
  fetchContractFormalizationPending,
  type ContractFormalizationPending,
} from "@/domains/contracts"

interface ContractFormalizationAlertsProps {
  entityId: string
  positionId: string | null
  signatureDate: string | null
  signaturePlace: string | null
  paymentMethodId: string | null
  representativeAssignmentId: string | null
  canManage?: boolean
  className?: string
  /** Notifica al contenedor el checklist vigente (para bloquear la confirmación) */
  onPendingChange?: (pending: ContractFormalizationPending | null) => void
}

/**
 * Fase 11A.5 — Checklist de formalización calculado por el backend.
 *
 * Enumera EXACTAMENTE lo que falta (nunca un genérico «datos incompletos») y
 * separa lo que impide formalizar de lo que sólo conviene completar.
 */
export const ContractFormalizationAlerts: React.FC<ContractFormalizationAlertsProps> = ({
  entityId,
  positionId,
  signatureDate,
  signaturePlace,
  paymentMethodId,
  representativeAssignmentId,
  canManage = false,
  className,
  onPendingChange,
}) => {
  const [pending, setPending] = React.useState<ContractFormalizationPending | null>(null)

  React.useEffect(() => {
    if (!entityId) return
    let cancelled = false

    const load = async () => {
      try {
        const result = await fetchContractFormalizationPending({
          entityId,
          positionId,
          signatureDate,
          signaturePlace,
          paymentMethodId,
          representativeAssignmentId,
        })
        if (!cancelled) {
          setPending(result)
          onPendingChange?.(result)
        }
      } catch (err) {
        console.error("Error loading contract formalization checklist:", err)
        if (!cancelled) {
          setPending(null)
          onPendingChange?.(null)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // onPendingChange se omite a propósito: los contenedores pasan una función estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entityId,
    positionId,
    signatureDate,
    signaturePlace,
    paymentMethodId,
    representativeAssignmentId,
  ])

  if (!pending || (pending.blocking.length === 0 && pending.warnings.length === 0)) return null

  const entityDataMissing = pending.blocking.some((item) =>
    [
      "Organismo al que pertenece",
      "Rama",
      "Código de identificación laboral/organizacional",
      "Dirección",
      "Provincia",
      "Municipio",
    ].includes(item)
  )

  return (
    <div className={className}>
      {pending.blocking.length > 0 && (
        <SiteCorpAlert type="danger">
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              No se puede completar la formalización del contrato.
            </p>
            <p className="text-sm">Datos pendientes:</p>
            <ul className="list-inside list-disc text-sm">
              {pending.blocking.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {entityDataMissing && canManage && (
              <Link
                to={`/entity/${entityId}/settings/contract-data`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sitecorp-primary underline-offset-2 hover:underline"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Completar datos contractuales
              </Link>
            )}
          </div>
        </SiteCorpAlert>
      )}

      {pending.warnings.length > 0 && (
        <SiteCorpAlert type="warning" className={pending.blocking.length > 0 ? "mt-3" : undefined}>
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              <Info className="h-4 w-4 shrink-0" />
              Conviene completar antes de formalizar:
            </p>
            <ul className="list-inside list-disc text-sm">
              {pending.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </SiteCorpAlert>
      )}
    </div>
  )
}

export default ContractFormalizationAlerts
