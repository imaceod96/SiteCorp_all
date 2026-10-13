import type { TenureScaleFormValues, TenureScaleRange, TenureScaleValues } from "./entities"

/**
 * Escala de pago por antigüedad — Reglas de dominio.
 *
 * Un tramo se define SIEMPRE en meses (`from_months` / `to_months`), pero se introduce
 * en meses o años. El formulario ofrece esas dos unidades y aquí se convierten sin
 * ambigüedad: la persistencia nunca depende de la unidad elegida.
 *
 * Un tramo abierto (`to_months = null`) es el último tramo: «en adelante».
 *
 * Los cálculos, los textos y las validaciones son EXACTAMENTE los que aplicaba la
 * pantalla: la migración a DDD es un traslado estructural, no un cambio de cálculo.
 */

export const MONTHS_PER_YEAR = 12

/** Formulario vacío de un tramo nuevo. */
export const EMPTY_TENURE_FORM: TenureScaleFormValues = {
  from_amount: "",
  from_unit: "Meses",
  to_amount: "",
  to_unit: "Meses",
  to_limit: false,
  amount: "",
}

/** Convierte un tramo persistido (meses) a los valores del formulario. */
export function tenureRangeToForm(range: TenureScaleRange): TenureScaleFormValues {
  const fromYears = Math.floor(range.from_months / MONTHS_PER_YEAR)
  const fromRemainder = range.from_months % MONTHS_PER_YEAR
  const toYears = range.to_months !== null ? Math.floor(range.to_months / MONTHS_PER_YEAR) : 0

  return {
    from_amount: String(fromYears > 0 ? fromYears : fromRemainder),
    from_unit: fromYears > 0 ? "Años" : "Meses",
    to_amount:
      range.to_months !== null ? String(toYears > 0 ? toYears : range.to_months % MONTHS_PER_YEAR) : "",
    to_unit: range.to_months !== null ? (toYears > 0 ? "Años" : "Meses") : "Meses",
    to_limit: range.to_months === null,
    amount: String(range.amount),
  }
}

/**
 * Convierte el formulario a los valores persistibles, validando en el mismo orden que
 * la pantalla. Devuelve `error` con el primer problema encontrado o `values` listos
 * para guardar (nunca ambos).
 */
export function tenureFormToValues(
  form: TenureScaleFormValues
): { values: TenureScaleValues; error: null } | { values: null; error: string } {
  const fromMonths =
    (form.from_unit === "Años"
      ? parseFloat(form.from_amount) * MONTHS_PER_YEAR
      : parseFloat(form.from_amount)) || 0

  const toMonths = form.to_limit
    ? null
    : (form.to_unit === "Años"
        ? parseFloat(form.to_amount) * MONTHS_PER_YEAR
        : parseFloat(form.to_amount)) || null

  const amount = parseFloat(form.amount)

  if (Number.isNaN(fromMonths) || fromMonths < 0) {
    return { values: null, error: "El valor 'Desde' debe ser un número válido positivo" }
  }

  if (!form.to_limit && toMonths !== null && (Number.isNaN(toMonths) || toMonths < 0)) {
    return { values: null, error: "El valor 'Hasta' debe ser un número válido positivo" }
  }

  if (!form.to_limit && toMonths !== null && toMonths <= fromMonths) {
    return { values: null, error: "El valor 'Hasta' debe ser mayor que 'Desde'" }
  }

  if (Number.isNaN(amount) || amount < 0) {
    return { values: null, error: "El importe debe ser un número válido positivo o cero" }
  }

  return { values: { from_months: fromMonths, to_months: toMonths, amount }, error: null }
}

/** Etiqueta legible de un tramo: «1 año a 2 años», «5 meses en adelante»… */
export function formatTenureRange(range: TenureScaleRange): string {
  const fromStr = formatMonths(range.from_months)

  if (range.to_months === null) {
    return `${fromStr} en adelante`
  }

  return `${fromStr} a ${formatMonths(range.to_months)}`
}

function formatMonths(months: number): string {
  const years = Math.floor(months / MONTHS_PER_YEAR)
  if (years > 0) return `${years} ${years === 1 ? "año" : "años"}`
  const remainder = months % MONTHS_PER_YEAR
  return `${remainder} ${remainder === 1 ? "mes" : "meses"}`
}
