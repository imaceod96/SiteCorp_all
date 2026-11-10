import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configureSelfHostedRuntimeBridge,
  supabase,
} from "../../../../src/lib/supabase";
import { SelfHostedAuthAdapter } from "../../../../src/modules/access-control/infrastructure/self-hosted-auth.adapter";
import { SelfHostedDomainClient } from "../../../../src/modules/access-control/infrastructure/self-hosted-domain.client";
import { DataMigrationEngine } from "../../src/cli/data-migration-tool";
import { AuthUser, createEmail, createUserId } from "../../src/domain";
import {
  Argon2idPasswordHasher,
  ControlledSmtpTransport,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  LocalFileStorageService,
  loadAllAuthSchemaMigrations,
  loadCompleteSubmodulesMigration,
  loadCompleteSubmodulesRollbackSql,
  PostgresActivationTokenRepository,
  PostgresCredentialRepository,
  PostgresDomainRepository,
  PostgresMigrationRunner,
  PostgresOperatorPermissionRepository,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresSubmodulesRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  SmtpTransactionalEmailService,
  validateHttpConfig,
} from "../../src/infrastructure";
import {
  AuthorizationPolicyService,
  RepositoryOperatorPrincipalResolver,
} from "../../src/interfaces";
import { PgPoolAdapter } from "../../src/presentation/http/entrypoint";
import {
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "../../src/presentation/http/server";

const PG16_BIN_DIR = "/tmp/pg16/usr/lib/postgresql/16/bin";
const PG16_LIB_DIR = "/tmp/pg16/usr/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu";
const PG16_PORT = 54332;
const PG16_HOST = "127.0.0.1";
const TEST_DB_NAME = "sitecorp_pg16_fase4g8_test";
const RESTORED_DB_NAME = "sitecorp_pg16_fase4g8_restored";
const ALLOWED_ORIGIN = "http://127.0.0.1:3000";

function runPg16Cmd(binary: string, args: readonly string[]): string {
  const fullBin = join(PG16_BIN_DIR, binary);
  return execFileSync(fullBin, args, {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: PG16_LIB_DIR,
      PATH: `${PG16_BIN_DIR}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

describe("Fase 4G.8 — Validación Real en PostgreSQL 16.15 Convencional, Seguridad de Pasarela Autónoma, Ensayo de Migración y Backup/Restore", () => {
  let rawAdminPool: pg.Pool;
  let rawTestPool: pg.Pool;
  let poolAdapter: PgPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credentialRepo: PostgresCredentialRepository;
  let operatorPermissionRepo: PostgresOperatorPermissionRepository;
  let passwordHasher: Argon2idPasswordHasher;
  let server: BuiltAuthHttpServer;
  let domainRepo: PostgresDomainRepository;
  let submodulesRepo: PostgresSubmodulesRepository;
  let smtpTransport: ControlledSmtpTransport;
  let emailService: SmtpTransactionalEmailService;
  let tempStorageDir: string;
  const logChunks: string[] = [];

  // Identidades y empresas sintéticas para pruebas
  let adminAccessToken = "";
  let companyAId = "";
  let companyBId = "";
  let entityAId = "";
  let positionAId = "";
  let workerA1Id = "";
  let workerA2Id = "";
  let contractA1Id = "";
  let periodAId = "";
  let templateAId = "";
  let courseAId = "";

  function createInjectFetch(): typeof fetch {
    const cookieJar = new Map<string, string>();
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const parsed = new URL(urlStr, "http://127.0.0.1:4010");
      const headers: Record<string, string> = {
        origin: ALLOWED_ORIGIN,
      };
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) {
            if (k && typeof v === "string") {
              headers[k.toLowerCase()] = v;
            }
          }
        } else {
          for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
            if (typeof v === "string") {
              headers[k.toLowerCase()] = v;
            }
          }
        }
      }

      if (cookieJar.size > 0 && !headers.cookie) {
        headers.cookie = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      }

      const res = await server.app.inject({
        method: (init?.method ?? "GET") as any,
        url: `${parsed.pathname}${parsed.search}`,
        headers,
        payload:
          typeof init?.body === "string"
            ? init.body
            : init?.body
              ? Buffer.from(init.body as ArrayBuffer)
              : undefined,
      });

      const setCookieHeader = res.headers["set-cookie"];
      const rawCookies = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : typeof setCookieHeader === "string"
          ? [setCookieHeader]
          : [];
      for (const raw of rawCookies) {
        const firstPart = raw.split(";")[0];
        if (!firstPart) continue;
        const eqIdx = firstPart.indexOf("=");
        if (eqIdx <= 0) continue;
        const cName = firstPart.slice(0, eqIdx).trim();
        const cVal = firstPart.slice(eqIdx + 1).trim();
        cookieJar.set(cName, cVal);
      }

      const outHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") {
          outHeaders.set(k, v);
        } else if (Array.isArray(v)) {
          outHeaders.set(k, v.join(", "));
        }
      }

      return new Response(res.rawPayload, {
        status: res.statusCode,
        headers: outHeaders,
      });
    };
  }

  beforeAll(async () => {
    // 0. Asegurar que el clúster PostgreSQL 16.15 aislado esté en ejecución en 127.0.0.1:54332
    const bootstrapScriptPath = existsSync(
      resolve(process.cwd(), "ops/bootstrap-local-pg16.sh")
    )
      ? resolve(process.cwd(), "ops/bootstrap-local-pg16.sh")
      : resolve(process.cwd(), "services/auth-api/ops/bootstrap-local-pg16.sh");
    execFileSync("bash", [bootstrapScriptPath], { stdio: "pipe" });

    // 1. Recrear bases de datos limpias en el servidor PostgreSQL 16.15 real
    rawAdminPool = new pg.Pool({
      host: PG16_HOST,
      port: PG16_PORT,
      user: "postgres",
      database: "postgres",
    });

    await rawAdminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2) AND pid <> pg_backend_pid();`,
      [TEST_DB_NAME, RESTORED_DB_NAME]
    );
    await rawAdminPool.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
    await rawAdminPool.query(`DROP DATABASE IF EXISTS "${RESTORED_DB_NAME}";`);
    await rawAdminPool.query(`CREATE DATABASE "${TEST_DB_NAME}" ENCODING 'UTF8';`);

    rawTestPool = new pg.Pool({
      host: PG16_HOST,
      port: PG16_PORT,
      user: "postgres",
      database: TEST_DB_NAME,
      max: 10,
    });
    poolAdapter = new PgPoolAdapter(rawTestPool);
    txManager = new PostgresTransactionManager(poolAdapter);

    // 2. Aplicar migraciones 0001–0006 sobre PostgreSQL 16.15 real
    const runner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    });
    await runner.applyMigrations(migrations);

    // 3. Levantar servidor HTTP autónomo conectado a PostgreSQL 16.15
    tempStorageDir = join(tmpdir(), `sitecorp-pg16-storage-${randomUUID()}`);
    mkdirSync(tempStorageDir, { recursive: true });

    const keyPair = generateEphemeralEd25519KeyPair("fase4g8-kid", "test");
    const tokenService = new JoseTokenService({
      issuer: "urn:sitecorp:auth-api:test",
      audience: "urn:sitecorp:api:test",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
    });

    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    userRepo = new PostgresUserRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);
    const sessionRepo = new PostgresSessionRepository(txManager, txManager);
    const activationTokenRepo = new PostgresActivationTokenRepository(txManager);
    operatorPermissionRepo = new PostgresOperatorPermissionRepository(txManager);
    const auditService = new PostgresSecurityAuditService(txManager);
    domainRepo = new PostgresDomainRepository(txManager);
    submodulesRepo = new PostgresSubmodulesRepository(txManager, domainRepo);
    const storageService = new LocalFileStorageService(txManager, tempStorageDir);

    smtpTransport = new ControlledSmtpTransport();
    emailService = new SmtpTransactionalEmailService(
      {
        host: "127.0.0.1",
        port: 587,
        secure: false,
        fromEmail: "seguridad@sitecorp.local",
        fromName: "SiteCorp Seguridad",
        appPublicUrl: "https://app.sitecorp.local",
        transportMode: "smtp_controlled",
      },
      smtpTransport
    );

    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logChunks.push(chunk.toString("utf8"));
        callback();
      },
    });

    const httpConfig = validateHttpConfig({
      environment: "test",
      host: "127.0.0.1",
      port: 4010,
      allowedOrigins: [ALLOWED_ORIGIN],
      trustedProxies: false,
      limits: {
        globalBodyLimitBytes: 65536,
        authBodyLimitBytes: 4096,
        requestTimeoutMs: 15000,
        connectionTimeoutMs: 5000,
        readinessTimeoutMs: 2000,
      },
      cookies: {
        secure: false,
        sameSite: "Lax",
        maxRefreshTtlSeconds: 14 * 24 * 60 * 60,
      },
      csrf: {
        hmacSecret:
          "sitecorp-csrf-hmac-secret-key-with-at-least-32-bytes-for-4g8-tests",
        ttlSeconds: 14 * 24 * 60 * 60,
      },
      argon2Gate: {
        maxConcurrent: 2,
        maxQueueSize: 8,
        acquireTimeoutMs: 5000,
      },
      rateLimit: {
        maxEntries: 5000,
        loginByIp: { maxRequests: 50, windowMs: 60_000 },
        loginByAccount: { maxRequests: 50, windowMs: 60_000 },
        refreshByIp: { maxRequests: 50, windowMs: 60_000 },
        refreshByToken: { maxRequests: 50, windowMs: 60_000 },
        changePasswordByIp: { maxRequests: 50, windowMs: 60_000 },
        changePasswordByUser: { maxRequests: 50, windowMs: 60_000 },
        logoutByIp: { maxRequests: 50, windowMs: 60_000 },
        logoutByActor: { maxRequests: 50, windowMs: 60_000 },
        meByIp: { maxRequests: 100, windowMs: 60_000 },
        meByUser: { maxRequests: 100, windowMs: 60_000 },
        adminByIp: { maxRequests: 100, windowMs: 60_000 },
        adminByUser: { maxRequests: 100, windowMs: 60_000 },
      },
      logging: {
        level: "info",
        enabled: true,
      },
    });

    server = await buildAuthHttpServer({
      httpConfig,
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      activationTokenRepo,
      operatorPermissionRepo,
      domainRepo,
      submodulesRepo,
      storageService,
      emailService,
      passwordHasher,
      auditService,
      txManager,
      authPolicy: new AuthorizationPolicyService(),
      operatorPrincipalResolver: new RepositoryOperatorPrincipalResolver(
        operatorPermissionRepo
      ),
      databaseReadinessCheck: async () => true,
      cryptoReadinessCheck: async () => true,
      logStream,
    });
  }, 60_000);

  afterAll(async () => {
    configureSelfHostedRuntimeBridge({
      provider: "supabase",
      accessToken: null,
      activeCompanyId: null,
    });
    if (server) {
      await server.app.close();
    }
    if (poolAdapter) {
      await poolAdapter.end();
    }
    if (rawAdminPool) {
      await rawAdminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2) AND pid <> pg_backend_pid();`,
        [TEST_DB_NAME, RESTORED_DB_NAME]
      );
      await rawAdminPool.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
      await rawAdminPool.query(`DROP DATABASE IF EXISTS "${RESTORED_DB_NAME}";`);
      await rawAdminPool.end();
    }
    if (tempStorageDir && existsSync(tempStorageDir)) {
      rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it("1. PostgreSQL 16.15 Convencional: verifica motor real, migraciones 0001–0006, rollback, reejecución idempotente, bloqueos concurrentes FOR UPDATE y mínimo privilegio", async () => {
    // 1.1 Confirmar que estamos sobre PostgreSQL 16.15 nativo (no PGlite)
    const verRes = await rawTestPool.query<{ version: string }>("SELECT version();");
    const versionStr = verRes.rows[0]?.version ?? "";
    expect(versionStr).toContain("PostgreSQL 16.");
    expect(versionStr).toContain("x86_64-pc-linux-gnu");

    // 1.2 Verificar conteos reales de objetos creados por 0001–0006
    const schemaCounts = await rawTestPool.query<{
      table_schema: string;
      cnt: number;
    }>(
      `SELECT table_schema, COUNT(*)::int AS cnt
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema IN ('sitecorp_auth', 'public')
       GROUP BY table_schema
       ORDER BY table_schema;`
    );
    expect(schemaCounts.rows).toEqual([
      { table_schema: "public", cnt: 136 },
      { table_schema: "sitecorp_auth", cnt: 8 },
    ]);

    const idxCount = await rawTestPool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM pg_indexes WHERE schemaname IN ('sitecorp_auth', 'public');`
    );
    expect(idxCount.rows[0]!.cnt).toBeGreaterThanOrEqual(250);

    const trigCount = await rawTestPool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.triggers WHERE trigger_schema IN ('sitecorp_auth', 'public');`
    );
    expect(trigCount.rows[0]!.cnt).toBeGreaterThanOrEqual(25);

    // 1.3 Probar rollback limpio de 0006 y reejecución idempotente de 0001–0006
    const rollbackSql = loadCompleteSubmodulesRollbackSql(undefined, {
      environment: "test",
    });
    await rawTestPool.query(rollbackSql);
    await rawTestPool.query(
      `DELETE FROM sitecorp_auth.schema_migrations WHERE version = '0006_sitecorp_complete_submodules';`
    );

    const afterRollback = await rawTestPool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cadre_reserves';`
    );
    expect(afterRollback.rows[0]!.cnt).toBe(0);

    // Reaplicar mediante PostgresMigrationRunner
    const runner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const reapplied = await runner.applyMigrations([
      loadCompleteSubmodulesMigration(undefined, { environment: "test" }),
    ]);
    expect(reapplied).toEqual(["0006_sitecorp_complete_submodules"]);

    // Segunda ejecución consecutiva es 100% idempotente (0 aplicadas)
    const idempotentRun = await runner.applyMigrations(
      loadAllAuthSchemaMigrations(undefined, { environment: "test" })
    );
    expect(idempotentRun).toHaveLength(0);

    // 1.4 Verificar bloqueo concurrente real (SELECT ... FOR UPDATE) entre dos conexiones de PostgreSQL 16
    const tempCompanyId = randomUUID();
    await rawTestPool.query(
      `INSERT INTO public.company_clients (id, name, code, is_active) VALUES ($1, 'Empresa Lock Test', 'LCK-01', TRUE);`,
      [tempCompanyId]
    );

    const client1 = await rawTestPool.connect();
    const client2 = await rawTestPool.connect();
    try {
      await client1.query("BEGIN");
      await client1.query(
        `SELECT id FROM public.company_clients WHERE id = $1 FOR UPDATE;`,
        [tempCompanyId]
      );

      // client2 con lock_timeout corto debe fallar por bloqueo activo de client1
      await client2.query("BEGIN");
      await client2.query("SET LOCAL lock_timeout = '150ms';");
      await expect(
        client2.query(
          `UPDATE public.company_clients SET name = 'Intento Concurrente' WHERE id = $1;`,
          [tempCompanyId]
        )
      ).rejects.toThrow();
      await client2.query("ROLLBACK");

      await client1.query(
        `DELETE FROM public.company_clients WHERE id = $1;`,
        [tempCompanyId]
      );
      await client1.query("COMMIT");
    } finally {
      client1.release();
      client2.release();
    }

    // 1.5 Verificar principio de mínimo privilegio (sitecorp_app_runtime)
    const leastPrivPath = existsSync(
      resolve(process.cwd(), "ops/postgres16-least-privilege.sql")
    )
      ? resolve(process.cwd(), "ops/postgres16-least-privilege.sql")
      : resolve(process.cwd(), "services/auth-api/ops/postgres16-least-privilege.sql");
    const leastPrivSql = readFileSync(leastPrivPath, "utf8");
    await rawTestPool.query(leastPrivSql);

    const runtimeClient = await rawTestPool.connect();
    try {
      await runtimeClient.query("SET ROLE sitecorp_app_runtime;");

      // Lectura DML permitida
      const readRes = await runtimeClient.query(
        `SELECT COUNT(*)::int AS cnt FROM public.company_clients;`
      );
      expect(typeof readRes.rows[0]?.cnt).toBe("number");

      // Creación DDL en public prohibida (42501 insufficient_privilege)
      await expect(
        runtimeClient.query(`CREATE TABLE public.unauthorized_ddl_test (id INT);`)
      ).rejects.toThrow(/permission denied/i);

      // Modificación de sitecorp_auth.schema_migrations prohibida
      await expect(
        runtimeClient.query(
          `DELETE FROM sitecorp_auth.schema_migrations WHERE version = '0001_sitecorp_auth_schema';`
        )
      ).rejects.toThrow(/permission denied/i);

      await runtimeClient.query("RESET ROLE;");
    } finally {
      runtimeClient.release();
    }
  });

  it("2. equivalencia funcional de los 14 módulos de negocio sobre PostgreSQL 16.15 y aislamiento multiempresa", async () => {
    // Crear usuario operador y autenticar
    const now = new Date();
    const adminPassword = "AdminPg16#2026_Secure!";
    const passwordHash = await passwordHasher.hash(adminPassword);
    const adminUser = AuthUser.create(
      createUserId(randomUUID()),
      createEmail("admin.pg16@sitecorp.cu"),
      {
        status: "active",
        mustChangePassword: false,
        now,
      }
    );

    await txManager.runInTransaction(async () => {
      await userRepo.save(adminUser);
      await credentialRepo.save({
        id: `cred_${randomUUID()}`,
        userId: adminUser.id,
        algorithm: "argon2id",
        passwordHash,
        version: 1,
        createdAt: now,
      });
    });

    await operatorPermissionRepo.grantPermission({
      userId: adminUser.id,
      permission: "security.admin",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test 4G.8 PG16",
    });
    await operatorPermissionRepo.grantPermission({
      userId: adminUser.id,
      permission: "users.manage",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test 4G.8 PG16",
    });

    const authAdapter = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    const loginRes = await authAdapter.signInWithPassword({
      email: "admin.pg16@sitecorp.cu",
      password: adminPassword,
    });
    expect(loginRes.error).toBeNull();
    adminAccessToken = loginRes.session!.accessToken;

    const domainClient = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider: authAdapter,
      fetchFn: createInjectFetch(),
    });

    // (Módulo 1) Empresas y Entidades: Crear Empresa A y Empresa B
    const companyA = await domainClient.createCompany({
      name: "Empresa Estatal Socialista A (PG16)",
      code: "EESA-PG16",
      description: "NIT: 10020030041",
    });
    companyAId = companyA.id;

    // Crear un segundo usuario exclusivo de Empresa B para probar aislamiento cruzado
    const userB = AuthUser.create(
      createUserId(randomUUID()),
      createEmail("userb.pg16@sitecorp.cu"),
      {
        status: "active",
        mustChangePassword: false,
        now,
      }
    );
    await txManager.runInTransaction(async () => {
      await userRepo.save(userB);
      await credentialRepo.save({
        id: `cred_${randomUUID()}`,
        userId: userB.id,
        algorithm: "argon2id",
        passwordHash,
        version: 1,
        createdAt: now,
      });
    });

    const compB = await domainRepo.createCompanyClient({
      code: "EEB-PG16",
      name: "Empresa Ajena B (PG16)",
    });
    companyBId = compB.id;

    await domainRepo.grantCompanyMembership({
      userId: userB.id,
      companyClientId: companyBId,
      roleCode: "COMPANY_ADMIN",
      permissions: ["companies.view", "workers.view"],
      grantedBy: adminUser.id,
    });

    const entityA = await domainClient.createEntity(companyAId, {
      name: "UEB Producción Industrial Habana",
      code: "UEB-HAB-01",
      entityType: "UEB",
    });
    entityAId = entityA.id;

    // (Módulo 2) Estructura Organizativa y Trabajadores
    const posCreated = await domainClient.createPosition(companyAId, {
      organizationEntityId: entityAId,
      jobTitle: "Ingeniero Principal de Procesos",
      positionName: "Plaza Ingeniero Principal #1",
      authorizedQuantity: 2,
      dailyHours: 8,
    });
    expect(posCreated.id).toBeTruthy();
    positionAId = posCreated.id;

    const worker1 = await domainClient.createWorker(companyAId, {
      identificationNumber: "88041212345",
      firstName: "Carlos",
      lastName: "Maceo Céspedes",
      email: "carlos.maceo@sitecorp.cu",
      address: "Calle 23 #450, Vedado, La Habana",
    });
    workerA1Id = worker1.id;

    const worker2 = await domainClient.createWorker(companyAId, {
      identificationNumber: "91072554321",
      firstName: "Elena",
      lastName: "Gómez Calixto",
      email: "elena.gomez@sitecorp.cu",
      address: "Ave. Paseo #102, Plaza, La Habana",
    });
    workerA2Id = worker2.id;

    // (Módulo 3) Contratos y Movimientos Laborales
    const contract1 = await domainClient.createContract(companyAId, {
      workerId: workerA1Id,
      organizationEntityId: entityAId,
      positionId: positionAId,
      startDate: "2026-01-01",
      baseSalary: 9800,
    });
    contractA1Id = contract1.id;

    const movLaboral = await domainClient.recordLaborMovement(companyAId, {
      workerId: workerA1Id,
      organizationEntityId: entityAId,
      movementType: "ALTA",
      effectiveDate: "2026-01-01",
      newPositionId: positionAId,
      reason: "Alta inicial en plaza aprobada",
    });
    expect(movLaboral.id).toBeTruthy();

    // (Módulo 4) Vacaciones
    const vac1 = await domainClient.recordVacationMovement(companyAId, {
      workerId: workerA1Id,
      year: 2026,
      movementType: "ACCRUAL",
      days: 15,
      notes: "Vacaciones acumuladas primer semestre",
    });
    expect(Number(vac1.daysAccrued)).toBe(15);

    // (Módulo 5) Nómina y Prenómina
    const period = await domainClient.createPrenominaPeriod(companyAId, {
      organizationEntityId: entityAId,
      periodYear: 2026,
      periodMonth: 4,
    });
    periodAId = String(period.id);

    await domainClient.upsertPrenominaWorkerEntry(companyAId, periodAId, {
      workerId: workerA1Id,
      workedDays: 24,
      workedHours: 192,
      baseAmount: 9800,
      bonusAmount: 1200,
      deductionAmount: 490,
      notes: "Mes completo sin ausencias",
    });

    await domainClient.createSalaryBonus(companyAId, {
      workerId: workerA1Id,
      prenominaPeriodId: periodAId,
      bonusType: "RESULTADOS",
      concept: "Sobrecumplimiento plan técnico",
      amount: 1200,
    });

    await domainClient.createSalaryDeduction(companyAId, {
      workerId: workerA1Id,
      prenominaPeriodId: periodAId,
      deductionType: "SEGURIDAD_SOCIAL",
      concept: "Aporte Seguridad Social 5%",
      amount: 490,
    });

    const closure = await domainClient.closePrenominaPeriod(
      companyAId,
      periodAId,
      "Cierre oficial abril 2026"
    );
    expect(Number(closure.totalWorkers)).toBe(1);
    expect(Number(closure.totalNetAmount)).toBe(10510);

    // (Módulo 6) Cuadros y Reservas
    const reserve = await domainClient.createCadreReserve(companyAId, {
      workerId: workerA1Id,
      targetPositionId: positionAId,
      reserveCategory: "RESERVA_INMEDIATA",
      readinessLevel: "LISTO",
      notes: "Cuadro preparado para promoción",
    });
    expect(reserve.id).toBeTruthy();

    await domainClient.createCadreEvaluation(companyAId, {
      workerId: workerA1Id,
      positionId: positionAId,
      evaluationPeriod: "2026-I",
      overallRating: "SUPERIOR",
      score: 97,
    });

    await domainClient.createCadreMovement(companyAId, {
      workerId: workerA1Id,
      toPositionId: positionAId,
      movementKind: "PROMOCION",
      resolutionNumber: "RES-CUADRO-2026-09",
    });

    // (Módulo 7) SST (EPP y Accidentes vía endpoints autónomos de dominio)
    const ppeRes = await server.app.inject({
      method: "POST",
      url: `/api/v1/domain/companies/${companyAId}/ppe-deliveries`,
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        "content-type": "application/json",
      },
      payload: {
        workerId: workerA1Id,
        itemName: "Casco dieléctrico y botas de seguridad",
        quantity: 1,
        deliveryDate: "2026-02-01",
      },
    });
    expect(ppeRes.statusCode).toBe(201);

    const accidentRes = await server.app.inject({
      method: "POST",
      url: `/api/v1/domain/companies/${companyAId}/work-accidents`,
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        "content-type": "application/json",
      },
      payload: {
        workerId: workerA2Id,
        organizationEntityId: entityAId,
        accidentDate: "2026-02-15",
        severity: "LEVE",
        daysLost: 2,
        description: "Resbalón en área de taller",
      },
    });
    expect(accidentRes.statusCode).toBe(201);

    // (Módulo 8) Capacitación
    const course = await domainClient.createTrainingCourse(companyAId, {
      code: "CAP-SST-2026",
      title: "Seguridad Industrial y Normas Eléctricas",
      provider: "Centro Nacional de Capacitación",
      modality: "PRESENCIAL",
      durationHours: 32,
    });
    courseAId = String(course.id);

    const training = await domainClient.recordWorkerTraining(companyAId, {
      workerId: workerA1Id,
      courseId: courseAId,
      startDate: "2026-02-10",
      status: "APROBADO",
      grade: 98,
      certificateNumber: "CERT-2026-0045",
    });
    expect(training.id).toBeTruthy();

    // (Módulo 9) Comisiones de Evaluación y Disciplina
    const committee = await domainClient.createEvaluationCommittee(companyAId, {
      organizationEntityId: entityAId,
      name: "Comisión de Idoneidad Demostrada UEB Habana",
      resolutionNumber: "RES-COM-2026-01",
      members: [{ workerId: workerA1Id, role: "PRESIDENTE" }],
    });
    expect(committee.id).toBeTruthy();

    const disciplinary = await domainClient.recordDisciplinaryMeasure(companyAId, {
      workerId: workerA2Id,
      organizationEntityId: entityAId,
      measureType: "AMONESTACION_PUBLICA",
      resolutionNumber: "RES-DISC-2026-02",
      reason: "Llegada tardía reiterada",
    });
    expect(disciplinary.id).toBeTruthy();

    // (Módulo 10) Plantillas y Documentos Generados
    const tpl = await domainClient.createDocumentTemplate(companyAId, {
      code: "TPL-CONTRATO-IND",
      name: "Contrato Indeterminado Estándar",
      category: "CONTRATO",
      contentHtml: "<p>Trabajador: {{worker_name}} - Salario: {{salary}}</p>",
    });
    templateAId = String(tpl.template.id);

    const genDoc = await domainClient.generateDocument(companyAId, {
      templateId: templateAId,
      workerId: workerA1Id,
      contractId: contractA1Id,
      documentTitle: "Contrato Carlos Maceo Céspedes",
      variables: { worker_name: "Carlos Maceo Céspedes", salary: 9800 },
    });
    expect(genDoc.renderedContent).toContain("Carlos Maceo Céspedes");

    // (Módulo 11) Invitaciones y Notificaciones
    const inv = await domainClient.createCompanyInvitation(companyAId, {
      invitedEmail: "especialista.rrhh@sitecorp.cu",
      roleCode: "HR_SPECIALIST",
    });
    expect(inv.invitation.invitedEmail).toBe("especialista.rrhh@sitecorp.cu");

    // (Módulo 12) Planes y Reportes (vía RPC autónomo save_entity_plan)
    const planRpc = await domainClient.invokeAutonomousRpc("save_entity_plan", {
      p_company_client_id: companyAId,
      p_organization_entity_id: entityAId,
      p_plan_type: "FUERZA_TRABAJO",
      p_year: 2026,
      p_data: { approvedQuota: 120 },
    });
    expect(planRpc).toBeTruthy();

    // (Módulo 13) Storage Autónomo
    const uploaded = await domainClient.uploadFile({
      bucketId: "documents",
      objectName: `${companyAId}/contratos/contrato-carlos-maceo.pdf`,
      companyClientId: companyAId,
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.4 Contrato Firmado SiteCorp").toString("base64"),
    });
    expect(uploaded.bucketId).toBe("documents");

    // (Módulo 14) Administración y Permisos + Prueba Negativa cruzada desde Usuario B hacia Empresa A
    const authB = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    const loginB = await authB.signInWithPassword({
      email: "userb.pg16@sitecorp.cu",
      password: adminPassword,
    });
    expect(loginB.error).toBeNull();
    const userBToken = loginB.session!.accessToken;

    const crossCompanyAttempt = await server.app.inject({
      method: "GET",
      url: `/api/v1/domain/companies/${companyAId}/cadre-reserves`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(crossCompanyAttempt.statusCode).toBe(403);
  });

  it("3. Seguridad de la Pasarela Autónoma (/api/v1/submodules/query/:table, /rpc/:rpcName, /edge/:functionName) y compatibilidad real de PostgREST en src/lib/supabase.ts", async () => {
    configureSelfHostedRuntimeBridge({
      provider: "self_hosted",
      apiBaseUrl: "http://127.0.0.1:4010",
      accessToken: adminAccessToken,
      activeCompanyId: companyAId,
      customFetch: createInjectFetch(),
    });

    // 3.1 Bloqueo de acceso a tablas no autorizadas (ej. credenciales internas, sistema o inventadas)
    for (const forbiddenTable of [
      "user_credentials",
      "sitecorp_auth.users",
      "account_activation_tokens",
      "pg_shadow",
      "tabla_inexistente_arbitraria",
    ]) {
      const res = await server.app.inject({
        method: "POST",
        url: `/api/v1/submodules/query/${encodeURIComponent(forbiddenTable)}`,
        headers: {
          authorization: `Bearer ${adminAccessToken}`,
          "content-type": "application/json",
        },
        payload: {
          operation: "select",
          companyClientId: companyAId,
        },
      });
      expect(res.statusCode).toBe(403);
    }

    // 3.2 Bloqueo de inyección SQL en nombres de columna u ordenación
    const sqlInjectionAttempt = await server.app.inject({
      method: "POST",
      url: "/api/v1/submodules/query/workers",
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        "content-type": "application/json",
      },
      payload: {
        operation: "select",
        companyClientId: companyAId,
        filters: {
          "first_name; DROP TABLE workers--": "Carlos",
        },
      },
    });
    expect(sqlInjectionAttempt.statusCode).toBe(400);
    expect(sqlInjectionAttempt.json().error.code).toBe("INVALID_GATEWAY_PARAMETER");

    // 3.3 Bloqueo de ejecución de RPC no permitida en la lista blanca
    const forbiddenRpcRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/submodules/rpc/pg_read_server_files",
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        "content-type": "application/json",
      },
      payload: { p_company_client_id: companyAId },
    });
    expect(forbiddenRpcRes.statusCode).toBe(403);

    // 3.4 Bloqueo de Edge Function no permitida en la lista blanca
    const forbiddenEdgeRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/submodules/edge/arbitrary-shell-function",
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        "content-type": "application/json",
      },
      payload: { companyClientId: companyAId },
    });
    expect(forbiddenEdgeRes.statusCode).toBe(403);

    // 3.5 Rechazo explícito (HTTP 400 UNSUPPORTED_POSTGREST_FEATURE) de características PostgREST no soportadas
    const unsupportedJoin = await supabase
      .from("workers")
      .select("id, first_name, employment_contracts(id, contract_number)");
    expect(unsupportedJoin.error).not.toBeNull();
    expect(unsupportedJoin.error?.code).toBe("UNSUPPORTED_POSTGREST_FEATURE");

    // 3.6 Compatibilidad real de operaciones PostgREST usadas por el frontend (filtros, ordenación, paginación, count=exact, single, update)
    const { data: pagedWorkers, count, error: listErr } = await supabase
      .from("workers")
      .select("*", { count: "exact" })
      .eq("company_client_id", companyAId)
      .ilike("first_name", "*arl*")
      .order("first_name", { ascending: true })
      .range(0, 9);

    expect(listErr).toBeNull();
    expect(count).toBe(1);
    expect(pagedWorkers).toHaveLength(1);
    expect((pagedWorkers![0] as any).first_name).toBe("Carlos");

    // Consulta .single()
    const { data: singleWorker, error: singleErr } = await supabase
      .from("workers")
      .select("*")
      .eq("id", workerA1Id)
      .single();
    expect(singleErr).toBeNull();
    expect((singleWorker as any).identification_number).toBe("88041212345");

    // Actualización .update() con validación de aislamiento
    const { data: updatedRows, error: updErr } = await supabase
      .from("workers")
      .update({ address: "Calle 23 #450 Modificada, Vedado" })
      .eq("id", workerA1Id)
      .select("*");
    expect(updErr).toBeNull();
    expect((updatedRows as any)?.[0]?.address).toBe("Calle 23 #450 Modificada, Vedado");

    // Intento de un operador de Empresa B de consultar trabajadores de Empresa A vía puente es bloqueado con 403
    const authB = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    const loginB = await authB.signInWithPassword({
      email: "userb.pg16@sitecorp.cu",
      password: "AdminPg16#2026_Secure!",
    });
    configureSelfHostedRuntimeBridge({
      provider: "self_hosted",
      apiBaseUrl: "http://127.0.0.1:4010",
      accessToken: loginB.session!.accessToken,
      activeCompanyId: companyAId,
      customFetch: createInjectFetch(),
    });
    const crossTenantQuery = await supabase
      .from("workers")
      .select("*")
      .eq("company_client_id", companyAId);
    expect(crossTenantQuery.error).not.toBeNull();

    // Restaurar bridge con adminAccessToken
    configureSelfHostedRuntimeBridge({
      provider: "self_hosted",
      apiBaseUrl: "http://127.0.0.1:4010",
      accessToken: adminAccessToken,
      activeCompanyId: companyAId,
      customFetch: createInjectFetch(),
    });
  });

  it("4. Ensayo de Migración de Datos Sintéticos, Reconciliación SHA-256, Rollback y Copia de Seguridad / Restauración Real (pg_dump + pg_restore) en PostgreSQL 16.15", async () => {
    const migrationEngine = new DataMigrationEngine(txManager, txManager);

    // 4.1 Exportar paquete determinista de la Empresa A desde PostgreSQL 16.15
    const exportedBundle = await migrationEngine.exportCompanyBundle([companyAId]);
    expect(exportedBundle.companyClientIds).toEqual([companyAId]);
    expect(exportedBundle.tables.workers?.rowCount).toBe(2);
    expect(exportedBundle.tables.employment_contracts?.rowCount).toBe(1);
    expect(exportedBundle.tables.payroll_closures?.rowCount).toBe(1);
    expect(exportedBundle.tables.cadre_reserves?.rowCount).toBe(1);
    expect(exportedBundle.tables.generated_documents?.rowCount).toBe(1);
    expect(exportedBundle.tables.storage_objects?.rowCount).toBe(1);
    expect(exportedBundle.bundleSha256).toMatch(/^[0-9a-f]{64}$/);

    // 4.2 Ejecutar copia de seguridad real con pg_dump (-Fc) de PostgreSQL 16.15
    const dumpFilePath = join(tempStorageDir, `${TEST_DB_NAME}.dump`);
    runPg16Cmd("pg_dump", [
      "-h",
      PG16_HOST,
      "-p",
      String(PG16_PORT),
      "-U",
      "postgres",
      "-d",
      TEST_DB_NAME,
      "-Fc",
      "--no-owner",
      "--no-acl",
      "-f",
      dumpFilePath,
    ]);
    expect(existsSync(dumpFilePath)).toBe(true);
    const dumpBuffer = readFileSync(dumpFilePath);
    expect(dumpBuffer.byteLength).toBeGreaterThan(10_000);
    const dumpSha256 = createHash("sha256").update(dumpBuffer).digest("hex");
    expect(dumpSha256).toMatch(/^[0-9a-f]{64}$/);

    // 4.3 Restaurar copia de seguridad con pg_restore en una base PostgreSQL 16.15 nueva (RESTORED_DB_NAME)
    await rawAdminPool.query(`CREATE DATABASE "${RESTORED_DB_NAME}" ENCODING 'UTF8';`);
    runPg16Cmd("pg_restore", [
      "-h",
      PG16_HOST,
      "-p",
      String(PG16_PORT),
      "-U",
      "postgres",
      "-d",
      RESTORED_DB_NAME,
      "--no-owner",
      "--no-acl",
      dumpFilePath,
    ]);

    const restoredPool = new pg.Pool({
      host: PG16_HOST,
      port: PG16_PORT,
      user: "postgres",
      database: RESTORED_DB_NAME,
    });
    const restoredAdapter = new PgPoolAdapter(restoredPool);
    const restoredTxManager = new PostgresTransactionManager(restoredAdapter);
    const restoredMigrationEngine = new DataMigrationEngine(
      restoredTxManager,
      restoredTxManager
    );

    try {
      // Verificar que la base restaurada conserva exactamente los mismos UUIDs, relaciones, hashes y cantidades
      const reconciliationAfterRestore =
        await restoredMigrationEngine.verifyReconciliation(exportedBundle);
      expect(reconciliationAfterRestore.passed).toBe(true);
      expect(reconciliationAfterRestore.uuidPreservationPassed).toBe(true);
      expect(reconciliationAfterRestore.referentialIntegrityPassed).toBe(true);
      expect(reconciliationAfterRestore.orphanCount).toBe(0);
      expect(reconciliationAfterRestore.checksumMatchPassed).toBe(true);
      expect(reconciliationAfterRestore.businessRulesPassed).toBe(true);
      expect(reconciliationAfterRestore.discrepancies).toEqual([]);

      // 4.4 Probar reversión transaccional (rollbackCompanyMigration) y reimportación (importCompanyBundle)
      const rollbackResult = await restoredMigrationEngine.rollbackCompanyMigration([
        companyAId,
      ]);
      expect(rollbackResult.deletedRows).toBeGreaterThanOrEqual(15);

      const reimportResult =
        await restoredMigrationEngine.importCompanyBundle(exportedBundle);
      expect(reimportResult.importedRows).toBe(
        reconciliationAfterRestore.totalRowsVerified
      );

      const reconciliationAfterReimport =
        await restoredMigrationEngine.verifyReconciliation(exportedBundle);
      expect(reconciliationAfterReimport.passed).toBe(true);
      expect(reconciliationAfterReimport.discrepancies).toEqual([]);
    } finally {
      await restoredAdapter.end();
    }
  });
});
