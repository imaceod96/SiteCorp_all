/**
 * Movimientos de Nómina — Interfaz pública del contexto.
 *
 * Punto único de entrada para los consumidores (dominios, pantallas y componentes):
 *   import { ensurePayrollMovementDocumentGenerated } from "@/domains/payroll-movements"
 *
 * Estructura:
 *   domain/entities.ts                              → tipos y contratos
 *   domain/rules.ts                                 → reglas puras (idempotencia §73)
 *   infrastructure/payroll-movements.repository.ts  → RPC del backend
 *   application/payroll-movements.queries.ts        → localizar el movimiento del evento
 *   application/payroll-movements.commands.ts       → garantizar su documento
 *
 * Límites DELIBERADOS del contexto:
 *  - La creación, la modificación, las validaciones y los estados del movimiento son del
 *    BACKEND: los consumen las operaciones que los originan (Personas, Contratos), no este
 *    dominio.
 *  - La generación documental se CONSUME de `@/domains/document-generation`: no se duplica ni
 *    el renderizado, ni el Storage, ni la selección de versión de plantilla.
 *  - La dependencia va en un solo sentido —movimientos → generación documental—, por lo que no
 *    puede formarse ningún ciclo entre dominios.
 *
 * Los nombres públicos se conservan respecto de la etapa anterior (`@/lib/payroll-movements`)
 * para no alterar a los consumidores; lo que cambia es el lugar donde vive el código.
 */

export type {
  PayrollMovementEventType,
  PayrollMovementAutomationResult,
} from "./domain/entities"

export { movementAlreadyDocumented } from "./domain/rules"

export { findPayrollMovement } from "./application/payroll-movements.queries"

export { ensurePayrollMovementDocumentGenerated } from "./application/payroll-movements.commands"
