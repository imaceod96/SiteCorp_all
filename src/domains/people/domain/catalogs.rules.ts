import type { CatalogOption } from "./entities"

/**
 * Personas — Regla pura de los catálogos de la persona (dominio).
 *
 * Sólo describe: la relación real de licencias de conducción se representa con las
 * MISMAS etiquetas del catálogo (código visible A, B, C… o su nombre) y en el orden
 * del catálogo, nunca en el orden en que llegaron los identificadores.
 */

/** Etiquetas (A, B, C…) de las licencias seleccionadas, en el orden del catálogo. */
export const drivingLicenseLabels = (
  categoryIds: string[],
  categories: CatalogOption[]
): string[] =>
  categories
    .filter((category) => categoryIds.includes(category.id))
    .map((category) => category.code || category.name)
