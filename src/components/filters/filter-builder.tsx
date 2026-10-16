import * as React from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Plus, SlidersHorizontal, X } from "lucide-react"
import type {
  ActiveEntityFilter,
  EntityFilterDefinition,
} from "@/modules/organization-structure/presentation/hooks/use-entity-filters"

/**
 * Constructor de filtros de SiteCorp (patrón «+ Añadir filtro»).
 *
 * · Inicialmente solo se ve «Añadir filtro».
 * · Cada filtro activo es un chip compacto [ Criterio: valor × ].
 * · Tras el primer chip aparece un «+» para añadir otro criterio.
 * · Los criterios disponibles dependen del módulo (se reciben por props).
 * · Los resultados se recalculan al añadir/quitar/cambiar (sin botón Aplicar).
 */

interface FilterBuilderProps {
  definitions: EntityFilterDefinition[]
  active: ActiveEntityFilter[]
  available: EntityFilterDefinition[]
  onAdd: (key: string) => void
  onRemove: (key: string) => void
  onSetValues: (key: string, values: string[]) => void
  onClear: () => void
  /** Nº de resultados tras aplicar (opcional). */
  resultCount?: number
  /** Nº total antes de aplicar (opcional). */
  totalCount?: number
  className?: string
}

const optionLabel = (definition: EntityFilterDefinition, value: string): string => {
  const option = definition.options?.find((item) => item.value === value)
  return option?.label ?? value
}

const summarize = (definition: EntityFilterDefinition, values: string[]): string => {
  if (values.length === 0) return "Elegir…"
  if (definition.type === "boolean") return values[0] === "true" ? "Sí" : "No"
  if (definition.type === "daterange") {
    const [from, to] = values
    if (from && to) return `${from} – ${to}`
    if (from) return `Desde ${from}`
    if (to) return `Hasta ${to}`
    return "Elegir…"
  }
  return values.map((value) => optionLabel(definition, value)).join(", ")
}

const toggleValue = (values: string[], value: string, multiple: boolean): string[] => {
  if (!multiple) return values.includes(value) ? [] : [value]
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

const ValueControl: React.FC<{
  definition: EntityFilterDefinition
  values: string[]
  onChange: (values: string[]) => void
}> = ({ definition, values, onChange }) => {
  if (definition.type === "boolean") {
    return (
      <div className="space-y-1">
        {[
          { value: "true", label: "Sí" },
          { value: "false", label: "No" },
        ].map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={values[0] === option.value}
              onCheckedChange={() => onChange(toggleValue(values, option.value, false))}
            />
            {option.label}
          </label>
        ))}
      </div>
    )
  }

  if (definition.type === "text") {
    return (
      <input
        autoFocus
        value={values[0] ?? ""}
        onChange={(event) => onChange([event.target.value])}
        placeholder={definition.placeholder ?? "Escribir…"}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  if (definition.type === "date") {
    return (
      <input
        type="date"
        value={values[0] ?? ""}
        onChange={(event) => onChange([event.target.value])}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  if (definition.type === "daterange") {
    return (
      <div className="space-y-2">
        <label className="block text-xs text-muted-foreground">Desde</label>
        <input
          type="date"
          value={values[0] ?? ""}
          onChange={(event) => onChange([event.target.value, values[1] ?? ""])}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label className="block text-xs text-muted-foreground">Hasta</label>
        <input
          type="date"
          value={values[1] ?? ""}
          onChange={(event) => onChange([values[0] ?? "", event.target.value])}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    )
  }

  // select / multiselect
  const multiple = definition.type === "multiselect"
  const options = definition.options ?? []
  if (options.length === 0) {
    return <p className="px-2 py-1.5 text-sm text-muted-foreground">Sin opciones disponibles.</p>
  }
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
        >
          <Checkbox
            checked={values.includes(option.value)}
            onCheckedChange={() => onChange(toggleValue(values, option.value, multiple))}
          />
          <span className="truncate">{option.label}</span>
        </label>
      ))}
    </div>
  )
}

const FilterChip: React.FC<{
  definition: EntityFilterDefinition
  values: string[]
  onChange: (values: string[]) => void
  onRemove: () => void
}> = ({ definition, values, onChange, onRemove }) => {
  const summary = summarize(definition, values)
  const incomplete = values.length === 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-sm",
        incomplete
          ? "border-dashed border-border bg-card text-muted-foreground"
          : "border-sitecorp-primary/30 bg-sitecorp-primary/5 text-ink"
      )}
    >
      <span className="font-medium">{definition.label}:</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="max-w-[16rem] truncate rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={summary}
          >
            {summary}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <ValueControl definition={definition} values={values} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={onRemove}
        title="Eliminar filtro"
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}

const AddFilterButton: React.FC<{
  available: EntityFilterDefinition[]
  onAdd: (key: string) => void
  compact: boolean
}> = ({ available, onAdd, compact }) => {
  const [open, setOpen] = React.useState(false)
  if (available.length === 0) return null
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Añadir filtro"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-card font-medium text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "h-7 w-7 justify-center" : "px-3 py-1.5 text-sm"
          )}
        >
          {compact ? (
            <Plus className="h-4 w-4" />
          ) : (
            <>
              <SlidersHorizontal className="h-4 w-4" />
              Añadir filtro
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          Añadir filtro
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((definition) => (
          <DropdownMenuItem
            key={definition.key}
            onSelect={() => {
              onAdd(definition.key)
              setOpen(false)
            }}
          >
            {definition.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  definitions,
  active,
  available,
  onAdd,
  onRemove,
  onSetValues,
  onClear,
  resultCount,
  totalCount,
  className,
}) => {
  const definitionByKey = React.useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions]
  )

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {active.map((filter) => {
        const definition = definitionByKey.get(filter.key)
        if (!definition) return null
        return (
          <FilterChip
            key={filter.key}
            definition={definition}
            values={filter.values}
            onChange={(values) => onSetValues(filter.key, values)}
            onRemove={() => onRemove(filter.key)}
          />
        )
      })}

      <AddFilterButton available={available} onAdd={onAdd} compact={active.length > 0} />

      {active.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Limpiar filtros
        </button>
      )}

      {typeof resultCount === "number" && typeof totalCount === "number" && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {resultCount} de {totalCount}
        </span>
      )}
    </div>
  )
}
