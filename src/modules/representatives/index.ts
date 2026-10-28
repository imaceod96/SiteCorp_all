/**
 * Representantes y datos contractuales de entidad — Interfaz pública del dominio.
 *
 * Punto único de entrada para los consumidores (componentes y páginas):
 *   · domain/entities.ts                  → contratos de datos y límite de cargos
 *   · domain/rules.ts                     → reglas puras (pendientes y formatos)
 *   · application/                        → consultas (composición de la pantalla)
 *   · infrastructure/                     → repositorio (RPC y consultas Supabase)
 *
 * El dominio NO importa de `@/lib/*` ni de la presentación: la dependencia va
 * siempre en un solo sentido (presentación → dominio → infraestructura → Supabase),
 * por lo que no puede formarse ningún ciclo.
 *
 * La capa `application/` sólo compone la pantalla de datos contractuales (permisos +
 * datos + cargos + ocupante vigente). El resto de operaciones es una única llamada
 * cuya resolución por fecha se delega al backend, así que no necesita orquestación.
 */

/* Entidades y límites */
export type {
  EntityContractData,
  EntityContractDataInput,
  EntityContractDataWorkspace,
  RepresentativeHistoryRow,
  RepresentativePositionConfig,
  RepresentativePositionConfigRow,
  RepresentativePositionRow,
} from "./domain/entities"

export { MAX_REPRESENTATIVE_POSITIONS } from "./domain/entities"

/* Reglas puras */
export {
  pendingEntityContractualData,
  representativePeriodLabel,
  formatRepresentativeDate,
} from "./domain/rules"

/* Consultas (capa de aplicación) */
export { loadEntityContractDataWorkspace } from "./application/entity-contract-data.queries"

/* Repositorio (acceso a datos) */
export {
  fetchEntityContractData,
  saveEntityContractData,
  fetchRepresentativePositions,
  fetchRepresentativePositionList,
  fetchValidRepresentatives,
  fetchRepresentativeHistory,
  createRepresentativePosition,
  changeRepresentative,
  updateRepresentativePosition,
} from "./infrastructure/representatives.repository"
