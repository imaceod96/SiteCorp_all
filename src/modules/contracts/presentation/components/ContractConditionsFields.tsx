import * as React from "react"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { SiteCorpSelect } from "@/components/ui/sitecorp-select"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Plus, Trash2 } from "lucide-react"
import {
  COMPENSATION_COMPONENT_TYPES,
  componentAmountValue,
  componentTypeLabel,
  componentsTotal,
  hasInvalidComponent,
  newComponentDraft,
  type CompensationComponentDraft,
  type CompensationComponentType,
} from "@/modules/contracts/domain/compensation.rules"
import { formatContractMoney } from "@/modules/contracts/domain/formats"
import type { PaymentMethodOption } from "@/modules/contracts/domain/entities"
import { toRomanNumeral } from "@/utils/roman-numerals"

/* ------------------------------------------------------------------ *
 * Fase 11A.5 — Condiciones contractuales (componentes reutilizables)
 *
 *   Contrato:   ContractSignatureFields   → firma, lugar de firma, forma de pago
 *   Represent.: RepresentativeSelect      → representante vigente en la fecha de firma
 *   Retribución: ContractRetributionFields → grupo/escala (sólo lectura) + conceptos + total
 *
 * Los usan TODOS los flujos que crean un contrato: contratación desde candidato,
 * cubrir puesto, reincorporación, cambio de contrato y registro de contrato.
 * ------------------------------------------------------------------ */

export interface ContractSignatureFieldsProps {
  /** Fecha de firma (puede ser distinta de la fecha de inicio) */
  signatureDate: string
  onSignatureDateChange: (value: string) => void
  /** Lugar de firma (texto) */
  signaturePlace: string
  onSignaturePlaceChange: (value: string) => void
  /** Forma de pago (catálogo global) */
  paymentMethodId: string
  onPaymentMethodIdChange: (value: string) => void
  paymentMethods: PaymentMethodOption[]
  /**
   * Fase 11A.7 — Día / momento de pago (condición contractual distinta de la forma
   * de pago). Opcional: si no se proporciona, el campo no se muestra.
   */
  paymentSchedule?: string
  onPaymentScheduleChange?: (value: string) => void
  disabled?: boolean
  className?: string
}

export const ContractSignatureFields: React.FC<ContractSignatureFieldsProps> = ({
  signatureDate,
  onSignatureDateChange,
  signaturePlace,
  onSignaturePlaceChange,
  paymentMethodId,
  onPaymentMethodIdChange,
  paymentMethods,
  paymentSchedule,
  onPaymentScheduleChange,
  disabled = false,
  className,
}) => (
  <div className={cn("grid gap-4 sm:grid-cols-3", className)}>
    <div className="space-y-2">
      <Label htmlFor="contract-signature-date">Fecha de firma *</Label>
      <SiteCorpInput
        id="contract-signature-date"
        type="date"
        value={signatureDate}
        onChange={(e) => onSignatureDateChange(e.target.value)}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        Formalización del contrato. Puede ser anterior a la fecha de inicio.
      </p>
    </div>

    <div className="space-y-2">
      <Label htmlFor="contract-signature-place">Lugar de firma *</Label>
      <SiteCorpInput
        id="contract-signature-place"
        type="text"
        value={signaturePlace}
        onChange={(e) => onSignaturePlaceChange(e.target.value)}
        placeholder="Ej.: La Habana"
        disabled={disabled}
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="contract-payment-method">Forma de pago *</Label>
      <SiteCorpSelect
        value={paymentMethodId}
        onValueChange={onPaymentMethodIdChange}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      >
        <option value="">Seleccionar forma</option>
        {paymentMethods.map((method) => (
          <option key={method.id} value={method.id}>
            {method.name}
          </option>
        ))}
      </SiteCorpSelect>
      <p className="text-xs text-muted-foreground">Dato del contrato (catálogo global).</p>
    </div>

    {paymentSchedule !== undefined && onPaymentScheduleChange && (
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="contract-payment-schedule">Día / momento de pago</Label>
        <SiteCorpInput
          id="contract-payment-schedule"
          type="text"
          value={paymentSchedule}
          onChange={(e) => onPaymentScheduleChange(e.target.value)}
          placeholder="Ej.: Día 10 de cada mes · Quincenal · Último día hábil del mes"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Cuándo se realiza el pago. Es una condición distinta de la forma de pago y queda
          preservada en el contrato (no cambia con pagos posteriores).
        </p>
      </div>
    )}
  </div>
)

export interface ContractRetributionFieldsProps {
  /** Conceptos específicos del contrato */
  components: CompensationComponentDraft[]
  onComponentsChange: (next: CompensationComponentDraft[]) => void
  /** Salario de escala derivado (sólo lectura) */
  baseSalaryAmount: number | null
  baseSalaryCurrency?: string | null
  salaryGroupSequence?: number | null
  salaryHint?: string
  disabled?: boolean
  className?: string
}

export const ContractRetributionFields: React.FC<ContractRetributionFieldsProps> = ({
  components,
  onComponentsChange,
  baseSalaryAmount,
  baseSalaryCurrency,
  salaryGroupSequence,
  salaryHint,
  disabled = false,
  className,
}) => {
  const componentsSum = componentsTotal(components)
  const previewTotal = (baseSalaryAmount ?? 0) + componentsSum
  const invalid = hasInvalidComponent(components)

  const byType = (type: CompensationComponentType) =>
    components.filter((component) => component.component_type === type)

  const addComponent = (type: CompensationComponentType) =>
    onComponentsChange([...components, newComponentDraft(type)])

  const updateComponent = (key: string, patch: Partial<CompensationComponentDraft>) =>
    onComponentsChange(
      components.map((component) =>
        component.key === key ? { ...component, ...patch } : component
      )
    )

  const removeComponent = (key: string) =>
    onComponentsChange(components.filter((component) => component.key !== key))

  return (
    <div className={cn("rounded-xl border border-border bg-muted/20 p-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Condiciones retributivas
      </p>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        {salaryHint ||
          "El salario de escala se deriva del cargo y la escala aplicable a la entidad (sólo lectura)."}
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Grupo salarial</dt>
          <dd className="text-sm font-medium text-ink">
            {salaryGroupSequence == null ? "—" : `Grupo ${toRomanNumeral(salaryGroupSequence)}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Salario de escala</dt>
          <dd className="text-sm font-medium text-ink">
            {baseSalaryAmount === null
              ? "Sin salario configurado"
              : formatContractMoney(baseSalaryAmount, baseSalaryCurrency)}
          </dd>
        </div>
      </dl>

      {COMPENSATION_COMPONENT_TYPES.map((type) => {
        const rows = byType(type.code)
        return (
          <div key={type.code} className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">{type.label}</p>
                <p className="text-xs text-muted-foreground">{type.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => addComponent(type.code)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-full border border-input bg-background px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-sitecorp-primary/50 hover:text-sitecorp-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" /> Añadir concepto
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Sin conceptos.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((row) => {
                  const amountInvalid = componentAmountValue(row) === null
                  return (
                    <li key={row.key} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[180px] flex-1 space-y-1.5">
                        <Label className="text-xs">Descripción</Label>
                        <SiteCorpInput
                          value={row.description}
                          onChange={(e) =>
                            updateComponent(row.key, { description: e.target.value })
                          }
                          placeholder="Ej.: Responsabilidad"
                          disabled={disabled}
                        />
                      </div>
                      <div className="w-32 space-y-1.5">
                        <Label className="text-xs">Importe</Label>
                        <SiteCorpInput
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.amount}
                          onChange={(e) => updateComponent(row.key, { amount: e.target.value })}
                          className={cn(amountInvalid && "border-sitecorp-danger")}
                          disabled={disabled}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeComponent(row.key)}
                        disabled={disabled}
                        className="mb-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-sitecorp-danger/50 hover:text-sitecorp-danger disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Eliminar concepto de ${componentTypeLabel(row.component_type)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">
            Conceptos añadidos: {formatContractMoney(componentsSum, baseSalaryCurrency)}
          </p>
          {invalid && (
            <p className="text-xs text-sitecorp-danger">
              Cada concepto necesita descripción e importe válido (mayor o igual que 0).
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total contractual
          </p>
          <p className="text-lg font-semibold text-ink">
            {baseSalaryAmount === null
              ? "—"
              : formatContractMoney(previewTotal, baseSalaryCurrency)}
          </p>
          <p className="text-xs text-muted-foreground">
            Vista previa: el importe definitivo lo calcula el sistema.
          </p>
        </div>
      </div>
    </div>
  )
}

export default ContractRetributionFields
