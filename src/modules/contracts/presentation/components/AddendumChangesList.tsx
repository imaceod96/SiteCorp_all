import * as React from "react"
import { cn } from "@/lib/utils"
import { ArrowRight } from "lucide-react"
import { addendumFieldLabel } from "@/modules/contracts/domain/addendum-labels"
import { formatSalary } from "@/modules/organization-structure"
import type { AddendumChange } from "@/modules/contracts/domain/entities"

interface AddendumChangesListProps {
  changes: AddendumChange[]
  className?: string
  /** Texto cuando no hay diferencias contractuales representables */
  emptyLabel?: string
  /** Título de la comparación */
  title?: string
  description?: string
}

const MONETARY_FIELD_CODES = new Set([
  "SALARY",
  "ADDITIONAL_PAYMENT",
  "ABNORMAL_CONDITIONS",
  "OTHER_PAYMENT",
  "TOTAL_COMPENSATION",
])

const normalizeMonetaryDisplay = (raw: string): string => {
  // Convierte formatos heredados como "3 610,00 CUP" o "4500 CUP" a "3,610.00 CUP"
  const match = /^([0-9][0-9\s.,]*?)\s+([A-Z]{3})(.*)$/.exec(raw.trim())
  if (!match) return raw
  const [, rawNumber, currency, suffix] = match
  const compact = rawNumber.replace(/\s+/g, "")
  const normalizedNum =
    compact.includes(",") && !compact.includes(".")
      ? compact.replace(",", ".")
      : compact.replace(/,/g, "")
  const amount = Number(normalizedNum)
  if (!Number.isFinite(amount)) return raw
  return `${formatSalary({ amount, currency_code: currency })}${suffix || ""}`
}

const valueLabel = (
  value: string | null | undefined,
  fieldCode?: string
) => {
  if (value === null || value === undefined || value === "") return "Sin información"
  if (fieldCode && MONETARY_FIELD_CODES.has(fieldCode)) {
    return normalizeMonetaryDisplay(value)
  }
  return value
}

/**
 * Fase 11A.6 — Comparación ANTES / DESPUÉS de un anexo (§52/§53/§54).
 *
 * Sólo se muestran los campos que realmente cambian: los snapshots completos
 * permanecen internamente.
 */
export const AddendumChangesList: React.FC<AddendumChangesListProps> = ({
  changes,
  className,
  emptyLabel = "Este cambio no modifica condiciones contractuales representables.",
  title = "Cambios contractuales",
  description,
}) => {
  const rows = React.useMemo(
    () => changes.slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
    [changes]
  )

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground",
          className
        )}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={cn("rounded-xl border border-border bg-muted/20 p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <div className="hidden items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
          <span>Antes</span>
          <span className="text-sitecorp-primary">Después</span>
        </div>
      </div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}

      <ul className="mt-3 space-y-2">
        {rows.map((change, index) => (
          <li
            key={`${change.field_code}-${index}`}
            className="rounded-lg border border-border bg-background px-3 py-2"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {addendumFieldLabel(change.field_code)}
            </p>

            {/* Móvil: apilado (Antes: … / Después: …) */}
            <div className="mt-1.5 space-y-1 sm:hidden">
              <p className="text-sm text-ink">
                <span className="text-muted-foreground">Antes: </span>
                {valueLabel(change.old_display_value ?? change.old_value, change.field_code)}
              </p>
              <p className="text-sm font-medium text-sitecorp-primary">
                <span className="font-normal text-muted-foreground">Después: </span>
                {valueLabel(change.new_display_value ?? change.new_value, change.field_code)}
              </p>
            </div>

            {/* Escritorio: Antes → Después */}
            <div className="mt-1.5 hidden items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
              <span className="truncate text-sm text-muted-foreground">
                {valueLabel(change.old_display_value ?? change.old_value, change.field_code)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium text-sitecorp-primary">
                {valueLabel(change.new_display_value ?? change.new_value, change.field_code)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default AddendumChangesList
