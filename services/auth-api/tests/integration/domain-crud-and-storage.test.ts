import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  AuthSession,
  AuthUser,
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  AuthorizationPolicyService,
  QueryResultRow,
} from "../../src/interfaces";
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadAllAuthSchemaMigrations,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  validateHttpConfig,
} from "../../src/infrastructure";
import {
  ALL_TENANT_PERMISSIONS,
  PostgresDomainRepository,
  TenantPermission,
} from "../../src/infrastructure/postgres/postgres-domain.repository";
import {
  LocalFileStorageService,
  PathTraversalError,
  InvalidMimeTypeError,
  StorageAccessForbiddenError,
} from "../../src/infrastructure/storage/local-file-storage.service";
import {
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "../../src/presentation/http";

class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0;
  private waitQueue: Array<() => void> = [];
  private isLocked = false;

  constructor(private readonly pglite: PGlite) {}

  public getActiveClientCount(): number {
    return this.activeClientCount;
  }

  private async acquireMutex(): Promise<void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private releaseMutex(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.isLocked = false;
    }
  }

  async connect(): Promise<PgPoolClientLike> {
    await this.acquireMutex();
    this.activeClientCount += 1;
    let released = false;

    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ): Promise<{ rows: TRow[]; rowCount: number | null }> => {
        if (released) {
          throw new Error("Attempted to query on a released PoolClient.");
        }
        if (!values || values.length === 0) {
          const execResults = await this.pglite.exec(text);
          const last = execResults[execResults.length - 1];
          const rows = (last?.rows ?? []) as TRow[];
          return {
            rows,
            rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          };
        }
        const res = await this.pglite.query<TRow>(text, [...values]);
        return {
          rows: res.rows,
          rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
        };
      },
      release: () => {
        if (!released) {
          released = true;
          this.activeClientCount -= 1;
          this.releaseMutex();
        }
      },
    };
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[]; rowCount: number | null }> {
    await this.acquireMutex();
    try {
      if (!values || values.length === 0) {
        const execResults = await this.pglite.exec(text);
        const last = execResults[execResults.length - 1];
        const rows = (last?.rows ?? []) as TRow[];
        return {
          rows,
          rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
        };
      }
      const res = await this.pglite.query<TRow>(text, [...values]);
      return {
        rows: res.rows,
        rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
      };
    } finally {
      this.releaseMutex();
    }
  }
}

describe("FASE 4G.6 — Autonomous Domain Schema, Multi-Company Authorization & Storage Isolation", () => {
  let pglite: PGlite;
  let poolAdapter: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let domainRepo: PostgresDomainRepository;
  let storageService: LocalFileStorageService;
  let serverInstance: BuiltAuthHttpServer;
  let userRepo: PostgresUserRepository;
  let sessionRepo: PostgresSessionRepository;
  let credentialRepo: PostgresCredentialRepository;
  let tokenService: JoseTokenService;
  let testStorageDir: string;

  async function createAuthenticatedTestUser(
    emailStr: string,
    options?: {
      isPlatformAdmin?: boolean;
      memberships?: Array<{
        companyClientId: string;
        roleCode: string;
        permissions: readonly TenantPermission[];
      }>;
    }
  ): Promise<{ user: AuthUser; accessToken: string }> {
    const userId = createUserId(randomUUID());
    const user = AuthUser.reconstitute({
      id: userId,
      email: createEmail(emailStr),
      status: "active",
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await userRepo.save(user);

    if (options?.isPlatformAdmin) {
      await txManager.query(
        `INSERT INTO sitecorp_auth.operator_permissions (id, user_id, permission)
         VALUES ($1, $2, 'security.admin')
         ON CONFLICT DO NOTHING`,
        [`op_${randomUUID()}`, userId]
      );
    }

    if (options?.memberships) {
      for (const m of options.memberships) {
        await domainRepo.grantCompanyMembership({
          companyClientId: m.companyClientId,
          userId,
          roleCode: m.roleCode,
          permissions: m.permissions,
          grantedBy: null,
          allowBootstrapNullGranter: true,
        });
      }
    }

    const sessionId = `sess_${randomUUID()}`;
    const session = AuthSession.create(sessionId, userId, {
      ipAddress: "127.0.0.1",
      userAgent: "IntegrationTest",
    });
    await sessionRepo.createSession(session);

    const { token: accessToken } = await tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      sid: session.id,
      scope: "api:full",
      role: "authenticated",
      mustChangePassword: false,
    });

    return { user, accessToken };
  }

  beforeAll(async () => {
    pglite = new PGlite();
    poolAdapter = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(poolAdapter);

    testStorageDir = join(process.cwd(), "tmp_test_storage_" + Date.now());
    mkdirSync(testStorageDir, { recursive: true });

    // Aplicar migraciones 0001..0005
    const migrationRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations();
    await migrationRunner.applyMigrations(migrations);

    domainRepo = new PostgresDomainRepository(txManager);
    storageService = new LocalFileStorageService(txManager, testStorageDir);

    userRepo = new PostgresUserRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);

    const keyPair = await generateEphemeralEd25519KeyPair("fase4g6-test-kid");
    tokenService = new JoseTokenService({
      issuer: "https://auth.sitecorp.cu",
      audience: "sitecorp-app",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
      additionalVerificationKeys: [],
    });

    const httpConfig = validateHttpConfig({
      environment: "test",
      host: "127.0.0.1",
      port: 4010,
      allowedOrigins: ["http://localhost:3000"],
      cookies: {
        secure: false,
        sameSite: "Lax",
      },
      csrf: {
        hmacSecret: "0123456789abcdef0123456789abcdef",
      },
    });

    serverInstance = await buildAuthHttpServer({
      httpConfig,
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      domainRepo,
      storageService,
      passwordHasher: new Argon2idPasswordHasher({
        timeCost: 2,
        memoryCostKiB: 19456,
        parallelism: 1,
      }),
      authPolicy: new AuthorizationPolicyService(),
    });
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.app.close();
    }
    if (pglite) {
      await pglite.close();
    }
    rmSync(testStorageDir, { recursive: true, force: true });
  });

  describe("1. Multi-Tenant Domain Schema & SQL Trigger Isolation", () => {
    it("crea empresas independientes y garantiza aislamiento estricto de trabajadores y triggers SQL", async () => {
      const companyA = await domainRepo.createCompanyClient({
        code: "COMP_A",
        name: "Empresa Alfa S.A.",
      });
      const companyB = await domainRepo.createCompanyClient({
        code: "COMP_B",
        name: "Empresa Beta S.A.",
      });

      expect(companyA.id).toBeDefined();
      expect(companyB.id).toBeDefined();

      const workerA1 = await domainRepo.createWorker({
        companyClientId: companyA.id,
        identificationNumber: "11111111111",
        firstName: "Juan",
        lastName: "Pérez",
      });

      const workerB1 = await domainRepo.createWorker({
        companyClientId: companyB.id,
        identificationNumber: "22222222222",
        firstName: "Maria",
        lastName: "Gómez",
      });

      const listA = await domainRepo.listWorkersByCompany(companyA.id);
      expect(listA.length).toBe(1);
      expect(listA[0]!.id).toBe(workerA1.id);

      const listB = await domainRepo.listWorkersByCompany(companyB.id);
      expect(listB.length).toBe(1);
      expect(listB[0]!.id).toBe(workerB1.id);

      // Verificación de aislamiento horizontal
      const crossFetch = await domainRepo.getWorkerById(companyA.id, workerB1.id);
      expect(crossFetch).toBeNull();

      // Verificación de trigger SQL anti-cruce de empresa en public.employment_contracts
      await expect(
        txManager.query(
          `INSERT INTO public.employment_contracts (company_client_id, worker_id, start_date, base_salary)
           VALUES ($1, $2, '2026-01-01', 100000)`,
          [companyA.id, workerB1.id]
        )
      ).rejects.toThrow(/CROSS_TENANT_VIOLATION/);
    });

    it("gestiona contratos y ledger de vacaciones de forma atómica y concurrente", async () => {
      const company = await domainRepo.createCompanyClient({
        code: "COMP_VAC",
        name: "Vacation Test Corp",
      });

      const worker = await domainRepo.createWorker({
        companyClientId: company.id,
        identificationNumber: "33333333333",
        firstName: "Carlos",
        lastName: "Rodríguez",
      });

      const contract = await domainRepo.createContract({
        companyClientId: company.id,
        workerId: worker.id,
        startDate: new Date("2026-01-01"),
        baseSalary: 150000,
      });

      expect(contract.id).toBeDefined();
      expect(contract.status).toBe("active");

      // Devengo inicial (+20 días)
      const vacAfterAccrual = await domainRepo.recordVacationMovement({
        companyClientId: company.id,
        workerId: worker.id,
        year: 2026,
        movementType: "ACCRUAL",
        days: 20,
        notes: "Devengo anual",
      });

      expect(Number(vacAfterAccrual.daysAccrued)).toBe(20);
      expect(Number(vacAfterAccrual.balance)).toBe(20);

      // Movimientos concurrentes: 4 consumos simultáneos de 2.5 días = 10 días tomados
      await Promise.all([
        domainRepo.recordVacationMovement({
          companyClientId: company.id,
          workerId: worker.id,
          year: 2026,
          movementType: "TAKEN",
          days: 2.5,
          notes: "Concurrencia 1",
        }),
        domainRepo.recordVacationMovement({
          companyClientId: company.id,
          workerId: worker.id,
          year: 2026,
          movementType: "TAKEN",
          days: 2.5,
          notes: "Concurrencia 2",
        }),
        domainRepo.recordVacationMovement({
          companyClientId: company.id,
          workerId: worker.id,
          year: 2026,
          movementType: "TAKEN",
          days: 2.5,
          notes: "Concurrencia 3",
        }),
        domainRepo.recordVacationMovement({
          companyClientId: company.id,
          workerId: worker.id,
          year: 2026,
          movementType: "TAKEN",
          days: 2.5,
          notes: "Concurrencia 4",
        }),
      ]);

      const finalVacations = await domainRepo.listVacationsByCompany(company.id, worker.id);
      expect(finalVacations.length).toBe(1);
      expect(Number(finalVacations[0]!.daysTaken)).toBe(10);
      expect(Number(finalVacations[0]!.balance)).toBe(10);
    });
  });

  describe("2. Self-Hosted Storage & Cross-Tenant Overwrite Protections", () => {
    it("sube, descarga y elimina un objeto con verificación SHA-256 y bloquea sobreescritura cruzada", async () => {
      const companyA = await domainRepo.createCompanyClient({
        code: "STOR_COMP_A",
        name: "Storage Alfa",
      });
      const companyB = await domainRepo.createCompanyClient({
        code: "STOR_COMP_B",
        name: "Storage Beta",
      });

      const buffer = Buffer.from("Contenido de prueba para documento PDF de SiteCorp", "utf8");

      const uploaded = await storageService.uploadFile({
        bucketId: "documents",
        objectName: "contrato_firmado.pdf",
        contentBuffer: buffer,
        mimeType: "application/pdf",
        companyClientId: companyA.id,
      });

      expect(uploaded.objectName).toBe("contrato_firmado.pdf");
      expect(uploaded.sha256Checksum).toBeDefined();

      // Intento de sobreescritura desde Empresa B sobre el mismo path es bloqueado
      await expect(
        storageService.uploadFile({
          bucketId: "documents",
          objectName: "contrato_firmado.pdf",
          contentBuffer: Buffer.from("Intento malicioso de Empresa B"),
          mimeType: "application/pdf",
          companyClientId: companyB.id,
        })
      ).rejects.toThrow(StorageAccessForbiddenError);

      // Descarga e integridad SHA-256
      const { record, contentBuffer } = await storageService.downloadFile(
        "documents",
        "contrato_firmado.pdf"
      );
      expect(record.id).toBe(uploaded.id);
      expect(contentBuffer.toString("utf8")).toBe(buffer.toString("utf8"));

      // Eliminación
      const deleted = await storageService.deleteFile("documents", "contrato_firmado.pdf");
      expect(deleted).toBe(true);
    });

    it("bloquea intentos de Path Traversal y tipos MIME no permitidos", async () => {
      await expect(
        storageService.uploadFile({
          bucketId: "documents",
          objectName: "../../../etc/passwd",
          contentBuffer: Buffer.from("hack"),
          mimeType: "text/plain",
        })
      ).rejects.toThrow(PathTraversalError);

      await expect(
        storageService.uploadFile({
          bucketId: "avatars",
          objectName: "malware.exe",
          contentBuffer: Buffer.from("binary"),
          mimeType: "application/x-msdownload",
        })
      ).rejects.toThrow(InvalidMimeTypeError);
    });
  });

  describe("3. Multi-Company HTTP Authorization & Negative Isolation Tests (Empresa A vs Empresa B)", () => {
    it("aplica denegación por defecto y aísla completamente Empresa A de Empresa B en dominio y Storage", async () => {
      const tenantA = await domainRepo.createCompanyClient({
        code: "TENANT_ALPHA",
        name: "Alpha Holdings S.A.",
      });
      const tenantB = await domainRepo.createCompanyClient({
        code: "TENANT_BETA",
        name: "Beta Logistics S.A.",
      });

      // 1. Usuario autenticado sin ninguna membresía (denegación por defecto -> 403 FORBIDDEN)
      const unprivileged = await createAuthenticatedTestUser("unprivileged@sitecorp.com");

      const listNoMembershipRes = await serverInstance.app.inject({
        method: "GET",
        url: "/api/v1/domain/companies",
        headers: { authorization: `Bearer ${unprivileged.accessToken}` },
      });
      expect(listNoMembershipRes.statusCode).toBe(403);

      const createCompanyForbiddenRes = await serverInstance.app.inject({
        method: "POST",
        url: "/api/v1/domain/companies",
        headers: { authorization: `Bearer ${unprivileged.accessToken}` },
        payload: { code: "HACK_CO", name: "Unauthorized Co" },
      });
      expect(createCompanyForbiddenRes.statusCode).toBe(403);

      // 2. Usuarios de Empresa A (admin y viewer) y Empresa B (admin)
      const userAlphaAdmin = await createAuthenticatedTestUser("admin_alpha@sitecorp.com", {
        memberships: [
          {
            companyClientId: tenantA.id,
            roleCode: "company_admin",
            permissions: ALL_TENANT_PERMISSIONS,
          },
        ],
      });
      const userAlphaViewer = await createAuthenticatedTestUser("viewer_alpha@sitecorp.com", {
        memberships: [
          {
            companyClientId: tenantA.id,
            roleCode: "viewer",
            permissions: ["companies.view", "workers.view", "contracts.view", "documents.view"],
          },
        ],
      });
      const userBetaAdmin = await createAuthenticatedTestUser("admin_beta@sitecorp.com", {
        memberships: [
          {
            companyClientId: tenantB.id,
            roleCode: "company_admin",
            permissions: ALL_TENANT_PERMISSIONS,
          },
        ],
      });
      const platformAdmin = await createAuthenticatedTestUser("superadmin@sitecorp.com", {
        isPlatformAdmin: true,
      });

      // 3. Listado de empresas devuelve exclusivamente las empresas autorizadas
      const alphaCompaniesRes = await serverInstance.app.inject({
        method: "GET",
        url: "/api/v1/domain/companies",
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(alphaCompaniesRes.statusCode).toBe(200);
      const alphaCompanies = JSON.parse(alphaCompaniesRes.payload).data.companies;
      expect(alphaCompanies.length).toBe(1);
      expect(alphaCompanies[0].id).toBe(tenantA.id);

      // Superadmin sí ve todas las empresas y puede crear nuevas
      const superCompaniesRes = await serverInstance.app.inject({
        method: "GET",
        url: "/api/v1/domain/companies",
        headers: { authorization: `Bearer ${platformAdmin.accessToken}` },
      });
      expect(superCompaniesRes.statusCode).toBe(200);
      expect(
        JSON.parse(superCompaniesRes.payload).data.companies.length
      ).toBeGreaterThanOrEqual(2);

      // 4. Crear trabajadores y entidades en Empresa A y Empresa B
      const createWorkerAlphaRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantA.id}/workers`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: {
          identificationNumber: "90010111111",
          firstName: "Elena",
          lastName: "Alpha",
        },
      });
      expect(createWorkerAlphaRes.statusCode).toBe(201);
      const workerAlpha = JSON.parse(createWorkerAlphaRes.payload).data.worker;

      const createWorkerBetaRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantB.id}/workers`,
        headers: { authorization: `Bearer ${userBetaAdmin.accessToken}` },
        payload: {
          identificationNumber: "90020222222",
          firstName: "Roberto",
          lastName: "Beta",
        },
      });
      expect(createWorkerBetaRes.statusCode).toBe(201);
      const workerBeta = JSON.parse(createWorkerBetaRes.payload).data.worker;

      const createEntityBetaRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantB.id}/entities`,
        headers: { authorization: `Bearer ${userBetaAdmin.accessToken}` },
        payload: {
          code: "ENT_BETA_1",
          name: "Planta Beta",
          entityType: "branch",
        },
      });
      expect(createEntityBetaRes.statusCode).toBe(201);
      const entityBeta = JSON.parse(createEntityBetaRes.payload).data.entity;

      // 5. Pruebas negativas de aislamiento entre Empresa A y Empresa B:
      // 5a. Usuario de Empresa A intenta enumerar trabajadores de Empresa B -> 403
      const enumBetaWorkersRes = await serverInstance.app.inject({
        method: "GET",
        url: `/api/v1/domain/companies/${tenantB.id}/workers`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(enumBetaWorkersRes.statusCode).toBe(403);

      // 5b. Usuario de Empresa A intenta crear trabajador en Empresa B -> 403
      const writeBetaWorkerRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantB.id}/workers`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: {
          identificationNumber: "99999999999",
          firstName: "Intruso",
          lastName: "Alpha",
        },
      });
      expect(writeBetaWorkerRes.statusCode).toBe(403);

      // 5c. Usuario de Empresa A intenta leer/modificar/eliminar el UUID de trabajador de Empresa B bajo su ruta de Empresa A -> 404 (no revela ni modifica)
      const readForeignWorkerUuidRes = await serverInstance.app.inject({
        method: "GET",
        url: `/api/v1/domain/companies/${tenantA.id}/workers/${workerBeta.id}`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(readForeignWorkerUuidRes.statusCode).toBe(404);

      const patchForeignWorkerUuidRes = await serverInstance.app.inject({
        method: "PATCH",
        url: `/api/v1/domain/companies/${tenantA.id}/workers/${workerBeta.id}`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: { firstName: "Pwned" },
      });
      expect(patchForeignWorkerUuidRes.statusCode).toBe(404);

      const deleteForeignWorkerUuidRes = await serverInstance.app.inject({
        method: "DELETE",
        url: `/api/v1/domain/companies/${tenantA.id}/workers/${workerBeta.id}`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(deleteForeignWorkerUuidRes.statusCode).toBe(404);

      // 5d. Usuario de Empresa A intenta inyectar workerBeta.id o entityBeta.id al crear un contrato en Empresa A -> 403 FORBIDDEN
      const crossTenantContractWorkerRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantA.id}/contracts`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: {
          workerId: workerBeta.id,
          startDate: "2026-02-01",
          baseSalary: 120000,
        },
      });
      expect(crossTenantContractWorkerRes.statusCode).toBe(403);

      const crossTenantContractEntityRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantA.id}/contracts`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: {
          workerId: workerAlpha.id,
          organizationEntityId: entityBeta.id,
          startDate: "2026-02-01",
          baseSalary: 120000,
        },
      });
      expect(crossTenantContractEntityRes.statusCode).toBe(403);

      // 5e. Control granular de permisos intra-empresa: viewer puede leer pero NO escribir
      const viewerReadRes = await serverInstance.app.inject({
        method: "GET",
        url: `/api/v1/domain/companies/${tenantA.id}/workers`,
        headers: { authorization: `Bearer ${userAlphaViewer.accessToken}` },
      });
      expect(viewerReadRes.statusCode).toBe(200);

      const viewerWriteRes = await serverInstance.app.inject({
        method: "POST",
        url: `/api/v1/domain/companies/${tenantA.id}/workers`,
        headers: { authorization: `Bearer ${userAlphaViewer.accessToken}` },
        payload: {
          identificationNumber: "88888888888",
          firstName: "NoPerm",
          lastName: "Viewer",
        },
      });
      expect(viewerWriteRes.statusCode).toBe(403);

      // 6. Pruebas negativas de Storage entre Empresa A y Empresa B
      const uploadBetaRes = await serverInstance.app.inject({
        method: "POST",
        url: "/api/v1/storage/upload",
        headers: { authorization: `Bearer ${userBetaAdmin.accessToken}` },
        payload: {
          bucketId: "worker_documents",
          objectName: `${tenantB.id}/nomina_confidencial_beta.pdf`,
          contentBase64: Buffer.from("Secreto Empresarial Beta").toString("base64"),
          mimeType: "application/pdf",
          companyClientId: tenantB.id,
        },
      });
      expect(uploadBetaRes.statusCode).toBe(201);

      // 6a. Usuario de Empresa A intenta subir un archivo declarando companyClientId de Empresa B -> 403
      const uploadSpoofTenantRes = await serverInstance.app.inject({
        method: "POST",
        url: "/api/v1/storage/upload",
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
        payload: {
          bucketId: "worker_documents",
          objectName: `${tenantB.id}/spoof.pdf`,
          contentBase64: Buffer.from("Spoof").toString("base64"),
          mimeType: "application/pdf",
          companyClientId: tenantB.id,
        },
      });
      expect(uploadSpoofTenantRes.statusCode).toBe(403);

      // 6b. Usuario de Empresa A intenta descargar el archivo confidencial de Empresa B -> 403
      const downloadCrossTenantRes = await serverInstance.app.inject({
        method: "GET",
        url: `/api/v1/storage/objects/worker_documents/${tenantB.id}/nomina_confidencial_beta.pdf`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(downloadCrossTenantRes.statusCode).toBe(403);

      // 6c. Usuario de Empresa A intenta eliminar el archivo confidencial de Empresa B -> 403
      const deleteCrossTenantRes = await serverInstance.app.inject({
        method: "DELETE",
        url: `/api/v1/storage/objects/worker_documents/${tenantB.id}/nomina_confidencial_beta.pdf`,
        headers: { authorization: `Bearer ${userAlphaAdmin.accessToken}` },
      });
      expect(deleteCrossTenantRes.statusCode).toBe(403);

      // 6d. Usuario de Empresa B sí puede descargar su propio archivo -> 200
      const downloadOwnTenantRes = await serverInstance.app.inject({
        method: "GET",
        url: `/api/v1/storage/objects/worker_documents/${tenantB.id}/nomina_confidencial_beta.pdf`,
        headers: { authorization: `Bearer ${userBetaAdmin.accessToken}` },
      });
      expect(downloadOwnTenantRes.statusCode).toBe(200);
      expect(downloadOwnTenantRes.payload).toBe("Secreto Empresarial Beta");
    });
  });
});
