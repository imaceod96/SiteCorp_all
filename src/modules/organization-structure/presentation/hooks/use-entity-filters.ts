import * as React from "react"
import type {
  ActiveEntityFilter,
  EntityFilterDefinition,
} from "@/components/filters/entity-filter-types"

/**
 * Sistema de filtros acumulativos de SiteCorp (lógica de presentación).
 *
 * Un módulo declara sus CRITERIOS (EntityFilterDefinition[]) y este módulo se
 * encarga de la lógica común: combinar varios filtros con AND, comparar el mismo
 * criterio contra multivalor, etc. La UI (FilterBuilder) sólo pinta los chips.
 *
 * Reglas:
 *   · Cada criterio declara cómo extraer su valor del registro (`getValue`) o sus
 *     valores (`getValues` para campos multivalor como las categorías de licencia).
 *   · Filtros de criterios DISTINTOS se combinan con AND (acumulativo).
 *   · Un mismo criterio con varios valores se combina con OR (multiselección).
 *   · No se hardcodean catálogos: los `options` los aporta cada módulo desde los
 *     catálogos globales reales.
 *
 * Es lógica de interfaz (estado de React y filtrado de listados ya cargados): no
 * contiene reglas de negocio ni consultas de datos, así que no pertenece a ningún
 * dominio. Los criterios siguen declarándose en cada pantalla.
 *
 * Los TIPOS del sistema (EntityFilterType, EntityFilterOption, EntityFilterDefinition,
 * ActiveEntityFilter) viven en la capa compartida
 * `src/components/filters/entity-filter-types` para que el constructor de filtros
 * compartido no dependa de la presentación de un módulo de negocio; aquí se reexportan
 * para conservar la interfaz pública de este hook.
 */

export type {
  ActiveEntityFilter,
  EntityFilterDefinition,
  EntityFilterOption,
  EntityFilterType,
} from "@/components/filters/entity-filter-types"

const toText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value)

const dateOnly = (value: unknown): string => toText(value).slice(0, 10)

/** ¿Un registro satisface un filtro activo concreto? */
export function matchesEntityFilter(
  definition: EntityFilterDefinition,
  item: unknown,
  filter: ActiveEntityFilter
): boolean {
  const values = filter.values.filter((value) => value !== "" && value !== undefined)
  if (values.length === 0) return true

  if (definition.type === "boolean") {
    if (!definition.getValue) return true
    const actual = Boolean(definition.getValue(item))
    const expected = values[0] === "true"
    return actual === expected
  }

  if (definition.type === "text") {
    if (!definition.getValue) return true
    const actual = toText(definition.getValue(item)).toLowerCase()
    return values.some((value) => actual.includes(value.toLowerCase()))
  }

  if (definition.type === "date") {
    if (!definition.getValue) return true
    const actual = dateOnly(definition.getValue(item))
    return values.some((value) => actual === dateOnly(value))
  }

  if (definition.type === "daterange") {
    if (!definition.getValue) return true
    const actual = dateOnly(definition.getValue(item))
    if (!actual) return false
    const from = values[0] ? dateOnly(values[0]) : ""
    const to = values[1] ? dateOnly(values[1]) : ""
    if (from && actual < from) return false
    if (to && actual > to) return false
    return true
  }

  // select / multiselect: el registro aporta uno o varios valores y basta con que
  // coincida con alguno de los valores elegidos (OR dentro del mismo criterio).
  const ownValues = definition.getValues
    ? definition.getValues(item).map(toText)
    : definition.getValue
      ? [toText(definition.getValue(item))]
      : []
  return values.some((value) => ownValues.includes(toText(value)))
}

/** Aplica TODOS los filtros activos (AND acumulativo). */
export function applyEntityFilters<T>(
  items: T[],
  definitions: EntityFilterDefinition[],
  active: ActiveEntityFilter[]
): T[] {
  if (active.length === 0) return items
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  return items.filter((item) =>
    active.every((filter) => {
      const definition = byKey.get(filter.key)
      if (!definition) return true
      return matchesEntityFilter(definition, item, filter)
    })
  )
}

export interface UseEntityFiltersResult<T> {
  definitions: EntityFilterDefinition[]
  active: ActiveEntityFilter[]
  available: EntityFilterDefinition[]
  add: (key: string) => void
  remove: (key: string) => void
  setValues: (key: string, values: string[]) => void
  clear: () => void
  result: T[]
}

/**
 * Hook de estado de filtros. Mantiene los filtros activos y aplica el resultado
 * de forma memoizada. Los criterios se declaran una vez por módulo.
 */
export function useEntityFilters<T>(
  items: T[],
  definitions: EntityFilterDefinition[]
): UseEntityFiltersResult<T> {
  const [active, setActive] = React.useState<ActiveEntityFilter[]>([])

  const available = React.useMemo(
    () => definitions.filter((definition) => !active.some((filter) => filter.key === definition.key)),
    [definitions, active]
  )

  const add = React.useCallback((key: string) => {
    setActive((prev) => (prev.some((filter) => filter.key === key) ? prev : [...prev, { key, values: [] }]))
  }, [])

  const remove = React.useCallback((key: string) => {
    setActive((prev) => prev.filter((filter) => filter.key !== key))
  }, [])

  const setValues = React.useCallback((key: string, values: string[]) => {
    setActive((prev) => prev.map((filter) => (filter.key === key ? { ...filter, values } : filter)))
  }, [])

  const clear = React.useCallback(() => setActive([]), [])

  const result = React.useMemo(
    () => applyEntityFilters(items, definitions, active),
    [items, definitions, active]
  )

  return { definitions, active, available, add, remove, setValues, clear, result }
}
