import { randomUUID } from "node:crypto";
import { DomainError, ForbiddenError } from "../../domain";
import { IDatabaseClient, ITransactionManager, QueryResultRow } from "../../interfaces";

export type TenantPermission =
  | "companies.view"
  | "companies.manage"
  | "entities.view"
  | "entities.manage"
  | "positions.view"
  | "positions.manage"
  | "workers.view"
  | "workers.manage"
  | "contracts.view"
  | "contracts.manage"
  | "vacations.view"
  | "vacations.manage"
  | "documents.view"
  | "documents.manage"
  | "audit.view";

export const ALL_TENANT_PERMISSIONS: readonly TenantPermission[] = Object.freeze([
  "companies.view",
  "companies.manage",
  "entities.view",
  "entities.manage",
  "positions.view",
  "positions.manage",
  "workers.view",
  "workers.manage",
  "contracts.view",
  "contracts.manage",
  "vacations.view",
  "vacations.manage",
  "documents.view",
  "documents.manage",
  "audit.view",
]);

export function isValidTenantPermission(value: unknown): value is TenantPermission {
  return (
    typeof value === "string" &&
    (ALL_TENANT_PERMISSIONS as readonly string[]).includes(value)
  );
}

export class CrossTenantResourceAccessError extends ForbiddenError {
  constructor(
    message: string = "Operación denegada: el recurso solicitado no pertenece a la empresa autorizada."
  ) {
    super(message);
  }
}

export class DomainResourceNotFoundError extends DomainError {
  public readonly code = "RESOURCE_NOT_FOUND";
  constructor(message: string = "El recurso solicitado no existe en la empresa autorizada.") {
    super(message);
  }
}

export interface VerifiedCompanyAccessContext {
  readonly userId: string;
  readonly companyClientId: string;
  readonly isPlatformAdmin: boolean;
  readonly isMember: boolean;
  readonly roleCode: string | null;
  readonly permissions: ReadonlySet<TenantPermission>;
}

export interface CompanyClientMembershipRecord extends QueryResultRow {
  id: string;
  userId: string;
  companyClientId: string;
  roleCode: string;
  isActive: boolean;
  grantedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

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

export interface OrganizationPositionRecord extends QueryResultRow {
  id: string;
  jobId: string;
  organizationEntityId: string;
  companyClientId: string;
  name: string;
  jobTitle: string;
  authorizedQuantity: number;
  dailyHours: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  [column: string]: unknown;
}

export interface WorkerPositionAssignmentRecord extends QueryResultRow {
  id: string;
  workerId: string;
  positionId: string;
  employmentPeriodId: string | null;
  startDate: Date;
  endDate: Date | null;
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

export interface WorkerEmploymentMovementRecord extends QueryResultRow {
  id: string;
  workerId: string;
  companyClientId: string;
  organizationEntityId: string | null;
  movementType: "ALTA" | "BAJA" | "REINGRESO" | "CAMBIO_PUESTO" | "CAMBIO_CONTRATO" | "MODIFICACION_SALARIAL";
  effectiveDate: Date;
  reason: string | null;
  previousPositionId: string | null;
  newPositionId: string | null;
  createdBy: string | null;
  createdAt: Date;
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

function isTransactionManager(
  client: IDatabaseClient
): client is IDatabaseClient & ITransactionManager {
  return typeof (client as unknown as ITransactionManager).runInTransaction === "function";
}

export class PostgresDomainRepository {
  constructor(private readonly db: IDatabaseClient) {}

  private async runInTxIfNeeded<T>(work: () => Promise<T>): Promise<T> {
    if (this.db.isInTransaction()) {
      return work();
    }
    if (isTransactionManager(this.db)) {
      return this.db.runInTransaction(async () => work());
    }
    return work();
  }

  // =========================================================================
  // 0. Authoritative Multi-Tenant Membership, Permissions & Session Context
  // =========================================================================

  /**
   * Establece las variables de contexto transaccional en PostgreSQL (`SET LOCAL` vía `set_config(..., true)`).
   * Garantiza aislamiento transaccional 100% parametrizado sin interpolación SQL.
   */
  async setTransactionalTenantContext(params: {
    userId: string;
    companyClientId: string | null;
    isPlatformAdmin: boolean;
  }): Promise<void> {
    const executor = this.db.getActiveExecutor();
    await executor.query(
      `SELECT
         set_config('sitecorp.current_user_id', $1, true),
         set_config('sitecorp.current_tenant_id', $2, true),
         set_config('sitecorp.is_platform_admin', $3, true);`,
      [
        params.userId,
        params.companyClientId ?? "",
        params.isPlatformAdmin ? "true" : "false",
      ]
    );
  }

  /**
   * Verifica en vivo en PostgreSQL si el usuario es un superadministrador de plataforma activo
   * (`security.admin` en `sitecorp_auth.operator_permissions`) con cuenta activa y sin cambio de clave pendiente.
   */
  async isUserPlatformAdmin(userId: string): Promise<boolean> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<{ is_admin: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM sitecorp_auth.users u
         INNER JOIN sitecorp_auth.operator_permissions op ON op.user_id = u.id
         WHERE u.id = $1
           AND u.status = 'active'
           AND u.deleted_at IS NULL
           AND u.must_change_password = FALSE
           AND op.permission = 'security.admin'
           AND op.is_revoked = FALSE
       ) AS is_admin;`,
      [userId]
    );
    return Boolean(res.rows[0]?.is_admin);
  }

  async requirePlatformAdmin(userId: string): Promise<void> {
    const isAdmin = await this.isUserPlatformAdmin(userId);
    if (!isAdmin) {
      throw new ForbiddenError(
        "Acceso denegado: esta operación exige privilegios autoritativos de administrador de plataforma ('security.admin')."
      );
    }
  }

  /**
   * Resuelve desde tablas persistentes confiables (`sitecorp_auth.users`, `sitecorp_auth.operator_permissions`,
   * `public.company_client_memberships` y `public.company_client_user_permissions`) la pertenencia
   * y los permisos efectivos del usuario sobre una empresa concreta.
   *
   * NUNCA confía en claims JWT ni en parámetros del cliente.
   */
  async resolveUserCompanyAccess(
    userId: string,
    companyClientId: string
  ): Promise<VerifiedCompanyAccessContext> {
    const executor = this.db.getActiveExecutor();

    // 1. Verificar estado activo del usuario en sitecorp_auth.users
    const userRes = await executor.query<{
      id: string;
      status: string;
      must_change_password: boolean;
      deleted_at: Date | null;
    }>(
      `SELECT id, status, must_change_password, deleted_at
       FROM sitecorp_auth.users
       WHERE id = $1;`,
      [userId]
    );

    const userRow = userRes.rows[0];
    if (
      !userRow ||
      userRow.status !== "active" ||
      userRow.deleted_at !== null ||
      userRow.must_change_password
    ) {
      throw new ForbiddenError("La cuenta de usuario no se encuentra activa o autorizada.");
    }

    // 2. Comprobar permiso administrativo de plataforma en vivo
    const isPlatformAdmin = await this.isUserPlatformAdmin(userId);

    // 3. Comprobar membresía activa en la empresa objetivo
    const membershipRes = await executor.query<{
      role_code: string;
      is_active: boolean;
      company_active: boolean;
    }>(
      `SELECT
         m.role_code,
         m.is_active,
         c.is_active AS company_active
       FROM public.company_client_memberships m
       INNER JOIN public.company_clients c ON c.id = m.company_client_id
       WHERE m.user_id = $1
         AND m.company_client_id = $2
         AND m.is_active = TRUE
         AND c.is_active = TRUE
       LIMIT 1;`,
      [userId, companyClientId]
    );

    const membershipRow = membershipRes.rows[0];
    const isMember = Boolean(membershipRow?.is_active && membershipRow?.company_active);

    // 4. Si es administrador de plataforma, verificar que la empresa exista
    if (isPlatformAdmin) {
      const compRes = await executor.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM public.company_clients WHERE id = $1;`,
        [companyClientId]
      );
      if (!compRes.rows[0]) {
        throw new DomainResourceNotFoundError(`La empresa '${companyClientId}' no existe.`);
      }
      return Object.freeze({
        userId,
        companyClientId,
        isPlatformAdmin: true,
        isMember: true,
        roleCode: membershipRow?.role_code ?? "platform_admin",
        permissions: new Set<TenantPermission>(ALL_TENANT_PERMISSIONS),
      });
    }

    if (!isMember) {
      return Object.freeze({
        userId,
        companyClientId,
        isPlatformAdmin: false,
        isMember: false,
        roleCode: null,
        permissions: new Set<TenantPermission>(),
      });
    }

    // 5. Consultar permisos explícitos no revocados para el usuario en esta empresa
    const permRes = await executor.query<{ permission: string }>(
      `SELECT permission
       FROM public.company_client_user_permissions
       WHERE user_id = $1
         AND company_client_id = $2
         AND is_revoked = FALSE;`,
      [userId, companyClientId]
    );

    const permSet = new Set<TenantPermission>();
    for (const row of permRes.rows) {
      if (isValidTenantPermission(row.permission)) {
        permSet.add(row.permission);
      }
    }

    return Object.freeze({
      userId,
      companyClientId,
      isPlatformAdmin: false,
      isMember: true,
      roleCode: membershipRow?.role_code ?? "company_member",
      permissions: permSet,
    });
  }

  /**
   * Valida que el usuario pertenezca a la empresa objetivo y posea el permiso concreto requerido.
   * Aplica denegación por defecto (`ForbiddenError` -> HTTP 403).
   */
  async requireCompanyPermission(
    userId: string,
    companyClientId: string,
    requiredPermission: TenantPermission
  ): Promise<VerifiedCompanyAccessContext> {
    const access = await this.resolveUserCompanyAccess(userId, companyClientId);

    if (access.isPlatformAdmin) {
      return access;
    }

    if (!access.isMember) {
      throw new ForbiddenError(
        "Acceso denegado: el usuario autenticado no pertenece a la empresa solicitada."
      );
    }

    if (!access.permissions.has(requiredPermission)) {
      throw new ForbiddenError(
        `Acceso denegado: el usuario carece del permiso requerido ('${requiredPermission}') en la empresa solicitada.`
      );
    }

    return access;
  }

  /**
   * Ejecuta una operación de dominio dentro de una transacción segura, verificando primero
   * la pertenencia a la empresa y el permiso requerido desde datos persistentes, e inyectando
   * el contexto transaccional `sitecorp.current_user_id` y `sitecorp.current_tenant_id`.
   */
  async runAuthorizedCompanyOperation<T>(
    params: {
      userId: string;
      companyClientId: string;
      requiredPermission: TenantPermission;
    },
    work: (access: VerifiedCompanyAccessContext) => Promise<T>
  ): Promise<T> {
    return this.runInTxIfNeeded(async () => {
      const access = await this.requireCompanyPermission(
        params.userId,
        params.companyClientId,
        params.requiredPermission
      );
      await this.setTransactionalTenantContext({
        userId: params.userId,
        companyClientId: params.companyClientId,
        isPlatformAdmin: access.isPlatformAdmin,
      });
      return work(access);
    });
  }

  /**
   * Otorga membresía activa y permisos explícitos a un usuario sobre una empresa.
   * Impide estrictamente la auto-asignación (`grantedBy !== userId`).
   */
  async grantCompanyMembership(input: {
    userId: string;
    companyClientId: string;
    roleCode?: string;
    permissions: readonly TenantPermission[];
    grantedBy: string | null;
    allowBootstrapNullGranter?: boolean;
  }): Promise<CompanyClientMembershipRecord> {
    if (input.grantedBy === null && input.allowBootstrapNullGranter !== true) {
      throw new ForbiddenError(
        "Se requiere un operador autorizante ('grantedBy') para otorgar membresías de empresa."
      );
    }
    if (input.grantedBy !== null && input.grantedBy === input.userId) {
      throw new ForbiddenError(
        "Prohibida la auto-asignación de membresías o permisos de empresa ('grantedBy === userId')."
      );
    }

    for (const perm of input.permissions) {
      if (!isValidTenantPermission(perm)) {
        throw new ForbiddenError(`Permiso de empresa inválido: '${String(perm)}'.`);
      }
    }

    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const now = new Date();
      const id = randomUUID();
      const roleCode = input.roleCode?.trim() || "company_member";

      const membershipRes = await executor.query<CompanyClientMembershipRecord>(
        `INSERT INTO public.company_client_memberships (
           id, user_id, company_client_id, role_code, is_active, granted_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $6)
         ON CONFLICT (user_id, company_client_id) DO UPDATE SET
           role_code = EXCLUDED.role_code,
           is_active = TRUE,
           granted_by = EXCLUDED.granted_by,
           updated_at = EXCLUDED.updated_at
         RETURNING
           id,
           user_id AS "userId",
           company_client_id AS "companyClientId",
           role_code AS "roleCode",
           is_active AS "isActive",
           granted_by AS "grantedBy",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [id, input.userId, input.companyClientId, roleCode, input.grantedBy, now]
      );

      // Sincronizar tenant_id principal del usuario si no tenía uno asignado
      await executor.query(
        `UPDATE sitecorp_auth.users
         SET tenant_id = COALESCE(tenant_id, $1), updated_at = $2
         WHERE id = $3;`,
        [input.companyClientId, now, input.userId]
      );

      // Otorgar permisos solicitados de forma idempotente
      for (const perm of input.permissions) {
        await executor.query(
          `INSERT INTO public.company_client_user_permissions (
             id, user_id, company_client_id, permission, granted_by, is_revoked, created_at
           ) VALUES ($1, $2, $3, $4, $5, FALSE, $6)
           ON CONFLICT (user_id, company_client_id, permission) WHERE is_revoked = FALSE
           DO NOTHING;`,
          [randomUUID(), input.userId, input.companyClientId, perm, input.grantedBy, now]
        );
      }

      const row = membershipRes.rows[0];
      if (!row) {
        throw new Error("No se pudo registrar la membresía de empresa.");
      }
      return row;
    });
  }

  async revokeCompanyMembership(
    userId: string,
    companyClientId: string
  ): Promise<boolean> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const now = new Date();

      const res = await executor.query(
        `UPDATE public.company_client_memberships
         SET is_active = FALSE, updated_at = $3
         WHERE user_id = $1 AND company_client_id = $2 AND is_active = TRUE;`,
        [userId, companyClientId, now]
      );

      await executor.query(
        `UPDATE public.company_client_user_permissions
         SET is_revoked = TRUE, revoked_at = $3
         WHERE user_id = $1 AND company_client_id = $2 AND is_revoked = FALSE;`,
        [userId, companyClientId, now]
      );

      return (res.rowCount ?? 0) > 0;
    });
  }

  async getUserAccessOverview(userId: string): Promise<{
    isPlatformAdmin: boolean;
    operatorPermissions: string[];
    memberships: Array<{
      companyClientId: string;
      companyCode: string;
      companyName: string;
      roleCode: string;
      permissions: TenantPermission[];
    }>;
  }> {
    const executor = this.db.getActiveExecutor();
    const isPlatformAdmin = await this.isUserPlatformAdmin(userId);

    const opPermRes = await executor.query<{ permission: string }>(
      `SELECT permission
       FROM sitecorp_auth.operator_permissions
       WHERE user_id = $1 AND is_revoked = FALSE
       ORDER BY permission ASC;`,
      [userId]
    );

    const membershipsRes = await executor.query<{
      company_client_id: string;
      company_code: string;
      company_name: string;
      role_code: string;
    }>(
      `SELECT
         m.company_client_id,
         c.code AS company_code,
         c.name AS company_name,
         m.role_code
       FROM public.company_client_memberships m
       INNER JOIN public.company_clients c ON c.id = m.company_client_id
       WHERE m.user_id = $1
         AND m.is_active = TRUE
         AND c.is_active = TRUE
       ORDER BY c.name ASC;`,
      [userId]
    );

    const memberships: Array<{
      companyClientId: string;
      companyCode: string;
      companyName: string;
      roleCode: string;
      permissions: TenantPermission[];
    }> = [];

    for (const m of membershipsRes.rows) {
      const pRes = await executor.query<{ permission: string }>(
        `SELECT permission
         FROM public.company_client_user_permissions
         WHERE user_id = $1
           AND company_client_id = $2
           AND is_revoked = FALSE
         ORDER BY permission ASC;`,
        [userId, m.company_client_id]
      );
      const perms: TenantPermission[] = [];
      for (const pr of pRes.rows) {
        if (isValidTenantPermission(pr.permission)) {
          perms.push(pr.permission);
        }
      }
      memberships.push({
        companyClientId: m.company_client_id,
        companyCode: m.company_code,
        companyName: m.company_name,
        roleCode: m.role_code,
        permissions: perms,
      });
    }

    return {
      isPlatformAdmin,
      operatorPermissions: opPermRes.rows.map((r) => r.permission),
      memberships,
    };
  }

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
      data.code.trim(),
      data.name.trim(),
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

  async updateCompanyClient(
    companyClientId: string,
    data: { name: string; description?: string | null; isActive?: boolean }
  ): Promise<CompanyClientRecord | null> {
    const executor = this.db.getActiveExecutor();
    const now = new Date();
    const sql = `
      UPDATE public.company_clients
      SET
        name = $2,
        description = COALESCE($3, description),
        is_active = COALESCE($4, is_active),
        updated_at = $5
      WHERE id = $1
      RETURNING id, code, name, description, logo_url as "logoUrl", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<CompanyClientRecord>(sql, [
      companyClientId,
      data.name.trim(),
      data.description === undefined ? null : data.description,
      data.isActive === undefined ? null : data.isActive,
      now,
    ]);
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

  /**
   * Lista únicamente las empresas a las que el usuario tiene acceso autorizado en datos persistentes.
   * Si el usuario es administrador de plataforma (`security.admin`), devuelve todas.
   * Si es miembro de una o más empresas con permiso `companies.view` o `companies.manage`, devuelve solo esas.
   * Si no tiene autorización sobre ninguna empresa, lanza `ForbiddenError` (default deny).
   */
  async listAuthorizedCompaniesForUser(userId: string): Promise<CompanyClientRecord[]> {
    const isAdmin = await this.isUserPlatformAdmin(userId);
    if (isAdmin) {
      return this.listCompanyClients();
    }

    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT DISTINCT
        c.id,
        c.code,
        c.name,
        c.description,
        c.logo_url AS "logoUrl",
        c.is_active AS "isActive",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM public.company_clients c
      INNER JOIN public.company_client_memberships m
        ON m.company_client_id = c.id
       AND m.user_id = $1
       AND m.is_active = TRUE
      INNER JOIN public.company_client_user_permissions p
        ON p.company_client_id = c.id
       AND p.user_id = $1
       AND p.is_revoked = FALSE
       AND p.permission IN ('companies.view', 'companies.manage')
      WHERE c.is_active = TRUE
      ORDER BY c.name ASC;
    `;
    const res = await executor.query<CompanyClientRecord>(sql, [userId]);
    if (res.rows.length === 0) {
      throw new ForbiddenError(
        "Acceso denegado: el usuario no cuenta con membresía activa ni permiso 'companies.view' en ninguna empresa."
      );
    }
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

    if (data.parentId) {
      const parentRes = await executor.query<{ company_client_id: string }>(
        `SELECT company_client_id FROM public.organization_entities WHERE id = $1;`,
        [data.parentId]
      );
      if (!parentRes.rows[0] || parentRes.rows[0].company_client_id !== data.companyClientId) {
        throw new CrossTenantResourceAccessError(
          "La entidad padre especificada no existe o pertenece a otra empresa."
        );
      }
    }

    const sql = `
      INSERT INTO public.organization_entities (id, company_client_id, parent_id, name, entity_type, code, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7)
      RETURNING id, company_client_id as "companyClientId", parent_id as "parentId", name, entity_type as "entityType", code, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<OrganizationEntityRecord>(sql, [
      id,
      data.companyClientId,
      data.parentId ?? null,
      data.name.trim(),
      data.entityType ?? "EMPRESARIAL",
      data.code ?? null,
      now,
    ]);
    if (!res.rows[0]) {
      throw new Error("No se pudo insertar la entidad organizativa.");
    }
    return res.rows[0];
  }

  async getEntityById(
    companyClientId: string,
    entityId: string
  ): Promise<OrganizationEntityRecord | null> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, company_client_id as "companyClientId", parent_id as "parentId", name, entity_type as "entityType", code, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
      FROM public.organization_entities
      WHERE id = $1 AND company_client_id = $2;
    `;
    const res = await executor.query<OrganizationEntityRecord>(sql, [
      entityId,
      companyClientId,
    ]);
    return res.rows[0] ?? null;
  }

  async updateOrganizationEntity(
    companyClientId: string,
    entityId: string,
    data: { name?: string; entityType?: string; code?: string | null; isActive?: boolean }
  ): Promise<OrganizationEntityRecord | null> {
    const executor = this.db.getActiveExecutor();
    const now = new Date();
    const sql = `
      UPDATE public.organization_entities
      SET
        name = COALESCE($3, name),
        entity_type = COALESCE($4, entity_type),
        code = COALESCE($5, code),
        is_active = COALESCE($6, is_active),
        updated_at = $7
      WHERE id = $1 AND company_client_id = $2
      RETURNING id, company_client_id as "companyClientId", parent_id as "parentId", name, entity_type as "entityType", code, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<OrganizationEntityRecord>(sql, [
      entityId,
      companyClientId,
      data.name?.trim() ?? null,
      data.entityType ?? null,
      data.code ?? null,
      data.isActive ?? null,
      now,
    ]);
    return res.rows[0] ?? null;
  }

  async deleteOrganizationEntity(
    companyClientId: string,
    entityId: string
  ): Promise<boolean> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query(
      `DELETE FROM public.organization_entities WHERE id = $1 AND company_client_id = $2;`,
      [entityId, companyClientId]
    );
    return (res.rowCount ?? 0) > 0;
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

  async createPosition(data: {
    companyClientId: string;
    organizationEntityId: string;
    jobTitle: string;
    positionName: string;
    authorizedQuantity?: number;
    dailyHours?: number;
  }): Promise<OrganizationPositionRecord> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const now = new Date();

      const entity = await this.getEntityById(
        data.companyClientId,
        data.organizationEntityId
      );
      if (!entity) {
        throw new CrossTenantResourceAccessError(
          "La entidad organizativa indicada no existe o pertenece a otra empresa."
        );
      }

      const jobId = randomUUID();
      await executor.query(
        `INSERT INTO public.organization_jobs (
           id, organization_entity_id, title, is_active, created_at, updated_at
         ) VALUES ($1, $2, $3, TRUE, $4, $4);`,
        [jobId, data.organizationEntityId, data.jobTitle.trim(), now]
      );

      const positionId = randomUUID();
      const posRes = await executor.query<{
        id: string;
        jobId: string;
        organizationEntityId: string;
        name: string;
        authorizedQuantity: number;
        dailyHours: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>(
        `INSERT INTO public.organization_positions (
           id, job_id, organization_entity_id, name, authorized_quantity, daily_hours, is_active, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7)
         RETURNING
           id,
           job_id AS "jobId",
           organization_entity_id AS "organizationEntityId",
           name,
           authorized_quantity AS "authorizedQuantity",
           daily_hours AS "dailyHours",
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [
          positionId,
          jobId,
          data.organizationEntityId,
          data.positionName.trim(),
          data.authorizedQuantity ?? 1,
          data.dailyHours ?? 8,
          now,
        ]
      );

      const row = posRes.rows[0];
      if (!row) {
        throw new Error("No se pudo crear la plaza organizativa.");
      }

      return {
        ...row,
        companyClientId: data.companyClientId,
        jobTitle: data.jobTitle.trim(),
      };
    });
  }

  async listPositionsByCompany(
    companyClientId: string
  ): Promise<OrganizationPositionRecord[]> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<OrganizationPositionRecord>(
      `SELECT
         p.id,
         p.job_id AS "jobId",
         p.organization_entity_id AS "organizationEntityId",
         oe.company_client_id AS "companyClientId",
         p.name,
         j.title AS "jobTitle",
         p.authorized_quantity AS "authorizedQuantity",
         p.daily_hours AS "dailyHours",
         p.is_active AS "isActive",
         p.created_at AS "createdAt",
         p.updated_at AS "updatedAt"
       FROM public.organization_positions p
       INNER JOIN public.organization_entities oe ON oe.id = p.organization_entity_id
       INNER JOIN public.organization_jobs j ON j.id = p.job_id
       WHERE oe.company_client_id = $1
       ORDER BY p.name ASC;`,
      [companyClientId]
    );
    return [...res.rows];
  }

  async assignWorkerToPosition(data: {
    companyClientId: string;
    workerId: string;
    positionId: string;
    startDate: Date;
  }): Promise<WorkerPositionAssignmentRecord> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const now = new Date();

      const worker = await this.getWorkerById(data.companyClientId, data.workerId);
      if (!worker) {
        throw new CrossTenantResourceAccessError(
          "El trabajador indicado no existe o pertenece a otra empresa."
        );
      }

      const posRes = await executor.query<{ id: string }>(
        `SELECT p.id
         FROM public.organization_positions p
         INNER JOIN public.organization_entities oe ON oe.id = p.organization_entity_id
         WHERE p.id = $1 AND oe.company_client_id = $2;`,
        [data.positionId, data.companyClientId]
      );
      if (!posRes.rows[0]) {
        throw new CrossTenantResourceAccessError(
          "La plaza indicada no existe o pertenece a otra empresa."
        );
      }

      const id = randomUUID();
      const res = await executor.query<WorkerPositionAssignmentRecord>(
        `INSERT INTO public.worker_position_assignments (
           id, worker_id, position_id, start_date, is_active, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, TRUE, $5, $5)
         RETURNING
           id,
           worker_id AS "workerId",
           position_id AS "positionId",
           employment_period_id AS "employmentPeriodId",
           start_date AS "startDate",
           end_date AS "endDate",
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt";`,
        [id, data.workerId, data.positionId, data.startDate, now]
      );

      if (!res.rows[0]) {
        throw new Error("No se pudo registrar la asignación de plaza.");
      }
      return res.rows[0];
    });
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
      data.identificationNumber.trim(),
      data.firstName.trim(),
      data.lastName.trim(),
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

  async updateWorker(
    companyClientId: string,
    workerId: string,
    data: Partial<{
      firstName: string;
      lastName: string;
      secondLastName: string | null;
      email: string | null;
      address: string | null;
      photoUrl: string | null;
    }>
  ): Promise<WorkerRecord | null> {
    const executor = this.db.getActiveExecutor();
    const now = new Date();
    const sql = `
      UPDATE public.workers
      SET
        first_name = COALESCE($3, first_name),
        last_name = COALESCE($4, last_name),
        second_last_name = COALESCE($5, second_last_name),
        email = COALESCE($6, email),
        address = COALESCE($7, address),
        photo_url = COALESCE($8, photo_url),
        updated_at = $9
      WHERE id = $1 AND company_client_id = $2
      RETURNING id, company_client_id as "companyClientId", identification_number as "identificationNumber",
                first_name as "firstName", last_name as "lastName", second_last_name as "secondLastName",
                email, address, photo_url as "photoUrl", employment_start_date as "employmentStartDate",
                created_at as "createdAt", updated_at as "updatedAt";
    `;
    const res = await executor.query<WorkerRecord>(sql, [
      workerId,
      companyClientId,
      data.firstName?.trim() ?? null,
      data.lastName?.trim() ?? null,
      data.secondLastName ?? null,
      data.email ?? null,
      data.address ?? null,
      data.photoUrl ?? null,
      now,
    ]);
    return res.rows[0] ?? null;
  }

  async deleteWorker(companyClientId: string, workerId: string): Promise<boolean> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query(
      `DELETE FROM public.workers WHERE id = $1 AND company_client_id = $2;`,
      [workerId, companyClientId]
    );
    return (res.rowCount ?? 0) > 0;
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
    return this.runInTxIfNeeded(async () => {
      const worker = await this.getWorkerById(data.companyClientId, data.workerId);
      if (!worker) {
        throw new CrossTenantResourceAccessError(
          "El trabajador indicado no existe o pertenece a otra empresa."
        );
      }

      if (data.organizationEntityId) {
        const entity = await this.getEntityById(
          data.companyClientId,
          data.organizationEntityId
        );
        if (!entity) {
          throw new CrossTenantResourceAccessError(
            "La entidad organizativa indicada no existe o pertenece a otra empresa."
          );
        }
      }

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
    });
  }

  async createEmploymentMovement(data: {
    companyClientId: string;
    workerId: string;
    organizationEntityId?: string;
    movementType: "ALTA" | "BAJA" | "REINGRESO" | "CAMBIO_PUESTO" | "CAMBIO_CONTRATO" | "MODIFICACION_SALARIAL";
    effectiveDate: Date;
    reason?: string;
    previousPositionId?: string;
    newPositionId?: string;
    createdBy?: string;
  }): Promise<WorkerEmploymentMovementRecord> {
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const worker = await this.getWorkerById(data.companyClientId, data.workerId);
      if (!worker) {
        throw new CrossTenantResourceAccessError(
          "El trabajador indicado para el movimiento laboral no existe o pertenece a otra empresa."
        );
      }

      if (data.organizationEntityId) {
        const entity = await this.getEntityById(
          data.companyClientId,
          data.organizationEntityId
        );
        if (!entity) {
          throw new CrossTenantResourceAccessError(
            "La entidad organizativa del movimiento laboral no pertenece a la empresa autorizada."
          );
        }
      }

      const id = randomUUID();
      const now = new Date();
      const res = await executor.query<WorkerEmploymentMovementRecord>(
        `INSERT INTO public.worker_employment_movements (
           id, worker_id, company_client_id, organization_entity_id, movement_type,
           effective_date, reason, previous_position_id, new_position_id, created_by, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING
           id,
           worker_id AS "workerId",
           company_client_id AS "companyClientId",
           organization_entity_id AS "organizationEntityId",
           movement_type AS "movementType",
           effective_date AS "effectiveDate",
           reason,
           previous_position_id AS "previousPositionId",
           new_position_id AS "newPositionId",
           created_by AS "createdBy",
           created_at AS "createdAt";`,
        [
          id,
          data.workerId,
          data.companyClientId,
          data.organizationEntityId ?? null,
          data.movementType,
          data.effectiveDate,
          data.reason ?? null,
          data.previousPositionId ?? null,
          data.newPositionId ?? null,
          data.createdBy ?? null,
          now,
        ]
      );

      if (!res.rows[0]) {
        throw new Error("No se pudo registrar el movimiento laboral.");
      }
      return res.rows[0];
    });
  }

  async listEmploymentMovementsByCompany(
    companyClientId: string,
    workerId?: string
  ): Promise<WorkerEmploymentMovementRecord[]> {
    const executor = this.db.getActiveExecutor();
    if (workerId) {
      const res = await executor.query<WorkerEmploymentMovementRecord>(
        `SELECT
           id,
           worker_id AS "workerId",
           company_client_id AS "companyClientId",
           organization_entity_id AS "organizationEntityId",
           movement_type AS "movementType",
           effective_date AS "effectiveDate",
           reason,
           previous_position_id AS "previousPositionId",
           new_position_id AS "newPositionId",
           created_by AS "createdBy",
           created_at AS "createdAt"
         FROM public.worker_employment_movements
         WHERE company_client_id = $1 AND worker_id = $2
         ORDER BY effective_date DESC, created_at DESC;`,
        [companyClientId, workerId]
      );
      return [...res.rows];
    }

    const res = await executor.query<WorkerEmploymentMovementRecord>(
      `SELECT
         id,
         worker_id AS "workerId",
         company_client_id AS "companyClientId",
         organization_entity_id AS "organizationEntityId",
         movement_type AS "movementType",
         effective_date AS "effectiveDate",
         reason,
         previous_position_id AS "previousPositionId",
         new_position_id AS "newPositionId",
         created_by AS "createdBy",
         created_at AS "createdAt"
       FROM public.worker_employment_movements
       WHERE company_client_id = $1
       ORDER BY effective_date DESC, created_at DESC;`,
      [companyClientId]
    );
    return [...res.rows];
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
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();

      // Validar pertenencia estricta del trabajador a la empresa autorizada
      const worker = await this.getWorkerById(data.companyClientId, data.workerId);
      if (!worker) {
        throw new CrossTenantResourceAccessError(
          "El trabajador indicado para el contrato no existe o pertenece a otra empresa."
        );
      }

      if (data.organizationEntityId) {
        const entity = await this.getEntityById(
          data.companyClientId,
          data.organizationEntityId
        );
        if (!entity) {
          throw new CrossTenantResourceAccessError(
            "La entidad organizativa indicada para el contrato no pertenece a la empresa autorizada."
          );
        }
      }

      if (data.positionId) {
        const posCheck = await executor.query<{ id: string }>(
          `SELECT p.id
           FROM public.organization_positions p
           INNER JOIN public.organization_entities oe ON oe.id = p.organization_entity_id
           WHERE p.id = $1 AND oe.company_client_id = $2;`,
          [data.positionId, data.companyClientId]
        );
        if (!posCheck.rows[0]) {
          throw new CrossTenantResourceAccessError(
            "La plaza indicada para el contrato no pertenece a la empresa autorizada."
          );
        }
      }

      const id = randomUUID();
      const now = new Date();
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
    });
  }

  async getContractById(
    companyClientId: string,
    contractId: string
  ): Promise<EmploymentContractRecord | null> {
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<EmploymentContractRecord>(
      `SELECT id, worker_id as "workerId", company_client_id as "companyClientId", organization_entity_id as "organizationEntityId",
              position_id as "positionId", start_date as "startDate", end_date as "endDate", base_salary as "baseSalary",
              status, created_at as "createdAt", updated_at as "updatedAt"
       FROM public.employment_contracts
       WHERE id = $1 AND company_client_id = $2;`,
      [contractId, companyClientId]
    );
    return res.rows[0] ?? null;
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
  // 5. Worker Vacations & Ledger (with FOR UPDATE locking & tenant ownership)
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
    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();
      const now = new Date();

      // 1. Verificar pertenencia del trabajador a la empresa con bloqueo FOR UPDATE
      const workerCheck = await executor.query<{ id: string }>(
        `SELECT id
         FROM public.workers
         WHERE id = $1 AND company_client_id = $2
         FOR UPDATE;`,
        [data.workerId, data.companyClientId]
      );
      if (!workerCheck.rows[0]) {
        throw new CrossTenantResourceAccessError(
          "El trabajador indicado para el movimiento de vacaciones no existe o pertenece a otra empresa."
        );
      }

      // 2. Buscar o inicializar balance de vacaciones para el año (con FOR UPDATE y filtro company_client_id)
      const selectSql = `
        SELECT id, worker_id as "workerId", company_client_id as "companyClientId", year,
               opening_balance as "openingBalance", days_accrued as "daysAccrued",
               days_taken as "daysTaken", balance
        FROM public.worker_vacations
        WHERE worker_id = $1 AND company_client_id = $2 AND year = $3
        FOR UPDATE;
      `;
      const existingRes = await executor.query<WorkerVacationRecord>(selectSql, [
        data.workerId,
        data.companyClientId,
        data.year,
      ]);

      let vacationId: string;
      let daysAccrued = 0;
      let daysTaken = 0;

      if (existingRes.rows.length === 0) {
        vacationId = randomUUID();
        const insertVacSql = `
          INSERT INTO public.worker_vacations (id, worker_id, company_client_id, year, opening_balance, days_accrued, days_taken, balance, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 0.00, 0.00, 0.00, 0.00, $5, $5);
        `;
        await executor.query(insertVacSql, [
          vacationId,
          data.workerId,
          data.companyClientId,
          data.year,
          now,
        ]);
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
        WHERE id = $5 AND company_client_id = $6
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
        data.companyClientId,
      ]);

      // 3. Registrar movimiento
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
    });
  }

  async listVacationsByCompany(
    companyClientId: string,
    workerId?: string
  ): Promise<WorkerVacationRecord[]> {
    const executor = this.db.getActiveExecutor();
    if (workerId) {
      const res = await executor.query<WorkerVacationRecord>(
        `SELECT id, worker_id as "workerId", company_client_id as "companyClientId", year,
                opening_balance as "openingBalance", days_accrued as "daysAccrued",
                days_taken as "daysTaken", balance, created_at as "createdAt", updated_at as "updatedAt"
         FROM public.worker_vacations
         WHERE company_client_id = $1 AND worker_id = $2
         ORDER BY year DESC;`,
        [companyClientId, workerId]
      );
      return [...res.rows];
    }

    const res = await executor.query<WorkerVacationRecord>(
      `SELECT id, worker_id as "workerId", company_client_id as "companyClientId", year,
              opening_balance as "openingBalance", days_accrued as "daysAccrued",
              days_taken as "daysTaken", balance, created_at as "createdAt", updated_at as "updatedAt"
       FROM public.worker_vacations
       WHERE company_client_id = $1
       ORDER BY year DESC, created_at DESC;`,
      [companyClientId]
    );
    return [...res.rows];
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

  async listAuditEventsByCompany(
    companyClientId: string,
    limit: number = 100
  ): Promise<AuditEventRecord[]> {
    const executor = this.db.getActiveExecutor();
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const res = await executor.query<AuditEventRecord>(
      `SELECT id, company_client_id as "companyClientId", user_id as "userId", action, entity_type as "entityType",
              entity_id as "entityId", module, previous_state as "previousState", new_state as "newState",
              ip_address as "ipAddress", user_agent as "userAgent", created_at as "createdAt"
       FROM public.audit_events
       WHERE company_client_id = $1
       ORDER BY created_at DESC
       LIMIT $2;`,
      [companyClientId, safeLimit]
    );
    return [...res.rows];
  }
}
