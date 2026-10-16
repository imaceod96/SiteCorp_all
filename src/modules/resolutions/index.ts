/**
 * Barrel público del dominio de Resoluciones.
 *
 * Reexporta explícitamente los 21 símbolos originales de `src/lib/resolutions.ts`
 * para preservar la interfaz pública durante la migración DDD.
 */

// --- Constantes de dominio ---
export { RESOLUTION_DOCUMENT_TYPE } from "./domain/entities"
export {
  MISSING_RESOLUTION_TEMPLATE_MESSAGE,
  RESOLUTION_TEMPLATE_NOT_CONFIGURED,
} from "./domain/rules"

// --- Tipos e interfaces ---
export type {
  ResolutionContextWorker,
  ResolutionContextJob,
  ResolutionContextEntity,
  ResolutionRepresentative,
  ResolutionContext,
  CreateResolutionInput,
  CreatedResolution,
  ResolutionTemplateStatus,
  ResolutionTemplateAvailability,
  WorkerResolutionRow,
} from "./domain/entities"

export type { ResolutionAutomationResult } from "./infrastructure/resolutions.repository"

// --- Funciones de infraestructura ---
export {
  fetchResolutionContext,
  createWorkerResolution,
  updateJobWorkContent,
  resolveResolutionTemplateAvailability,
  fetchResolutionRequiredVariables,
  ensureResolutionDocumentGenerated,
  fetchWorkerResolutions,
} from "./infrastructure/resolutions.repository"
