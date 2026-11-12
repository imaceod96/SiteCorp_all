// Deriva la fecha de nacimiento (YYYY-MM-DD) de los primeros 6 dígitos del
// carné de identidad cubano (AAMMDD). Devuelve null si el CI no permite
// derivar una fecha válida.
export const ciToBirthDate = (ci: string): string | null => {
  const cleaned = ci.replace(/\D/g, "")
  if (cleaned.length < 6) return null

  const year = parseInt(cleaned.substring(0, 2), 10)
  const month = parseInt(cleaned.substring(2, 4), 10)
  const day = parseInt(cleaned.substring(4, 6), 10)

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const fullYear = year >= 50 ? 1900 + year : 2000 + year
  const date = new Date(fullYear, month - 1, day)

  // Descartar fechas inválidas (p. ej. 3102)
  if (date.getDate() !== day || date.getMonth() !== month - 1) return null

  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Regla general de SiteCorp: el Número de Identificación / Carnet de Identidad
 * debe contener EXACTAMENTE 11 dígitos (solo 0-9). Se almacena siempre como
 * TEXTO para conservar los ceros iniciales; nunca se convierte a número.
 */
export const IDENTIFICATION_LENGTH = 11
export const IDENTIFICATION_REGEX = /^[0-9]{11}$/
export const IDENTIFICATION_ERROR_MESSAGE =
  "El número de identificación debe contener exactamente 11 dígitos."

/** Normaliza la entrada del carné a un máximo de 11 dígitos numéricos. */
export const sanitizeIdentificationInput = (value: string): string =>
  value.replace(/\D/g, "").slice(0, IDENTIFICATION_LENGTH)

/** true si el valor (recortado) son exactamente 11 dígitos. */
export const isValidIdentification = (value: unknown): boolean =>
  IDENTIFICATION_REGEX.test(String(value ?? "").trim())

/** Convierte una fecha ISO YYYY-MM-DD a formato visual DD/MM/AAAA. */
export const formatIsoDateToDisplay = (value: string | null | undefined): string => {
  const trimmed = (value ?? "").trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`
  }
  return trimmed
}
