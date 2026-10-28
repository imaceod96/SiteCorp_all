import type { ContractCompensationComponent, ContractFormalizationPending } from "./entities"

/**
 * Contratos — Conceptos retributivos: reglas de formulario y de payload (dominio, puro).
 *
 * Distinción clave:
 *   SALARIO ACTUAL      → Puesto → Cargo → Grupo → Escala aplicable → valor vigente (derivado)
 *   SALARIO FORMALIZADO → snapshot del contrato (firmado e histórico, nunca recalculado)
 *
 * El salario de escala y el total contractual SIEMPRE los calcula el backend. Estas reglas
 * describen lo que el formulario admite (tipos aprobados, importes válidos) y construyen el
 * payload que viaja al backend; el backend sigue siendo quien valida y rechaza.
 */

/** Tipos de componente retributivo aprobados por el backend. */
export type CompensationComponentType =
  | "ADDITIONAL_PAYMENT"
  | "ABNORMAL_CONDITIONS"
  | "OTHER"

export interface CompensationComponentTypeMeta {
  code: CompensationComponentType
  /** Título de la sección en el formulario */
  label: string
  /** Texto de la fila de concepto */
  hint: string
}

/** Tipos de componente retributivo aprobados (no hay clasificación por texto libre). */
export const COMPENSATION_COMPONENT_TYPES: CompensationComponentTypeMeta[] = [
  {
    code: "ADDITIONAL_PAYMENT",
    label: "Pagos adicionales",
    hint: "Ej.: responsabilidad, antigüedad, coeficiente",
  },
  {
    code: "ABNORMAL_CONDITIONS",
    label: "Condiciones laborales anormales",
    hint: "Ej.: nocturnidad, trabajo en altura, ambiente insalubre",
  },
  {
    code: "OTHER",
    label: "Otros pagos",
    hint: "Otros conceptos específicos del contrato",
  },
]

export const componentTypeLabel = (code: string): string =>
  COMPENSATION_COMPONENT_TYPES.find((type) => type.code === code)?.label || code

/** Concepto retributivo en edición (importe como texto para el input). */
export interface CompensationComponentDraft {
  /** Identificador local de la fila (no se persiste) */
  key: string
  component_type: CompensationComponentType
  description: string
  amount: string
}

export const newComponentDraft = (
  componentType: CompensationComponentType = "ADDITIONAL_PAYMENT"
): CompensationComponentDraft => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  component_type: componentType,
  description: "",
  amount: "",
})

/** Checklist de formalización vacío (sin bloqueos ni avisos). */
export const EMPTY_FORMALIZATION_PENDING: ContractFormalizationPending = {
  blocking: [],
  warnings: [],
}

/** Importe de un concepto: sólo números finitos y no negativos (vacío = 0). */
export const componentAmountValue = (draft: CompensationComponentDraft): number | null => {
  const raw = draft.amount.trim().replace(",", ".")
  if (!raw) return 0
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

/** Suma de conceptos (los importes inválidos no se suman; el backend los rechaza). */
export const componentsTotal = (drafts: CompensationComponentDraft[]): number =>
  drafts.reduce((total, draft) => total + (componentAmountValue(draft) || 0), 0)

/** ¿Hay alguna fila de concepto incompleta o con importe inválido? */
export const hasInvalidComponent = (drafts: CompensationComponentDraft[]): boolean =>
  drafts.some(
    (draft) => draft.description.trim() === "" || componentAmountValue(draft) === null
  )

/** Payload que viaja al backend: tipo, descripción e importe (nunca el total). */
export const buildComponentsPayload = (
  drafts: CompensationComponentDraft[]
): { component_type: string; description: string; amount: number }[] =>
  drafts
    .filter((draft) => draft.description.trim() !== "" || draft.amount.trim() !== "")
    .map((draft) => ({
      component_type: draft.component_type,
      description: draft.description.trim(),
      amount: componentAmountValue(draft) ?? 0,
    }))

/** Convierte conceptos persistidos en filas editables (precarga de revisión). */
export const toComponentDrafts = (
  components: ContractCompensationComponent[]
): CompensationComponentDraft[] =>
  components.map((component) => ({
    key: component.id,
    component_type: (component.component_type as CompensationComponentType) || "OTHER",
    description: component.description,
    amount: String(component.amount),
  }))
