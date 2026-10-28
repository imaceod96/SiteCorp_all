/**
 * Certificados Médicos — Reglas puras del dominio.
 *
 * Funciones deterministas: sin React y sin Supabase (no realizan IO).
 * Las condiciones, los mensajes de error, los cálculos y el tratamiento de
 * fechas son EXACTAMENTE los que ya usaba `src/lib/rpc/medical-certificates.ts`:
 * la migración no altera ninguna regla.
 *
 * Requisito documental (§11/§14): el documento justificativo es obligatorio y
 * solo se admiten los formatos y el tamaño máximo definidos aquí.
 */

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
