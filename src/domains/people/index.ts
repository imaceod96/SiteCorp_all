/**
 * Personas — Interfaz pública del dominio.
 *
 * Punto único de entrada para los consumidores (páginas y componentes):
 *   · domain/entities.ts        → identidad de persona, filas de cada vista y comandos
 *   · domain/rules.ts           → clasificación excluyente, ficha y validación del alta
 *   · application/              → casos de uso de las tres vistas y del alta
 *   · infrastructure/           → repositorios (consultas Supabase, RPC y Storage)
 *
 * El dominio NO importa de `@/lib/*` ni de la presentación: la dependencia va siempre en
 * un solo sentido (presentación → aplicación → dominio → infraestructura → Supabase), así
 * que no puede formarse ningún ciclo. Las páginas consumen CASOS DE USO: no componen
 * consultas ni repiten el criterio de clasificación.
 *
 * Alcance de este bloque: registro y ciclo laboral de Personas (Candidatos · Trabajadores
 * · Reingresos). El expediente detallado, la contratación y las transiciones
 * (reubicación, cambio de contrato, baja y reincorporación) siguen en su módulo actual.
 */

/* Entidades, estados y comandos */
export type {
  PeopleView,
  PersonIdentity,
  EmploymentRecord,
  EmploymentIndex,
  PersonCandidate,
  PersonDirectoryWorker,
  PersonReentryWorker,
  PersonSeparation,
  CatalogRow,
  CatalogOption,
  PersonRegistryCatalogs,
  PersonIdentificationStatus,
  CandidateRegistrationInput,
} from "./domain/entities"

export { EMPLOYMENT_STATUS } from "./domain/entities"

/* Reglas puras */
export {
  PeopleRuleError,
  emptyEmploymentIndex,
  buildEmploymentIndex,
  hasLinkedWorker,
  isPendingCandidate,
  isActiveWorker,
  isReentryWorker,
  filterUnlinkedCandidates,
  filterActiveWorkers,
  filterReentryWorkers,
  personFullName,
  missingPersonProfileFields,
  candidateRequiresSpecialty,
  convertDisplayDateToISO,
  validateCandidateRegistration,
  personRegistrationConflict,
} from "./domain/rules"

/* Casos de uso (lectura) */
export type {
  EntityCandidatesView,
  EntityWorkersDirectoryView,
  EntityReentriesView,
} from "./application/people.queries"

export {
  loadEntityCandidatesView,
  loadEntityWorkersDirectory,
  loadEntityReentriesView,
  loadCandidateRegistryCatalogs,
} from "./application/people.queries"

/* Casos de uso (escritura) */
export type { RegisterCandidateCommand } from "./application/people.commands"

export { registerCandidate } from "./application/people.commands"
