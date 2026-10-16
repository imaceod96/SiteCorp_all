import * as React from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { Label } from "@/components/ui/label"
import {
  fetchValidRepresentatives,
  formatRepresentativeDate,
  type RepresentativePositionRow,
} from "@/modules/representatives"
import { Settings2, UserCheck } from "lucide-react"

interface RepresentativeSelectProps {
  entityId: string
  /** Fecha contractual usada para resolver el representante vigente */
  onDate: string
  value: string | null
  onChange: (assignmentId: string | null) => void
  canManage?: boolean
  label?: string
  /** Texto de apoyo que documenta la fecha contractual utilizada */
  dateHint?: string
  /** Notifica los representantes vigentes resueltos (para resúmenes y validaciones) */
  onOptionsChange?: (rows: RepresentativePositionRow[]) => void
}

/**
 * Selección del representante de la entidad para la contratación.
 *
 * Los candidatos se resuelven por FECHA (posición + persona vigente en la fecha
 * contractual), no por «effective_to IS NULL». Si existe un solo representante
 * vigente se preselecciona, pero siempre se muestra quién comparece.
 */
export const RepresentativeSelect = ({
  entityId,
  onDate,
  value,
  onChange,
  canManage = false,
  label = "Representante de la entidad *",
  dateHint,
  onOptionsChange,
}: RepresentativeSelectProps) => {
  const [rows, setRows] = React.useState<RepresentativePositionRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onOptionsChangeRef = React.useRef(onOptionsChange)
  React.useEffect(() => {
    onOptionsChangeRef.current = onOptionsChange
  })

  React.useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!entityId || !onDate) {
        setRows([])
        onOptionsChangeRef.current?.([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const valid = await fetchValidRepresentatives(entityId, onDate)
        if (!cancelled) {
          setRows(valid)
          onOptionsChangeRef.current?.(valid)
        }
      } catch (err) {
        console.error("Error loading representatives:", err)
        if (!cancelled) {
          setRows([])
          onOptionsChangeRef.current?.([])
          setError("No se pudieron cargar los representantes autorizados.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [entityId, onDate])

  // Mantener coherente la selección con la fecha contractual
  React.useEffect(() => {
    if (loading) return
    if (rows.length === 0) {
      if (value) onChange(null)
      return
    }
    if (rows.length === 1) {
      if (value !== rows[0].assignment_id) onChange(rows[0].assignment_id)
      return
    }
    if (value && !rows.some((row) => row.assignment_id === value)) onChange(null)
  }, [loading, rows, value, onChange])

  if (!onDate) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">
          Indique la fecha del contrato para resolver el representante vigente.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {loading ? (
        <p className="text-sm text-muted-foreground">Buscando representantes vigentes…</p>
      ) : error ? (
        <SiteCorpAlert type="danger">{error}</SiteCorpAlert>
      ) : rows.length === 0 ? (
        <SiteCorpAlert type="danger">
          <div className="space-y-2">
            <p>
              No existe ningún representante autorizado configurado para la fecha del contrato (
              {formatRepresentativeDate(onDate)}).
            </p>
            {canManage && (
              <Link
                to={`/entity/${entityId}/settings/contract-data`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sitecorp-primary underline-offset-2 hover:underline"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Configurar representantes
              </Link>
            )}
          </div>
        </SiteCorpAlert>
      ) : (
        <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-2">
          {rows.map((row) => {
            const selected = value === row.assignment_id
            return (
              <button
                key={row.position_id}
                type="button"
                onClick={() => onChange(row.assignment_id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-sitecorp-primary bg-sitecorp-primary/5"
                    : "border-transparent hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-sitecorp-primary" : "border-muted-foreground/40"
                  )}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-sitecorp-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{row.person_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.title}
                    {row.effective_from
                      ? ` · desde ${formatRepresentativeDate(row.effective_from)}`
                      : ""}
                  </span>
                </span>
              </button>
            )
          })}

          {rows.length === 1 && (
            <p className="flex items-center gap-1.5 px-1 pt-1 text-xs text-muted-foreground">
              <UserCheck className="h-3.5 w-3.5" />
              Único representante vigente para la fecha del contrato.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {dateHint ??
          `Representante vigente para la fecha contractual del contrato (${formatRepresentativeDate(
            onDate
          )}).`}
      </p>
    </div>
  )
}

export default RepresentativeSelect
