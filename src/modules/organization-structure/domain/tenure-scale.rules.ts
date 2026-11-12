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

/** Etiqueta individual de una cota en meses: «1 año», «1 año y 6 meses», «6 meses». */
export function formatTenureMonths(months: number): string {
  if (months <= 0) return "0 meses"
  const years = Math.floor(months / MONTHS_PER_YEAR)
  const remainder = months % MONTHS_PER_YEAR
  const yearsStr = years > 0 ? `${years} ${years === 1 ? "año" : "años"}` : ""
  const monthsStr = remainder > 0 ? `${remainder} ${remainder === 1 ? "mes" : "meses"}` : ""
  if (yearsStr && monthsStr) return `${yearsStr} y ${monthsStr}`
  return yearsStr || monthsStr
}

/** Etiqueta legible de un tramo completo: «1 año a 2 años», «5 meses en adelante»… */
export function formatTenureRange(range: TenureScaleRange): string {
  const fromStr = formatTenureMonths(range.from_months)

  if (range.to_months === null) {
    return `${fromStr} en adelante`
  }

  return `${fromStr} a ${formatTenureMonths(range.to_months)}`
}

/**
 * Valida la coherencia del conjunto de tramos de antigüedad de una entidad (G5):
 * - No puede haber dos tramos abiertos («Sin límite»).
 * - Ningún tramo puede empezar después o encima de un tramo abierto.
 * - Dos tramos no pueden solaparse (`prev.to_months > next.from_months`).
 * - No deben quedar huecos intermedios (`next.from_months > prev.to_months`), ya que el
 *   cálculo de prenómina evalúa `meses >= desde AND meses < hasta`: para continuidad sin
 *   huecos el «Desde» del siguiente tramo debe coincidir con el «Hasta» del anterior
 *   (ej. 1 a 5 años, 5 a 10 años, 10 años en adelante).
 */
export function validateTenureScaleContinuity(
  candidate: TenureScaleValues,
  existingRanges: TenureScaleRange[],
  editingId?: string | null
): string | null {
  const others = existingRanges.filter(
    (range) => range.is_active !== false && range.id !== (editingId ?? null)
  )

  if (others.length === 0) return null

  if (candidate.to_months === null) {
    const existingOpen = others.find((range) => range.to_months === null)
    if (existingOpen) {
      return `Ya existe un tramo final «Sin límite» (desde ${formatTenureMonths(existingOpen.from_months)}). Solo puede existir un último tramo abierto.`
    }
  }

  const all = [
    ...others.map((range) => ({
      id: range.id,
      from_months: range.from_months,
      to_months: range.to_months,
      isCandidate: false,
    })),
    {
      id: editingId ?? "__candidate__",
      from_months: candidate.from_months,
      to_months: candidate.to_months,
      isCandidate: true,
    },
  ].sort((a, b) => {
    if (a.from_months !== b.from_months) return a.from_months - b.from_months
    const aEnd = a.to_months ?? Number.POSITIVE_INFINITY
    const bEnd = b.to_months ?? Number.POSITIVE_INFINITY
    return aEnd - bEnd
  })

  for (let index = 0; index < all.length - 1; index += 1) {
    const current = all[index]
    const next = all[index + 1]

    if (current.to_months === null) {
      return `El tramo «Sin límite» (desde ${formatTenureMonths(current.from_months)}) debe ser el último: no puede existir un tramo posterior desde ${formatTenureMonths(next.from_months)}.`
    }

    if (current.to_months > next.from_months) {
      return `El tramo se solapa con el tramo existente (${formatTenureMonths(current.from_months)} a ${formatTenureMonths(current.to_months)}). El valor «Desde» debe ser al menos ${formatTenureMonths(current.to_months)}.`
    }

    if (next.from_months > current.to_months) {
      return `Queda un hueco sin cobertura entre ${formatTenureMonths(current.to_months)} y ${formatTenureMonths(next.from_months)}. Para evitar meses sin pago de antigüedad, el tramo siguiente debe iniciar en ${formatTenureMonths(current.to_months)}.`
    }
  }

  return null
}
