/**
 * Contratos y documentos — Interfaz pública del contexto.
 *
 * Contexto propio para lo que NO es la persona sino su contrato de trabajo y los documentos
 * que lo formalizan: anexos, condiciones contractuales, historial salarial y automatización
 * documental. Nació al integrar el expediente, para que la presentación dejara de componer
 * consultas: las pantallas y los diálogos piden CASOS DE USO.
 *
 *   · domain/entities.ts  → modelos (anexos, condiciones, historial, plantilla)
 *   · domain/rules.ts     → criterio puro sobre los estados de un anexo
 *   · application/        → casos de uso de lectura y escritura
 *   · infrastructure/     → Supabase, RPC, motor documental y Storage
 *
 * Dependencia en un solo sentido: presentación → aplicación → dominio → infraestructura →
 * Supabase. Este contexto NO conoce el contexto de Personas; es Personas quien lo reutiliza
 * para generar los documentos de una transición laboral (contrato, anexo), de modo que no
 * puede formarse ningún ciclo entre dominios.
 *
 * Las etiquetas, los formatos y los textos de los mensajes siguen en `@/lib/addendums`,
 * `@/lib/contract-conditions` y `@/lib/contract-automation`: son copy de presentación.
 */

/* Modelos */
export type {
  AddendumStatus,
  AddendumReasonCode,
  AddendumSourceType,
  AddendumChange,
  ContractAddendum,
  AddendumPending,
  ManualAddendumResult,
  AddendumChangeInput,
  FormalizedConditions,
  WorkerContractualConditions,
  PaymentMethodOption,
  ContractCompensationComponent,
  ContractConditionsSnapshot,
  ContractFormalizationPending,
  WorkerSalaryHistoryEntry,
  SalaryChangePreview,
  SalaryChangeImpactRow,
  SalaryChangeApplyResult,
  SalaryChangeEventResult,
  TemplateAvailabilityStatus,
  TemplateAvailability,
  DocumentAutomationResult,
} from "./domain/entities"

/* Reglas puras */
export { PENDING_ADDENDUM_STATUSES, isAddendumPending } from "./domain/rules"

/* Casos de uso: anexos */
export {
  fetchWorkerAddendums,
  fetchAddendumPending,
  fetchWorkerContractualConditions,
} from "./application/addendums.queries"

export {
  createManualAddendum,
  formalizeAddendum,
  cancelAddendum,
} from "./application/addendums.commands"

/* Casos de uso: condiciones contractuales */
export {
  fetchPaymentMethods,
  fetchContractFormalizationPending,
  fetchContractCompensationComponents,
  fetchComponentsByContract,
  fetchContractConditions,
} from "./application/contract-conditions.queries"

/* Casos de uso: historial y cambio salarial */
export {
  fetchWorkerSalaryHistory,
  previewSalaryChange,
  fetchSalaryChangeImpact,
} from "./application/salary.queries"

export { applySalaryChange, finalizeSalaryChangeEvent } from "./application/salary.commands"

/* Automatización documental (infraestructura del contexto) */
export {
  resolveContractTemplateAvailability,
  resolveAddendumTemplateAvailability,
  ensureContractDocumentGenerated,
  ensureAddendumDocumentGenerated,
} from "./infrastructure/contract-documents.repository"
