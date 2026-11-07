import { randomUUID } from "node:crypto";
import { IDatabaseClient, QueryResultRow } from "../../interfaces";

export interface CompanyClientRecord extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface OrganizationEntityRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  parentId: string | null;
  name: string;
  entityType: string;
  code: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface WorkerRecord extends QueryResultRow {
  id: string;
  companyClientId: string;
  identificationNumber: string;
  firstName: string;
  lastName: string;
  secondLastName: string | null;
  email: string | null;
  address: string | null;
  photoUrl: string | null;
  employmentStartDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface WorkerEmploymentPeriodRecord extends QueryResultRow {
  id: string;
  workerId: string;
  companyClientId: string;
  organizationEntityId: string | null;
  hireNumber: string | null;
  separationNumber: string | null;
  sourceOrigin: string | null;
  startDate: Date;
  endDate: Date | null;
  separationReasonId: string | null;
  separationOtherReason: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface EmploymentContractRecord extends QueryResultRow {
  id: string;
  workerId: string;
  companyClientId: string;
  organizationEntityId: string | null;
  positionId: string | null;
  startDate: Date;
  endDate: Date | null;
  baseSalary: number;
  status: string;
  signatureDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface WorkerVacationRecord extends QueryResultRow {
  id: string;
  workerId: string;
  companyClientId: string;
  positionAssignmentId: string | null;
  year: number;
  openingBalance: number;
  daysAccrued: number;
  daysTaken: number;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface AuditEventRecord extends QueryResultRow {
  id: string;
  companyClientId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  module: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  [column: string]: unknown;
}

export class PostgresDomainRepository {
  constructor(private readonly db: IDatabaseClient) {}

  // =========================================================================
  // 1. Company Clients & Tenant Management
  // =========================================================================
  async createCompanyClient(data: {
    code: string;
    name: string;
    description?: string;
    logoUrl?: string;
  }): Promise<CompanyClientRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.company_clients (id, code, name, description, logo_url, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
      RETURNING id, code, name, description, logo_url as "logoUrl", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<CompanyClientRecord>(sql, [
      id,
      data.code,
      data.name,
      data.description ?? null,
      data.logoUrl ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar el cliente de compañía.");
    }
    return res.rows[0];
  }

  async getCompanyClientById(id: string): Promise<CompanyClientRecord | null> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, code, name, description, logo_url as "logoUrl", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM public.company_clients
      WHERE id = $1;
    `;
    const res = await executor.query<CompanyClientRecord>(sql, [id]);
    return res.rows[0] ?? null;
  }

  async listCompanyClients(): Promise<CompanyClientRecord[]> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, code, name, description, logo_url as "logoUrl", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM public.company_clients
      ORDER BY name ASC;
    `;
    const res = await executor.query<CompanyClientRecord>(sql, []);
    return [...res.rows];
  }

  // =========================================================================
  // 2. Organization Entities & Positions
  // =========================================================================
  async createOrganizationEntity(data: {
    companyClientId: string;
    parentId?: string;
    name: string;
    entityType?: string;
    code?: string;
  }): Promise<OrganizationEntityRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.organization_entities (id, company_client_id, parent_id, name, entity_type, code, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7)
      RETURNING id, company_client_id as "companyClientId", parent_id as "parentId", name, entity_type as "entityType", code, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<OrganizationEntityRecord>(sql, [
      id,
      data.companyClientId,
      data.parentId ?? null,
      data.name,
      data.entityType ?? "EMPRESARIAL",
      data.code ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar la entidad organizativa.");
    }
    return res.rows[0];
  }

  async listEntitiesByCompany(companyClientId: string): Promise<OrganizationEntityRecord[]> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, company_client_id as "companyClientId", parent_id as "parentId", name, entity_type as "entityType", code, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM public.organization_entities
      WHERE company_client_id = $1
      ORDER BY name ASC;
    `;
    const res = await executor.query<OrganizationEntityRecord>(sql, [companyClientId]);
    return [...res.rows];
  }

  // =========================================================================
  // 3. Workers Subsystem with Tenant Isolation
  // =========================================================================
  async createWorker(data: {
    companyClientId: string;
    identificationNumber: string;
    firstName: string;
    lastName: string;
    secondLastName?: string;
    email?: string;
    address?: string;
    photoUrl?: string;
    employmentStartDate?: Date;
  }): Promise<WorkerRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.workers (
        id, company_client_id, identification_number, first_name, last_name, second_last_name,
        email, address, photo_url, employment_start_date, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING id, company_client_id as "companyClientId", identification_number as "identificationNumber",
                first_name as "firstName", last_name as "lastName", second_last_name as "secondLastName",
                email, address, photo_url as "photoUrl", employment_start_date as "employmentStartDate",
                created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<WorkerRecord>(sql, [
      id,
      data.companyClientId,
      data.identificationNumber,
      data.firstName,
      data.lastName,
      data.secondLastName ?? null,
      data.email ?? null,
      data.address ?? null,
      data.photoUrl ?? null,
      data.employmentStartDate ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar el trabajador.");
    }
    return res.rows[0];
  }

  async getWorkerById(companyClientId: string, workerId: string): Promise<WorkerRecord | null> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, company_client_id as "companyClientId", identification_number as "identificationNumber",
             first_name as "firstName", last_name as "lastName", second_last_name as "secondLastName",
             email, address, photo_url as "photoUrl", employment_start_date as "employmentStartDate",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM public.workers
      WHERE id = $1 AND company_client_id = $2;
    `;
    const res = await executor.query<WorkerRecord>(sql, [workerId, companyClientId]);
    return res.rows[0] ?? null;
  }

  async listWorkersByCompany(companyClientId: string): Promise<WorkerRecord[]> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, company_client_id as "companyClientId", identification_number as "identificationNumber",
             first_name as "firstName", last_name as "lastName", second_last_name as "secondLastName",
             email, address, photo_url as "photoUrl", employment_start_date as "employmentStartDate",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM public.workers
      WHERE company_client_id = $1
      ORDER BY last_name ASC, first_name ASC;
    `;
    const res = await executor.query<WorkerRecord>(sql, [companyClientId]);
    return [...res.rows];
  }

  async createEmploymentPeriod(data: {
    workerId: string;
    companyClientId: string;
    organizationEntityId?: string;
    hireNumber?: string;
    startDate: Date;
    endDate?: Date;
  }): Promise<WorkerEmploymentPeriodRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.worker_employment_periods (
        id, worker_id, company_client_id, organization_entity_id, hire_number, start_date, end_date, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $8)
      RETURNING id, worker_id as "workerId", company_client_id as "companyClientId", organization_entity_id as "organizationEntityId",
                hire_number as "hireNumber", start_date as "startDate", end_date as "endDate", is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<WorkerEmploymentPeriodRecord>(sql, [
      id,
      data.workerId,
      data.companyClientId,
      data.organizationEntityId ?? null,
      data.hireNumber ?? null,
      data.startDate,
      data.endDate ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar el período de empleo.");
    }
    return res.rows[0];
  }

  // =========================================================================
  // 4. Contracts & Addendums Subsystem
  // =========================================================================
  async createContract(data: {
    workerId: string;
    companyClientId: string;
    organizationEntityId?: string;
    positionId?: string;
    startDate: Date;
    endDate?: Date;
    baseSalary: number;
    status?: string;
  }): Promise<EmploymentContractRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.employment_contracts (
        id, worker_id, company_client_id, organization_entity_id, position_id, start_date, end_date, base_salary, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      RETURNING id, worker_id as "workerId", company_client_id as "companyClientId", organization_entity_id as "organizationEntityId",
                position_id as "positionId", start_date as "startDate", end_date as "endDate", base_salary as "baseSalary",
                status, created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<EmploymentContractRecord>(sql, [
      id,
      data.workerId,
      data.companyClientId,
      data.organizationEntityId ?? null,
      data.positionId ?? null,
      data.startDate,
      data.endDate ?? null,
      data.baseSalary,
      data.status ?? "active",
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar el contrato laboral.");
    }
    return res.rows[0];
  }

  async listContractsByCompany(companyClientId: string): Promise<EmploymentContractRecord[]> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, worker_id as "workerId", company_client_id as "companyClientId", organization_entity_id as "organizationEntityId",
             position_id as "positionId", start_date as "startDate", end_date as "endDate", base_salary as "baseSalary",
             status, created_at as "createdAt", updated_at as "updatedAt"
      FROM public.employment_contracts
      WHERE company_client_id = $1
      ORDER BY start_date DESC;
    `;
    const res = await executor.query<EmploymentContractRecord>(sql, [companyClientId]);
    return [...res.rows];
  }

  // =========================================================================
  // 5. Worker Vacations & Ledger
  // =========================================================================
  async recordVacationMovement(data: {
    workerId: string;
    companyClientId: string;
    year: number;
    movementType: "ACCRUAL" | "TAKEN" | "ADJUSTMENT";
    days: number;
    startDate?: Date;
    endDate?: Date;
    notes?: string;
  }): Promise<WorkerVacationRecord> {
    const executor = this.db.getActiveExecutor();
    const now = new Date();

    // Buscar o inicializar balance de vacaciones para el año
    const selectSql = `
      SELECT id, worker_id as "workerId", company_client_id as "companyClientId", year,
             opening_balance as "openingBalance", days_accrued as "daysAccrued",
             days_taken as "daysTaken", balance
      FROM public.worker_vacations
      WHERE worker_id = $1 AND year = $2;
    `;
    const existingRes = await executor.query<WorkerVacationRecord>(selectSql, [data.workerId, data.year]);

    let vacationId: string;
    let daysAccrued = 0;
    let daysTaken = 0;

    if (existingRes.rows.length === 0) {
      vacationId = randomUUID();
      const insertVacSql = `
        INSERT INTO public.worker_vacations (id, worker_id, company_client_id, year, opening_balance, days_accrued, days_taken, balance, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 0.00, 0.00, 0.00, 0.00, $5, $5);
      `;
      await executor.query(insertVacSql, [vacationId, data.workerId, data.companyClientId, data.year, now]);
    } else {
      const existingRow = existingRes.rows[0];
      if (!existingRow) {
        throw new Error("Error inesperado al consultar el registro de vacaciones.");
      }
      vacationId = existingRow.id;
      daysAccrued = Number(existingRow.daysAccrued);
      daysTaken = Number(existingRow.daysTaken);
    }

    if (data.movementType === "ACCRUAL") {
      daysAccrued += data.days;
    } else if (data.movementType === "TAKEN") {
      daysTaken += data.days;
    } else if (data.movementType === "ADJUSTMENT") {
      daysAccrued += data.days;
    }

    const newBalance = daysAccrued - daysTaken;

    const updateVacSql = `
      UPDATE public.worker_vacations
      SET days_accrued = $1, days_taken = $2, balance = $3, updated_at = $4
      WHERE id = $5
      RETURNING id, worker_id as "workerId", company_client_id as "companyClientId", year,
                opening_balance as "openingBalance", days_accrued as "daysAccrued",
                days_taken as "daysTaken", balance, created_at as "createdAt", updated_at as "updatedAt";
    `;
    const updatedVacRes = await executor.query<WorkerVacationRecord>(updateVacSql, [
      daysAccrued,
      daysTaken,
      newBalance,
      now,
      vacationId,
    ]);

    // Registrar movimiento
    const movId = randomUUID();
    const movSql = `
      INSERT INTO public.worker_vacation_movements (id, vacation_id, company_client_id, movement_type, days, start_date, end_date, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `;
    await executor.query(movSql, [
      movId,
      vacationId,
      data.companyClientId,
      data.movementType,
      data.days,
      data.startDate ?? null,
      data.endDate ?? null,
      data.notes ?? null,
      now,
    ]);

    if (!updatedVacRes.rows[0]) {
      throw new Error("No se pudo actualizar el balance de vacaciones.");
    }
    return updatedVacRes.rows[0];
  }

  // =========================================================================
  // 6. Audit Logging Subsystem
  // =========================================================================
  async logAuditEvent(event: {
    companyClientId?: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    module?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditEventRecord> {
    const id = randomUUID();
    const now = new Date();
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO public.audit_events (
        id, company_client_id, user_id, action, entity_type, entity_id, module,
        previous_state, new_state, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, company_client_id as "companyClientId", user_id as "userId", action, entity_type as "entityType",
                entity_id as "entityId", module, previous_state as "previousState", new_state as "newState",
                ip_address as "ipAddress", user_agent as "userAgent", created_at as "createdAt";
    `;
    const res = await executor.query<AuditEventRecord>(sql, [
      id,
      event.companyClientId ?? null,
      event.userId ?? null,
      event.action,
      event.entityType,
      event.entityId ?? null,
      event.module ?? "general",
      event.previousState ? JSON.stringify(event.previousState) : null,
      event.newState ? JSON.stringify(event.newState) : null,
      event.ipAddress ?? null,
      event.userAgent ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo registrar el evento de auditoría.");
    }
    return res.rows[0];
  }
}
