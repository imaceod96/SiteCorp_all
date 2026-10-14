/**
 * Contratos y documentos — Interfaz pública del contexto.
 *
 * Contexto propio para lo que NO es la persona sino su contrato de trabajo y los documentos
 * que lo formalizan: anexos, condiciones contractuales, historial salarial, VENCIMIENTOS
 * (alertas de fin de contrato) y automatización documental. Nació al integrar el expediente,
 * para que la presentación dejara de componer consultas: las pantallas y los diálogos piden
 * CASOS DE USO.
 *
 *   · domain/entities.ts               → modelos (anexos, condiciones, historial, plantilla)
 *   · domain/rules.ts                  → criterio puro sobre los estados de un anexo
 *   · domain/contract-alerts.rules.ts  → categorías, horizontes, prioridades, filtros y
 *                                        textos de las alertas de vencimiento (criterio puro)
 *   · domain/addendum-labels.ts        → etiquetas de estados, motivos y campos del anexo
 *   · domain/salary-labels.ts          → etiquetas del historial salarial
 *   · domain/compensation.rules.ts     → conceptos retributivos: tipos aprobados, borradores,
 *                                        importes, validación y payload
 *   · domain/formats.ts                → formatos del contexto (fecha laboral e importe)
 *   · domain/automation.messages.ts    → textos de la formalización automática
 *   · application/                     → casos de uso de lectura y escritura
 *   · infrastructure/                  → Supabase, RPC, motor documental y Storage
 *
 * Dependencia en un solo sentido: presentación → aplicación → dominio → infraestructura →
 * Supabase. Este contexto NO conoce el contexto de Personas; es Personas quien lo reutiliza
 * para generar los documentos de una transición laboral (contrato, anexo), de modo que no
 * puede formarse ningún ciclo entre dominios.
 *
 * Las etiquetas, los formatos y los textos que antes se repartían entre módulos de `src/lib`
 * (anexos, condiciones contractuales, automatización e historial salarial) viven ahora en las
 * reglas puras de este dominio: la presentación consume su API pública y no existe una
 * segunda copia de ningún formato ni de ningún texto.
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

/* Etiquetas y vocabulario del contexto */
export {
  ADDENDUM_FIELD_LABELS,
  ADDENDUM_REASON_LABELS,
  ADDENDUM_STATUS_BADGE,
  ADDENDUM_STATUS_LABELS,
  MANUAL_ADDENDUM_REASON_CODES,
  addendumFieldLabel,
  addendumReasonLabel,
} from "./domain/addendum-labels"

export { SALARY_CHANGE_TYPE_LABELS } from "./domain/salary-labels"

/* Formatos del contexto (una sola implementación de cada uno) */
export {
  formatConditionDate,
  formatContractDate,
  formatContractMoney,
} from "./domain/formats"

/* Conceptos retributivos: tipos aprobados, borradores y validación de formulario */
export type {
  CompensationComponentDraft,
  CompensationComponentType,
  CompensationComponentTypeMeta,
} from "./domain/compensation.rules"

export {
  COMPENSATION_COMPONENT_TYPES,
  EMPTY_FORMALIZATION_PENDING,
  buildComponentsPayload,
  componentAmountValue,
  componentTypeLabel,
  componentsTotal,
  hasInvalidComponent,
  newComponentDraft,
  toComponentDrafts,
} from "./domain/compensation.rules"

/* Textos de la formalización automática */
export {
  MISSING_ADDENDUM_TEMPLATE_MESSAGE,
  missingContractTemplateMessage,
} from "./domain/automation.messages"

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

/* Modelos y reglas puras: alertas de vencimiento contractual */
export type {
  ContractAlertFilter,
  ContractAlertState,
  ContractAlertRow,
  ContractAlertSummary,
} from "./domain/contract-alerts.rules"

export {
  ATTENTION_STATES,
  CONTRACT_ALERT_FILTER_OPTIONS,
  CONTRACT_ALERT_FULL_HORIZON_DAYS,
  CONTRACT_ALERT_HORIZON_DAYS,
  CONTRACT_ALERT_LOOKAHEAD_DAYS,
  CONTRACT_ALERT_META,
  deadlineLabel,
  isContractAlertFilter,
  matchesContractAlertFilter,
  needsCorrection,
  requiresAttention,
  summarizeContractAlerts,
} from "./domain/contract-alerts.rules"
// `formatContractDate` se exporta más abajo, desde `domain/formats`: es la MISMA función que
// reexporta el módulo de alertas, así que aquí no se declara dos veces.

/* Casos de uso: vencimientos contractuales */
export {
  fetchContractAlerts,
  fetchWorkerContractAlert,
} from "./application/contract-alerts.queries"

/* Automatización documental (infraestructura del contexto) */
export {
  resolveContractTemplateAvailability,
  resolveAddendumTemplateAvailability,
  ensureContractDocumentGenerated,
  ensureAddendumDocumentGenerated,
} from "./infrastructure/contract-documents.repository"
