import * as React from "react"
import { X, ChevronDown } from "lucide-react"

import { Label } from "@/shared/components/ui/label"
import { Checkbox } from "@/shared/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CatalogOption } from "@/modules/people/domain/entities"

interface DrivingLicenseSelectorProps {
  /** Catálogo global de SiteCorp (A, B, C, D, E) cargado desde la base de datos. */
  categories: CatalogOption[]
  /** Identificadores de las categorías seleccionadas (0..N). */
  value: string[]
  onChange: (next: string[]) => void
  label?: string
  disabled?: boolean
  hint?: string
  className?: string
}

/**
 * Fase 11A.4 — Selector múltiple compartido de licencias de conducción.
 *
 * Componente único reutilizado por Candidatos y Trabajadores: no se duplica lógica
 * por formulario y el catálogo siempre proviene de `driving_license_categories`.
 */
export const DrivingLicenseSelector: React.FC<DrivingLicenseSelectorProps> = ({
  categories,
  value,
  onChange,
  label = "Licencias de conducción",
  disabled = false,
  hint,
  className,
}) => {
  const [open, setOpen] = React.useState(false)

  // El orden visible siempre es el del catálogo (A, B, C, D, E), no el de selección.
  const selected = categories.filter((category) => value.includes(category.id))

  const toggle = (categoryId: string, checked: boolean) => {
    if (checked) {
      onChange(value.includes(categoryId) ? value : [...value, categoryId])
    } else {
      onChange(value.filter((id) => id !== categoryId))
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label>{label}</Label>}

      <div className="flex flex-wrap items-center gap-2">
        {selected.length === 0 ? (
          <span className="text-sm text-muted-foreground">Sin licencia de conducción</span>
        ) : (
          selected.map((category) => (
            <span
              key={category.id}
              className="inline-flex items-center gap-1 rounded-full border border-sitecorp-primary/30 bg-sitecorp-primary/5 px-2.5 py-1 text-xs font-semibold text-sitecorp-primary"
            >
              {category.code || category.name}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Quitar licencia ${category.code || category.name}`}
                  onClick={() => toggle(category.id, false)}
                  className="rounded-full p-0.5 transition-colors hover:bg-sitecorp-primary/15"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border border-input bg-background px-3 text-sm font-medium text-ink transition-colors hover:border-sitecorp-primary/50 hover:text-sitecorp-primary",
                disabled && "cursor-not-allowed opacity-60"
              )}
            >
              Seleccionar
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-56 space-y-1 p-2">
            {categories.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                No hay categorías configuradas.
              </p>
            ) : (
              categories.map((category) => {
                const checked = value.includes(category.id)
                return (
                  <label
                    key={category.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink transition-colors hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(state) => toggle(category.id, state === true)}
                      className="border-sitecorp-primary data-[state=checked]:bg-sitecorp-primary data-[state=checked]:text-white"
                    />
                    {category.code || category.name}
                  </label>
                )
              })
            )}
          </PopoverContent>
        </Popover>
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default DrivingLicenseSelector
