/**
 * Contratos — Formatos de presentación del contexto (dominio, puro).
 *
 * Aquí vive UNA sola implementación de cada formato del contexto:
 *   · la fecha laboral (ISO `aaaa-mm-dd` → `dd/mm/aaaa`), compartida por las alertas de
 *     vencimiento, las condiciones contractuales, los anexos y el historial salarial;
 *   · el importe contractual (es-CU, dos decimales, moneda opcional).
 *
 * Los dos nombres públicos de la fecha (`formatContractDate` y `formatConditionDate`) son la
 * MISMA función: existían como copias en los módulos legacy y ahora no se duplica el criterio.
 */

/** Fecha laboral ISO (aaaa-mm-dd, como las columnas DATE) → dd/mm/aaaa. */
export const formatContractDate = (isoDate: string | null | undefined): string => {
  if (!isoDate) return "—"
  const [year, month, day] = isoDate.split("-")
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}

/**
 * Mismo formato con el nombre que usan las condiciones contractuales y los anexos:
 * es la MISMA función (una implementación, dos nombres públicos del contexto).
 */
export const formatConditionDate = formatContractDate

/**
 * Importe contractual: `4 000,00 CUP`. Sin moneda devuelve sólo el número y un importe
 * nulo se muestra como `—` (nunca `NaN` ni `0` por defecto).
 */
export const formatContractMoney = (amount: number | null, currency?: string | null): string => {
  if (amount === null || amount === undefined) return "—"
  const value = `${amount.toLocaleString("es-CU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return currency ? `${value} ${currency}` : value
}
