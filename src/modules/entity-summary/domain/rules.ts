import { differenceInYears } from "date-fns"
import type { ReportSlice } from "./entities"

/** Código de la rebanada para los trabajadores sin el dato cargado. */
export const NO_INFO_KEY = "no-info"

/**
 * Tramos de edad utilizados en todos los informes de edad.
 * Incluye explícitamente el tramo «Sin información» (fecha de nacimiento ausente).
 */
export const AGE_BUCKETS = [
  { key: "under20", label: "Menos de 20 años" },
  { key: "20-29", label: "20-29 años" },
  { key: "30-39", label: "30-39 años" },
  { key: "40-49", label: "40-49 años" },
  { key: "50-59", label: "50-59 años" },
  { key: "60plus", label: "60 años o más" },
  { key: NO_INFO_KEY, label: "Sin información" },
] as const

/**
 * Clave de tramo de edad, derivada de `AGE_BUCKETS`.
 * Se co-loca aquí con la constante de la que deriva para no introducir una
 * dependencia circular entre `rules` y `entities`.
 */
export type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"]

/** Suma de los valores de un informe (total de trabajadores distintos). */
export function reportTotal(report: {
  byAgeGroup?: ReportSlice[]
  bySex?: ReportSlice[]
  bySkinColor?: ReportSlice[]
  byEducation?: ReportSlice[]
}): number {
  const slices =
    report.byAgeGroup ?? report.bySex ?? report.bySkinColor ?? report.byEducation
  return slices.reduce((sum, s) => sum + s.value, 0)
}

const today = () => new Date()

/** Calcula la edad cronológica a partir de la fecha de nacimiento. */
export function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null
  return differenceInYears(today(), new Date(birthDate))
}

/** Asigna una edad (años) al tramo correspondiente. Sin fecha → «Sin información». */
export function ageBucketKey(age: number | null): AgeBucketKey {
  if (age === null || Number.isNaN(age)) return NO_INFO_KEY
  if (age < 20) return "under20"
  if (age <= 29) return "20-29"
  if (age <= 39) return "30-39"
  if (age <= 49) return "40-49"
  if (age <= 59) return "50-59"
  return "60plus"
}

/** Convierte un mapa de contadores en rebanadas ordenadas (mayor a menor). */
export function countsToSlices(
  counts: Map<string, number>,
  nameById: Record<string, string>,
  fallback: string
): ReportSlice[] {
  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: nameById[key] ?? fallback,
      value,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}
