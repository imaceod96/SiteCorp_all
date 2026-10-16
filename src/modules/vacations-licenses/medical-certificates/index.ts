/**
 * Certificados Médicos — Interfaz pública del dominio.
 *
 * Punto único de importación para la presentación y para cualquier consumidor:
 *   import { createMedicalCertificate } from "@/domains/vacations-licenses/medical-certificates"
 *
 * No crea una instancia nueva de Supabase: el acceso a datos vive únicamente en
 * `infrastructure/medical-certificates.repository.ts`, que reutiliza el cliente
 * existente (`@/lib/supabase`).
 *
 * Estructura:
 *   domain/entities.ts    → tipos y contratos de datos
 *   domain/rules.ts       → reglas puras (sin React ni Supabase)
 *   infrastructure/       → adaptador Supabase (RPC y Storage)
 *
 * Sin dependencias circulares: el dominio no importa presentación ni el módulo
 * de compatibilidad.
 */

/* Tipos y contratos de datos */
export type {
  MedicalCertificateDocument,
  WorkerMedicalCertificateRow,
  WorkerMedicalCertificatesResult,
  EntityMedicalCertificateRow,
  EntityMedicalCertificatesResult,
} from "./domain/entities"

/* Reglas puras del dominio */
export { validateDocumentFile } from "./domain/rules"

/* Operaciones de infraestructura (RPC y Storage) */
export {
  fetchWorkerMedicalCertificates,
  fetchEntityMedicalCertificates,
  createMedicalCertificate,
  updateMedicalCertificate,
  getCertificateSignedUrl,
} from "./infrastructure/medical-certificates.repository"
