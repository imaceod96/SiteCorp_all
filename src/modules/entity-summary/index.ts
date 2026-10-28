/**
 * Barrel público del contexto del Resumen de entidad.
 *
 * Cubre TODO lo que muestra la pantalla Resumen: los informes demográficos, el ámbito,
 * la plantilla, la ocupación, la distribución, las vacaciones y los bloques que antes
 * componía la presentación (candidatos, contratos vigentes, próximos vencimientos,
 * movimientos del período y readiness de la configuración).
 *
 *   · domain/entities.ts        → modelos de cada bloque
 *   · domain/rules.ts           → reglas puras de los informes demográficos
 *   · domain/distribution.ts    → agrupación por Área / Categoría ocupacional
 *   · domain/summary.rules.ts   → reglas de agregación de los bloques del Resumen
 *   · infrastructure/           → consultas Supabase y RPC de cada bloque
 *   · application/              → casos de uso (mismos nombres y firmas de siempre)
 *
 * Dependencias en un solo sentido: presentación → aplicación → dominio → infraestructura
 * → Supabase, y entity-summary → contracts (vencimientos) y → people (vínculo del
 * candidato), que no dependen de este contexto.
 */

// --- Informes demográficos: tipos ---
export type { ReportSlice } from "./domain/entities"
export type { AgeReport } from "./domain/entities"
export type { SexReport } from "./domain/entities"
export type { SkinColorReport } from "./domain/entities"
export type { EducationLevelReport } from "./domain/entities"
export type { CatalogRefs } from "./domain/entities"
export type { WorkersByAgeData } from "./domain/entities"
export type { AgeBucketKey } from "./domain/rules"

// --- Informes demográficos: constantes y funciones puras ---
export {
  NO_INFO_KEY,
  AGE_BUCKETS,
  reportTotal,
  ageFromBirthDate,
  ageBucketKey,
  countsToSlices,
} from "./domain/rules"

// --- Ámbito del Resumen: tipos ---
export type { SummaryScope } from "./domain/entities"
export type { EntityScopeInfo } from "./domain/entities"

// --- Informes demográficos: infraestructura ---
export { fetchEntityScope } from "./infrastructure/entity-scope.repository"
export {
  fetchCatalogRefs,
  fetchWorkersByAge,
  fetchWorkersBySex,
  fetchWorkersBySkinColor,
  fetchWorkersByEducationLevel,
} from "./infrastructure/reports.repository"

// --- Distribución y ocupación: tipos ---
export type { PositionRef } from "./domain/entities"
export type { PlantillaSummary } from "./domain/entities"
export type { OccupancySummary } from "./domain/entities"
export type { DistributionSlice } from "./domain/entities"
export type { DistributionSummary } from "./domain/entities"

// --- Distribución y ocupación: funciones puras ---
export { buildDistribution } from "./domain/distribution"

// --- Distribución y ocupación: infraestructura ---
export { fetchPlantillaSummary } from "./infrastructure/plantilla.repository"
export { fetchOccupancySummary } from "./infrastructure/occupancy.repository"

// --- Vacaciones: tipo ---
export type { VacationsSummary } from "./domain/entities"

// --- Vacaciones: infraestructura ---
export { fetchVacationsSummary } from "./infrastructure/vacations.repository"

// --- Bloques del Resumen: tipos (candidatos, contratos, movimientos, readiness) ---
export type {
  CandidatesSummary,
  ContractsSummary,
  MovementsSummary,
  ContractDataReadiness,
  RepresentativeStatus,
  SalaryScaleStatus,
  DocumentTemplatesStatus,
} from "./domain/entities"

// --- Bloques del Resumen: reglas de agregación puras ---
export {
  MOVEMENTS_WINDOW_DAYS,
  summarizeCandidates,
  summarizeContracts,
  summarizeMovements,
  summarizeContractDataReadiness,
  summarizeRepresentativeStatus,
  summarizeDocumentTemplatesStatus,
} from "./domain/summary.rules"

// --- Bloques del Resumen: casos de uso ---
export {
  fetchCandidatesSummary,
  fetchContractsSummary,
  fetchExpirationsSummary,
  fetchMovementsSummary,
  fetchContractDataReadiness,
  fetchRepresentativeStatus,
  fetchSalaryScaleStatus,
  fetchDocumentTemplatesStatus,
} from "./application/entity-summary.queries"
