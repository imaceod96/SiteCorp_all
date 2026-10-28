/**
 * Certificados Médicos — Entidades y contratos de datos del dominio.
 *
 * Cada certificado es un EVENTO registrado en el historial del trabajador.
 * NO hay saldo, devengo, acumulación mensual, máximo anual (§2/§82).
 * La cantidad de días se introduce explícitamente, NO se calcula de fechas (§7).
 * El total anual se deriva de SUM(days) WHERE year(start_date) = year (§46).
 * El documento es obligatorio y se almacena en storage privado (§11/§14).
 *
 * Estos tipos son EXACTAMENTE los que exponía `src/lib/rpc/medical-certificates.ts`
 * antes de la migración DDD: mismos nombres, propiedades, opcionalidad y
 * estructuras de respuesta.
 */

export interface MedicalCertificateDocument {
  id: string | null
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  storage_path: string | null
}

export interface WorkerMedicalCertificateRow {
  id: string
  worker_id: string
  start_date: string
  return_date: string
  days: number
  document_id: string | null
  document: MedicalCertificateDocument | null
  created_at: string
  updated_at: string
}

/** Histórico + totales anuales de UN trabajador (una sola consulta RPC). */
export interface WorkerMedicalCertificatesResult {
  worker_id: string
  year: number | null
  certificates: WorkerMedicalCertificateRow[]
  total_days: number
  count: number
}

export interface EntityMedicalCertificateRow {
  id: string
  worker_id: string
  worker_full_name: string
  worker_identification: string
  area_name: string | null
  start_date: string
  return_date: string
  days: number
  document: MedicalCertificateDocument | null
  created_at: string
}

/**
 * Listado global + KPIs de la entidad (una sola consulta RPC).
 * Devuelve los certificados de los trabajadores de la entidad con nombre,
 * CI y área, además de total_days / count / worker_count del período.
 */
export interface EntityMedicalCertificatesResult {
  entity_id: string
  year: number | null
  certificates: EntityMedicalCertificateRow[]
  total_days: number
  count: number
  worker_count: number
}
