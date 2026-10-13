/**
 * Contratos y documentos — Modelos del contexto (dominio).
 *
 * Este contexto reúne lo que NO pertenece a la persona sino a su contrato de trabajo y a
 * los documentos que lo formalizan:
 *
 *   · Anexos al contrato (`contract_addendums`) — modificaciones formalizadas.
 *   · Condiciones contractuales (snapshot histórico y conceptos retributivos).
 *   · Historial salarial del trabajador y cambios de escala salarial.
 *   · Plantilla documental aplicable y generación automática del documento.
 *
 * Los modelos son los MISMOS que ya consumía la aplicación: se han trasladado desde
 * `src/lib/*` sin cambiar ningún nombre, campo ni opcionalidad, de modo que el traslado es
 * estructural. El dominio no conoce Supabase ni `@/lib/*`: eso vive en `infrastructure/`.
 */

// ---------------------------------------------------------------------------
// Anexos al contrato
// ---------------------------------------------------------------------------

export type AddendumStatus =
  | "PENDING_TEMPLATE"
  | "READY_TO_GENERATE"
  | "GENERATED"
  | "GENERATION_ERROR"
  | "FORMALIZED"
  | "CANCELLED"

export type AddendumReasonCode =
  | "POSITION_CHANGE"
  | "SALARY_CHANGE"
  | "COMPENSATION_CHANGE"
  | "PAYMENT_METHOD_CHANGE"
  | "WORK_LOCATION_CHANGE"
  | "WORK_SCHEDULE_CHANGE"
  | "OTHER"

export type AddendumSourceType =
  | "POSITION_CHANGE"
  | "SALARY_SCALE_CHANGE"
  | "MANUAL_COMPENSATION_CHANGE"
  | "MANUAL"
  | "OTHER"

export interface AddendumChange {
  id?: string
  field_code: string
  old_value: string | null
  new_value: string | null
  old_display_value: string | null
  new_display_value: string | null
  display_order: number
  old_reference_id?: string | null
  new_reference_id?: string | null
}

export interface ContractAddendum {
  id: string
  addendum_number: number | null
  employment_contract_id: string
  worker_id: string
  organization_entity_id: string
  addendum_type: string
  status: AddendumStatus
  reason_code: AddendumReasonCode | null
  reason: string | null
  notes: string | null
  effective_date: string
  signature_date: string | null
  signature_place: string | null
  representative_assignment_id: string | null
  representative_name_snapshot: string | null
  representative_position_snapshot: string | null
  representative_captured_at: string | null
  previous_amount: number | null
  new_amount: number | null
  total_before: number | null
  total_after: number | null
  currency_code: string | null
  salary_history_id: string | null
  source_type: string | null
  source_id: string | null
  payment_method_id: string | null
  previous_payment_method_id: string | null
  payment_method: { name: string } | null
  created_at: string
  formalized_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  changes: AddendumChange[]
}

export interface AddendumPending {
  blocking: string[]
  warnings: string[]
  status: string
}

/** Resultado de `create_contract_addendum` (anexo manual). */
export interface ManualAddendumResult {
  status: string
  addendum_id?: string
  addendum_number?: number | null
  addendum_status?: string
  pending?: string[]
}

export interface AddendumChangeInput {
  field_code: string
  old_value?: string | null
  new_value?: string | null
  old_display_value?: string | null
  new_display_value?: string | null
  old_reference_id?: string | null
  new_reference_id?: string | null
  display_order?: number
}

export interface FormalizedConditions {
  employment_contract_id: string
  worker_id: string
  contract_start_date: string
  contract_type_id: string | null
  has_formalized_addendums: boolean
  applied_addendums: { addendum_id: string; addendum_number: number | null; effective_date: string }[]
  last_addendum_number: number | null
  area_name: string | null
  job_name: string | null
  position_name: string | null
  position_code: string | null
  occupational_category: string | null
  work_location: string | null
  work_schedule: string | null
  daily_hours: number | null
  weekly_hours: number | null
  monthly_hours: number | null
  break_minutes: number | null
  jornada: string | null
  salary_group_id: string | null
  salary_group_sequence: number | null
  salary_amount: number | null
  currency_code: string | null
  payment_method_id: string | null
  payment_method_name: string | null
  payment_schedule: string | null
  additional_payment: number
  abnormal_conditions: number
  other_payment: number
  total_compensation: number | null
  components: {
    component_type: string
    description: string
    amount: number
    display_order: number
    addendum_id: string | null
  }[]
}

export interface WorkerContractualConditions {
  worker_id: string
  has_contract: boolean
  employment_contract_id?: string
  formalized: FormalizedConditions | null
  pending_addendums: {
    addendum_id: string
    addendum_number: number | null
    reason_code: string | null
    reason: string | null
    effective_date: string
    status: string
    total_before: number | null
    total_after: number | null
    salary_history_id: string | null
    changes: {
      field_code: string
      old_display_value: string | null
      new_display_value: string | null
      display_order: number
    }[]
  }[]
  pending_difference: number | null
}

// ---------------------------------------------------------------------------
// Condiciones contractuales
// ---------------------------------------------------------------------------

export interface PaymentMethodOption {
  id: string
  name: string
  code: string
}

/** Concepto retributivo persistido (histórico del contrato). */
export interface ContractCompensationComponent {
  id: string
  component_type: string
  description: string
  amount: number
  display_order: number
}

export interface ContractConditionsSnapshot {
  id: string
  signature_date: string | null
  signature_place: string | null
  payment_method_id: string | null
  payment_method_name: string | null
  payment_method_code: string | null
  payment_schedule_text: string | null
  salary_amount: number | null
  salary_currency_code: string | null
  salary_snapshot_status: string
  total_compensation_snapshot: number | null
  components: ContractCompensationComponent[]
}

export interface ContractFormalizationPending {
  blocking: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Historial salarial y cambios de escala
// ---------------------------------------------------------------------------

export interface WorkerSalaryHistoryEntry {
  id: string
  worker_id: string
  employment_contract_id: string | null
  assignment_id: string | null
  salary_group_id: string | null
  salary_scale_id: string | null
  previous_amount: number | null
  new_amount: number
  currency_code: string
  effective_date: string
  change_type: string
  source: string
  notes: string | null
  created_at: string
  group_sequence_number: number | null
  addendums: {
    id: string
    status: string
    effective_date: string
    document_type_id: string
    addendum_number: number | null
    previous_amount: number | null
    new_amount: number | null
    currency_code: string | null
    employment_contract_id: string | null
  }[]
}

export interface SalaryChangePreview {
  salary_group_id: string
  salary_scale_id: string
  scope_type: "PRESUPUESTADA_GLOBAL" | "EMPRESARIAL_ENTITY"
  organization_entity_id: string | null
  scale_name: string
  sequence_number: number
  group_description: string | null
  currency_code: string
  previous_amount: number | null
  previous_effective_from: string | null
  previous_effective_to: string | null
  new_amount: number
  new_effective_date: string
  difference: number | null
  variation_pct: number | null
  is_decrease: boolean
  is_retroactive: boolean
  is_future: boolean
  value_exists_on_date: boolean
  existing_amount_on_date: number | null
  workers_affected: number
  workers_with_contract: number
}

export interface SalaryChangeImpactRow {
  worker_id: string
  worker_code: string
  worker_name: string
  identification: string
  area_name: string | null
  job_name: string | null
  position_name: string | null
  group_sequence_number: number | null
  previous_amount: number
  currency_code: string
  contract_id: string | null
  contract_start_date: string | null
  contract_type_name: string | null
  assignment_id: string
  position_id: string
  job_id: string
}

export interface SalaryChangeApplyResult {
  status: "APPLIED" | "UNCHANGED"
  salary_group_value_id: string
  salary_group_id: string
  salary_scale_id: string | null
  previous_amount: number | null
  previous_effective_from: string | null
  new_amount: number
  currency_code: string
  effective_date: string
  workers_affected: number
  salary_history_created: number
  addendums_created: number
}

export interface SalaryChangeEventResult {
  event_id: string
  movements_created: number
  movements_skipped: number
  batches: number
}

// ---------------------------------------------------------------------------
// Plantilla documental y automatización
// ---------------------------------------------------------------------------

export type TemplateAvailabilityStatus = "RESOLVED" | "NONE" | "AMBIGUOUS" | "UNKNOWN"

export interface TemplateAvailability {
  status: TemplateAvailabilityStatus
  documentTypeCode: string | null
  versionId: string | null
  versionNumber: number | null
  templateName: string | null
}

export interface DocumentAutomationResult {
  /** Se generó un documento nuevo en esta llamada. */
  generated: boolean
  /** Ya existía un documento completado: no se duplica (idempotencia). */
  skipped: boolean
  result: DocumentGenerationResult | null
}

/**
 * Resultado del motor documental, con la MISMA forma que devuelve el dominio
 * `@/domains/document-generation`.
 * Se declara aquí porque el dominio no puede depender del módulo del motor y porque el
 * contexto de estructura organizativa y el de resoluciones comparten este contrato: así los
 * documentos de una transición laboral se pueden tratar igual vengan de donde vengan.
 */
export interface DocumentGenerationResult {
  success: boolean
  generationId?: string
  templateVersionId?: string
  workerDocumentId?: string
  generationNumber?: number
  docxPath?: string
  pdfPath?: string | null
  missingVariables?: { key: string; label: string }[]
  error?: string
}
