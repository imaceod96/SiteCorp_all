import type { AddendumReasonCode } from "./entities"

/**
 * Contratos — Etiquetas de los anexos al contrato (dominio, puro).
 *
 *   Contrato   → condiciones originales (snapshot histórico)
 *   Anexo 1..N → modificaciones formalizadas de esas condiciones
 *
 * Estados:
 *   PENDING_*   → cambio detectado/preparado, todavía NO formalizado documentalmente
 *   FORMALIZED  → datos estructurados confirmados (todavía NO existe PDF/DOCX)
 *   CANCELLED   → anexo cancelado preservando la auditoría (nunca se borra)
 *
 * Sólo vocabulario del contexto: los MODELOS viven en `./entities`, el criterio de negocio en
 * `./rules` y el número de anexo, los totales y la resolución de condiciones vigentes SIEMPRE
 * los calcula el backend. Nada de este archivo consulta datos.
 */

export const ADDENDUM_STATUS_LABELS: Record<string, string> = {
  PENDING_TEMPLATE: "Pendiente de formalizar",
  READY_TO_GENERATE: "Listo para formalizar",
  GENERATED: "Generado",
  GENERATION_ERROR: "Error de generación",
  FORMALIZED: "Formalizado",
  CANCELLED: "Cancelado",
}

export const ADDENDUM_STATUS_BADGE: Record<
  string,
  "success" | "warning" | "danger" | "info" | "neutral"
> = {
  PENDING_TEMPLATE: "warning",
  READY_TO_GENERATE: "warning",
  GENERATED: "success",
  GENERATION_ERROR: "danger",
  FORMALIZED: "success",
  CANCELLED: "neutral",
}

export const ADDENDUM_REASON_LABELS: Record<string, string> = {
  POSITION_CHANGE: "Cambio de puesto",
  SALARY_CHANGE: "Cambio salarial",
  COMPENSATION_CHANGE: "Modificación de condiciones retributivas",
  PAYMENT_METHOD_CHANGE: "Cambio de forma de pago",
  WORK_LOCATION_CHANGE: "Modificación de lugar de trabajo",
  WORK_SCHEDULE_CHANGE: "Modificación de jornada u horario",
  OTHER: "Otra modificación contractual",
}

/** Motivos admitidos en un anexo manual: el puesto y el salario de escala no se editan aquí. */
export const MANUAL_ADDENDUM_REASON_CODES: AddendumReasonCode[] = [
  "COMPENSATION_CHANGE",
  "PAYMENT_METHOD_CHANGE",
  "WORK_LOCATION_CHANGE",
  "WORK_SCHEDULE_CHANGE",
  "OTHER",
]

/** Etiquetas de los campos que puede modificar un anexo (mismas que el backend). */
export const ADDENDUM_FIELD_LABELS: Record<string, string> = {
  AREA: "Área",
  JOB: "Cargo",
  POSITION: "Puesto",
  OCCUPATIONAL_CATEGORY: "Categoría ocupacional",
  SALARY_GROUP: "Grupo salarial",
  SALARY: "Salario de escala",
  WORK_LOCATION: "Lugar de trabajo",
  DAILY_HOURS: "Horas diarias",
  WEEKLY_HOURS: "Horas semanales",
  MONTHLY_HOURS: "Horas mensuales",
  WORK_SCHEDULE: "Horario",
  PAYMENT_METHOD: "Forma de pago",
  ADDITIONAL_PAYMENT: "Pagos adicionales",
  ABNORMAL_CONDITIONS: "Condiciones laborales anormales",
  OTHER_PAYMENT: "Otros pagos",
  TOTAL_COMPENSATION: "Total contractual",
}

export const addendumFieldLabel = (code: string): string => ADDENDUM_FIELD_LABELS[code] || code

export const addendumReasonLabel = (code: string | null | undefined): string =>
  code ? ADDENDUM_REASON_LABELS[code] || code : "Modificación contractual"
