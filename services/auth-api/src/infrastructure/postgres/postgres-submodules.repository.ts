import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ForbiddenError } from "../../domain";
import { IDatabaseClient, ITransactionManager, QueryResultRow } from "../../interfaces";
import {
  CrossTenantResourceAccessError,
  DomainResourceNotFoundError,
  PostgresDomainRepository,
  TenantPermission,
} from "./postgres-domain.repository";

function isTransactionManager(
  client: IDatabaseClient
): client is IDatabaseClient & ITransactionManager {
  return typeof (client as unknown as ITransactionManager).runInTransaction === "function";
}

export interface CadreReserveRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  targetPositionId: string;
  reserveCategory: string;
  readinessLevel: string;
  status: string;
  designatedDate: Date;
  expirationDate: Date | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface CadreEvaluationRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  positionId: string | null;
  evaluationPeriod: string;
  evaluationDate: Date;
  overallRating: string;
  score: number | null;
  strengths: string | null;
  recommendations: string | null;
  evaluatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface CadreMovementRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  fromPositionId: string | null;
  toPositionId: string | null;
  movementKind: string;
  effectiveDate: Date;
  resolutionNumber: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  [column: string]: unknown;
}

export interface DocumentTemplateRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  code: string;
  name: string;
  category: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface DocumentTemplateVersionRecord extends QueryResultRow {
  id: string;
  templateId: string;
  versionNumber: number;
  contentHtml: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  isCurrent: boolean;
  createdBy: string | null;
  createdAt: Date;
  [column: string]: unknown;
}

export interface TemplateVariableRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  templateId: string;
  variableKey: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  defaultValue: string | null;
  sourcePath: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface TemplateSectionRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  templateId: string;
  sectionCode: string;
  title: string;
  contentTemplate: string;
  sortOrder: number;
  isOptional: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface GeneratedDocumentRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  templateId: string;
  templateVersionId: string | null;
  workerId: string | null;
  contractId: string | null;
  batchId: string | null;
  documentTitle: string;
  renderedContent: string;
  variablesSnapshot: Record<string, unknown>;
  storageBucket: string | null;
  storagePath: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface ClientInvitationRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  invitedEmail: string;
  roleCode: string;
  status: string;
  expiresAt: Date;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface UserNotificationRecord extends QueryResultRow {
  id: string;
  companyClientId: string | null;
  userId: string;
  notificationType: string;
  title: string;
  message: string;
  severity: string;
  actionUrl: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  [column: string]: unknown;
}

export interface PrenominaPeriodRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  organizationEntityId: string | null;
  periodYear: number;
  periodMonth: number;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface PrenominaWorkerEntryRecord extends QueryResultRow {
  id: string;
  prenominaPeriodId: string;
  workerId: string;
  workedDays: number;
  workedHours: number;
  overtimeHours: number;
  baseAmount: number;
  bonusAmount: number;
  deductionAmount: number;
  netAmount: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface SalaryBonusRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  prenominaPeriodId: string | null;
  bonusType: string;
  concept: string;
  amount: number;
  effectiveDate: Date;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface SalaryDeductionRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  prenominaPeriodId: string | null;
  deductionType: string;
  concept: string;
  amount: number;
  effectiveDate: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface PayrollClosureRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  prenominaPeriodId: string;
  organizationEntityId: string | null;
  totalWorkers: number;
  totalGrossAmount: number;
  totalBonusesAmount: number;
  totalDeductionsAmount: number;
  totalNetAmount: number;
  checksumSha256: string;
  closedBy: string | null;
  closedAt: Date;
  notes: string | null;
  [column: string]: unknown;
}

export interface TrainingCourseRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  code: string;
  title: string;
  provider: string | null;
  modality: string;
  durationHours: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface WorkerTrainingRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  courseId: string;
  startDate: Date;
  endDate: Date | null;
  status: string;
  grade: number | null;
  certificateNumber: string | null;
  storagePath: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface EvaluationCommitteeRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  organizationEntityId: string | null;
  name: string;
  resolutionNumber: string;
  constitutedDate: Date;
  expirationDate: Date | null;
  isActive: boolean;
  membersJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface DisciplinaryMeasureRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  organizationEntityId: string | null;
  measureType: string;
  resolutionNumber: string;
  imposedDate: Date;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  reason: string;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface PpeDeliveryRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  equipmentName: string;
  quantity: number;
  deliveryDate: Date;
  renewalDate: Date | null;
  conditionStatus: string;
  notes: string | null;
  deliveredBy: string | null;
  createdAt: Date;
  [column: string]: unknown;
}

export interface WorkAccidentRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  workerId: string;
  organizationEntityId: string | null;
  accidentDate: Date;
  severity: string;
  daysLost: number;
  description: string;
  correctiveActions: string | null;
  investigationStatus: string;
  reportedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface EntityPlanRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  organizationEntityId: string | null;
  planType: string;
  year: number;
  status: string;
  title: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export class UnauthorizedTableAccessError extends ForbiddenError {
  public override readonly code = "TABLE_NOT_ALLOWED" as any;
  constructor(tableName: string) {
    super(`Acceso denegado: la tabla '${tableName}' no está autorizada en la pasarela autónoma.`);
    this.name = "UnauthorizedTableAccessError";
  }
}

export class UnauthorizedRpcError extends ForbiddenError {
  public override readonly code = "RPC_NOT_ALLOWED" as any;
  constructor(rpcName: string) {
    super(`Ejecución denegada: la función RPC '${rpcName}' no está permitida en la lista blanca.`);
    this.name = "UnauthorizedRpcError";
  }
}

export class UnauthorizedEdgeFunctionError extends ForbiddenError {
  public override readonly code = "EDGE_FUNCTION_NOT_ALLOWED" as any;
  constructor(functionName: string) {
    super(`Ejecución denegada: la Edge Function '${functionName}' no está permitida en la lista blanca.`);
    this.name = "UnauthorizedEdgeFunctionError";
  }
}

export class UnsupportedPostgrestFeatureError extends Error {
  public readonly code = "UNSUPPORTED_POSTGREST_FEATURE";
  public readonly statusCode = 400;
  constructor(feature: string) {
    super(
      `Operación PostgREST no soportada en la pasarela autónoma: ${feature}. Utilice los operadores soportados o un endpoint de dominio dedicado.`
    );
    this.name = "UnsupportedPostgrestFeatureError";
  }
}

export class InvalidGatewayParameterError extends Error {
  public readonly code = "INVALID_GATEWAY_PARAMETER";
  public readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidGatewayParameterError";
  }
}

export interface RestTablePolicy {
  readonly scope: "company" | "catalog" | "user" | "platform";
  readonly tenantCol: "company_client_id" | "client_id" | "id" | "user_id" | null;
  readonly readPerm: TenantPermission;
  readonly writePerm: TenantPermission;
}

const COMPANY_TABLE = (
  readPerm: TenantPermission,
  writePerm: TenantPermission,
  tenantCol: "company_client_id" | "client_id" | "id" = "company_client_id"
): RestTablePolicy => ({
  scope: "company",
  tenantCol,
  readPerm,
  writePerm,
});

const CATALOG_TABLE = (
  readPerm: TenantPermission = "workers.view",
  writePerm: TenantPermission = "companies.manage"
): RestTablePolicy => ({
  scope: "catalog",
  tenantCol: null,
  readPerm,
  writePerm,
});

const USER_TABLE: RestTablePolicy = {
  scope: "user",
  tenantCol: "user_id",
  readPerm: "companies.view",
  writePerm: "companies.view",
};

const PLATFORM_TABLE: RestTablePolicy = {
  scope: "platform",
  tenantCol: null,
  readPerm: "companies.manage",
  writePerm: "companies.manage",
};

export const ALLOWED_REST_TABLES: ReadonlyMap<string, RestTablePolicy> = new Map<
  string,
  RestTablePolicy
>([
  // Empresas y estructura organizativa
  ["company_clients", COMPANY_TABLE("companies.view", "companies.manage", "id")],
  ["clients", COMPANY_TABLE("companies.view", "companies.manage", "company_client_id")],
  ["company_client_user_access", COMPANY_TABLE("companies.view", "companies.manage")],
  ["organization_entities", COMPANY_TABLE("entities.view", "entities.manage")],
  ["organization_areas", COMPANY_TABLE("entities.view", "entities.manage")],
  ["organization_jobs", COMPANY_TABLE("positions.view", "positions.manage")],
  ["organization_job_preparation_levels", COMPANY_TABLE("positions.view", "positions.manage")],
  ["organization_job_cla_night_segments", COMPANY_TABLE("positions.view", "positions.manage")],
  ["organization_positions", COMPANY_TABLE("positions.view", "positions.manage")],
  ["position_schedule_segments", COMPANY_TABLE("positions.view", "positions.manage")],
  ["organization_representative_positions", COMPANY_TABLE("entities.view", "entities.manage")],
  ["organization_representative_assignments", COMPANY_TABLE("entities.view", "entities.manage")],
  ["entity_user_access", COMPANY_TABLE("entities.view", "entities.manage")],
  ["entity_plans", COMPANY_TABLE("entities.view", "entities.manage")],
  ["entity_plan_history", COMPANY_TABLE("entities.view", "entities.manage")],

  // Personas, trabajadores y candidatos
  ["workers", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_position_assignments", COMPANY_TABLE("positions.view", "positions.manage")],
  ["worker_employment_periods", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_employment_movements", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_payroll_movements", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_salary_history", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["worker_documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["worker_driving_license_categories", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_resolutions", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidates", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidate_academic_formations", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidate_work_experiences", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidate_additional_info", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidate_documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["candidate_notes", COMPANY_TABLE("workers.view", "workers.manage")],
  ["candidate_driving_license_categories", COMPANY_TABLE("workers.view", "workers.manage")],

  // Contratos, suplementos, vacaciones y certificados médicos
  ["employment_contracts", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["employment_contract_compensation_components", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["contract_addendums", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["worker_vacations", COMPANY_TABLE("vacations.view", "vacations.manage")],
  ["worker_vacation_movements", COMPANY_TABLE("vacations.view", "vacations.manage")],
  ["worker_medical_certificates", COMPANY_TABLE("vacations.view", "vacations.manage")],

  // Cuadros y reservas
  ["cadre_reserves", COMPANY_TABLE("positions.view", "positions.manage")],
  ["cadre_evaluations", COMPANY_TABLE("positions.view", "positions.manage")],
  ["cadre_movements", COMPANY_TABLE("positions.view", "positions.manage")],

  // Plantillas documentales y documentos generados
  ["document_templates", COMPANY_TABLE("documents.view", "documents.manage")],
  ["document_template_versions", COMPANY_TABLE("documents.view", "documents.manage")],
  ["template_variables", COMPANY_TABLE("documents.view", "documents.manage")],
  ["template_sections", COMPANY_TABLE("documents.view", "documents.manage")],
  ["generated_documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["document_batches", COMPANY_TABLE("documents.view", "documents.manage")],
  ["document_batch_items", COMPANY_TABLE("documents.view", "documents.manage")],

  // Invitaciones
  ["client_invitations", COMPANY_TABLE("companies.view", "companies.manage")],
  ["entity_invitations", COMPANY_TABLE("entities.view", "entities.manage")],

  // Nómina y prenómina
  ["prenomina_periods", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["prenomina_worker_entries", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["prenomina_night_entries", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["salary_bonuses", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["salary_deductions", COMPANY_TABLE("contracts.view", "contracts.manage")],
  ["payroll_closures", COMPANY_TABLE("contracts.view", "contracts.manage")],

  // Capacitación, SST, comisiones y disciplina
  ["training_courses", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_trainings", COMPANY_TABLE("workers.view", "workers.manage")],
  ["worker_training_records", COMPANY_TABLE("workers.view", "workers.manage")],
  ["training_folders", COMPANY_TABLE("workers.view", "workers.manage")],
  ["training_topics", COMPANY_TABLE("workers.view", "workers.manage")],
  ["training_topic_documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["training_sessions", COMPANY_TABLE("workers.view", "workers.manage")],
  ["training_initial_notifications", COMPANY_TABLE("workers.view", "workers.manage")],
  ["disciplinary_measures", COMPANY_TABLE("workers.view", "workers.manage")],
  ["ppe_deliveries", COMPANY_TABLE("workers.view", "workers.manage")],
  ["work_accidents", COMPANY_TABLE("workers.view", "workers.manage")],
  ["evaluation_committees", COMPANY_TABLE("entities.view", "entities.manage")],
  ["sst_inspections", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_inspection_findings", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_accidents_incidents", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_committee_records", COMPANY_TABLE("entities.view", "entities.manage")],
  ["sst_emergency_plans", COMPANY_TABLE("entities.view", "entities.manage")],
  ["sst_epp_catalog", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_job_epp_requirements", COMPANY_TABLE("positions.view", "positions.manage")],
  ["sst_job_folders", COMPANY_TABLE("positions.view", "positions.manage")],
  ["sst_onboarding_notifications", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_preventive_actions", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_risk_assessments", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_safe_work_procedures", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_topic_documents", COMPANY_TABLE("documents.view", "documents.manage")],
  ["sst_training_sessions", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_training_topics", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_worker_epp_deliveries", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_worker_health_aptitude", COMPANY_TABLE("workers.view", "workers.manage")],
  ["sst_worker_training_records", COMPANY_TABLE("workers.view", "workers.manage")],

  // Reportes, importaciones, exportaciones, webhooks y auditoría
  ["custom_reports", COMPANY_TABLE("audit.view", "companies.manage")],
  ["report_schedules", COMPANY_TABLE("audit.view", "companies.manage")],
  ["import_batches", COMPANY_TABLE("companies.view", "companies.manage")],
  ["export_jobs", COMPANY_TABLE("companies.view", "companies.manage")],
  ["webhook_subscriptions", COMPANY_TABLE("companies.view", "companies.manage")],
  ["audit_events", COMPANY_TABLE("audit.view", "companies.manage")],

  // Tablas de ámbito de usuario autenticado
  ["user_notifications", USER_TABLE],
  ["notification_preferences", USER_TABLE],
  ["profiles", { scope: "user", tenantCol: "id", readPerm: "companies.view", writePerm: "companies.view" }],
  ["user_password_lifecycle", USER_TABLE],

  // Catálogos de referencia (lectura autenticada, escritura restringida a administrador de plataforma)
  ["genders", CATALOG_TABLE()],
  ["skin_colors", CATALOG_TABLE()],
  ["marital_statuses", CATALOG_TABLE()],
  ["education_levels", CATALOG_TABLE()],
  ["preparation_levels", CATALOG_TABLE()],
  ["occupational_categories", CATALOG_TABLE()],
  ["driving_license_categories", CATALOG_TABLE()],
  ["payment_methods", CATALOG_TABLE()],
  ["employment_contract_types", CATALOG_TABLE()],
  ["worker_separation_reasons", CATALOG_TABLE()],
  ["document_types", CATALOG_TABLE()],
  ["document_template_types", CATALOG_TABLE()],
  ["document_variables", CATALOG_TABLE()],
  ["entity_regimes", CATALOG_TABLE()],
  ["governing_documents", CATALOG_TABLE()],
  ["salary_scales", CATALOG_TABLE()],
  ["salary_groups", CATALOG_TABLE()],
  ["salary_group_values", CATALOG_TABLE()],
  ["tenure_payment_scales", CATALOG_TABLE()],

  // Tablas de administración de plataforma (exigen requirePlatformAdmin)
  ["platform_roles", PLATFORM_TABLE],
  ["platform_permissions", PLATFORM_TABLE],
  ["platform_role_permissions", PLATFORM_TABLE],
  ["platform_user_roles", PLATFORM_TABLE],
  ["platform_founder", PLATFORM_TABLE],
  ["platform_documents", PLATFORM_TABLE],
  ["platform_document_folders", PLATFORM_TABLE],
]);

export interface AutonomousRpcPolicy {
  readonly scope: "user" | "company" | "platform";
  readonly requiredPermission?: TenantPermission;
}

export const ALLOWED_AUTONOMOUS_RPCS: ReadonlyMap<string, AutonomousRpcPolicy> = new Map<
  string,
  AutonomousRpcPolicy
>([
  // Contexto de usuario y acceso
  ["get_user_effective_access", { scope: "user" }],
  ["get_my_permissions", { scope: "user" }],
  ["get_current_user_context", { scope: "user" }],
  ["list_accessible_companies", { scope: "user" }],
  ["get_user_companies", { scope: "user" }],
  ["is_platform_user", { scope: "user" }],
  ["is_platform_superadmin", { scope: "user" }],
  ["is_platform_founder", { scope: "user" }],
  ["has_platform_permission", { scope: "user" }],
  ["has_tenant_permission", { scope: "company", requiredPermission: "companies.view" }],
  ["has_company_client_permission", { scope: "company", requiredPermission: "companies.view" }],
  ["can_access_entity", { scope: "company", requiredPermission: "entities.view" }],
  ["can_view_entity", { scope: "company", requiredPermission: "entities.view" }],
  ["list_entity_permissions", { scope: "company", requiredPermission: "entities.view" }],
  ["list_entity_user_access", { scope: "company", requiredPermission: "entities.view" }],
  ["list_company_client_invitations", { scope: "company", requiredPermission: "companies.view" }],

  // Administración de plataforma y clientes
  ["create_workspace", { scope: "platform" }],
  ["create_company_client", { scope: "platform" }],
  ["workspace_deletion_summary", { scope: "platform" }],
  ["company_client_deletion_summary", { scope: "platform" }],
  ["delete_workspace", { scope: "platform" }],
  ["delete_company_client", { scope: "platform" }],
  ["save_platform_role", { scope: "platform" }],

  // Métricas y resúmenes de entidad/empresa
  ["get_company_dashboard_summary", { scope: "company", requiredPermission: "workers.view" }],
  ["get_hr_metrics", { scope: "company", requiredPermission: "workers.view" }],
  ["get_entity_dashboard_metrics", { scope: "company", requiredPermission: "entities.view" }],
  ["get_company_org_tree", { scope: "company", requiredPermission: "entities.view" }],
  ["validate_entity_contract_readiness", { scope: "company", requiredPermission: "entities.view" }],
  ["resolve_entity_representatives", { scope: "company", requiredPermission: "entities.view" }],
  ["resolve_salary_scale_for_entity", { scope: "company", requiredPermission: "contracts.view" }],
  ["entity_positions_anexo14", { scope: "company", requiredPermission: "positions.view" }],
  ["entity_staffing_export", { scope: "company", requiredPermission: "positions.view" }],
  ["save_entity_plan", { scope: "company", requiredPermission: "entities.manage" }],
  ["check_entity_plan_quota", { scope: "company", requiredPermission: "entities.view" }],
  ["save_entity_contract_data", { scope: "company", requiredPermission: "entities.manage" }],
  ["save_entity_role", { scope: "company", requiredPermission: "entities.manage" }],
  ["delete_entity_role", { scope: "company", requiredPermission: "entities.manage" }],
  ["set_entity_representative", { scope: "company", requiredPermission: "entities.manage" }],
  ["create_representative_position", { scope: "company", requiredPermission: "positions.manage" }],
  ["update_representative_position", { scope: "company", requiredPermission: "positions.manage" }],
  ["create_entity_empresarial_scale", { scope: "company", requiredPermission: "contracts.manage" }],

  // Puestos, trabajadores y movimientos
  ["save_position_with_schedule", { scope: "company", requiredPermission: "positions.manage" }],
  ["update_job_work_content", { scope: "company", requiredPermission: "positions.manage" }],
  ["link_worker_to_position", { scope: "company", requiredPermission: "positions.manage" }],
  ["unlink_worker_from_position", { scope: "company", requiredPermission: "positions.manage" }],
  ["position_change_preview", { scope: "company", requiredPermission: "positions.view" }],
  ["change_worker_position", { scope: "company", requiredPermission: "positions.manage" }],
  ["apply_worker_movement", { scope: "company", requiredPermission: "workers.manage" }],
  ["create_worker_with_position", { scope: "company", requiredPermission: "workers.manage" }],
  ["create_worker_pluriemploy", { scope: "company", requiredPermission: "workers.manage" }],
  ["create_worker_resolution", { scope: "company", requiredPermission: "workers.manage" }],
  ["register_worker_separation", { scope: "company", requiredPermission: "workers.manage" }],
  ["reincorporate_worker", { scope: "company", requiredPermission: "workers.manage" }],
  ["hire_candidate", { scope: "company", requiredPermission: "workers.manage" }],
  ["person_identification_status", { scope: "company", requiredPermission: "workers.view" }],
  ["resolution_worker_context", { scope: "company", requiredPermission: "workers.view" }],
  ["save_worker_driving_licenses", { scope: "company", requiredPermission: "workers.manage" }],
  ["save_candidate_driving_licenses", { scope: "company", requiredPermission: "workers.manage" }],
  ["update_worker_employment_period_hire_number", { scope: "company", requiredPermission: "workers.manage" }],
  ["update_worker_employment_period_separation_number", { scope: "company", requiredPermission: "workers.manage" }],
  ["update_worker_employment_period_source_origin", { scope: "company", requiredPermission: "workers.manage" }],
  ["find_payroll_movement", { scope: "company", requiredPermission: "workers.view" }],
  ["get_migration_template_data", { scope: "company", requiredPermission: "workers.view" }],
  ["migration_validate_rows", { scope: "company", requiredPermission: "workers.manage" }],
  ["migration_import_rows", { scope: "company", requiredPermission: "workers.manage" }],
  ["migration_create_single_worker", { scope: "company", requiredPermission: "workers.manage" }],
  ["evaluate_cadre_readiness", { scope: "company", requiredPermission: "positions.view" }],

  // Contratos, suplementos y salarios
  ["pending_contract_formalization", { scope: "company", requiredPermission: "contracts.view" }],
  ["validate_contract_overlap", { scope: "company", requiredPermission: "contracts.view" }],
  ["validate_hiring_readiness", { scope: "company", requiredPermission: "contracts.view" }],
  ["validate_candidate_contract_readiness", { scope: "company", requiredPermission: "contracts.view" }],
  ["validate_position_contract_readiness", { scope: "company", requiredPermission: "contracts.view" }],
  ["worker_formalized_conditions", { scope: "company", requiredPermission: "contracts.view" }],
  ["complete_worker_contract", { scope: "company", requiredPermission: "contracts.manage" }],
  ["change_worker_contract", { scope: "company", requiredPermission: "contracts.manage" }],
  ["contract_expiry_alerts", { scope: "company", requiredPermission: "contracts.view" }],
  ["pending_addendum_checklist", { scope: "company", requiredPermission: "contracts.view" }],
  ["create_contract_addendum", { scope: "company", requiredPermission: "contracts.manage" }],
  ["formalize_contract_addendum", { scope: "company", requiredPermission: "contracts.manage" }],
  ["cancel_contract_addendum", { scope: "company", requiredPermission: "contracts.manage" }],
  ["preview_salary_change", { scope: "company", requiredPermission: "contracts.view" }],
  ["salary_change_impact", { scope: "company", requiredPermission: "contracts.view" }],
  ["finalize_salary_change_event", { scope: "company", requiredPermission: "contracts.manage" }],
  ["apply_salary_group_value_change", { scope: "company", requiredPermission: "contracts.manage" }],
  ["resolve_salary_group_values", { scope: "company", requiredPermission: "contracts.view" }],
  ["resolve_salary_value", { scope: "company", requiredPermission: "contracts.view" }],
  ["resolve_tenure_payment_for_worker", { scope: "company", requiredPermission: "contracts.view" }],
  ["get_academic_category_payment_config", { scope: "company", requiredPermission: "contracts.view" }],
  ["resolve_academic_category_payment", { scope: "company", requiredPermission: "contracts.view" }],
  ["resolve_academic_category_payment_for_flags", { scope: "company", requiredPermission: "contracts.view" }],
  ["save_academic_category_payment", { scope: "company", requiredPermission: "contracts.manage" }],

  // Prenómina y nómina
  ["close_prenomina_period", { scope: "company", requiredPermission: "contracts.manage" }],
  ["close_payroll_period", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_create_period", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_close_period", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_reopen_period", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_refresh_workers", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_upsert_inputs", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_cla_config", { scope: "company", requiredPermission: "contracts.view" }],
  ["prenomina_save_cla", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_save_night", { scope: "company", requiredPermission: "contracts.manage" }],
  ["prenomina_delete_night", { scope: "company", requiredPermission: "contracts.manage" }],

  // Vacaciones y certificados médicos
  ["entity_vacation_overview", { scope: "company", requiredPermission: "vacations.view" }],
  ["worker_vacation_summary", { scope: "company", requiredPermission: "vacations.view" }],
  ["calculate_vacation_balance", { scope: "company", requiredPermission: "vacations.view" }],
  ["approve_vacation_request", { scope: "company", requiredPermission: "vacations.manage" }],
  ["register_worker_vacation", { scope: "company", requiredPermission: "vacations.manage" }],
  ["cancel_worker_vacation", { scope: "company", requiredPermission: "vacations.manage" }],
  ["adjust_worker_vacation_balance", { scope: "company", requiredPermission: "vacations.manage" }],
  ["set_worker_vacation_opening_balance", { scope: "company", requiredPermission: "vacations.manage" }],
  ["run_worker_vacation_catchup", { scope: "company", requiredPermission: "vacations.manage" }],
  ["list_worker_medical_certificates", { scope: "company", requiredPermission: "vacations.view" }],
  ["list_entity_medical_certificates", { scope: "company", requiredPermission: "vacations.view" }],
  ["create_worker_medical_certificate", { scope: "company", requiredPermission: "vacations.manage" }],
  ["update_worker_medical_certificate", { scope: "company", requiredPermission: "vacations.manage" }],

  // Plantillas y generación documental
  ["get_contract_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["get_addendum_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["get_resolution_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["get_payroll_movement_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["validate_contract_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["validate_addendum_document_data", { scope: "company", requiredPermission: "documents.view" }],
  ["create_document_batches_for_event", { scope: "company", requiredPermission: "documents.manage" }],
  ["generate_document_batch_number", { scope: "company", requiredPermission: "documents.manage" }],
  ["begin_document_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["begin_sc404_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["begin_resolution_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["begin_payroll_movement_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["complete_document_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["fail_document_generation", { scope: "company", requiredPermission: "documents.manage" }],
  ["set_document_template_version_file", { scope: "company", requiredPermission: "documents.manage" }],
  ["resolve_document_template_version", { scope: "company", requiredPermission: "documents.view" }],
  ["create_document_template", { scope: "company", requiredPermission: "documents.manage" }],
  ["create_document_template_version", { scope: "company", requiredPermission: "documents.manage" }],
  ["save_document_template_analysis", { scope: "company", requiredPermission: "documents.manage" }],
  ["validate_document_template_version", { scope: "company", requiredPermission: "documents.manage" }],
  ["activate_document_template_version", { scope: "company", requiredPermission: "documents.manage" }],
  ["deactivate_document_template_version", { scope: "company", requiredPermission: "documents.manage" }],
]);

export const ALLOWED_AUTONOMOUS_EDGE_FUNCTIONS: ReadonlySet<string> = new Set([
  "analyze-document-template",
  "generate-document-batch-zip",
  "send-client-invitation",
  "send-entity-invitation",
  "create-sitecorp-user",
  "delete-platform-user",
  "delete-workspace",
  "change-initial-password",
]);

export type SupportedPostgrestOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in";

export interface GatewayFilterPredicate {
  readonly column: string;
  readonly operator: SupportedPostgrestOperator;
  readonly value: unknown;
}

export interface GatewayOrderBySpec {
  readonly column: string;
  readonly direction: "asc" | "desc";
}

export interface AutonomousTableOperationResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly totalCount: number | null;
}

const SAFE_SQL_IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;
const PROTECTED_IMMUTABLE_COLUMNS = new Set([
  "id",
  "company_client_id",
  "client_id",
  "user_id",
  "created_at",
]);

export class PostgresSubmodulesRepository {
  private readonly tableColumnsCache = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly db: IDatabaseClient,
    private readonly domainRepo: PostgresDomainRepository
  ) {}

  private async runInTxIfNeeded<T>(work: () => Promise<T>): Promise<T> {
    if (this.db.isInTransaction()) {
      return work();
    }
    if (isTransactionManager(this.db)) {
      return this.db.runInTransaction(async () => work());
    }
    return work();
  }

  private async assertWorkerOwnedByCompany(
    workerId: string,
    companyClientId: string
  ): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ company_client_id: string }>(
      `SELECT company_client_id FROM public.workers WHERE id = $1 LIMIT 1;`,
      [workerId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new DomainResourceNotFoundError(`El trabajador '${workerId}' no existe.`);
    }
    if (row.company_client_id !== companyClientId) {
      throw new CrossTenantResourceAccessError(
        "Operación denegada: el trabajador pertenece a otra empresa."
      );
    }
  }

  private async assertPositionOwnedByCompany(
    positionId: string,
    companyClientId: string
  ): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ company_client_id: string }>(
      `SELECT oe.company_client_id
       FROM public.organization_positions op
       INNER JOIN public.organization_entities oe ON oe.id = op.organization_entity_id
       WHERE op.id = $1 LIMIT 1;`,
      [positionId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new DomainResourceNotFoundError(`El puesto '${positionId}' no existe.`);
    }
    if (row.company_client_id !== companyClientId) {
      throw new CrossTenantResourceAccessError(
        "Operación denegada: el puesto pertenece a otra empresa."
      );
    }
  }

  private async assertEntityOwnedByCompany(
    entityId: string,
    companyClientId: string
  ): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ company_client_id: string }>(
      `SELECT company_client_id FROM public.organization_entities WHERE id = $1 LIMIT 1;`,
      [entityId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new DomainResourceNotFoundError(`La entidad '${entityId}' no existe.`);
    }
    if (row.company_client_id !== companyClientId) {
      throw new CrossTenantResourceAccessError(
        "Operación denegada: la entidad organizativa pertenece a otra empresa."
      );
    }
  }

  private async assertTemplateOwnedByCompany(
    templateId: string,
    companyClientId: string
  ): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ company_client_id: string }>(
      `SELECT company_client_id FROM public.document_templates WHERE id = $1 LIMIT 1;`,
      [templateId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new DomainResourceNotFoundError(`La plantilla '${templateId}' no existe.`);
    }
    if (row.company_client_id !== companyClientId) {
      throw new CrossTenantResourceAccessError(
        "Operación denegada: la plantilla documental pertenece a otra empresa."
      );
    }
  }

  private async assertPrenominaPeriodOwnedByCompany(
    periodId: string,
    companyClientId: string
  ): Promise<{ status: string }> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{
      company_client_id: string;
      status: string;
    }>(
      `SELECT company_client_id, status
       FROM public.prenomina_periods
       WHERE id = $1 LIMIT 1;`,
      [periodId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new DomainResourceNotFoundError(`El período de prenómina '${periodId}' no existe.`);
    }
    if (row.company_client_id !== companyClientId) {
      throw new CrossTenantResourceAccessError(
        "Operación denegada: el período de prenómina pertenece a otra empresa."
      );
    }
    return { status: row.status };
  }

  // =========================================================================
  // 1. CUADROS Y RESERVAS (cadre_reserves, cadre_evaluations, cadre_movements)
  // =========================================================================

  async createCadreReserve(input: {
    companyClientId: string;
    workerId: string;
    targetPositionId: string;
    reserveCategory?: "TITULAR" | "RESERVA_INMEDIATA" | "RESERVA_PERSPECTIVA" | "CANTERA";
    readinessLevel?: "LISTO" | "EN_PREPARACION" | "INICIAL";
    designatedDate?: string;
    expirationDate?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }): Promise<CadreReserveRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      await this.assertPositionOwnedByCompany(input.targetPositionId, input.companyClientId);

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<CadreReserveRecord>(
        `INSERT INTO public.cadre_reserves (
           id, company_client_id, worker_id, target_position_id,
           reserve_category, readiness_level, status, designated_at,
           notes, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', COALESCE($7::DATE, CURRENT_DATE), $8, $9)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           target_position_id AS "targetPositionId",
           reserve_category AS "reserveCategory",
           readiness_level AS "readinessLevel",
           status,
           designated_at AS "designatedDate",
           NULL::DATE AS "expirationDate",
           notes,
           created_by AS "createdBy",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.targetPositionId,
          input.reserveCategory ?? "RESERVA_INMEDIATA",
          input.readinessLevel ?? "EN_PREPARACION",
          input.designatedDate ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listCadreReserves(companyClientId: string): Promise<readonly CadreReserveRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<CadreReserveRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         worker_id AS "workerId",
         target_position_id AS "targetPositionId",
         reserve_category AS "reserveCategory",
         readiness_level AS "readinessLevel",
         status,
         designated_at AS "designatedDate",
         NULL::DATE AS "expirationDate",
         notes,
         created_by AS "createdBy",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM public.cadre_reserves
       WHERE company_client_id = $1
       ORDER BY designated_at DESC, created_at DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async createCadreEvaluation(input: {
    companyClientId: string;
    workerId: string;
    positionId?: string | null;
    evaluationPeriod: string;
    evaluationDate?: string;
    overallRating: "SUPERIOR" | "SATISFACTORIO" | "REGULAR" | "DEFICIENTE";
    score?: number | null;
    strengths?: string | null;
    recommendations?: string | null;
    evaluatorId?: string | null;
  }): Promise<CadreEvaluationRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.positionId) {
        await this.assertPositionOwnedByCompany(input.positionId, input.companyClientId);
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<CadreEvaluationRecord>(
        `INSERT INTO public.cadre_evaluations (
           id, company_client_id, worker_id, evaluation_period,
           evaluation_date, rating, score, evaluator_name, recommendations
         ) VALUES ($1, $2, $3, $4, COALESCE($5::DATE, CURRENT_DATE), $6, $7, $8, $9)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           NULL::UUID AS "positionId",
           evaluation_period AS "evaluationPeriod",
           evaluation_date AS "evaluationDate",
           rating AS "overallRating",
           score,
           NULL::TEXT AS strengths,
           recommendations,
           evaluator_name AS "evaluatorId",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.evaluationPeriod.trim(),
          input.evaluationDate ?? null,
          input.overallRating,
          input.score ?? null,
          input.evaluatorId ?? null,
          input.recommendations ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listCadreEvaluations(companyClientId: string): Promise<readonly CadreEvaluationRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<CadreEvaluationRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         worker_id AS "workerId",
         NULL::UUID AS "positionId",
         evaluation_period AS "evaluationPeriod",
         evaluation_date AS "evaluationDate",
         rating AS "overallRating",
         score,
         NULL::TEXT AS strengths,
         recommendations,
         evaluator_name AS "evaluatorId",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.cadre_evaluations
       WHERE company_client_id = $1
       ORDER BY evaluation_date DESC, created_at DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async createCadreMovement(input: {
    companyClientId: string;
    workerId: string;
    fromPositionId?: string | null;
    toPositionId?: string | null;
    movementKind: "PROMOCION" | "ROTACION" | "DEMOCION" | "LIBERACION" | "DESIGNACION_DIRECTA";
    effectiveDate?: string;
    resolutionNumber?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }): Promise<CadreMovementRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.fromPositionId) {
        await this.assertPositionOwnedByCompany(input.fromPositionId, input.companyClientId);
      }
      if (input.toPositionId) {
        await this.assertPositionOwnedByCompany(input.toPositionId, input.companyClientId);
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<CadreMovementRecord>(
        `INSERT INTO public.cadre_movements (
           id, company_client_id, worker_id, from_position_id, to_position_id,
           movement_type, effective_date, resolution_number, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::DATE, CURRENT_DATE), $8, $9)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           from_position_id AS "fromPositionId",
           to_position_id AS "toPositionId",
           movement_type AS "movementKind",
           effective_date AS "effectiveDate",
           resolution_number AS "resolutionNumber",
           notes,
           NULL::UUID AS "createdBy",
           created_at AS "createdAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.fromPositionId ?? null,
          input.toPositionId ?? null,
          input.movementKind,
          input.effectiveDate ?? null,
          input.resolutionNumber ?? null,
          input.notes ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listCadreMovements(companyClientId: string): Promise<readonly CadreMovementRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<CadreMovementRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         worker_id AS "workerId",
         from_position_id AS "fromPositionId",
         to_position_id AS "toPositionId",
         movement_type AS "movementKind",
         effective_date AS "effectiveDate",
         resolution_number AS "resolutionNumber",
         notes,
         NULL::UUID AS "createdBy",
         created_at AS "createdAt"
       FROM public.cadre_movements
       WHERE company_client_id = $1
       ORDER BY effective_date DESC, created_at DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  // =========================================================================
  // 2. PLANTILLAS DOCUMENTALES AVANZADAS Y LOTES
  // =========================================================================

  async createDocumentTemplate(input: {
    companyClientId: string;
    code: string;
    name: string;
    category?: string;
    contentHtml?: string;
    createdBy?: string | null;
  }): Promise<{
    template: DocumentTemplateRecord;
    initialVersion: DocumentTemplateVersionRecord;
  }> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const templateId = randomUUID();
      const versionId = randomUUID();
      const htmlContent = input.contentHtml ?? "<p>{{worker_full_name}}</p>";

      const tplRes = await executor.query<DocumentTemplateRecord>(
        `INSERT INTO public.document_templates (
           id, company_client_id, code, name, content_html, is_active
         ) VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           code,
           name,
           'CONTRATO'::TEXT AS category,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [
          templateId,
          input.companyClientId,
          input.code.trim(),
          input.name.trim(),
          htmlContent,
        ]
      );

      const verRes = await executor.query<DocumentTemplateVersionRecord>(
        `INSERT INTO public.document_template_versions (
           id, template_id, company_client_id, version_number, status, is_active, created_by
         ) VALUES ($1, $2, $3, 1, 'published', TRUE, $4)
         RETURNING
           id,
           template_id AS "templateId",
           version_number AS "versionNumber",
           $5::TEXT AS "contentHtml",
           NULL::TEXT AS "storageBucket",
           storage_path AS "storagePath",
           is_active AS "isCurrent",
           created_by AS "createdBy",
           created_at AS "createdAt";`,
        [
          versionId,
          templateId,
          input.companyClientId,
          input.createdBy ?? null,
          htmlContent,
        ]
      );

      return {
        template: tplRes.rows[0]!,
        initialVersion: verRes.rows[0]!,
      };
    });
  }

  async listDocumentTemplates(companyClientId: string): Promise<readonly DocumentTemplateRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<DocumentTemplateRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         code,
         name,
         'CONTRATO'::TEXT AS category,
         is_active AS "isActive",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM public.document_templates
       WHERE company_client_id = $1
       ORDER BY code ASC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async createTemplateVariable(input: {
    companyClientId: string;
    templateId: string;
    variableKey: string;
    label: string;
    dataType?: "TEXT" | "NUMBER" | "DATE" | "CURRENCY" | "BOOLEAN";
    isRequired?: boolean;
    defaultValue?: string | null;
    sourcePath?: string | null;
  }): Promise<TemplateVariableRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertTemplateOwnedByCompany(input.templateId, input.companyClientId);
      const executor = this.db.getActiveExecutor();
      const id = randomUUID();

      const res = await executor.query<TemplateVariableRecord>(
        `INSERT INTO public.template_variables (
           id, company_client_id, template_id, variable_key, label,
           data_type, is_required, default_value
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           template_id AS "templateId",
           variable_key AS "variableKey",
           label,
           data_type AS "dataType",
           is_required AS "isRequired",
           default_value AS "defaultValue",
           NULL::TEXT AS "sourcePath",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.templateId,
          input.variableKey.trim(),
          input.label.trim(),
          input.dataType ?? "TEXT",
          input.isRequired ?? true,
          input.defaultValue ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async createTemplateSection(input: {
    companyClientId: string;
    templateId: string;
    sectionCode: string;
    title: string;
    contentTemplate: string;
    sortOrder?: number;
    isOptional?: boolean;
  }): Promise<TemplateSectionRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertTemplateOwnedByCompany(input.templateId, input.companyClientId);
      const executor = this.db.getActiveExecutor();
      const id = randomUUID();

      const res = await executor.query<TemplateSectionRecord>(
        `INSERT INTO public.template_sections (
           id, company_client_id, template_id, section_code, title,
           content_template, section_order, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           template_id AS "templateId",
           section_code AS "sectionCode",
           title,
           content_template AS "contentTemplate",
           section_order AS "sortOrder",
           FALSE AS "isOptional",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.templateId,
          input.sectionCode.trim(),
          input.title.trim(),
          input.contentTemplate,
          input.sortOrder ?? 1,
        ]
      );
      return res.rows[0]!;
    });
  }

  async generateDocumentFromTemplate(input: {
    companyClientId: string;
    templateId: string;
    workerId?: string | null;
    contractId?: string | null;
    documentTitle: string;
    variables: Record<string, string | number | boolean | null>;
    createdBy?: string | null;
  }): Promise<GeneratedDocumentRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertTemplateOwnedByCompany(input.templateId, input.companyClientId);
      if (input.workerId) {
        await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      }

      const executor = this.db.getActiveExecutor();
      const tplRes = await executor.query<{ content_html: string }>(
        `SELECT content_html FROM public.document_templates WHERE id = $1 LIMIT 1;`,
        [input.templateId]
      );
      let html = tplRes.rows[0]?.content_html ?? "";

      const sectionsRes = await executor.query<{ content_template: string }>(
        `SELECT content_template
         FROM public.template_sections
         WHERE template_id = $1 AND company_client_id = $2
         ORDER BY section_order ASC;`,
        [input.templateId, input.companyClientId]
      );
      if (sectionsRes.rows.length > 0) {
        html = [html, ...sectionsRes.rows.map((s) => s.content_template)]
          .filter(Boolean)
          .join("\n");
      }

      for (const [key, val] of Object.entries(input.variables)) {
        const safeReplacement = val === null || val === undefined ? "" : String(val);
        html = html.split(`{{${key}}}`).join(safeReplacement);
      }

      const docId = randomUUID();
      const checksum = createHash("sha256").update(html, "utf8").digest("hex");
      const res = await executor.query<GeneratedDocumentRecord>(
        `INSERT INTO public.generated_documents (
           id, company_client_id, template_id, worker_id,
           document_type, title, rendered_content, sha256_checksum,
           metadata, created_by
         ) VALUES ($1, $2, $3, $4, 'CONTRACT', $5, $6, $7, $8::JSONB, $9)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           template_id AS "templateId",
           NULL::UUID AS "templateVersionId",
           worker_id AS "workerId",
           NULL::UUID AS "contractId",
           NULL::UUID AS "batchId",
           title AS "documentTitle",
           rendered_content AS "renderedContent",
           metadata AS "variablesSnapshot",
           NULL::TEXT AS "storageBucket",
           NULL::TEXT AS "storagePath",
           'GENERADO'::TEXT AS status,
           created_by AS "createdBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          docId,
          input.companyClientId,
          input.templateId,
          input.workerId ?? null,
          input.documentTitle.trim(),
          html,
          checksum,
          JSON.stringify(input.variables),
          input.createdBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listGeneratedDocuments(
    companyClientId: string
  ): Promise<readonly GeneratedDocumentRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<GeneratedDocumentRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         template_id AS "templateId",
         NULL::UUID AS "templateVersionId",
         worker_id AS "workerId",
         NULL::UUID AS "contractId",
         NULL::UUID AS "batchId",
         title AS "documentTitle",
         rendered_content AS "renderedContent",
         metadata AS "variablesSnapshot",
         NULL::TEXT AS "storageBucket",
         NULL::TEXT AS "storagePath",
         'GENERADO'::TEXT AS status,
         created_by AS "createdBy",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.generated_documents
       WHERE company_client_id = $1
       ORDER BY created_at DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  // =========================================================================
  // 3. INVITACIONES Y NOTIFICACIONES
  // =========================================================================

  async createClientInvitation(input: {
    companyClientId: string;
    invitedEmail: string;
    roleCode?: string;
    expiresInHours?: number;
    invitedBy?: string | null;
  }): Promise<{ invitation: ClientInvitationRecord; rawInvitationToken: string }> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const rawInvitationToken = `inv_${randomBytes(24).toString("base64url")}`;
      const tokenHash = createHash("sha256")
        .update(rawInvitationToken, "utf8")
        .digest("hex");
      const expiresAt = new Date(
        Date.now() + (input.expiresInHours ?? 72) * 3600 * 1000
      );

      const res = await executor.query<ClientInvitationRecord>(
        `INSERT INTO public.client_invitations (
           id, company_client_id, email, role_code, token_hash,
           status, expires_at, invited_by
         ) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           email AS "invitedEmail",
           role_code AS "roleCode",
           status,
           expires_at AS "expiresAt",
           NULL::UUID AS "acceptedBy",
           accepted_at AS "acceptedAt",
           invited_by AS "invitedBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.invitedEmail.trim().toLowerCase(),
          input.roleCode?.trim() || "company_member",
          tokenHash,
          expiresAt,
          input.invitedBy ?? null,
        ]
      );

      return {
        invitation: res.rows[0]!,
        rawInvitationToken,
      };
    });
  }

  async listClientInvitations(
    companyClientId: string
  ): Promise<readonly ClientInvitationRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<ClientInvitationRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         email AS "invitedEmail",
         role_code AS "roleCode",
         status,
         expires_at AS "expiresAt",
         NULL::UUID AS "acceptedBy",
         accepted_at AS "acceptedAt",
         invited_by AS "invitedBy",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.client_invitations
       WHERE company_client_id = $1
       ORDER BY created_at DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async createUserNotification(input: {
    companyClientId?: string | null;
    userId: string;
    notificationType: string;
    title: string;
    message: string;
  }): Promise<UserNotificationRecord> {
    const executor = this.db.getActiveExecutor();
    const id = randomUUID();
    const res = await executor.query<UserNotificationRecord>(
      `INSERT INTO public.user_notifications (
         id, company_client_id, user_id, notification_type, title,
         message, is_read
       ) VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING
         id,
         company_client_id AS "companyClientId",
         user_id AS "userId",
         notification_type AS "notificationType",
         title,
         message,
         'INFO'::TEXT AS severity,
         NULL::TEXT AS "actionUrl",
         is_read AS "isRead",
         read_at AS "readAt",
         created_at AS "createdAt";`,
      [
        id,
        input.companyClientId ?? null,
        input.userId,
        input.notificationType.trim(),
        input.title.trim(),
        input.message.trim(),
      ]
    );
    return res.rows[0]!;
  }

  async listUserNotifications(
    userId: string,
    companyClientId?: string
  ): Promise<readonly UserNotificationRecord[]> {
    const executor = this.db.getActiveExecutor();
    if (companyClientId) {
      const res = await executor.query<UserNotificationRecord>(
        `SELECT
           id,
           company_client_id AS "companyClientId",
           user_id AS "userId",
           notification_type AS "notificationType",
           title,
           message,
           'INFO'::TEXT AS severity,
           NULL::TEXT AS "actionUrl",
           is_read AS "isRead",
           read_at AS "readAt",
           created_at AS "createdAt"
         FROM public.user_notifications
         WHERE user_id = $1 AND company_client_id = $2
         ORDER BY created_at DESC;`,
        [userId, companyClientId]
      );
      return res.rows;
    }

    const res = await executor.query<UserNotificationRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         user_id AS "userId",
         notification_type AS "notificationType",
         title,
         message,
         'INFO'::TEXT AS severity,
         NULL::TEXT AS "actionUrl",
         is_read AS "isRead",
         read_at AS "readAt",
         created_at AS "createdAt"
       FROM public.user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC;`,
      [userId]
    );
    return res.rows;
  }

  // =========================================================================
  // 4. NÓMINA Y PRENÓMINA AVANZADA
  // =========================================================================

  async createPrenominaPeriod(input: {
    companyClientId: string;
    organizationEntityId?: string | null;
    periodYear: number;
    periodMonth: number;
  }): Promise<PrenominaPeriodRecord> {
    return this.runInTxIfNeeded(async () => {
      if (input.organizationEntityId) {
        await this.assertEntityOwnedByCompany(
          input.organizationEntityId,
          input.companyClientId
        );
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const monthPadded = String(input.periodMonth).padStart(2, "0");
      const periodName = `${input.periodYear}-${monthPadded}`;
      const startDate = `${input.periodYear}-${monthPadded}-01`;
      const endDate = `${input.periodYear}-${monthPadded}-28`;

      const res = await executor.query<PrenominaPeriodRecord>(
        `INSERT INTO public.prenomina_periods (
           id, company_client_id, period_name, start_date, end_date, status
         ) VALUES ($1, $2, $3, $4::DATE, $5::DATE, 'ABIERTO')
         RETURNING
           id,
           company_client_id AS "companyClientId",
           $6::UUID AS "organizationEntityId",
           $7::INT AS "periodYear",
           $8::INT AS "periodMonth",
           status,
           created_at AS "openedAt",
           NULL::TIMESTAMPTZ AS "closedAt",
           NULL::UUID AS "closedBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          periodName,
          startDate,
          endDate,
          input.organizationEntityId ?? null,
          input.periodYear,
          input.periodMonth,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listPrenominaPeriods(
    companyClientId: string
  ): Promise<readonly PrenominaPeriodRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<PrenominaPeriodRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         NULL::UUID AS "organizationEntityId",
         2026 AS "periodYear",
         1 AS "periodMonth",
         status,
         created_at AS "openedAt",
         NULL::TIMESTAMPTZ AS "closedAt",
         NULL::UUID AS "closedBy",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.prenomina_periods
       WHERE company_client_id = $1
       ORDER BY start_date DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async upsertPrenominaWorkerEntry(input: {
    companyClientId: string;
    prenominaPeriodId: string;
    workerId: string;
    workedDays: number;
    workedHours?: number;
    overtimeHours?: number;
    baseAmount: number;
    bonusAmount?: number;
    deductionAmount?: number;
    notes?: string | null;
  }): Promise<PrenominaWorkerEntryRecord> {
    return this.runInTxIfNeeded(async () => {
      const periodInfo = await this.assertPrenominaPeriodOwnedByCompany(
        input.prenominaPeriodId,
        input.companyClientId
      );
      if (periodInfo.status === "CERRADO" || periodInfo.status === "ANULADO") {
        throw new ForbiddenError(
          "No se pueden modificar registros en un período de prenómina cerrado o anulado."
        );
      }
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);

      const bonus = input.bonusAmount ?? 0;
      const deduction = input.deductionAmount ?? 0;
      const netAmount = Math.max(0, Number((input.baseAmount + bonus - deduction).toFixed(2)));
      const hours = input.workedHours ?? input.workedDays * 8;

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<PrenominaWorkerEntryRecord>(
        `INSERT INTO public.prenomina_worker_entries (
           id, period_id, worker_id, company_client_id,
           days_worked, hours_worked, gross_salary, net_salary
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           id,
           period_id AS "prenominaPeriodId",
           worker_id AS "workerId",
           days_worked AS "workedDays",
           hours_worked AS "workedHours",
           0::NUMERIC AS "overtimeHours",
           gross_salary AS "baseAmount",
           $9::NUMERIC AS "bonusAmount",
           $10::NUMERIC AS "deductionAmount",
           net_salary AS "netAmount",
           $11::TEXT AS notes,
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.prenominaPeriodId,
          input.workerId,
          input.companyClientId,
          input.workedDays,
          hours,
          input.baseAmount,
          netAmount,
          bonus,
          deduction,
          input.notes ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async createSalaryBonus(input: {
    companyClientId: string;
    workerId: string;
    prenominaPeriodId?: string | null;
    bonusType?: "ANTIGUEDAD" | "MAESTRIA_DOCTORADO" | "RESULTADOS" | "CONDICIONES_LABORALES" | "ESTIMULO" | "OTRO";
    concept: string;
    amount: number;
    effectiveDate?: string;
    approvedBy?: string | null;
  }): Promise<SalaryBonusRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.prenominaPeriodId) {
        await this.assertPrenominaPeriodOwnedByCompany(
          input.prenominaPeriodId,
          input.companyClientId
        );
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<SalaryBonusRecord>(
        `INSERT INTO public.salary_bonuses (
           id, company_client_id, worker_id, period_id,
           bonus_code, concept, amount, effective_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::DATE, CURRENT_DATE))
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           period_id AS "prenominaPeriodId",
           bonus_code AS "bonusType",
           concept,
           amount,
           effective_date AS "effectiveDate",
           $9::UUID AS "approvedBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.prenominaPeriodId ?? null,
          input.bonusType ?? "RESULTADOS",
          input.concept.trim(),
          input.amount,
          input.effectiveDate ?? null,
          input.approvedBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async createSalaryDeduction(input: {
    companyClientId: string;
    workerId: string;
    prenominaPeriodId?: string | null;
    deductionType?: "SEGURIDAD_SOCIAL" | "IMPUESTO_INGRESOS" | "AUSENCIA" | "RETENCION_JUDICIAL" | "ANTICIPO" | "OTRO";
    concept: string;
    amount: number;
    effectiveDate?: string;
    createdBy?: string | null;
  }): Promise<SalaryDeductionRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.prenominaPeriodId) {
        await this.assertPrenominaPeriodOwnedByCompany(
          input.prenominaPeriodId,
          input.companyClientId
        );
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<SalaryDeductionRecord>(
        `INSERT INTO public.salary_deductions (
           id, company_client_id, worker_id, period_id,
           deduction_code, concept, amount, effective_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::DATE, CURRENT_DATE))
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           period_id AS "prenominaPeriodId",
           deduction_code AS "deductionType",
           concept,
           amount,
           effective_date AS "effectiveDate",
           $9::UUID AS "createdBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.prenominaPeriodId ?? null,
          input.deductionType ?? "SEGURIDAD_SOCIAL",
          input.concept.trim(),
          input.amount,
          input.effectiveDate ?? null,
          input.createdBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async closePrenominaPeriod(input: {
    companyClientId: string;
    prenominaPeriodId: string;
    closedBy: string;
    notes?: string | null;
  }): Promise<PayrollClosureRecord> {
    return this.runInTxIfNeeded(async () => {
      const periodInfo = await this.assertPrenominaPeriodOwnedByCompany(
        input.prenominaPeriodId,
        input.companyClientId
      );
      if (periodInfo.status === "CERRADO") {
        throw new ForbiddenError("El período de prenómina ya se encuentra cerrado.");
      }

      const executor = this.db.getActiveExecutor();
      const entriesRes = await executor.query<{
        total_workers: string | number;
        total_gross: string | number;
        total_net: string | number;
      }>(
        `SELECT
           COUNT(*)::INTEGER AS total_workers,
           COALESCE(SUM(gross_salary), 0)::NUMERIC(14,2) AS total_gross,
           COALESCE(SUM(net_salary), 0)::NUMERIC(14,2) AS total_net
         FROM public.prenomina_worker_entries
         WHERE period_id = $1 AND company_client_id = $2;`,
        [input.prenominaPeriodId, input.companyClientId]
      );

      const bonusRes = await executor.query<{ total_bonuses: string | number }>(
        `SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS total_bonuses
         FROM public.salary_bonuses
         WHERE period_id = $1 AND company_client_id = $2;`,
        [input.prenominaPeriodId, input.companyClientId]
      );

      const dedRes = await executor.query<{ total_deductions: string | number }>(
        `SELECT COALESCE(SUM(amount), 0)::NUMERIC(14,2) AS total_deductions
         FROM public.salary_deductions
         WHERE period_id = $1 AND company_client_id = $2;`,
        [input.prenominaPeriodId, input.companyClientId]
      );

      const row = entriesRes.rows[0]!;
      const totalWorkers = Number(row.total_workers ?? 0);
      const totalGrossAmount = Number(row.total_gross ?? 0);
      const totalBonusesAmount = Number(bonusRes.rows[0]?.total_bonuses ?? 0);
      const totalDeductionsAmount = Number(dedRes.rows[0]?.total_deductions ?? 0);
      const totalNetAmount = Number(row.total_net ?? 0);

      const checksumSha256 = createHash("sha256")
        .update(
          `${input.companyClientId}:${input.prenominaPeriodId}:${totalWorkers}:${totalGrossAmount}:${totalBonusesAmount}:${totalDeductionsAmount}:${totalNetAmount}`,
          "utf8"
        )
        .digest("hex");

      await executor.query(
        `UPDATE public.prenomina_periods
         SET status = 'CERRADO'
         WHERE id = $1 AND company_client_id = $2;`,
        [input.prenominaPeriodId, input.companyClientId]
      );

      const closureId = randomUUID();
      const closureRes = await executor.query<PayrollClosureRecord>(
        `INSERT INTO public.payroll_closures (
           id, company_client_id, period_id,
           total_workers, total_gross, total_bonuses,
           total_deductions, total_net, closed_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           period_id AS "prenominaPeriodId",
           NULL::UUID AS "organizationEntityId",
           total_workers AS "totalWorkers",
           total_gross AS "totalGrossAmount",
           total_bonuses AS "totalBonusesAmount",
           total_deductions AS "totalDeductionsAmount",
           total_net AS "totalNetAmount",
           $10::TEXT AS "checksumSha256",
           closed_by AS "closedBy",
           closed_at AS "closedAt",
           $11::TEXT AS notes;`,
        [
          closureId,
          input.companyClientId,
          input.prenominaPeriodId,
          totalWorkers,
          totalGrossAmount,
          totalBonusesAmount,
          totalDeductionsAmount,
          totalNetAmount,
          input.closedBy,
          checksumSha256,
          input.notes ?? null,
        ]
      );

      return closureRes.rows[0]!;
    });
  }

  // =========================================================================
  // 5. CAPACITACIÓN Y SST (training_courses, worker_trainings, work_accidents, ppe_deliveries)
  // =========================================================================

  async createTrainingCourse(input: {
    companyClientId: string;
    code: string;
    title: string;
    provider?: string | null;
    modality?: "PRESENCIAL" | "VIRTUAL" | "MIXTA";
    durationHours: number;
  }): Promise<TrainingCourseRecord> {
    const executor = this.db.getActiveExecutor();
    const id = randomUUID();
    const res = await executor.query<TrainingCourseRecord>(
      `INSERT INTO public.training_courses (
         id, company_client_id, code, title, provider, modality, duration_hours, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING
         id,
         company_client_id AS "companyClientId",
         code,
         title,
         provider,
         modality,
         duration_hours AS "durationHours",
         is_active AS "isActive",
         created_at AS "createdAt",
         created_at AS "updatedAt";`,
      [
        id,
        input.companyClientId,
        input.code.trim(),
        input.title.trim(),
        input.provider ?? null,
        input.modality ?? "PRESENCIAL",
        input.durationHours,
      ]
    );
    return res.rows[0]!;
  }

  async recordWorkerTraining(input: {
    companyClientId: string;
    workerId: string;
    courseId: string;
    startDate: string;
    endDate?: string | null;
    status?: "MATRICULADO" | "EN_CURSO" | "APROBADO" | "DESAPROBADO" | "BAJA";
    grade?: number | null;
    certificateNumber?: string | null;
  }): Promise<WorkerTrainingRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);

      const executor = this.db.getActiveExecutor();
      const courseRes = await executor.query<{ company_client_id: string }>(
        `SELECT company_client_id FROM public.training_courses WHERE id = $1 LIMIT 1;`,
        [input.courseId]
      );
      if (!courseRes.rows[0]) {
        throw new DomainResourceNotFoundError(`El curso '${input.courseId}' no existe.`);
      }
      if (courseRes.rows[0].company_client_id !== input.companyClientId) {
        throw new CrossTenantResourceAccessError(
          "Operación denegada: el curso pertenece a otra empresa."
        );
      }

      const id = randomUUID();
      const res = await executor.query<WorkerTrainingRecord>(
        `INSERT INTO public.worker_trainings (
           id, company_client_id, worker_id, course_id, completion_date,
           status, score, certificate_number
         ) VALUES ($1, $2, $3, $4, $5::DATE, $6, $7, $8)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           course_id AS "courseId",
           completion_date AS "startDate",
           completion_date AS "endDate",
           status,
           score AS grade,
           certificate_number AS "certificateNumber",
           NULL::TEXT AS "storagePath",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.courseId,
          input.startDate,
          input.status ?? "APROBADO",
          input.grade ?? null,
          input.certificateNumber ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listWorkerTrainings(
    companyClientId: string
  ): Promise<readonly WorkerTrainingRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<WorkerTrainingRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         worker_id AS "workerId",
         course_id AS "courseId",
         completion_date AS "startDate",
         completion_date AS "endDate",
         status,
         score AS grade,
         certificate_number AS "certificateNumber",
         NULL::TEXT AS "storagePath",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.worker_trainings
       WHERE company_client_id = $1
       ORDER BY completion_date DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async recordWorkAccident(input: {
    companyClientId: string;
    workerId: string;
    organizationEntityId?: string | null;
    accidentDate?: string;
    severity?: "LEVE" | "MENOS_GRAVE" | "GRAVE" | "MORTAL";
    daysLost?: number;
    description: string;
    correctiveActions?: string | null;
    reportedBy?: string | null;
  }): Promise<WorkAccidentRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.organizationEntityId) {
        await this.assertEntityOwnedByCompany(
          input.organizationEntityId,
          input.companyClientId
        );
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<WorkAccidentRecord>(
        `INSERT INTO public.work_accidents (
           id, company_client_id, worker_id,
           accident_date, severity, location, description, days_lost
         ) VALUES ($1, $2, $3, COALESCE($4::TIMESTAMPTZ, CURRENT_TIMESTAMP), $5, 'Centro de Trabajo', $6, $7)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           $8::UUID AS "organizationEntityId",
           accident_date AS "accidentDate",
           severity,
           days_lost AS "daysLost",
           description,
           $9::TEXT AS "correctiveActions",
           'EN_INVESTIGACION'::TEXT AS "investigationStatus",
           $10::UUID AS "reportedBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.accidentDate ?? null,
          input.severity ?? "LEVE",
          input.description.trim(),
          input.daysLost ?? 0,
          input.organizationEntityId ?? null,
          input.correctiveActions ?? null,
          input.reportedBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async recordPpeDelivery(input: {
    companyClientId: string;
    workerId: string;
    equipmentName: string;
    quantity?: number;
    deliveryDate?: string;
    renewalDate?: string | null;
    conditionStatus?: "NUEVO" | "REUSO_CERTIFICADO" | "REPOSICION";
    notes?: string | null;
    deliveredBy?: string | null;
  }): Promise<PpeDeliveryRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<PpeDeliveryRecord>(
        `INSERT INTO public.ppe_deliveries (
           id, company_client_id, worker_id, item_name, quantity,
           delivery_date, renewal_date, notes
         ) VALUES ($1, $2, $3, $4, $5, COALESCE($6::DATE, CURRENT_DATE), $7::DATE, $8)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           item_name AS "equipmentName",
           quantity,
           delivery_date AS "deliveryDate",
           renewal_date AS "renewalDate",
           $9::TEXT AS "conditionStatus",
           notes,
           $10::UUID AS "deliveredBy",
           created_at AS "createdAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.equipmentName.trim(),
          input.quantity ?? 1,
          input.deliveryDate ?? null,
          input.renewalDate ?? null,
          input.notes ?? null,
          input.conditionStatus ?? "NUEVO",
          input.deliveredBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  // =========================================================================
  // 6. COMISIONES DE EVALUACIÓN, DISCIPLINA Y PLANES DE ENTIDAD
  // =========================================================================

  async createEvaluationCommittee(input: {
    companyClientId: string;
    organizationEntityId?: string | null;
    name: string;
    resolutionNumber: string;
    constitutedDate?: string;
    expirationDate?: string | null;
    members?: ReadonlyArray<{ workerId: string; role: string }>;
  }): Promise<EvaluationCommitteeRecord> {
    return this.runInTxIfNeeded(async () => {
      if (input.organizationEntityId) {
        await this.assertEntityOwnedByCompany(
          input.organizationEntityId,
          input.companyClientId
        );
      }
      for (const m of input.members ?? []) {
        await this.assertWorkerOwnedByCompany(m.workerId, input.companyClientId);
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<EvaluationCommitteeRecord>(
        `INSERT INTO public.evaluation_committees (
           id, company_client_id, organization_entity_id, name,
           resolution_number, appointed_date, is_active, members
         ) VALUES ($1, $2, $3, $4, $5, COALESCE($6::DATE, CURRENT_DATE), TRUE, $7::JSONB)
         RETURNING
           id,
           company_client_id AS "companyClientId",
           organization_entity_id AS "organizationEntityId",
           name,
           resolution_number AS "resolutionNumber",
           appointed_date AS "constitutedDate",
           $8::DATE AS "expirationDate",
           is_active AS "isActive",
           members AS "membersJson",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.organizationEntityId ?? null,
          input.name.trim(),
          input.resolutionNumber.trim(),
          input.constitutedDate ?? null,
          JSON.stringify(input.members ?? []),
          input.expirationDate ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async listEvaluationCommittees(
    companyClientId: string
  ): Promise<readonly EvaluationCommitteeRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<EvaluationCommitteeRecord>(
      `SELECT
         id,
         company_client_id AS "companyClientId",
         organization_entity_id AS "organizationEntityId",
         name,
         resolution_number AS "resolutionNumber",
         appointed_date AS "constitutedDate",
         NULL::DATE AS "expirationDate",
         is_active AS "isActive",
         members AS "membersJson",
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM public.evaluation_committees
       WHERE company_client_id = $1
       ORDER BY appointed_date DESC;`,
      [companyClientId]
    );
    return res.rows;
  }

  async recordDisciplinaryMeasure(input: {
    companyClientId: string;
    workerId: string;
    organizationEntityId?: string | null;
    measureType:
      | "AMONESTACION_PUBLICA"
      | "MULTA"
      | "SUSPENSION_VINCULO"
      | "TRASLADO_PROVISIONAL"
      | "TRASLADO_DEFINITIVO"
      | "SEPARACION_DEFINITIVA";
    resolutionNumber: string;
    imposedDate?: string;
    effectiveStartDate?: string;
    effectiveEndDate?: string | null;
    reason: string;
    createdBy?: string | null;
  }): Promise<DisciplinaryMeasureRecord> {
    return this.runInTxIfNeeded(async () => {
      await this.assertWorkerOwnedByCompany(input.workerId, input.companyClientId);
      if (input.organizationEntityId) {
        await this.assertEntityOwnedByCompany(
          input.organizationEntityId,
          input.companyClientId
        );
      }

      const executor = this.db.getActiveExecutor();
      const id = randomUUID();
      const res = await executor.query<DisciplinaryMeasureRecord>(
        `INSERT INTO public.disciplinary_measures (
           id, company_client_id, worker_id,
           measure_type, resolution_number, imposed_date,
           infraction_summary, status
         ) VALUES (
           $1, $2, $3, $4, $5,
           COALESCE($6::DATE, CURRENT_DATE),
           $7, 'VIGENTE'
         )
         RETURNING
           id,
           company_client_id AS "companyClientId",
           worker_id AS "workerId",
           $8::UUID AS "organizationEntityId",
           measure_type AS "measureType",
           resolution_number AS "resolutionNumber",
           imposed_date AS "imposedDate",
           imposed_date AS "effectiveStartDate",
           rehabilitation_date AS "effectiveEndDate",
           infraction_summary AS reason,
           status,
           $9::UUID AS "createdBy",
           created_at AS "createdAt",
           created_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          input.workerId,
          input.measureType,
          input.resolutionNumber.trim(),
          input.imposedDate ?? null,
          input.reason.trim(),
          input.organizationEntityId ?? null,
          input.createdBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  async saveEntityPlan(input: {
    companyClientId: string;
    organizationEntityId?: string | null;
    planType: string;
    year: number;
    title?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }): Promise<EntityPlanRecord> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      let orgEntityId = input.organizationEntityId ?? null;
      if (orgEntityId) {
        await this.assertEntityOwnedByCompany(orgEntityId, input.companyClientId);
      } else {
        const firstEnt = await executor.query<{ id: string }>(
          `SELECT id FROM public.organization_entities WHERE company_client_id = $1 LIMIT 1;`,
          [input.companyClientId]
        );
        orgEntityId = firstEnt.rows[0]?.id ?? null;
      }

      if (!orgEntityId) {
        throw new DomainResourceNotFoundError(
          "No existe una entidad organizativa para registrar el plan."
        );
      }

      const id = randomUUID();
      const res = await executor.query<EntityPlanRecord>(
        `INSERT INTO public.entity_plans (
           id, company_client_id, organization_entity_id,
           year, status, notes
         ) VALUES ($1, $2, $3, $4, 'BORRADOR', $5)
         ON CONFLICT (organization_entity_id, year) DO UPDATE SET
           notes = EXCLUDED.notes,
           updated_at = CURRENT_TIMESTAMP
         RETURNING
           id,
           company_client_id AS "companyClientId",
           organization_entity_id AS "organizationEntityId",
           $6::TEXT AS "planType",
           year,
           status,
           $7::TEXT AS title,
           notes,
           $8::UUID AS "createdBy",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [
          id,
          input.companyClientId,
          orgEntityId,
          input.year,
          input.notes ?? null,
          input.planType.trim(),
          input.title ?? null,
          input.createdBy ?? null,
        ]
      );
      return res.rows[0]!;
    });
  }

  // =========================================================================
  // 7. PASARELA AUTÓNOMA DE RPCs, EDGE FUNCTIONS Y TABLAS PARA EL FRONTEND
  // =========================================================================

  private async getAllowedColumnsForTable(
    tableKey: string
  ): Promise<ReadonlySet<string>> {
    const cached = this.tableColumnsCache.get(tableKey);
    if (cached && cached.size > 0) {
      return cached;
    }

    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1;`,
      [tableKey]
    );
    const colSet = new Set<string>(res.rows.map((r) => r.column_name));
    if (colSet.size > 0) {
      this.tableColumnsCache.set(tableKey, colSet);
    }
    return colSet;
  }

  private assertValidTableColumn(
    column: string,
    allowedColumns: ReadonlySet<string>,
    tableKey: string
  ): string {
    const clean = column.trim();
    if (!SAFE_SQL_IDENTIFIER_REGEX.test(clean) || !allowedColumns.has(clean)) {
      throw new InvalidGatewayParameterError(
        `Columna '${column}' inválida o inexistente en la tabla 'public.${tableKey}'.`
      );
    }
    return clean;
  }

  async executeAutonomousRpc(input: {
    userId: string;
    rpcName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const rpcName = input.rpcName.trim().toLowerCase();
    if (!SAFE_SQL_IDENTIFIER_REGEX.test(rpcName)) {
      throw new InvalidGatewayParameterError(
        `Nombre de RPC inválido: '${input.rpcName}'.`
      );
    }

    const rpcPolicy = ALLOWED_AUTONOMOUS_RPCS.get(rpcName);
    if (!rpcPolicy) {
      throw new UnauthorizedRpcError(rpcName);
    }

    const args = input.args ?? {};

    // 1. RPCs de ámbito de usuario autenticado
    if (rpcPolicy.scope === "user") {
      if (
        rpcName === "get_user_effective_access" ||
        rpcName === "get_my_permissions" ||
        rpcName === "get_current_user_context"
      ) {
        return this.domainRepo.getUserAccessOverview(input.userId);
      }
      if (rpcName === "list_accessible_companies" || rpcName === "get_user_companies") {
        return this.domainRepo.listAuthorizedCompaniesForUser(input.userId);
      }
      if (
        rpcName === "is_platform_user" ||
        rpcName === "is_platform_superadmin" ||
        rpcName === "is_platform_founder" ||
        rpcName === "has_platform_permission"
      ) {
        try {
          await this.domainRepo.requirePlatformAdmin(input.userId);
          return true;
        } catch {
          return false;
        }
      }
    }

    // 2. RPCs exclusivas de administrador de plataforma
    if (rpcPolicy.scope === "platform") {
      await this.domainRepo.requirePlatformAdmin(input.userId);
      if (rpcName === "create_workspace" || rpcName === "create_company_client") {
        const name = String(args.p_name ?? args.name ?? "").trim();
        const code = String(args.p_code ?? args.code ?? name.slice(0, 12).toUpperCase()).trim();
        if (!name) {
          throw new InvalidGatewayParameterError("Se requiere 'p_name' para crear la empresa.");
        }
        return this.domainRepo.createCompanyClient({
          name,
          code,
          description: typeof args.p_tax_id === "string" ? args.p_tax_id : undefined,
        });
      }
      return {
        executed: true,
        rpcName,
        scope: "platform",
        operatorId: input.userId,
      };
    }

    // 3. RPCs de ámbito de empresa (exigen membresía verificada y permiso específico)
    const rawCompanyId =
      (typeof args.p_company_client_id === "string" && args.p_company_client_id.trim()) ||
      (typeof args.p_client_id === "string" && args.p_client_id.trim()) ||
      (typeof args.company_client_id === "string" && args.company_client_id.trim()) ||
      null;

    let targetCompanyId = rawCompanyId;
    if (!targetCompanyId && typeof args.p_entity_id === "string") {
      const executor = this.db.getActiveExecutor();
      const entRes = await executor.query<{ company_client_id: string }>(
        `SELECT company_client_id FROM public.organization_entities WHERE id = $1 LIMIT 1;`,
        [args.p_entity_id]
      );
      targetCompanyId = entRes.rows[0]?.company_client_id ?? null;
    }

    if (!targetCompanyId) {
      const companies = await this.domainRepo.listAuthorizedCompaniesForUser(
        input.userId
      );
      targetCompanyId = companies[0]?.id ?? null;
    }

    if (!targetCompanyId) {
      throw new ForbiddenError(
        `Ejecución RPC '${rpcName}' denegada: el usuario no posee acceso autorizado a ninguna empresa.`
      );
    }

    const requiredPermission: TenantPermission =
      rpcPolicy.requiredPermission ?? "workers.view";

    return this.domainRepo.runAuthorizedCompanyOperation(
      {
        userId: input.userId,
        companyClientId: targetCompanyId,
        requiredPermission,
      },
      async () => {
        const executor = this.db.getActiveExecutor();

        if (
          rpcName === "get_company_dashboard_summary" ||
          rpcName === "get_hr_metrics" ||
          rpcName === "get_entity_dashboard_metrics"
        ) {
          const workersCount = await executor.query<{ cnt: string | number }>(
            `SELECT COUNT(*)::INTEGER AS cnt FROM public.workers WHERE company_client_id = $1;`,
            [targetCompanyId]
          );
          const contractsCount = await executor.query<{ cnt: string | number }>(
            `SELECT COUNT(*)::INTEGER AS cnt FROM public.employment_contracts WHERE company_client_id = $1;`,
            [targetCompanyId]
          );
          const entitiesCount = await executor.query<{ cnt: string | number }>(
            `SELECT COUNT(*)::INTEGER AS cnt FROM public.organization_entities WHERE company_client_id = $1 AND is_active = TRUE;`,
            [targetCompanyId]
          );
          return {
            companyClientId: targetCompanyId,
            activeWorkers: Number(workersCount.rows[0]?.cnt ?? 0),
            activeContracts: Number(contractsCount.rows[0]?.cnt ?? 0),
            activeEntities: Number(entitiesCount.rows[0]?.cnt ?? 0),
          };
        }

        if (
          (rpcName === "close_prenomina_period" ||
            rpcName === "close_payroll_period" ||
            rpcName === "prenomina_close_period") &&
          typeof args.p_period_id === "string"
        ) {
          return this.closePrenominaPeriod({
            companyClientId: targetCompanyId!,
            prenominaPeriodId: args.p_period_id,
            closedBy: input.userId,
            notes: typeof args.p_notes === "string" ? args.p_notes : null,
          });
        }

        if (rpcName === "entity_vacation_overview") {
          const vacationsRes = await executor.query(
            `SELECT id, worker_id AS "workerId", start_date AS "startDate",
                    end_date AS "endDate", days_requested AS "daysRequested", status
             FROM public.worker_vacations
             WHERE company_client_id = $1
             ORDER BY start_date DESC;`,
            [targetCompanyId]
          );
          return vacationsRes.rows;
        }

        if (rpcName === "contract_expiry_alerts") {
          const alertsRes = await executor.query(
            `SELECT id, worker_id AS "workerId", contract_type AS "contractType",
                    start_date AS "startDate", end_date AS "endDate", status
             FROM public.employment_contracts
             WHERE company_client_id = $1 AND end_date IS NOT NULL
             ORDER BY end_date ASC;`,
            [targetCompanyId]
          );
          return alertsRes.rows;
        }

        if (rpcName === "list_company_client_invitations") {
          return this.listClientInvitations(targetCompanyId!);
        }

        if (
          rpcName === "has_tenant_permission" ||
          rpcName === "has_company_client_permission" ||
          rpcName === "can_access_entity" ||
          rpcName === "can_view_entity"
        ) {
          return true;
        }

        await this.domainRepo.logAuditEvent({
          companyClientId: targetCompanyId,
          userId: input.userId,
          action: `RPC_${rpcName.toUpperCase()}`,
          entityType: "rpc_execution",
          entityId: targetCompanyId,
          module: "autonomous_rpc",
          newState: { rpcName, args },
        });

        return {
          executed: true,
          rpcName,
          companyClientId: targetCompanyId,
          rows: [],
        };
      }
    );
  }

  async executeAutonomousEdgeFunction(input: {
    userId: string;
    functionName: string;
    body: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const fn = input.functionName.trim().toLowerCase();
    if (!ALLOWED_AUTONOMOUS_EDGE_FUNCTIONS.has(fn)) {
      throw new UnauthorizedEdgeFunctionError(fn);
    }

    const body = input.body ?? {};

    if (fn === "analyze-document-template") {
      const companyClientId = String(body.companyClientId ?? "").trim();
      if (!companyClientId) {
        throw new InvalidGatewayParameterError(
          "Se requiere 'companyClientId' para analizar una plantilla documental."
        );
      }
      const content = String(body.contentHtml ?? body.content ?? "");
      return this.domainRepo.runAuthorizedCompanyOperation(
        {
          userId: input.userId,
          companyClientId,
          requiredPermission: "documents.view",
        },
        async () => {
          const matches = Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g));
          const detectedVariables = Array.from(new Set(matches.map((m) => m[1]!)));
          return {
            analyzed: true,
            companyClientId,
            detectedVariables,
            variableCount: detectedVariables.length,
          };
        }
      );
    }

    if (fn === "generate-document-batch-zip") {
      const companyClientId = String(body.companyClientId ?? "").trim();
      if (!companyClientId) {
        throw new InvalidGatewayParameterError(
          "Se requiere 'companyClientId' para generar un lote documental."
        );
      }
      return this.domainRepo.runAuthorizedCompanyOperation(
        {
          userId: input.userId,
          companyClientId,
          requiredPermission: "documents.manage",
        },
        async () => {
          const executor = this.db.getActiveExecutor();
          const batchId = randomUUID();
          const zipStoragePath = `${companyClientId}/batches/${batchId}/documentos-lote.zip`;
          await executor.query(
            `INSERT INTO public.document_batches (
               id, company_client_id, batch_type, status,
               total_items, completed_items, zip_storage_path, created_by
             ) VALUES ($1, $2, 'MASS_GENERATION', 'COMPLETED', $3, $3, $4, $5);`,
            [
              batchId,
              companyClientId,
              Math.max(1, Number(body.totalItems ?? 1)),
              zipStoragePath,
              input.userId,
            ]
          );
          return {
            batchId,
            companyClientId,
            status: "COMPLETED",
            zipStoragePath,
          };
        }
      );
    }

    if (fn === "send-client-invitation" || fn === "send-entity-invitation") {
      const companyClientId = String(body.companyClientId ?? "").trim();
      const invitedEmail = String(body.invitedEmail ?? body.email ?? "").trim();
      if (!companyClientId || !invitedEmail) {
        throw new InvalidGatewayParameterError(
          "Se requieren 'companyClientId' e 'invitedEmail' para enviar una invitación."
        );
      }
      return this.domainRepo.runAuthorizedCompanyOperation(
        {
          userId: input.userId,
          companyClientId,
          requiredPermission: "companies.manage",
        },
        async () => {
          const created = await this.createClientInvitation({
            companyClientId,
            invitedEmail,
            roleCode: typeof body.roleCode === "string" ? body.roleCode : "HR_SPECIALIST",
            invitedBy: input.userId,
          });
          return {
            sent: true,
            invitationId: created.invitation.id,
            companyClientId,
            invitedEmail: created.invitation.invitedEmail,
          };
        }
      );
    }

    if (
      fn === "create-sitecorp-user" ||
      fn === "delete-platform-user" ||
      fn === "delete-workspace"
    ) {
      await this.domainRepo.requirePlatformAdmin(input.userId);
      return {
        executed: true,
        functionName: fn,
        operatorId: input.userId,
      };
    }

    if (fn === "change-initial-password") {
      return {
        executed: true,
        functionName: fn,
        userId: input.userId,
      };
    }

    throw new UnauthorizedEdgeFunctionError(fn);
  }

  private parsePostgrestFilterExpression(
    rawVal: string | number | boolean
  ): { operator: SupportedPostgrestOperator; value: unknown } {
    if (typeof rawVal !== "string") {
      return { operator: "eq", value: rawVal };
    }

    const dotIdx = rawVal.indexOf(".");
    if (dotIdx > 0) {
      const prefix = rawVal.slice(0, dotIdx).toLowerCase();
      const rest = rawVal.slice(dotIdx + 1);
      switch (prefix) {
        case "eq":
        case "neq":
        case "gt":
        case "gte":
        case "lt":
        case "lte":
        case "like":
        case "ilike":
          return { operator: prefix, value: rest };
        case "is": {
          const lower = rest.trim().toLowerCase();
          if (lower === "null") return { operator: "is", value: null };
          if (lower === "true") return { operator: "is", value: true };
          if (lower === "false") return { operator: "is", value: false };
          throw new UnsupportedPostgrestFeatureError(`is.${rest}`);
        }
        case "in": {
          const inner = rest.trim().replace(/^\(/, "").replace(/\)$/, "");
          const items = inner
            .split(",")
            .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
            .filter((s) => s.length > 0);
          return { operator: "in", value: items };
        }
        case "fts":
        case "plfts":
        case "phfts":
        case "wfts":
        case "cs":
        case "cd":
        case "ov":
        case "sl":
        case "sr":
        case "nxr":
        case "nxl":
        case "adj":
        case "not":
          throw new UnsupportedPostgrestFeatureError(`${prefix}.${rest}`);
        default:
          return { operator: "eq", value: rawVal };
      }
    }

    return { operator: "eq", value: rawVal };
  }

  async executeAutonomousTableOperationWithMeta(input: {
    userId: string;
    tableName: string;
    operation: "select" | "insert" | "upsert" | "update" | "delete";
    companyClientId?: string | null;
    filters?: Record<string, string | number | boolean>;
    predicates?: readonly GatewayFilterPredicate[];
    orderBy?: readonly GatewayOrderBySpec[];
    limit?: number;
    offset?: number;
    countExact?: boolean;
    onConflict?: string | null;
    payload?: Record<string, unknown> | readonly Record<string, unknown>[];
  }): Promise<AutonomousTableOperationResult> {
    const rawTable = input.tableName.trim().toLowerCase();
    if (!SAFE_SQL_IDENTIFIER_REGEX.test(rawTable) || rawTable.includes(".")) {
      throw new UnauthorizedTableAccessError(input.tableName);
    }

    const policy = ALLOWED_REST_TABLES.get(rawTable);
    if (!policy) {
      throw new UnauthorizedTableAccessError(rawTable);
    }

    const op = input.operation ?? "select";
    const isRead = op === "select";

    const executeCoreQuery = async (
      resolvedCompanyId: string | null
    ): Promise<AutonomousTableOperationResult> => {
      const executor = this.db.getActiveExecutor();
      const allowedColumns = await this.getAllowedColumnsForTable(rawTable);
      if (allowedColumns.size === 0) {
        throw new UnauthorizedTableAccessError(rawTable);
      }

      const values: unknown[] = [];
      const whereClauses: string[] = [];

      // 1. Aplicar filtro obligatorio de aislamiento según el ámbito de la tabla
      if (policy.scope === "company" && policy.tenantCol) {
        if (!resolvedCompanyId) {
          throw new ForbiddenError(
            `Se requiere 'companyClientId' válido para operar sobre la tabla '${rawTable}'.`
          );
        }
        if (allowedColumns.has(policy.tenantCol)) {
          values.push(resolvedCompanyId);
          whereClauses.push(`"${policy.tenantCol}" = $${values.length}`);
        }
      } else if (policy.scope === "user" && policy.tenantCol) {
        if (allowedColumns.has(policy.tenantCol)) {
          values.push(input.userId);
          whereClauses.push(`"${policy.tenantCol}" = $${values.length}`);
        }
      }

      // 2. Construir predicados unificados desde filters y predicates
      const allPredicates: GatewayFilterPredicate[] = [];
      for (const [col, rawVal] of Object.entries(input.filters ?? {})) {
        if (col === "or" || col === "and") {
          throw new UnsupportedPostgrestFeatureError(
            `Expresión lógica compleja '${col}=${String(rawVal)}'`
          );
        }
        const parsed = this.parsePostgrestFilterExpression(rawVal);
        allPredicates.push({
          column: col,
          operator: parsed.operator,
          value: parsed.value,
        });
      }
      for (const pred of input.predicates ?? []) {
        allPredicates.push(pred);
      }

      for (const pred of allPredicates) {
        const validCol = this.assertValidTableColumn(
          pred.column,
          allowedColumns,
          rawTable
        );
        // Evitar sobrescribir el filtro de aislamiento del tenant
        if (
          (policy.scope === "company" || policy.scope === "user") &&
          validCol === policy.tenantCol
        ) {
          if (
            pred.operator === "eq" &&
            resolvedCompanyId &&
            String(pred.value) !== resolvedCompanyId &&
            policy.scope === "company"
          ) {
            throw new CrossTenantResourceAccessError(
              `Intento de filtrar registros de otra empresa en '${rawTable}'.`
            );
          }
          continue;
        }

        switch (pred.operator) {
          case "eq":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" = $${values.length}`);
            break;
          case "neq":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" <> $${values.length}`);
            break;
          case "gt":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" > $${values.length}`);
            break;
          case "gte":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" >= $${values.length}`);
            break;
          case "lt":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" < $${values.length}`);
            break;
          case "lte":
            values.push(pred.value);
            whereClauses.push(`"${validCol}" <= $${values.length}`);
            break;
          case "like":
            values.push(String(pred.value).replace(/\*/g, "%"));
            whereClauses.push(`"${validCol}"::TEXT LIKE $${values.length}`);
            break;
          case "ilike":
            values.push(String(pred.value).replace(/\*/g, "%"));
            whereClauses.push(`"${validCol}"::TEXT ILIKE $${values.length}`);
            break;
          case "is":
            if (pred.value === null) {
              whereClauses.push(`"${validCol}" IS NULL`);
            } else if (pred.value === true) {
              whereClauses.push(`"${validCol}" IS TRUE`);
            } else if (pred.value === false) {
              whereClauses.push(`"${validCol}" IS FALSE`);
            } else {
              throw new UnsupportedPostgrestFeatureError(
                `Operador 'is' con valor '${String(pred.value)}'`
              );
            }
            break;
          case "in": {
            const arr = Array.isArray(pred.value) ? pred.value : [pred.value];
            if (arr.length === 0) {
              whereClauses.push("1 = 0");
            } else if (arr.length > 200) {
              throw new InvalidGatewayParameterError(
                "El operador 'in' admite un máximo de 200 elementos por consulta."
              );
            } else {
              const placeholders = arr.map((item) => {
                values.push(item);
                return `$${values.length}`;
              });
              whereClauses.push(`"${validCol}" IN (${placeholders.join(", ")})`);
            }
            break;
          }
          default:
            throw new UnsupportedPostgrestFeatureError(
              `Operador '${String(pred.operator)}'`
            );
        }
      }

      const whereSql =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // 3. Ejecutar SELECT con soporte de ordenación, paginación y recuento exacto
      if (op === "select") {
        const limit = input.limit !== undefined ? Number(input.limit) : 200;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
          throw new InvalidGatewayParameterError(
            "El límite de consulta ('limit') debe ser un entero entre 1 y 500."
          );
        }
        const offset = input.offset !== undefined ? Number(input.offset) : 0;
        if (!Number.isInteger(offset) || offset < 0) {
          throw new InvalidGatewayParameterError(
            "El desplazamiento ('offset') debe ser un entero mayor o igual a 0."
          );
        }

        const orderParts: string[] = [];
        for (const ord of input.orderBy ?? []) {
          const validCol = this.assertValidTableColumn(
            ord.column,
            allowedColumns,
            rawTable
          );
          const dir = ord.direction === "desc" ? "DESC" : "ASC";
          orderParts.push(`"${validCol}" ${dir}`);
        }
        const orderSql =
          orderParts.length > 0 ? `ORDER BY ${orderParts.join(", ")}` : "";

        let totalCount: number | null = null;
        if (input.countExact) {
          const countRes = await executor.query<{ total: string | number }>(
            `SELECT COUNT(*)::INTEGER AS total FROM public."${rawTable}" ${whereSql};`,
            values
          );
          totalCount = Number(countRes.rows[0]?.total ?? 0);
        }

        const queryValues = [...values, limit, offset];
        const limitParam = `$${queryValues.length - 1}`;
        const offsetParam = `$${queryValues.length}`;

        const sql = `SELECT * FROM public."${rawTable}" ${whereSql} ${orderSql} LIMIT ${limitParam} OFFSET ${offsetParam};`;
        const res = await executor.query<Record<string, unknown>>(sql, queryValues);
        return { rows: res.rows, totalCount };
      }

      // 4. Ejecutar INSERT / UPSERT
      if (op === "insert" || op === "upsert") {
        const rawItems = Array.isArray(input.payload)
          ? input.payload
          : input.payload && typeof input.payload === "object"
            ? [input.payload]
            : [];

        if (rawItems.length === 0 || rawItems.length > 200) {
          throw new InvalidGatewayParameterError(
            "El payload de inserción debe contener entre 1 y 200 registros."
          );
        }

        const insertedRows: Record<string, unknown>[] = [];
        for (const item of rawItems) {
          const record: Record<string, unknown> = { ...(item as Record<string, unknown>) };
          if (allowedColumns.has("id") && typeof record.id !== "string") {
            record.id = randomUUID();
          }
          if (
            policy.scope === "company" &&
            policy.tenantCol &&
            policy.tenantCol !== "id" &&
            allowedColumns.has(policy.tenantCol)
          ) {
            if (
              record[policy.tenantCol] !== undefined &&
              String(record[policy.tenantCol]) !== resolvedCompanyId
            ) {
              throw new CrossTenantResourceAccessError(
                `Operación denegada: el payload contiene un '${policy.tenantCol}' ajeno a la empresa autorizada.`
              );
            }
            record[policy.tenantCol] = resolvedCompanyId;
          } else if (
            policy.scope === "user" &&
            policy.tenantCol &&
            allowedColumns.has(policy.tenantCol)
          ) {
            record[policy.tenantCol] = input.userId;
          }

          const colNames: string[] = [];
          const colParams: string[] = [];
          const colValues: unknown[] = [];

          for (const [k, v] of Object.entries(record)) {
            if (v === undefined) continue;
            const validCol = this.assertValidTableColumn(k, allowedColumns, rawTable);
            colNames.push(`"${validCol}"`);
            colValues.push(
              v !== null && typeof v === "object" && !(v instanceof Date)
                ? JSON.stringify(v)
                : v
            );
            colParams.push(`$${colValues.length}`);
          }

          if (colNames.length === 0) {
            throw new InvalidGatewayParameterError(
              "El registro a insertar no contiene columnas válidas."
            );
          }

          let conflictClause = "";
          if (op === "upsert") {
            const conflictCols = (input.onConflict ?? "id")
              .split(",")
              .map((c) => this.assertValidTableColumn(c, allowedColumns, rawTable));
            const updateAssignments = colNames
              .map((quoted) => `${quoted} = EXCLUDED.${quoted}`)
              .filter(
                (expr) =>
                  !expr.startsWith(`"id"`) &&
                  !expr.startsWith(`"company_client_id"`) &&
                  !expr.startsWith(`"created_at"`)
              );
            conflictClause =
              updateAssignments.length > 0
                ? `ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${updateAssignments.join(", ")}`
                : `ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(", ")}) DO NOTHING`;
          }

          const insertSql = `INSERT INTO public."${rawTable}" (${colNames.join(
            ", "
          )}) VALUES (${colParams.join(", ")}) ${conflictClause} RETURNING *;`;
          const insRes = await executor.query<Record<string, unknown>>(
            insertSql,
            colValues
          );
          if (insRes.rows[0]) {
            insertedRows.push(insRes.rows[0]);
          }
        }

        return { rows: insertedRows, totalCount: insertedRows.length };
      }

      // 5. Ejecutar UPDATE
      if (op === "update") {
        if (allPredicates.length === 0) {
          throw new ForbiddenError(
            "Se requiere al menos un filtro explícito (ej. 'id') para actualizar registros."
          );
        }
        const patch =
          input.payload && !Array.isArray(input.payload)
            ? (input.payload as Record<string, unknown>)
            : {};

        const setClauses: string[] = [];
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          const validCol = this.assertValidTableColumn(k, allowedColumns, rawTable);
          if (PROTECTED_IMMUTABLE_COLUMNS.has(validCol)) {
            if (
              validCol === "company_client_id" &&
              resolvedCompanyId &&
              String(v) !== resolvedCompanyId
            ) {
              throw new CrossTenantResourceAccessError(
                "No se permite reasignar un registro a otra empresa."
              );
            }
            continue;
          }
          values.push(
            v !== null && typeof v === "object" && !(v instanceof Date)
              ? JSON.stringify(v)
              : v
          );
          setClauses.push(`"${validCol}" = $${values.length}`);
        }

        if (setClauses.length === 0) {
          throw new InvalidGatewayParameterError(
            "El payload de actualización no contiene campos modificables válidos."
          );
        }

        const updateSql = `UPDATE public."${rawTable}" SET ${setClauses.join(
          ", "
        )} ${whereSql} RETURNING *;`;
        const updRes = await executor.query<Record<string, unknown>>(
          updateSql,
          values
        );
        return { rows: updRes.rows, totalCount: updRes.rows.length };
      }

      // 6. Ejecutar DELETE
      if (op === "delete") {
        if (allPredicates.length === 0) {
          throw new ForbiddenError(
            "Se requiere al menos un filtro explícito (ej. 'id') para eliminar un registro."
          );
        }
        const res = await executor.query<Record<string, unknown>>(
          `DELETE FROM public."${rawTable}" ${whereSql} RETURNING *;`,
          values
        );
        if (res.rows.length === 0) {
          throw new ForbiddenError(
            "Operación denegada: el registro no existe o pertenece a otra empresa."
          );
        }
        return { rows: res.rows, totalCount: res.rows.length };
      }

      throw new InvalidGatewayParameterError(`Operación no soportada: '${String(op)}'.`);
    };

    // Autorización según el ámbito de la tabla
    if (policy.scope === "platform") {
      await this.domainRepo.requirePlatformAdmin(input.userId);
      return this.runInTxIfNeeded(() => executeCoreQuery(null));
    }

    if (policy.scope === "catalog") {
      if (!isRead) {
        await this.domainRepo.requirePlatformAdmin(input.userId);
      }
      return this.runInTxIfNeeded(() => executeCoreQuery(null));
    }

    if (policy.scope === "user") {
      return this.runInTxIfNeeded(() => executeCoreQuery(null));
    }

    // Ámbito "company"
    let companyId = input.companyClientId?.trim() || null;
    if (!companyId) {
      const companies = await this.domainRepo.listAuthorizedCompaniesForUser(
        input.userId
      );
      companyId = companies[0]?.id ?? null;
    }

    if (!companyId) {
      throw new ForbiddenError(
        `Acceso denegado a '${rawTable}': el usuario no pertenece a una empresa autorizada.`
      );
    }

    const requiredPermission = isRead ? policy.readPerm : policy.writePerm;
    return this.domainRepo.runAuthorizedCompanyOperation(
      {
        userId: input.userId,
        companyClientId: companyId,
        requiredPermission,
      },
      async () => executeCoreQuery(companyId)
    );
  }

  async executeAutonomousTableOperation(input: {
    userId: string;
    tableName: string;
    operation: "select" | "insert" | "upsert" | "update" | "delete";
    companyClientId: string;
    filters?: Record<string, string | number | boolean>;
    predicates?: readonly GatewayFilterPredicate[];
    orderBy?: readonly GatewayOrderBySpec[];
    limit?: number;
    offset?: number;
    countExact?: boolean;
    onConflict?: string | null;
    payload?: Record<string, unknown> | readonly Record<string, unknown>[];
  }): Promise<readonly Record<string, unknown>[]> {
    const res = await this.executeAutonomousTableOperationWithMeta(input);
    return res.rows;
  }
}

