/**
 * Certificados Médicos — Reglas puras del dominio.
 *
 * Funciones deterministas: sin React y sin Supabase (no realizan IO).
 * Requisito documental (§11/§14): el documento justificativo es obligatorio y
 * solo se admiten los formatos y el tamaño máximo definidos aquí.
 */

export interface WorkerEmploymentWindow {
  periods: { hire_date: string; separation_date: string | null }[]
  fallbackHireDate: string | null
}

/** Formatos admitidos para el documento del certificado. */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]

/** Tamaño máximo permitido del documento (10 MB). */
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const DAY_MS = 24 * 60 * 60 * 1000

const parseIsoDateUtc = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const check = new Date(ms)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== m ||
    check.getUTCDate() !== d
  ) {
    return null
  }
  return ms
}

const formatIsoDmy = (iso: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

/**
 * Calcula los días de descanso del certificado médico como la diferencia en días
 * naturales entre la fecha de salida y la fecha de reincorporación (`return_date - start_date`).
 * Devuelve `null` si las fechas no son válidas o la reincorporación no es posterior.
 */
export function computeMedicalCertificateDays(
  startDate: string,
  returnDate: string
): number | null {
  const startMs = parseIsoDateUtc(startDate)
  const returnMs = parseIsoDateUtc(returnDate)
  if (startMs === null || returnMs === null || returnMs <= startMs) {
    return null
  }
  return Math.round((returnMs - startMs) / DAY_MS)
}

/**
 * Valida las fechas, coherencia de días y pertenencia al período laboral del trabajador.
 */
export function validateMedicalCertificateInput(input: {
  startDate: string
  returnDate: string
  days: number
  employment?: WorkerEmploymentWindow | null
}): string | null {
  if (!input.startDate) return "La fecha de salida es obligatoria."
  if (!input.returnDate) return "La fecha de reincorporación es obligatoria."

  const expectedDays = computeMedicalCertificateDays(input.startDate, input.returnDate)
  if (expectedDays === null) {
    return "La fecha de reincorporación debe ser posterior a la fecha de salida."
  }

  if (!Number.isInteger(input.days) || input.days < 1) {
    return "La cantidad de días debe ser un entero positivo (≥1)."
  }

  if (input.days !== expectedDays) {
    return `La cantidad de días (${input.days}) debe coincidir con la diferencia entre salida y reincorporación (${expectedDays} día(s)).`
  }

  if (input.employment) {
    const { periods, fallbackHireDate } = input.employment
    if (periods.length > 0) {
      const covered = periods.some(
        (p) =>
          input.startDate >= p.hire_date &&
          (p.separation_date === null || input.startDate <= p.separation_date)
      )
      if (!covered) {
        const earliestHire = periods
          .map((p) => p.hire_date)
          .sort()[0]
        return earliestHire
          ? `Las fechas del certificado médico caen fuera del período laboral del trabajador (alta: ${formatIsoDmy(earliestHire)}).`
          : "Las fechas del certificado médico caen fuera del período laboral del trabajador."
      }
    } else if (fallbackHireDate && input.startDate < fallbackHireDate) {
      return `La fecha de salida del certificado médico no puede ser anterior a la fecha de alta del trabajador (${formatIsoDmy(fallbackHireDate)}).`
    }
  }

  return null
}

/**
 * Valida el documento justificativo del certificado médico.
 * Lanza el error de dominio correspondiente si el formato no está permitido o
 * si el archivo supera el tamaño máximo.
 */
export function validateDocumentFile(file: File): void {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error("Formato no permitido. Usa PDF, DOC, DOCX, JPG, JPEG o PNG.")
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("El archivo no puede superar los 10 MB.")
  }
}
