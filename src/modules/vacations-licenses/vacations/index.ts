/**
 * Vacaciones — Interfaz pública del dominio.
 *
 * Punto único de entrada para los consumidores (hooks y componentes):
 *   · domain/entities.ts      → estados, contratos de datos y etiquetas
 *   · domain/rules.ts         → constantes y reglas puras (previsualización, formato)
 *   · application/            → casos de uso y contrato de caché de vacaciones
 *   · infrastructure/         → repositorio (RPC y consultas Supabase)
 *
 * El dominio NO importa de `@/lib/*` ni de la presentación: la dependencia va
 * siempre en un solo sentido (presentación → dominio → infraestructura → Supabase),
 * por lo que no puede formarse ningún ciclo.
 */

/* Entidades, estados y etiquetas */
export type {
  VacationStatus,
  VacationPeriodStatus,
  VacationMovementType,
  VacationSummary,
  VacationOverviewRow,
  VacationPeriod,
  VacationMovement,
} from "./domain/entities"

export {
  VACATION_STATUS_LABELS,
  VACATION_MOVEMENT_LABELS,
  VACATION_PERIOD_STATUS_LABELS,
} from "./domain/entities"

/* Constantes y reglas puras */
export {
  VACATION_ANNUAL_DAYS,
  VACATION_MAX_ACCRUAL_DAYS,
  VACATION_MIN_NATURAL_DAYS,
  VACATION_MAX_NATURAL_DAYS,
  formatVacationDays,
  previewVacationConsumption,
  vacationWorkspaceAlertsEnabled,
} from "./domain/rules"

/* Casos de uso y contrato de caché */
export type { WorkerVacationData } from "./application/vacations.queries"

export {
  vacationOverviewQueryKey,
  workerVacationQueryKey,
  loadWorkerVacationData,
  invalidateVacationData,
} from "./application/vacations.queries"

/* Repositorio (acceso a datos) */
export {
  fetchEntityVacationOverview,
  ensureWorkerVacationAccruals,
  fetchWorkerVacationSummary,
  fetchWorkerVacationPeriods,
  fetchWorkerVacationMovements,
  registerWorkerVacation,
  cancelWorkerVacation,
  adjustWorkerVacationBalance,
  setWorkerVacationOpeningBalance,
} from "./infrastructure/vacations.repository"
