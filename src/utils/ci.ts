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
 * Deriva el sexo ('M' | 'F') a partir del 10.º dígito (índice 9) del carné de identidad
 * cubano de 11 dígitos: par (0, 2, 4, 6, 8) = Masculino ('M'), impar (1, 3, 5, 7, 9) = Femenino ('F').
 */
export const ciToGenderHint = (ci: string): "M" | "F" | null => {
  const cleaned = (ci ?? "").replace(/\D/g, "")
  if (cleaned.length < 10) return null
  const tenthDigit = parseInt(cleaned.charAt(9), 10)
  if (Number.isNaN(tenthDigit)) return null
  return tenthDigit % 2 === 0 ? "M" : "F"
}

/**
 * Resuelve el `id` del catálogo de sexo (`genders`) a partir del 10.º dígito del CI cubano.
 */
export const resolveGenderIdFromCi = (
  ci: string,
  genders: ReadonlyArray<{ id: string; name: string; code?: string | null }>
): string | null => {
  const hint = ciToGenderHint(ci)
  if (!hint || !genders || genders.length === 0) return null
  const found = genders.find((g) => {
    const code = (g.code ?? "").trim().toUpperCase()
    const name = (g.name ?? "").trim().toLowerCase()
    if (hint === "M") {
      return (
        code === "M" ||
        code === "MALE" ||
        name.startsWith("masculino") ||
        name.startsWith("hombre")
      )
    }
    return (
      code === "F" ||
      code === "FEMALE" ||
      name.startsWith("femenino") ||
      name.startsWith("mujer")
    )
  })
  return found ? found.id : null
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
export const IDENTIFICATION_CALENDAR_DATE_ERROR =
  "Los primeros 6 dígitos del carné de identidad no corresponden a una fecha válida (AAMMDD)."
export const IDENTIFICATION_BIRTHDATE_MISMATCH_ERROR =
  "Los primeros 6 dígitos del carné de identidad no coinciden con la fecha de nacimiento."

/** Normaliza la entrada del carné a un máximo de 11 dígitos numéricos. */
export const sanitizeIdentificationInput = (value: string): string =>
  value.replace(/\D/g, "").slice(0, IDENTIFICATION_LENGTH)

/** true si el valor (recortado) son exactamente 11 dígitos. */
export const isValidIdentification = (value: unknown): boolean =>
  IDENTIFICATION_REGEX.test(String(value ?? "").trim())

/** Normaliza dd/mm/aaaa o YYYY-MM-DD a YYYY-MM-DD si es una fecha calendario válida. */
const normalizeBirthDateIso = (birthDate: string | null | undefined): string | null => {
  const trimmed = (birthDate ?? "").trim()
  if (!trimmed) return null
  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (displayMatch) {
    const day = Number(displayMatch[1])
    const month = Number(displayMatch[2])
    const year = Number(displayMatch[3])
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
    return trimmed
  }
  return null
}

/**
 * Valida que el carné de identidad tenga 11 dígitos, que sus primeros 6 dígitos (AAMMDD)
 * correspondan a una fecha de calendario real y —si se informa `birthDate`— que coincida.
 */
export const validateIdentificationWithBirthDate = (
  value: unknown,
  birthDate?: string | null
): string | null => {
  const cleaned = String(value ?? "").trim()
  if (!IDENTIFICATION_REGEX.test(cleaned)) {
    return IDENTIFICATION_ERROR_MESSAGE
  }
  const normalizedBirth = normalizeBirthDateIso(birthDate)
  const mm = parseInt(cleaned.substring(2, 4), 10)
  const dd = parseInt(cleaned.substring(4, 6), 10)
  const yy = parseInt(cleaned.substring(0, 2), 10)
  const birthYear = normalizedBirth ? parseInt(normalizedBirth.substring(0, 4), 10) : null
  const yearToCheck =
    birthYear !== null && birthYear % 100 === yy
      ? birthYear
      : yy >= 50
        ? 1900 + yy
        : 2000 + yy

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return IDENTIFICATION_CALENDAR_DATE_ERROR
  }
  const probe = new Date(yearToCheck, mm - 1, dd)
  if (probe.getFullYear() !== yearToCheck || probe.getMonth() !== mm - 1 || probe.getDate() !== dd) {
    return IDENTIFICATION_CALENDAR_DATE_ERROR
  }

  if (normalizedBirth) {
    const birthYymmdd = `${normalizedBirth.substring(2, 4)}${normalizedBirth.substring(5, 7)}${normalizedBirth.substring(8, 10)}`
    if (cleaned.substring(0, 6) !== birthYymmdd) {
      return IDENTIFICATION_BIRTHDATE_MISMATCH_ERROR
    }
  }
  return null
}

/** true si la fecha tiene formato YYYY-MM-DD con año de 4 dígitos (1900–2100) y fecha real. */
export const isCompleteIsoDate = (value: string | null | undefined): boolean => {
  const trimmed = (value ?? "").trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2100) return false
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

/** Convierte una fecha ISO YYYY-MM-DD a formato visual DD/MM/AAAA. */
export const formatIsoDateToDisplay = (value: string | null | undefined): string => {
  const trimmed = (value ?? "").trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`
  }
  return trimmed
}
