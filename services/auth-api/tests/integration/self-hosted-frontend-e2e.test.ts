import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
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
  PostgresActivationTokenRepository,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  validateHttpConfig,
} from "../../src/infrastructure";
import { PostgresDomainRepository } from "../../src/infrastructure/postgres/postgres-domain.repository";
import { LocalFileStorageService } from "../../src/infrastructure/storage/local-file-storage.service";
import {
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "../../src/presentation/http";
import {
  SelfHostedAuthAdapter,
} from "../../../../src/modules/access-control/infrastructure/self-hosted-auth.adapter";
import {
  SelfHostedDomainClient,
  SelfHostedDomainHttpError,
} from "../../../../src/modules/access-control/infrastructure/self-hosted-domain.client";

class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0;
  private waitQueue: Array<() => void> = [];
  private isLocked = false;

  constructor(private readonly pglite: PGlite) {}

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

describe("Validación E2E del Frontend en Modo Autónomo (self_hosted) sin Supabase", () => {
  let pglite: PGlite;
  let poolAdapter: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let domainRepo: PostgresDomainRepository;
  let storageService: LocalFileStorageService;
  let serverInstance: BuiltAuthHttpServer;
  let userRepo: PostgresUserRepository;
  let sessionRepo: PostgresSessionRepository;
  let credentialRepo: PostgresCredentialRepository;
  let activationTokenRepo: PostgresActivationTokenRepository;
  let auditService: PostgresSecurityAuditService;
  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let testStorageDir: string;

  // Registro de todas las URLs invocadas por el frontend para auditar que hay 0 llamadas a Supabase
  const interceptedUrls: string[] = [];
  const cookieJar = new Map<string, string>();

  function createInjectFetch(server: BuiltAuthHttpServer): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();
      interceptedUrls.push(urlStr);

      if (urlStr.includes("supabase.co")) {
        throw new Error(`Violación de autonomía: llamada residual a Supabase detectada (${urlStr})`);
      }

      const parsedUrl = new URL(urlStr);
      const headers: Record<string, string> = {
        origin: "http://localhost:3000",
      };
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }

      if (cookieJar.size > 0) {
        headers["cookie"] = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      }

      const injectRes = await server.app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST" | "PATCH" | "DELETE",
        url: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers,
        payload: init?.body ? String(init.body) : undefined,
      });

      const setCookieHeader = injectRes.headers["set-cookie"];
      const cookiesToParse = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : setCookieHeader
        ? [setCookieHeader]
        : [];

      for (const rawCookie of cookiesToParse) {
        const firstPair = String(rawCookie).split(";")[0];
        if (firstPair) {
          const eqIdx = firstPair.indexOf("=");
          if (eqIdx > 0) {
            const name = firstPair.slice(0, eqIdx).trim();
            const val = firstPair.slice(eqIdx + 1).trim();
            if (val === "" || String(rawCookie).includes("Max-Age=0")) {
              cookieJar.delete(name);
            } else {
              cookieJar.set(name, val);
            }
          }
        }
      }

      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(injectRes.headers)) {
        if (v !== undefined && k.toLowerCase() !== "set-cookie") {
          resHeaders.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        }
      }

      return new Response(injectRes.rawPayload, {
        status: injectRes.statusCode,
        headers: resHeaders,
      });
    }) as typeof fetch;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    poolAdapter = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(poolAdapter);

    testStorageDir = join(process.cwd(), "tmp_e2e_selfhosted_storage_" + Date.now());
    mkdirSync(testStorageDir, { recursive: true });

    const migrationRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations();
    await migrationRunner.applyMigrations(migrations);

    domainRepo = new PostgresDomainRepository(txManager);
    storageService = new LocalFileStorageService(txManager, testStorageDir);
    userRepo = new PostgresUserRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);
    activationTokenRepo = new PostgresActivationTokenRepository(txManager);
    auditService = new PostgresSecurityAuditService(txManager);
    passwordHasher = new Argon2idPasswordHasher({
      timeCost: 2,
      memoryCostKiB: 19456,
      parallelism: 1,
    });

    const keyPair = await generateEphemeralEd25519KeyPair("e2e-self-hosted-kid");
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
      activationTokenRepo,
      domainRepo,
      storageService,
      auditService,
      passwordHasher,
      txManager,
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

  it("ejecuta de extremo a extremo los 7 flujos funcionales autónomos en modo self_hosted con 0 llamadas a Supabase", async () => {
    const fetchFn = createInjectFetch(serverInstance);

    const authProvider = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn,
    });

    const domainClient = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider,
      fetchFn,
    });

    // =========================================================================
    // FLUJO 1: Activación de usuario importado, Login, Refresh y Logout
    // =========================================================================
    const adminUserId = createUserId(randomUUID());
    const adminUser = AuthUser.create(
      adminUserId,
      createEmail("director.rrhh@sitecorp.cu"),
      {
        status: "pending_password_change",
        mustChangePassword: true,
      }
    );
    await userRepo.save(adminUser);

    // Otorgar permiso de plataforma para poder crear empresas en el flujo E2E
    await txManager.query(
      `INSERT INTO sitecorp_auth.operator_permissions (id, user_id, permission)
       VALUES ($1, $2, 'security.admin')`,
      [`op_${randomUUID()}`, adminUserId]
    );

    // Generar token de activación mediante caso de uso de backend
    const { GenerateActivationTokenUseCase } = await import("../../src/application");
    const genTokenUseCase = new GenerateActivationTokenUseCase(
      userRepo,
      activationTokenRepo,
      auditService,
      txManager
    );
    const issuedToken = await genTokenUseCase.execute({
      userId: adminUserId,
      tokenType: "activation",
      expiresInHours: 24,
      ipAddress: "127.0.0.1",
      userAgent: "E2ETest",
    });

    // Activar cuenta desde el adaptador del frontend sin contraseña temporal previa
    const activationRes = await authProvider.activateAccountWithToken(
      issuedToken.rawToken,
      "SiteCorp#2026_Soberana!"
    );
    expect(activationRes.success).toBe(true);
    expect(activationRes.error).toBeNull();

    // Iniciar sesión desde el adaptador del frontend
    const signInRes = await authProvider.signInWithPassword({
      email: "director.rrhh@sitecorp.cu",
      password: "SiteCorp#2026_Soberana!",
    });
    expect(signInRes.error).toBeNull();
    expect(signInRes.session?.user.id).toBe(adminUserId);

    // Refrescar sesión mediante cookie HttpOnly
    const refreshedSession = await authProvider.refreshToken();
    expect(refreshedSession).not.toBeNull();
    expect(refreshedSession?.user.id).toBe(adminUserId);

    // =========================================================================
    // FLUJO 2: Empresas y Entidades Organizativas
    // =========================================================================
    const companyA = await domainClient.createCompany({
      code: "E2E_ALFA",
      name: "Corporación Alfa Autónoma S.A.",
      description: "Empresa principal autónoma",
    });
    expect(companyA.id).toBeDefined();
    expect(companyA.code).toBe("E2E_ALFA");

    const companyB = await domainClient.createCompany({
      code: "E2E_BETA",
      name: "Corporación Beta Aislada S.A.",
      description: "Empresa secundaria aislada",
    });
    expect(companyB.id).toBeDefined();

    const companies = await domainClient.listCompanies();
    expect(companies.some((c) => c.id === companyA.id)).toBe(true);

    const branchEntity = await domainClient.createEntity(companyA.id, {
      code: "SUC_HABANA",
      name: "Sucursal La Habana",
      entityType: "branch",
    });
    expect(branchEntity.companyClientId).toBe(companyA.id);

    const deptEntity = await domainClient.createEntity(companyA.id, {
      parentId: branchEntity.id,
      code: "DEP_ING",
      name: "Departamento de Ingeniería",
      entityType: "department",
    });
    expect(deptEntity.parentId).toBe(branchEntity.id);

    const entities = await domainClient.listEntities(companyA.id);
    expect(entities.length).toBe(2);

    // =========================================================================
    // FLUJO 3: Trabajadores y Puestos
    // =========================================================================
    const position = await domainClient.createPosition(companyA.id, {
      organizationEntityId: deptEntity.id,
      jobTitle: "Arquitecto de Software Principal",
      positionName: "Plaza Arquitecto Senior #1",
      authorizedQuantity: 3,
      dailyHours: 8,
    });
    expect(position.authorizedQuantity).toBe(3);

    const positions = await domainClient.listPositions(companyA.id);
    expect(positions.length).toBe(1);

    const worker = await domainClient.createWorker(companyA.id, {
      identificationNumber: "88051212345",
      firstName: "Alejandro",
      lastName: "Valdés",
      email: "alejandro.valdes@alfa.cu",
    });
    expect(worker.id).toBeDefined();

    const updatedWorker = await domainClient.updateWorker(companyA.id, worker.id, {
      address: "Ave. Paseo #100, Plaza de la Revolución",
    });
    expect(updatedWorker.address).toBe("Ave. Paseo #100, Plaza de la Revolución");

    const workersList = await domainClient.listWorkers(companyA.id);
    expect(workersList.length).toBe(1);

    // =========================================================================
    // FLUJO 4: Contratos y Movimientos Laborales
    // =========================================================================
    const contract = await domainClient.createContract(companyA.id, {
      workerId: worker.id,
      positionId: position.id,
      organizationEntityId: deptEntity.id,
      startDate: "2026-01-15",
      baseSalary: 45000,
    });
    expect(contract.status).toBe("active");

    const contractsList = await domainClient.listContracts(companyA.id);
    expect(contractsList.length).toBe(1);

    const movement = await domainClient.recordLaborMovement(companyA.id, {
      workerId: worker.id,
      organizationEntityId: deptEntity.id,
      movementType: "MODIFICACION_SALARIAL",
      effectiveDate: "2026-06-01",
      reason: "Evaluación de desempeño semestral sobresaliente",
    });
    expect(movement.movementType).toBe("MODIFICACION_SALARIAL");

    const movementsList = await domainClient.listWorkerMovements(companyA.id, worker.id);
    expect(movementsList.length).toBe(1);

    // =========================================================================
    // FLUJO 5: Vacaciones
    // =========================================================================
    await domainClient.recordVacationMovement(companyA.id, {
      workerId: worker.id,
      year: 2026,
      movementType: "ACCRUAL",
      days: 24,
      notes: "Devengo anual 2026",
    });

    const vacAfterTaken = await domainClient.recordVacationMovement(companyA.id, {
      workerId: worker.id,
      year: 2026,
      movementType: "TAKEN",
      days: 6,
      notes: "Disfrute programado agosto",
    });
    expect(Number(vacAfterTaken.balance)).toBe(18);

    const vacations = await domainClient.getWorkerVacations(companyA.id, worker.id);
    expect(vacations.length).toBe(1);
    expect(Number(vacations[0]!.balance)).toBe(18);

    // =========================================================================
    // FLUJO 6: Documentos y Storage Autónomo
    // =========================================================================
    const docContent = "Expediente Laboral Oficial - Alejandro Valdés - Empresa Alfa";
    const uploadedDoc = await domainClient.uploadFile({
      bucketId: "worker_documents",
      objectName: `${companyA.id}/${worker.id}/expediente.pdf`,
      contentBase64: Buffer.from(docContent, "utf8").toString("base64"),
      mimeType: "application/pdf",
      companyClientId: companyA.id,
    });
    expect(uploadedDoc.sha256Checksum).toHaveLength(64);

    const companyObjects = await domainClient.listCompanyObjects(
      companyA.id,
      "worker_documents"
    );
    expect(companyObjects.length).toBe(1);

    const downloaded = await domainClient.downloadFile(
      "worker_documents",
      `${companyA.id}/${worker.id}/expediente.pdf`
    );
    expect(Buffer.from(downloaded.content).toString("utf8")).toBe(docContent);
    expect(downloaded.sha256Checksum).toBe(uploadedDoc.sha256Checksum);

    const deletedDoc = await domainClient.deleteFile(
      "worker_documents",
      `${companyA.id}/${worker.id}/expediente.pdf`
    );
    expect(deletedDoc.deleted).toBe(true);

    // =========================================================================
    // FLUJO 7: Permisos, Membresías, Aislamiento y Auditoría
    // =========================================================================
    const hrOperatorId = createUserId(randomUUID());
    const hrOperator = AuthUser.create(
      hrOperatorId,
      createEmail("operador.alfa@sitecorp.cu"),
      {
        status: "active",
        mustChangePassword: false,
      }
    );
    await userRepo.save(hrOperator);

    // Otorgar membresía en Empresa A al operador
    const granted = await domainClient.grantCompanyMembership(companyA.id, {
      targetUserId: hrOperatorId,
      roleCode: "hr_operator",
      permissions: ["companies.view", "workers.view", "workers.manage"],
    });
    expect(granted.id).toBeDefined();

    // Consultar auditoría de Empresa A
    const auditLogs = await domainClient.listCompanyAuditLogs(companyA.id);
    expect(auditLogs.length).toBeGreaterThanOrEqual(5);

    // Revocar membresía del operador
    const revoked = await domainClient.revokeCompanyMembership(companyA.id, hrOperatorId);
    expect(revoked.revoked).toBe(true);

    // Cerrar sesión del director
    await authProvider.signOut();
    expect(await authProvider.getSession()).toBeNull();

    // Verificar que al cerrar sesión ya no puede invocar endpoints protegidos
    await expect(domainClient.listCompanies()).rejects.toThrow(SelfHostedDomainHttpError);

    // =========================================================================
    // VERIFICACIÓN DE AUTONOMÍA: 0 llamadas a Supabase
    // =========================================================================
    expect(interceptedUrls.length).toBeGreaterThan(20);
    expect(interceptedUrls.every((u) => u.startsWith("http://127.0.0.1:4010/api/v1/"))).toBe(
      true
    );
    expect(interceptedUrls.some((u) => u.includes("supabase"))).toBe(false);
  });
});
