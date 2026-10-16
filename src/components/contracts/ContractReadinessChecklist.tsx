import * as React from "react"
import { cn } from "@/lib/utils"
import { Check, AlertTriangle, Loader2 } from "lucide-react"
import { READINESS_SECTION_LABELS, type ReadinessResult } from "@/modules/people"

interface ContractReadinessChecklistProps {
  readiness: ReadinessResult | null
  loading?: boolean
  title?: string
  className?: string
}

const SECTION_ORDER = [
  "Datos personales",
  "Entidad",
  "Cargo",
  "Puesto y jornada",
  "Representante",
  "Condiciones contractuales",
]

/**
 * Lista de verificación de preparación contractual (§39): muestra de forma
 * humana qué bloques están completos y cuáles requieren información.
 */
export const ContractReadinessChecklist: React.FC<ContractReadinessChecklistProps> = ({
  readiness,
  loading = false,
  title = "Preparación contractual",
  className,
}) => {
  const sectionMap = React.useMemo(() => {
    const map = new Map<string, { ready: boolean; labels: string[] }>()
    for (const section of readiness?.sections || []) {
      const key = READINESS_SECTION_LABELS[section.key] || section.label
      const existing = map.get(key) || { ready: true, labels: [] }
      existing.ready = existing.ready && section.ready
      for (const item of section.missing) {
        if (!existing.labels.includes(item.label)) existing.labels.push(item.label)
      }
      map.set(key, existing)
    }
    return map
  }, [readiness])

  const ready = readiness?.ready ?? false

  return (
    <div className={cn("rounded-xl border border-border bg-muted/20 p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              ready
                ? "bg-sitecorp-success/10 text-sitecorp-success"
                : "bg-sitecorp-warning/10 text-sitecorp-warning"
            )}
          >
            {ready ? (
              <>
                <Check className="h-3.5 w-3.5" /> Listo
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" /> Información incompleta
              </>
            )}
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {SECTION_ORDER.map((label) => {
          const section = sectionMap.get(label)
          const isReady = !section || section.ready
          return (
            <li key={label} className="flex items-start gap-2 text-sm">
              {isReady ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-success" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sitecorp-warning" />
              )}
              <span className={cn("font-medium", isReady ? "text-ink" : "text-ink")}>
                {label}
              </span>
              {!isReady && section && section.labels.length > 0 && (
                <span className="text-muted-foreground">
                  · {section.labels.join(" · ")}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ContractReadinessChecklist
