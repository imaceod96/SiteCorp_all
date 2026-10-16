import * as React from "react"

interface AcademicBadgesProps {
  hasMastersDegree: boolean | null | undefined
  hasDoctorateDegree: boolean | null | undefined
  /** Texto mostrado cuando no hay ninguna categoría marcada. */
  emptyLabel?: string
  className?: string
}

/**
 * Visualización de solo lectura de los indicadores académicos (Máster / Doctor).
 * Los dos indicadores son independientes: pueden aparecer ambos a la vez.
 */
export const AcademicBadges: React.FC<AcademicBadgesProps> = ({
  hasMastersDegree,
  hasDoctorateDegree,
  emptyLabel = "Ninguna",
  className,
}) => {
  if (!hasMastersDegree && !hasDoctorateDegree) {
    return <span className="text-sm text-ink">{emptyLabel}</span>
  }

  return (
    <span className={["flex flex-wrap gap-1.5", className].filter(Boolean).join(" ")}>
      {hasMastersDegree && (
        <span className="inline-flex items-center rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary">
          Máster
        </span>
      )}
      {hasDoctorateDegree && (
        <span className="inline-flex items-center rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary">
          Doctor
        </span>
      )}
    </span>
  )
}

export default AcademicBadges
