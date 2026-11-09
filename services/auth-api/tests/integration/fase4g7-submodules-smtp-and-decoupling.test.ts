import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import {
  AuthUser,
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  AuthorizationPolicyService,
  QueryResultRow,
  RepositoryOperatorPrincipalResolver,
} from "../../src/interfaces";
import {
  Argon2idPasswordHasher,
  ControlledSmtpTransport,
  EmailSecurityPolicyViolationError,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadAllAuthSchemaMigrations,
  loadCompleteSubmodulesRollbackSql,
  PgPoolClientLike,
  PgPoolLike,
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
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "../../src/presentation/http";
import { SelfHostedAuthAdapter } from "../../../../src/modules/access-control/infrastructure/self-hosted-auth.adapter";
import {
  SelfHostedDomainClient,
  SelfHostedDomainHttpError,
} from "../../../../src/modules/access-control/infrastructure/self-hosted-domain.client";
import {
  configureSelfHostedRuntimeBridge,
  supabase,
} from "../../../../src/lib/supabase";

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
            rowCount:
              rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          };
        }
        const res = await this.pglite.query<TRow>(text, [...values]);
        return {
          rows: res.rows,
          rowCount:
            res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
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
          rowCount: last?.affectedRows ?? rows.length,
        };
      }
      const res = await this.pglite.query<TRow>(text, [...values]);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    } finally {
      this.releaseMutex();
    }
  }
}

describe("Fase 4G.7 — Desacoplamiento Funcional Completo de Supabase, 24 Tablas Pendientes, Submódulos y SMTP Transaccional", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credRepo: PostgresCredentialRepository;
  let sessionRepo: PostgresSessionRepository;
  let tokenRepo: PostgresActivationTokenRepository;
  let auditService: PostgresSecurityAuditService;
  let permissionRepo: PostgresOperatorPermissionRepository;
  let domainRepo: PostgresDomainRepository;
  let submodulesRepo: PostgresSubmodulesRepository;
  let smtpTransport: ControlledSmtpTransport;
  let emailService: SmtpTransactionalEmailService;
  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let server: BuiltAuthHttpServer;

  let logChunks: string[] = [];
  let supabaseExternalRequests = 0;

  let platformAdmin: { user: AuthUser; password: string };
  let userCompanyA: { user: AuthUser; password: string };
  let userCompanyB: { user: AuthUser; password: string };
  let companyAId: string;
  let companyBId: string;
  let entityAId: string;
  let entityBId: string;
  let positionAId: string;
  let positionBId: string;
  let workerAId: string;
  let workerBId: string;

  const ALLOWED_ORIGIN = "http://127.0.0.1:3000";

  function createInjectFetch(): typeof fetch {
    const cookieJar = new Map<string, string>();

    return async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ): Promise<Response> => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (urlStr.includes("supabase.co")) {
        supabaseExternalRequests += 1;
        throw new Error(
          `VIOLACIÓN DE AISLAMIENTO: Petición externa hacia Supabase detectada (${urlStr})`
        );
      }

      const parsedUrl = new URL(urlStr, "http://127.0.0.1:4010");
      const method = (init?.method ?? "GET").toUpperCase() as
        | "GET"
        | "POST"
        | "PATCH"
        | "DELETE";

      const headers: Record<string, string> = {
        origin: ALLOWED_ORIGIN,
      };

      if (init?.headers) {
        const rawHeaders = init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(rawHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }

      if (cookieJar.size > 0 && !headers.cookie) {
        headers.cookie = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      }

      const injected = await server.app.inject({
        method,
        url: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers,
        payload:
          typeof init?.body === "string"
            ? init.body
            : init?.body
              ? JSON.stringify(init.body)
              : undefined,
      });

      const setCookie = injected.headers["set-cookie"];
      const cookieList = Array.isArray(setCookie)
        ? setCookie
        : typeof setCookie === "string"
          ? [setCookie]
          : [];
      for (const raw of cookieList) {
        const firstPart = raw.split(";")[0];
        if (!firstPart) continue;
        const eqIdx = firstPart.indexOf("=");
        if (eqIdx > 0) {
          const name = firstPart.slice(0, eqIdx).trim();
          const val = firstPart.slice(eqIdx + 1).trim();
          if (val === "") {
            cookieJar.delete(name);
          } else {
            cookieJar.set(name, val);
          }
        }
      }

      const responseHeaders = new Headers();
      for (const [k, v] of Object.entries(injected.headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        }
      }

      return new Response(injected.rawPayload, {
        status: injected.statusCode,
        headers: responseHeaders,
      });
    };
  }

  async function seedActiveUser(
    email: string,
    password = "ClaveFuerte#2026_User!"
  ): Promise<{ user: AuthUser; password: string }> {
    const now = new Date();
    const hash = await passwordHasher.hash(password);
    const user = AuthUser.create(createUserId(randomUUID()), createEmail(email), {
      status: "active",
      mustChangePassword: false,
      now,
    });

    await txManager.runInTransaction(async () => {
      await userRepo.save(user);
      await credRepo.save({
        id: `cred_${randomUUID()}`,
        userId: user.id,
        algorithm: "argon2id",
        passwordHash: hash,
        version: 1,
        createdAt: now,
      });
    });

    return { user, password };
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    pool = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(pool);

    const runner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    });
    const applied = await runner.applyMigrations(migrations);
    expect(applied).toContain("0006_sitecorp_complete_submodules");

    userRepo = new PostgresUserRepository(txManager);
    credRepo = new PostgresCredentialRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    tokenRepo = new PostgresActivationTokenRepository(txManager);
    auditService = new PostgresSecurityAuditService(txManager);
    permissionRepo = new PostgresOperatorPermissionRepository(txManager);
    domainRepo = new PostgresDomainRepository(txManager);
    submodulesRepo = new PostgresSubmodulesRepository(txManager, domainRepo);

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

    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    const keyPair = generateEphemeralEd25519KeyPair("fase4g7-kid", "test");
    tokenService = new JoseTokenService({
      issuer: "urn:sitecorp:auth-api:test",
      audience: "urn:sitecorp:api:test",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
    });

    logChunks = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        logChunks.push(chunk.toString("utf8"));
        cb();
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
          "sitecorp-csrf-hmac-secret-key-with-at-least-32-bytes-for-4g7-tests",
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
      credentialRepo: credRepo,
      operatorPermissionRepo: permissionRepo,
      activationTokenRepo: tokenRepo,
      passwordHasher,
      auditService,
      txManager,
      domainRepo,
      submodulesRepo,
      emailService,
      authPolicy: new AuthorizationPolicyService(),
      operatorPrincipalResolver: new RepositoryOperatorPrincipalResolver(
        permissionRepo
      ),
      logStream,
    });

    // Sembrar admin de plataforma y dos empresas independientes (Empresa A y Empresa B)
    platformAdmin = await seedActiveUser("root.4g7@sitecorp.cu");
    userCompanyA = await seedActiveUser("operador.empresa.a@sitecorp.cu");
    userCompanyB = await seedActiveUser("operador.empresa.b@sitecorp.cu");

    await permissionRepo.grantPermission({
      userId: platformAdmin.user.id,
      permission: "security.admin",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test 4G.7",
    });
    await permissionRepo.grantPermission({
      userId: platformAdmin.user.id,
      permission: "users.manage",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test 4G.7",
    });

    const compA = await domainRepo.createCompanyClient({
      code: "EMP-4G7-A",
      name: "Empresa Autónoma Alfa S.A.",
    });
    const compB = await domainRepo.createCompanyClient({
      code: "EMP-4G7-B",
      name: "Empresa Autónoma Beta S.A.",
    });
    companyAId = compA.id;
    companyBId = compB.id;

    await domainRepo.grantCompanyMembership({
      userId: userCompanyA.user.id,
      companyClientId: companyAId,
      roleCode: "rrhh_director",
      permissions: [
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
      ],
      grantedBy: platformAdmin.user.id,
    });

    await domainRepo.grantCompanyMembership({
      userId: userCompanyB.user.id,
      companyClientId: companyBId,
      roleCode: "rrhh_director",
      permissions: [
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
      ],
      grantedBy: platformAdmin.user.id,
    });

    const entA = await domainRepo.createOrganizationEntity({
      companyClientId: companyAId,
      name: "Dirección General Alfa",
      code: "DG-A",
    });
    const entB = await domainRepo.createOrganizationEntity({
      companyClientId: companyBId,
      name: "Dirección General Beta",
      code: "DG-B",
    });
    entityAId = entA.id;
    entityBId = entB.id;

    const posA = await domainRepo.createPosition({
      companyClientId: companyAId,
      organizationEntityId: entityAId,
      jobTitle: "Especialista Principal A",
      positionName: "Plaza Especialista A-1",
      authorizedQuantity: 2,
    });
    const posB = await domainRepo.createPosition({
      companyClientId: companyBId,
      organizationEntityId: entityBId,
      jobTitle: "Especialista Principal B",
      positionName: "Plaza Especialista B-1",
      authorizedQuantity: 2,
    });
    positionAId = posA.id;
    positionBId = posB.id;

    const wA = await domainRepo.createWorker({
      companyClientId: companyAId,
      identificationNumber: "89010112345",
      firstName: "Elena",
      lastName: "Valdés",
      email: "elena.valdes@alfa.cu",
    });
    const wB = await domainRepo.createWorker({
      companyClientId: companyBId,
      identificationNumber: "90020254321",
      firstName: "Roberto",
      lastName: "Mendoza",
      email: "roberto.mendoza@beta.cu",
    });
    workerAId = wA.id;
    workerBId = wB.id;
  });

  afterAll(async () => {
    configureSelfHostedRuntimeBridge({
      provider: "supabase",
      accessToken: null,
      activeCompanyId: null,
      customFetch: undefined,
    });
    if (server) {
      await server.app.close();
    }
    if (pglite) {
      await pglite.close();
    }
  });

  it("1. Migración 0006 y reversibilidad: las 24 tablas pendientes y todos los catálogos existen en PostgreSQL y soportan rollback limpio", async () => {
    const pending24Tables = [
      "cadre_reserves",
      "cadre_evaluations",
      "cadre_movements",
      "template_variables",
      "template_sections",
      "generated_documents",
      "client_invitations",
      "entity_invitations",
      "salary_bonuses",
      "salary_deductions",
      "payroll_closures",
      "training_courses",
      "worker_trainings",
      "disciplinary_measures",
      "ppe_deliveries",
      "work_accidents",
      "evaluation_committees",
      "custom_reports",
      "report_schedules",
      "notification_preferences",
      "user_notifications",
      "import_batches",
      "export_jobs",
      "webhook_subscriptions",
    ];

    const res = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name ASC;`,
      [pending24Tables]
    );

    const existingNames = res.rows.map((r) => r.table_name);
    expect(existingNames).toEqual([...pending24Tables].sort());

    // Verificar reversibilidad limpia ejecutando el rollback y reaplicando 0006
    const rollbackSql = loadCompleteSubmodulesRollbackSql(undefined, {
      environment: "test",
    });
    await pool.query(rollbackSql);
    const afterRollback = await pool.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::INTEGER AS cnt
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[]);`,
      [pending24Tables]
    );
    expect(Number(afterRollback.rows[0]?.cnt)).toBe(0);

    // Reaplicar la migración 0006 para restaurar todas las tablas antes de los tests de negocio
    const allMigrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    });
    const mig0006 = allMigrations.find(
      (m) => m.version === "0006_sitecorp_complete_submodules"
    )!;
    await pool.query(mig0006.sql);

    const afterReapply = await pool.query<{ cnt: string | number }>(
      `SELECT COUNT(*)::INTEGER AS cnt
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[]);`,
      [pending24Tables]
    );
    expect(Number(afterReapply.rows[0]?.cnt)).toBe(24);
  });

  it("2. Submódulos de Negocio y Aislamiento Multiempresa (Cuadros, Plantillas Avanzadas, Nómina/Prenómina, Capacitación, SST, Comisiones y Disciplina)", async () => {
    const authA = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    await authA.signInWithPassword({
      email: userCompanyA.user.email,
      password: userCompanyA.password,
    });
    const clientA = new SelfHostedDomainClient({
      baseUrl: "http://127.0.0.1:4010",
      authProvider: authA,
      fetchFn: createInjectFetch(),
    });

    // 2.1 Cuadros y reservas en Empresa A
    const reserveA = await clientA.createCadreReserve(companyAId, {
      workerId: workerAId,
      targetPositionId: positionAId,
      reserveCategory: "RESERVA_INMEDIATA",
      readinessLevel: "LISTO",
      notes: "Cuadro preparado para promoción",
    });
    expect(reserveA.id).toEqual(expect.any(String));
    expect(reserveA.companyClientId).toBe(companyAId);

    const evalA = await clientA.createCadreEvaluation(companyAId, {
      workerId: workerAId,
      positionId: positionAId,
      evaluationPeriod: "2026-S1",
      overallRating: "SUPERIOR",
      score: 96,
    });
    expect(evalA.overallRating).toBe("SUPERIOR");

    const movA = await clientA.createCadreMovement(companyAId, {
      workerId: workerAId,
      toPositionId: positionAId,
      movementKind: "PROMOCION",
      resolutionNumber: "RES-CUADRO-01/2026",
    });
    expect(movA.movementKind).toBe("PROMOCION");

    // 2.2 Plantillas documentales avanzadas, variables, secciones y generación documental
    const tplCreated = await clientA.createDocumentTemplate(companyAId, {
      code: "TPL-CONTRATO-4G7",
      name: "Contrato Indeterminado con Cláusulas",
      category: "CONTRATO",
      contentHtml: "<h1>Contrato de {{worker_name}}</h1>",
    });
    const templateId = String(tplCreated.template.id);

    await clientA.createTemplateVariable(companyAId, templateId, {
      variableKey: "worker_name",
      label: "Nombre completo del trabajador",
      dataType: "TEXT",
      isRequired: true,
    });
    await clientA.createTemplateSection(companyAId, templateId, {
      sectionCode: "CLAUSULA_SALARIO",
      title: "Cláusula Salarial",
      contentTemplate: "<p>Salario mensual pactado: {{salary_amount}} CUP</p>",
      sortOrder: 1,
    });

    const generatedDoc = await clientA.generateDocument(companyAId, {
      templateId,
      workerId: workerAId,
      documentTitle: "Contrato Indeterminado - Elena Valdés",
      variables: {
        worker_name: "Elena Valdés",
        salary_amount: 14500,
      },
    });
    expect(generatedDoc.renderedContent).toContain("Elena Valdés");
    expect(generatedDoc.renderedContent).toContain("14500 CUP");

    // 2.3 Nómina y prenómina avanzada: apertura, entradas, bonificaciones, deducciones y cierre con checksum SHA-256
    const periodA = await clientA.createPrenominaPeriod(companyAId, {
      organizationEntityId: entityAId,
      periodYear: 2026,
      periodMonth: 11,
    });
    const periodId = String(periodA.id);

    const entryA = await clientA.upsertPrenominaWorkerEntry(companyAId, periodId, {
      workerId: workerAId,
      workedDays: 24,
      workedHours: 192,
      baseAmount: 14500,
      bonusAmount: 1500,
      deductionAmount: 725,
    });
    expect(Number(entryA.netAmount)).toBe(15275);

    await clientA.createSalaryBonus(companyAId, {
      workerId: workerAId,
      prenominaPeriodId: periodId,
      bonusType: "RESULTADOS",
      concept: "Cumplimiento sobrecumplido noviembre",
      amount: 1500,
    });
    await clientA.createSalaryDeduction(companyAId, {
      workerId: workerAId,
      prenominaPeriodId: periodId,
      deductionType: "SEGURIDAD_SOCIAL",
      concept: "Aporte seguridad social 5%",
      amount: 725,
    });

    const closureA = await clientA.closePrenominaPeriod(
      companyAId,
      periodId,
      "Cierre contable verificado"
    );
    expect(Number(closureA.totalWorkers)).toBe(1);
    expect(Number(closureA.totalNetAmount)).toBe(15275);
    expect(String(closureA.checksumSha256)).toMatch(/^[0-9a-f]{64}$/);

    // 2.4 Capacitación, Comisiones de evaluación y Disciplina
    const courseA = await clientA.createTrainingCourse(companyAId, {
      code: "CUR-SST-2026",
      title: "Seguridad Industrial y Protección Laboral",
      durationHours: 32,
    });
    const trainingA = await clientA.recordWorkerTraining(companyAId, {
      workerId: workerAId,
      courseId: String(courseA.id),
      startDate: "2026-10-01",
      status: "APROBADO",
      grade: 98,
    });
    expect(trainingA.status).toBe("APROBADO");

    const committeeA = await clientA.createEvaluationCommittee(companyAId, {
      organizationEntityId: entityAId,
      name: "Comisión de Idoneidad Demostrada Alfa",
      resolutionNumber: "RES-COM-12/2026",
      members: [{ workerId: workerAId, role: "PRESIDENTE" }],
    });
    expect(committeeA.name).toContain("Idoneidad");

    const measureA = await clientA.recordDisciplinaryMeasure(companyAId, {
      workerId: workerAId,
      organizationEntityId: entityAId,
      measureType: "AMONESTACION_PUBLICA",
      resolutionNumber: "RES-DISC-03/2026",
      reason: "Incumplimiento puntual de horario",
    });
    expect(measureA.status).toBe("VIGENTE");

    // 2.5 Pruebas negativas cruzadas entre Empresa A y Empresa B:
    // Operador de Empresa A intenta listar o crear reservas/nóminas en Empresa B -> 403 FORBIDDEN
    await expect(clientA.listCadreReserves(companyBId)).rejects.toThrow(
      SelfHostedDomainHttpError
    );

    // Operador de Empresa A intenta asignar un trabajador de Empresa B (workerBId) o un puesto de Empresa B (positionBId) en una reserva de Empresa A -> 403 FORBIDDEN
    await expect(
      clientA.createCadreReserve(companyAId, {
        workerId: workerBId,
        targetPositionId: positionAId,
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      clientA.createCadreReserve(companyAId, {
        workerId: workerAId,
        targetPositionId: positionBId,
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    // Operador de Empresa A intenta incluir un trabajador de Empresa B en la prenómina de Empresa A -> 403 FORBIDDEN
    const periodA2 = await clientA.createPrenominaPeriod(companyAId, {
      periodYear: 2026,
      periodMonth: 12,
    });
    await expect(
      clientA.upsertPrenominaWorkerEntry(companyAId, String(periodA2.id), {
        workerId: workerBId,
        workedDays: 24,
        baseAmount: 10000,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("3. Correo Transaccional SMTP (Activación, Recuperación de Contraseña e Invitaciones): enlaces de un solo uso, caducidad, protección contra reutilización y ausencia de contraseñas o tokens en logs", async () => {
    smtpTransport.clear();

    // 3.1 Admin crea un usuario importado/nuevo y solicita token de activación con envío SMTP automático
    const adminAuth = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    await adminAuth.signInWithPassword({
      email: platformAdmin.user.email,
      password: platformAdmin.password,
    });
    const adminSession = await adminAuth.getSession();

    const createUserRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${adminSession!.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "importado.smtp@sitecorp.cu",
        initialPassword: "TempPassword#2026_NoEnviada!",
        mustChangePassword: true,
      },
    });
    expect(createUserRes.statusCode).toBe(201);
    const importedUserId = createUserRes.json().data.user.id as string;

    const genTokenRes = await server.app.inject({
      method: "POST",
      url: `/api/v1/auth/admin/users/${importedUserId}/activation-token`,
      headers: {
        authorization: `Bearer ${adminSession!.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        tokenType: "activation",
        expiresInHours: 24,
      },
    });
    expect(genTokenRes.statusCode).toBe(201);
    const tokenBody = genTokenRes.json().data;
    expect(tokenBody.emailDelivery).toEqual({
      sent: true,
      messageId: expect.any(String),
      category: "account_activation",
      transportMode: "smtp_controlled",
    });

    const captured = smtpTransport.getCapturedMessages();
    expect(captured).toHaveLength(1);
    const activationEmail = captured[0]!;
    expect(activationEmail.toEmail).toBe("importado.smtp@sitecorp.cu");
    expect(activationEmail.htmlBody).toContain(
      `https://app.sitecorp.local/activate?token=${encodeURIComponent(tokenBody.token.rawToken)}`
    );
    expect(activationEmail.htmlBody).not.toContain("TempPassword#2026_NoEnviada!");

    // 3.2 Consumir el enlace de activación en POST /api/v1/auth/activate
    const newPersonalPassword = "MiClavePersonal#2026_Segura!";
    const activateRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/activate",
      headers: { "content-type": "application/json" },
      payload: {
        token: tokenBody.token.rawToken,
        newPassword: newPersonalPassword,
      },
    });
    expect(activateRes.statusCode).toBe(200);

    // Reutilizar el mismo token de activación falla con 400 (TOKEN_ALREADY_CONSUMED)
    const reuseActivateRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/activate",
      headers: { "content-type": "application/json" },
      payload: {
        token: tokenBody.token.rawToken,
        newPassword: "OtraClave#2026_Intento!",
      },
    });
    expect(reuseActivateRes.statusCode).toBe(400);

    // 3.3 Flujo público de recuperación de contraseña por correo: POST /api/v1/auth/recover-password
    smtpTransport.clear();
    const recoverRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/recover-password",
      headers: { "content-type": "application/json" },
      payload: {
        email: "importado.smtp@sitecorp.cu",
      },
    });
    expect(recoverRes.statusCode).toBe(200);
    // La respuesta HTTP nunca expone el token de recuperación
    expect(JSON.stringify(recoverRes.json())).not.toContain("reset-password?token=");

    const recoveryEmails = smtpTransport.getCapturedMessages();
    expect(recoveryEmails).toHaveLength(1);
    const recoveryHtml = recoveryEmails[0]!.htmlBody;
    const tokenMatch = recoveryHtml.match(/reset-password\?token=([^"&]+)/);
    expect(tokenMatch).not.toBeNull();
    const extractedRecoveryToken = decodeURIComponent(tokenMatch![1]!);

    // Consumir el token de recuperación en POST /api/v1/auth/reset-password
    const resetRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      headers: { "content-type": "application/json" },
      payload: {
        token: extractedRecoveryToken,
        newPassword: "ClaveRecuperada#2026_Final!",
      },
    });
    expect(resetRes.statusCode).toBe(200);

    // Reutilizar el mismo token de recuperación falla con 400
    const reuseResetRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      headers: { "content-type": "application/json" },
      payload: {
        token: extractedRecoveryToken,
        newPassword: "OtraClaveRecuperada#2026_Final!",
      },
    });
    expect(reuseResetRes.statusCode).toBe(400);

    // 3.4 Verificar prohibición de enviar hashes o contraseñas por correo
    await expect(
      emailService.sendActivationEmail({
        toEmail: "test@sitecorp.cu",
        rawToken: "$argon2id$v=19$m=19456,t=2,p=1$hashprohibido",
        expiresAt: new Date(Date.now() + 3600_000),
      })
    ).rejects.toThrow(EmailSecurityPolicyViolationError);

    // 3.5 Verificar que los logs de Pino no contienen contraseñas ni el token extraído
    const allLogs = logChunks.join("\n");
    expect(allLogs).not.toContain(newPersonalPassword);
    expect(allLogs).not.toContain("ClaveRecuperada#2026_Final!");
    expect(allLogs).not.toContain(extractedRecoveryToken);
  });

  it("4. Desacoplamiento Funcional E2E del Frontend en Modo self_hosted: llamadas supabase.rpc(), supabase.functions.invoke() y supabase.from() operan contra el backend autónomo con 0 peticiones a Supabase Cloud", async () => {
    supabaseExternalRequests = 0;

    const authA = new SelfHostedAuthAdapter({
      baseUrl: "http://127.0.0.1:4010",
      fetchFn: createInjectFetch(),
    });
    await authA.signInWithPassword({
      email: userCompanyA.user.email,
      password: userCompanyA.password,
    });
    const activeSessionA = await authA.getSession();

    configureSelfHostedRuntimeBridge({
      provider: "self_hosted",
      apiBaseUrl: "http://127.0.0.1:4010",
      accessToken: activeSessionA?.accessToken ?? null,
      activeCompanyId: companyAId,
      customFetch: createInjectFetch(),
    });

    // 4.1 Invocar supabase.rpc('get_company_dashboard_summary') -> redirigido a /api/v1/domain/rpc/get_company_dashboard_summary
    const rpcRes = await supabase.rpc("get_company_dashboard_summary", {
      p_company_client_id: companyAId,
    });
    expect(rpcRes.error).toBeNull();
    expect(rpcRes.data).toMatchObject({
      companyClientId: companyAId,
      activeWorkers: expect.any(Number),
    });

    // 4.2 Invocar supabase.functions.invoke('analyze-document-template') -> redirigido a /api/v1/domain/functions/analyze-document-template
    const fnRes = await supabase.functions.invoke("analyze-document-template", {
      body: {
        companyClientId: companyAId,
        contentHtml: "<p>Hola {{worker_full_name}}, puesto {{position_title}}</p>",
      },
    });
    expect(fnRes.error).toBeNull();
    expect(fnRes.data).toEqual({
      analyzed: true,
      companyClientId: companyAId,
      detectedVariables: ["worker_full_name", "position_title"],
      variableCount: 2,
    });

    // 4.3 Invocar supabase.from('cadre_reserves').select('*').eq('company_client_id', companyAId)
    const tableRes = await supabase
      .from("cadre_reserves")
      .select("*")
      .eq("company_client_id", companyAId);
    expect(tableRes.error).toBeNull();
    expect(Array.isArray(tableRes.data)).toBe(true);
    expect(tableRes.data!.length).toBeGreaterThanOrEqual(1);

    // 4.4 Prueba negativa multiempresa desde supabase.from():
    // Usuario de Empresa A intenta consultar reservas de Empresa B mediante supabase.from('cadre_reserves').eq('company_client_id', companyBId)
    const crossTenantTableRes = await supabase
      .from("cadre_reserves")
      .select("*")
      .eq("company_client_id", companyBId);
    expect(crossTenantTableRes.error).not.toBeNull();

    // 4.5 Confirmar 0 llamadas salientes a *.supabase.co
    expect(supabaseExternalRequests).toBe(0);
  });
});
