/**
 * Certificados Médicos — Interfaz pública del dominio.
 */

/* Tipos y contratos de datos */
export type {
  MedicalCertificateDocument,
  WorkerMedicalCertificateRow,
  WorkerMedicalCertificatesResult,
  EntityMedicalCertificateRow,
  EntityMedicalCertificatesResult,
} from "./domain/entities"

export type { WorkerEmploymentWindow } from "./domain/rules"

/* Reglas puras del dominio */
export {
  computeMedicalCertificateDays,
  validateDocumentFile,
  validateMedicalCertificateInput,
} from "./domain/rules"

/* Operaciones de infraestructura (RPC y Storage) */
export {
  fetchWorkerEmploymentWindow,
  fetchWorkerMedicalCertificates,
  fetchEntityMedicalCertificates,
  createMedicalCertificate,
  updateMedicalCertificate,
  getCertificateSignedUrl,
} from "./infrastructure/medical-certificates.repository"
