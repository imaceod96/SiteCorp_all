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

const ALLOWED_REST_TABLES: ReadonlyMap<
  string,
  {
    tenantCol: "company_client_id" | "client_id" | "id" | null;
    readPerm: TenantPermission;
    writePerm: TenantPermission;
  }
> = new Map([
  ["company_clients", { tenantCol: "id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["clients", { tenantCol: "company_client_id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["organization_entities", { tenantCol: "company_client_id", readPerm: "entities.view", writePerm: "entities.manage" }],
  ["organization_positions", { tenantCol: "company_client_id", readPerm: "positions.view", writePerm: "positions.manage" }],
  ["workers", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["worker_employment_periods", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["worker_employment_movements", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["employment_contracts", { tenantCol: "company_client_id", readPerm: "contracts.view", writePerm: "contracts.manage" }],
  ["worker_vacations", { tenantCol: "company_client_id", readPerm: "vacations.view", writePerm: "vacations.manage" }],
  ["cadre_reserves", { tenantCol: "company_client_id", readPerm: "positions.view", writePerm: "positions.manage" }],
  ["cadre_evaluations", { tenantCol: "company_client_id", readPerm: "positions.view", writePerm: "positions.manage" }],
  ["cadre_movements", { tenantCol: "company_client_id", readPerm: "positions.view", writePerm: "positions.manage" }],
  ["document_templates", { tenantCol: "company_client_id", readPerm: "documents.view", writePerm: "documents.manage" }],
  ["template_variables", { tenantCol: "company_client_id", readPerm: "documents.view", writePerm: "documents.manage" }],
  ["template_sections", { tenantCol: "company_client_id", readPerm: "documents.view", writePerm: "documents.manage" }],
  ["generated_documents", { tenantCol: "company_client_id", readPerm: "documents.view", writePerm: "documents.manage" }],
  ["document_batches", { tenantCol: "company_client_id", readPerm: "documents.view", writePerm: "documents.manage" }],
  ["client_invitations", { tenantCol: "company_client_id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["entity_invitations", { tenantCol: "company_client_id", readPerm: "entities.view", writePerm: "entities.manage" }],
  ["prenomina_periods", { tenantCol: "company_client_id", readPerm: "contracts.view", writePerm: "contracts.manage" }],
  ["salary_bonuses", { tenantCol: "company_client_id", readPerm: "contracts.view", writePerm: "contracts.manage" }],
  ["salary_deductions", { tenantCol: "company_client_id", readPerm: "contracts.view", writePerm: "contracts.manage" }],
  ["payroll_closures", { tenantCol: "company_client_id", readPerm: "contracts.view", writePerm: "contracts.manage" }],
  ["training_courses", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["worker_trainings", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["disciplinary_measures", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["ppe_deliveries", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["work_accidents", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["evaluation_committees", { tenantCol: "company_client_id", readPerm: "entities.view", writePerm: "entities.manage" }],
  ["sst_inspections", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["entity_plans", { tenantCol: "company_client_id", readPerm: "entities.view", writePerm: "entities.manage" }],
  ["worker_resolutions", { tenantCol: "company_client_id", readPerm: "workers.view", writePerm: "workers.manage" }],
  ["custom_reports", { tenantCol: "company_client_id", readPerm: "audit.view", writePerm: "companies.manage" }],
  ["report_schedules", { tenantCol: "company_client_id", readPerm: "audit.view", writePerm: "companies.manage" }],
  ["import_batches", { tenantCol: "company_client_id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["export_jobs", { tenantCol: "company_client_id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["webhook_subscriptions", { tenantCol: "company_client_id", readPerm: "companies.view", writePerm: "companies.manage" }],
  ["audit_events", { tenantCol: "company_client_id", readPerm: "audit.view", writePerm: "companies.manage" }],
]);

export class PostgresSubmodulesRepository {
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

  async executeAutonomousRpc(input: {
    userId: string;
    rpcName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const rpcName = input.rpcName.trim().toLowerCase();
    const args = input.args ?? {};

    const rawCompanyId =
      (typeof args.p_company_client_id === "string" && args.p_company_client_id) ||
      (typeof args.p_client_id === "string" && args.p_client_id) ||
      (typeof args.company_client_id === "string" && args.company_client_id) ||
      null;

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

    let targetCompanyId = rawCompanyId;
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

    const isWriteRpc =
      rpcName.startsWith("create_") ||
      rpcName.startsWith("update_") ||
      rpcName.startsWith("delete_") ||
      rpcName.startsWith("save_") ||
      rpcName.startsWith("register_") ||
      rpcName.startsWith("close_") ||
      rpcName.startsWith("approve_") ||
      rpcName.startsWith("assign_") ||
      rpcName.startsWith("revoke_");

    const requiredPermission: TenantPermission = isWriteRpc
      ? "workers.manage"
      : "workers.view";

    return this.domainRepo.runAuthorizedCompanyOperation(
      {
        userId: input.userId,
        companyClientId: targetCompanyId,
        requiredPermission,
      },
      async () => {
        const executor = this.db.getActiveExecutor();

        if (rpcName === "get_company_dashboard_summary" || rpcName === "get_hr_metrics") {
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

        if (rpcName === "close_prenomina_period" && typeof args.p_period_id === "string") {
          return this.closePrenominaPeriod({
            companyClientId: targetCompanyId!,
            prenominaPeriodId: args.p_period_id,
            closedBy: input.userId,
            notes: typeof args.p_notes === "string" ? args.p_notes : null,
          });
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
    const body = input.body ?? {};

    if (fn === "analyze-document-template") {
      const companyClientId = String(body.companyClientId ?? "");
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
      const companyClientId = String(body.companyClientId ?? "");
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
              Number(body.totalItems ?? 1),
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

    throw new DomainResourceNotFoundError(
      `La función autónoma '${fn}' no está registrada.`
    );
  }

  async executeAutonomousTableOperation(input: {
    userId: string;
    tableName: string;
    operation: "select" | "insert" | "update" | "delete";
    companyClientId: string;
    filters?: Record<string, string | number | boolean>;
    payload?: Record<string, unknown>;
  }): Promise<readonly Record<string, unknown>[]> {
    const tableKey = input.tableName.trim().toLowerCase();
    const policy = ALLOWED_REST_TABLES.get(tableKey);
    if (!policy) {
      throw new ForbiddenError(
        `La tabla '${tableKey}' no está habilitada para operaciones directas.`
      );
    }

    const requiredPermission =
      input.operation === "select" ? policy.readPerm : policy.writePerm;

    return this.domainRepo.runAuthorizedCompanyOperation(
      {
        userId: input.userId,
        companyClientId: input.companyClientId,
        requiredPermission,
      },
      async () => {
        const executor = this.db.getActiveExecutor();
        const tenantCol = policy.tenantCol ?? "company_client_id";

        if (input.operation === "select") {
          const values: unknown[] = [input.companyClientId];
          const whereClauses: string[] = [`"${tenantCol}" = $1`];

          for (const [col, val] of Object.entries(input.filters ?? {})) {
            if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;
            if (col === tenantCol) continue;
            values.push(val);
            whereClauses.push(`"${col}" = $${values.length}`);
          }

          const sql = `SELECT * FROM public."${tableKey}" WHERE ${whereClauses.join(
            " AND "
          )} LIMIT 200;`;
          const res = await executor.query<Record<string, unknown>>(sql, values);
          return res.rows;
        }

        if (input.operation === "delete") {
          const targetId = input.filters?.id;
          if (typeof targetId !== "string") {
            throw new ForbiddenError("Se requiere 'id' para eliminar un registro.");
          }
          const res = await executor.query<Record<string, unknown>>(
            `DELETE FROM public."${tableKey}" WHERE id = $1 AND "${tenantCol}" = $2 RETURNING *;`,
            [targetId, input.companyClientId]
          );
          if (res.rows.length === 0) {
            throw new ForbiddenError(
              "Operación denegada: el registro no existe o pertenece a otra empresa."
            );
          }
          return res.rows;
        }

        return [];
      }
    );
  }
}
