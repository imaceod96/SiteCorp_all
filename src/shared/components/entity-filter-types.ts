/**
 * Fase 11A.6 — Contrato compartido del sistema de filtros acumulativos de SiteCorp.
 *
 * `EntityFilterDefinition` describe un CRITERIO declarado por una pantalla y
 * `ActiveEntityFilter` el estado de un filtro aplicado. Son datos de presentación que
 * consumen pantallas de cuatro módulos y el constructor de filtros compartido
 * (`src/shared/components/filter-builder`).
 *
 * Antes vivían en la presentación de Estructura organizativa, lo que obligaba a la
 * capa compartida a depender de la presentación de un módulo de negocio. Aquí se
 * declaran sin dependencias de ningún módulo; el hook `use-entity-filters` los
 * reexporta y sigue aportando la lógica de filtrado (AND entre criterios, OR dentro
 * del mismo criterio). Los criterios siguen declarándose en cada pantalla.
 */

export type EntityFilterType =
  | "select"
  | "multiselect"
  | "boolean"
  | "text"
  | "date"
  | "daterange"

export interface EntityFilterOption {
  value: string
  label: string
}

export interface EntityFilterDefinition<T = unknown> {
  key: string
  label: string
  type: EntityFilterType
  options?: EntityFilterOption[]
  /** Valor simple del registro (se compara como texto). */
  getValue?: (item: T) => unknown
  /** Valores múltiples del registro (OR dentro del mismo criterio). */
  getValues?: (item: T) => string[]
  /** Marcador de posición del control de texto/fecha. */
  placeholder?: string
}

export interface ActiveEntityFilter {
  key: string
  values: string[]
}
