import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
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
  BootstrapAlreadyInitializedError,
  BootstrapDisabledError,
  InitialAdminBootstrapService,
  QueryResultRow,
  RepositoryOperatorPrincipalResolver,
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
  PostgresOperatorPermissionRepository,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  validateHttpConfig,
} from "../../src/infrastructure";
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

interface ParsedCookie {
  readonly name: string;
  readonly value: string;
  readonly attributes: ReadonlyMap<string, string | true>;
}

function parseSetCookieHeaders(
  header: string | string[] | undefined
): ReadonlyMap<string, ParsedCookie> {
  const list = Array.isArray(header)
    ? header
    : typeof header === "string"
    ? [header]
    : [];
  const map = new Map<string, ParsedCookie>();

  for (const raw of list) {
    const segments = raw.split(";").map((s) => s.trim());
    const [first, ...rest] = segments;
    if (!first) continue;
    const eqIdx = first.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = first.slice(0, eqIdx).trim();
    const value = first.slice(eqIdx + 1).trim();

    const attrs = new Map<string, string | true>();
    for (const attr of rest) {
      const aEq = attr.indexOf("=");
      if (aEq === -1) {
        attrs.set(attr.toLowerCase(), true);
      } else {
        const k = attr.slice(0, aEq).trim().toLowerCase();
        const v = attr.slice(aEq + 1).trim();
        attrs.set(k, v);
      }
    }
    map.set(name, { name, value, attributes: attrs });
  }

  return map;
}

describe("Fase 4G.2 FINAL — Modelo Autoritativo de Permisos, Endpoints Administrativos y Auditoría HTTP", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credentialRepo: PostgresCredentialRepository;
  let sessionRepo: PostgresSessionRepository;
  let auditService: PostgresSecurityAuditService;
  let permissionRepo: PostgresOperatorPermissionRepository;
  let authPolicy: AuthorizationPolicyService;
  let principalResolver: RepositoryOperatorPrincipalResolver;

  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let csrfSecret: string;

  let logChunks: string[];
  let logStream: Writable;
  let currentNow: Date;
  let server: BuiltAuthHttpServer;

  const ALLOWED_ORIGIN = "https://app.sitecorp.local";

  beforeAll(async () => {
    const signingKey = generateEphemeralEd25519KeyPair(
      "ed25519-2026-final",
      "test"
    );
    csrfSecret =
      "sitecorp-csrf-hmac-secret-key-with-at-least-32-bytes-for-4g2-final";

    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    tokenService = new JoseTokenService({
      issuer: "urn:sitecorp:auth-api:test",
      audience: "urn:sitecorp:api:test",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: signingKey,
    });

    pglite = new PGlite();
    await pglite.waitReady;

    pool = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(pool);

    const migrationRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    });
    const applied = await migrationRunner.applyMigrations(migrations);
    expect(applied).toEqual([
      "0001_sitecorp_auth_schema",
      "0002_sitecorp_auth_operator_permissions",
      "0003_sitecorp_auth_activation_tokens",
      "0004_sitecorp_domain_schema",
      "0005_sitecorp_extended_domain",
      "0006_sitecorp_complete_submodules",
    ]);

    userRepo = new PostgresUserRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    auditService = new PostgresSecurityAuditService(txManager);
    permissionRepo = new PostgresOperatorPermissionRepository(txManager);
    authPolicy = new AuthorizationPolicyService();
    principalResolver = new RepositoryOperatorPrincipalResolver(permissionRepo);
  });

  beforeEach(async () => {
    currentNow = new Date();
    logChunks = [];
    logStream = new Writable({
      write(chunk, _encoding, callback) {
        logChunks.push(chunk.toString("utf8"));
        callback();
      },
    });

    await pool.query(`
      TRUNCATE TABLE
        sitecorp_auth.security_audit_events,
        sitecorp_auth.operator_permissions,
        sitecorp_auth.refresh_tokens,
        sitecorp_auth.sessions,
        sitecorp_auth.user_credentials,
        sitecorp_auth.users
      CASCADE
    `);

    const httpConfig = validateHttpConfig({
      environment: "test",
      host: "127.0.0.1",
      port: 3000,
      allowedOrigins: [ALLOWED_ORIGIN],
      trustedProxies: false,
      limits: {
        globalBodyLimitBytes: 16384,
        authBodyLimitBytes: 4096,
        requestTimeoutMs: 15000,
        connectionTimeoutMs: 5000,
        readinessTimeoutMs: 2000,
      },
      cookies: {
        secure: true,
        sameSite: "Strict",
        maxRefreshTtlSeconds: 14 * 24 * 60 * 60,
      },
      csrf: {
        hmacSecret: csrfSecret,
        ttlSeconds: 14 * 24 * 60 * 60,
      },
      argon2Gate: {
        maxConcurrent: 2,
        maxQueueSize: 4,
        acquireTimeoutMs: 2000,
      },
      rateLimit: {
        maxEntries: 5000,
        loginByIp: { maxRequests: 10, windowMs: 60_000 },
        loginByAccount: { maxRequests: 5, windowMs: 60_000 },
        refreshByIp: { maxRequests: 10, windowMs: 60_000 },
        refreshByToken: { maxRequests: 5, windowMs: 60_000 },
        changePasswordByIp: { maxRequests: 5, windowMs: 60_000 },
        changePasswordByUser: { maxRequests: 5, windowMs: 60_000 },
        logoutByIp: { maxRequests: 10, windowMs: 60_000 },
        logoutByActor: { maxRequests: 10, windowMs: 60_000 },
        meByIp: { maxRequests: 30, windowMs: 60_000 },
        meByUser: { maxRequests: 30, windowMs: 60_000 },
        adminByIp: { maxRequests: 10, windowMs: 60_000 },
        adminByUser: { maxRequests: 10, windowMs: 60_000 },
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
      operatorPermissionRepo: permissionRepo,
      passwordHasher,
      auditService,
      txManager,
      authPolicy,
      operatorPrincipalResolver: principalResolver,
      logStream,
      nowProvider: () => currentNow,
    });
  });

  afterEach(async () => {
    if (server) {
      await server.app.close();
    }
    expect(pool.getActiveClientCount()).toBe(0);
  });

  afterAll(async () => {
    if (pglite) {
      await pglite.close();
    }
  });

  async function seedUser(options: {
    email: string;
    password?: string;
    mustChangePassword?: boolean;
  }): Promise<{ user: AuthUser; password: string }> {
    const password = options.password ?? "ClaveFuerte#2026_Operador!";
    const mustChange = options.mustChangePassword ?? false;
    const hash = await passwordHasher.hash(password);
    const user = AuthUser.create(
      createUserId(randomUUID()),
      createEmail(options.email),
      {
        status: mustChange ? "pending_password_change" : "active",
        mustChangePassword: mustChange,
        now: currentNow,
      }
    );

    await txManager.runInTransaction(async () => {
      await userRepo.save(user);
      await credentialRepo.save({
        id: `cred_${randomUUID()}`,
        userId: user.id,
        algorithm: "argon2id",
        passwordHash: hash,
        version: 1,
        createdAt: currentNow,
      });
    });

    return { user, password };
  }

  async function loginAndGetTokens(email: string, password: string) {
    const res = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const cookies = parseSetCookieHeaders(res.headers["set-cookie"]);
    return {
      accessToken: body.data.accessToken as string,
      csrfToken: body.data.csrfToken as string | null,
      refreshCookie: cookies.get("sitecorp_rt")?.value ?? null,
      csrfCookie: cookies.get("__Host-sitecorp_csrf")?.value ?? null,
    };
  }

  it("1. Migración 0002 y Bootstrap Inicial Controlado: deshabilitado por defecto, ejecución única fail-closed e invariantes SQL contra auto-asignación", async () => {
    const { user: firstAdmin } = await seedUser({
      email: "bootstrap.admin@sitecorp.cu",
    });
    const { user: pendingUser } = await seedUser({
      email: "pending.bootstrap@sitecorp.cu",
      mustChangePassword: true,
    });

    // 1.1 El servicio por defecto está deshabilitado -> BootstrapDisabledError
    const disabledBootstrap = new InitialAdminBootstrapService(
      userRepo,
      permissionRepo,
      auditService
    );
    await expect(
      disabledBootstrap.bootstrapFirstAdmin({
        targetUserId: firstAdmin.id,
        confirmSingleExecution: true,
        now: currentNow,
      })
    ).rejects.toThrow(BootstrapDisabledError);

    // 1.2 Habilitado pero sin confirmación explícita -> BootstrapDisabledError
    const enabledBootstrap = new InitialAdminBootstrapService(
      userRepo,
      permissionRepo,
      auditService,
      { enabled: true, txManager }
    );
    await expect(
      enabledBootstrap.bootstrapFirstAdmin({
        targetUserId: firstAdmin.id,
        confirmSingleExecution: false,
        now: currentNow,
      })
    ).rejects.toThrow(BootstrapDisabledError);

    // 1.3 Rechaza hacer bootstrap sobre un usuario con mustChangePassword = true
    await expect(
      enabledBootstrap.bootstrapFirstAdmin({
        targetUserId: pendingUser.id,
        confirmSingleExecution: true,
        now: currentNow,
      })
    ).rejects.toThrow();

    // 1.4 Primera ejecución válida sobre tabla operator_permissions vacía -> otorga los 3 permisos y audita
    const granted = await enabledBootstrap.bootstrapFirstAdmin({
      targetUserId: firstAdmin.id,
      confirmSingleExecution: true,
      reason: "INITIAL_PLATFORM_SETUP",
      now: currentNow,
    });
    expect(granted).toHaveLength(3);
    const activePerms = await permissionRepo.findActivePermissionsByUserId(
      firstAdmin.id
    );
    expect(activePerms).toEqual([
      "security.admin",
      "security.manage",
      "users.manage",
    ]);

    // 1.5 Segunda ejecución de bootstrap -> aborta fail-closed con BootstrapAlreadyInitializedError
    await expect(
      enabledBootstrap.bootstrapFirstAdmin({
        targetUserId: firstAdmin.id,
        confirmSingleExecution: true,
        now: currentNow,
      })
    ).rejects.toThrow(BootstrapAlreadyInitializedError);

    // 1.6 Prohibición de auto-asignación de permisos en repositorio y constraint SQL (chk_operator_permissions_no_self_grant)
    const { user: regularUser } = await seedUser({
      email: "self.grant@sitecorp.cu",
    });
    await expect(
      permissionRepo.grantPermission({
        userId: regularUser.id,
        permission: "users.manage",
        grantedBy: regularUser.id,
        now: currentNow,
      })
    ).rejects.toThrow(/auto-asignación/i);

    await expect(
      pool.query(
        `INSERT INTO sitecorp_auth.operator_permissions (
           id, user_id, permission, granted_by, is_revoked, created_at
         ) VALUES ($1, $2, 'users.manage', $2, FALSE, CURRENT_TIMESTAMP)`,
        [randomUUID(), regularUser.id]
      )
    ).rejects.toThrow();
  });

  it("2. Denegación por defecto (403 FORBIDDEN), bloqueo por mustChangePassword (403 PASSWORD_CHANGE_REQUIRED) y rechazo de escalación vía JSON body (400 VALIDATION_ERROR)", async () => {
    const { user: regularUser, password: regularPassword } = await seedUser({
      email: "usuario.sin.permisos@sitecorp.cu",
    });
    const { user: pendingAdmin, password: pendingPassword } = await seedUser({
      email: "admin.pendiente.clave@sitecorp.cu",
      mustChangePassword: true,
    });
    const { user: rootAuthorizer } = await seedUser({
      email: "root.authorizer@sitecorp.cu",
    });

    // Incluso aunque a pendingAdmin se le otorgue registro en BD, mientras mustChangePassword sea true está confinado
    await permissionRepo.grantPermission({
      userId: pendingAdmin.id,
      permission: "users.manage",
      grantedBy: rootAuthorizer.id,
      now: currentNow,
    });

    const regularTokens = await loginAndGetTokens(
      regularUser.email,
      regularPassword
    );
    const pendingTokens = await loginAndGetTokens(
      pendingAdmin.email,
      pendingPassword
    );

    // 2.1 Usuario autenticado normal intenta POST /api/v1/auth/admin/users -> 403 FORBIDDEN (default deny)
    const forbiddenCreateRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${regularTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "nuevo.intento@sitecorp.cu",
        initialPassword: "ClaveInicial#2026_Valida!",
      },
    });
    expect(forbiddenCreateRes.statusCode).toBe(403);
    expect(forbiddenCreateRes.json().error.code).toBe("FORBIDDEN");

    // 2.2 Usuario autenticado normal intenta PATCH /api/v1/auth/admin/users/:id/status -> 403 FORBIDDEN
    const forbiddenPatchRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${rootAuthorizer.id}/status`,
      headers: {
        authorization: `Bearer ${regularTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        status: "suspended",
      },
    });
    expect(forbiddenPatchRes.statusCode).toBe(403);
    expect(forbiddenPatchRes.json().error.code).toBe("FORBIDDEN");

    // 2.3 Operador con mustChangePassword = true intenta POST /api/v1/auth/admin/users -> 403 PASSWORD_CHANGE_REQUIRED
    const pendingAdminRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${pendingTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "nuevo.intento2@sitecorp.cu",
        initialPassword: "ClaveInicial#2026_Valida!",
      },
    });
    expect(pendingAdminRes.statusCode).toBe(403);
    expect(pendingAdminRes.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // 2.4 Operador legítimo intenta inyectar role/permissions/isPlatformAdmin en el body -> 400 VALIDATION_ERROR
    await permissionRepo.grantPermission({
      userId: rootAuthorizer.id,
      permission: "users.manage",
      grantedBy: regularUser.id,
      now: currentNow,
    });
    const authorizerTokens = await loginAndGetTokens(
      rootAuthorizer.email,
      "ClaveFuerte#2026_Operador!"
    );

    for (const extraField of [
      { role: "security.admin" },
      { permissions: ["security.admin"] },
      { isPlatformAdmin: true },
      { status: "active" },
    ]) {
      const escalationBodyRes = await server.app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/users",
        headers: {
          authorization: `Bearer ${authorizerTokens.accessToken}`,
          "content-type": "application/json",
        },
        payload: {
          email: "intento.escalacion@sitecorp.cu",
          initialPassword: "ClaveInicial#2026_Valida!",
          ...extraField,
        },
      });
      expect(escalationBodyRes.statusCode).toBe(400);
      expect(escalationBodyRes.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("3. Flujo completo de POST /api/v1/auth/admin/users (201 Created), unicidad (409), política de contraseña (422) y revocación en vivo inmediata de privilegios del operador", async () => {
    const { user: granter } = await seedUser({
      email: "security.granter@sitecorp.cu",
    });
    const { user: operator, password: operatorPassword } = await seedUser({
      email: "user.manager@sitecorp.cu",
    });

    await permissionRepo.grantPermission({
      userId: operator.id,
      permission: "users.manage",
      grantedBy: granter.id,
      grantReason: "Asignación de gestor de usuarios",
      now: currentNow,
    });

    const operatorTokens = await loginAndGetTokens(
      operator.email,
      operatorPassword
    );

    // 3.1 Contraseña inicial débil -> 400 WEAK_PASSWORD
    const weakPwdRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${operatorTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "debil@sitecorp.cu",
        initialPassword: "solominusc1234",
      },
    });
    expect(weakPwdRes.statusCode).toBe(400);
    expect(weakPwdRes.json().error.code).toBe("WEAK_PASSWORD");

    // 3.2 Creación exitosa -> 201 Created sin exponer initialPassword ni passwordHash
    const initialTempPassword = "TempPassword#2026_SiteCorp!";
    const createRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${operatorTokens.accessToken}`,
        "content-type": "application/json",
        "user-agent": "SiteCorp-AdminConsole/1.0",
      },
      payload: {
        email: "  Nuevo.Empleado@SiteCorp.CU  ",
        initialPassword: initialTempPassword,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdBody = createRes.json();
    expect(createdBody.data.user).toEqual({
      id: expect.any(String),
      email: "nuevo.empleado@sitecorp.cu",
      status: "pending_password_change",
      mustChangePassword: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(createdBody)).not.toContain(initialTempPassword);
    expect(JSON.stringify(createdBody)).not.toContain("$argon2id$");

    // Verificar evento de auditoría persistido con IP y User-Agent
    const auditEvents = await auditService.findRecentByUserId(
      createUserId(createdBody.data.user.id)
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.eventType).toBe("USER_CREATED");
    expect(auditEvents[0]?.ipAddress).toBe("127.0.0.1");
    expect(auditEvents[0]?.userAgent).toBe("SiteCorp-AdminConsole/1.0");
    expect(auditEvents[0]?.metadata).toEqual({
      createdByOperatorId: operator.id,
      mustChangePassword: "[REDACTED]",
    });

    // 3.3 Email duplicado -> 409 DUPLICATE_EMAIL
    const duplicateRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${operatorTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "nuevo.empleado@sitecorp.cu",
        initialPassword: initialTempPassword,
      },
    });
    expect(duplicateRes.statusCode).toBe(409);
    expect(duplicateRes.json().error.code).toBe("DUPLICATE_EMAIL");

    // 3.4 El nuevo usuario creado por admin no posee ningún permiso administrativo en BD
    const newEmployeePerms = await permissionRepo.findActivePermissionsByUserId(
      createUserId(createdBody.data.user.id)
    );
    expect(newEmployeePerms).toEqual([]);

    // 3.5 Revocación en vivo del permiso del operador:
    // Aunque el JWT de 15m de `operator` sigue criptográficamente vigente y su sesión sigue activa,
    // al revocar su permiso en `sitecorp_auth.operator_permissions`, la siguiente petición /admin/*
    // es rechazada de inmediato con 403 FORBIDDEN.
    const revoked = await permissionRepo.revokePermission({
      userId: operator.id,
      permission: "users.manage",
      revokedBy: granter.id,
      now: currentNow,
    });
    expect(revoked).toBe(true);

    const afterRevokeRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: {
        authorization: `Bearer ${operatorTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        email: "otro.empleado@sitecorp.cu",
        initialPassword: initialTempPassword,
      },
    });
    expect(afterRevokeRes.statusCode).toBe(403);
    expect(afterRevokeRes.json().error.code).toBe("FORBIDDEN");
  });

  it("4. PATCH /api/v1/auth/admin/users/:id/status: mínimo privilegio (users.manage vs security.manage), prohibición de auto-suspensión/auto-baja, anti-escalación y revocación inmediata de sesiones del afectado", async () => {
    const { user: securityAdmin, password: secAdminPassword } = await seedUser({
      email: "sec.admin@sitecorp.cu",
    });
    const { user: userManager, password: userMgrPassword } = await seedUser({
      email: "usr.manager@sitecorp.cu",
    });
    const { user: targetUser, password: targetPassword } = await seedUser({
      email: "empleado.objetivo@sitecorp.cu",
    });

    await permissionRepo.grantPermission({
      userId: securityAdmin.id,
      permission: "security.admin",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test",
      now: currentNow,
    });
    await permissionRepo.grantPermission({
      userId: securityAdmin.id,
      permission: "security.manage",
      grantedBy: null,
      allowBootstrapNullGranter: true,
      grantReason: "Bootstrap test",
      now: currentNow,
    });
    await permissionRepo.grantPermission({
      userId: userManager.id,
      permission: "users.manage",
      grantedBy: securityAdmin.id,
      now: currentNow,
    });

    const secAdminTokens = await loginAndGetTokens(
      securityAdmin.email,
      secAdminPassword
    );
    const userMgrTokens = await loginAndGetTokens(
      userManager.email,
      userMgrPassword
    );
    const targetTokens = await loginAndGetTokens(
      targetUser.email,
      targetPassword
    );

    // 4.1 Prohibición estricta de auto-suspensión y auto-eliminación incluso para security.admin -> 403 FORBIDDEN
    for (const selfStatus of ["suspended", "deleted"] as const) {
      const selfActionRes = await server.app.inject({
        method: "PATCH",
        url: `/api/v1/auth/admin/users/${securityAdmin.id}/status`,
        headers: {
          authorization: `Bearer ${secAdminTokens.accessToken}`,
          "content-type": "application/json",
        },
        payload: { status: selfStatus },
      });
      expect(selfActionRes.statusCode).toBe(403);
      expect(selfActionRes.json().error.code).toBe("FORBIDDEN");
    }

    // 4.2 Prevención de escalación horizontal/vertical:
    // `userManager` (solo `users.manage`) NO puede suspender a `securityAdmin` (`security.admin`) -> 403 FORBIDDEN
    const attackSecAdminRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${securityAdmin.id}/status`,
      headers: {
        authorization: `Bearer ${userMgrTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "suspended" },
    });
    expect(attackSecAdminRes.statusCode).toBe(403);
    expect(attackSecAdminRes.json().error.code).toBe("FORBIDDEN");

    // 4.3 Mínimo privilegio: `userManager` (solo `users.manage`) NO puede eliminar lógicamente (`status: "deleted"`) -> 403 FORBIDDEN
    const unauthorizedDeleteRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${targetUser.id}/status`,
      headers: {
        authorization: `Bearer ${userMgrTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "deleted" },
    });
    expect(unauthorizedDeleteRes.statusCode).toBe(403);
    expect(unauthorizedDeleteRes.json().error.code).toBe("FORBIDDEN");

    // 4.4 `userManager` (`users.manage`) SÍ puede suspender a `targetUser` -> 200 OK
    const suspendRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${targetUser.id}/status`,
      headers: {
        authorization: `Bearer ${userMgrTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "suspended" },
    });
    expect(suspendRes.statusCode).toBe(200);
    expect(suspendRes.json().data.user).toEqual({
      id: targetUser.id,
      email: targetUser.email,
      status: "suspended",
      mustChangePassword: false,
      updatedAt: expect.any(String),
      deletedAt: null,
    });

    // 4.5 Revocación inmediata de todas las sesiones y refresh tokens de `targetUser`:
    // Su accessToken activo falla en GET /me (401 SESSION_INVALID) y su cookie falla en POST /refresh
    const targetMeAfterSuspend = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${targetTokens.accessToken}`,
      },
    });
    expect(targetMeAfterSuspend.statusCode).toBe(401);
    expect(targetMeAfterSuspend.json().error.code).toBe("SESSION_INVALID");

    const targetRefreshAfterSuspend = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": targetTokens.csrfCookie!,
        cookie: `sitecorp_rt=${targetTokens.refreshCookie}; __Host-sitecorp_csrf=${targetTokens.csrfCookie}`,
      },
    });
    expect(targetRefreshAfterSuspend.statusCode).toBe(401);

    // 4.6 Reactivación de `targetUser` por `userManager` (`status: "active"`) -> 200 OK
    const activateRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${targetUser.id}/status`,
      headers: {
        authorization: `Bearer ${userMgrTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "active" },
    });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().data.user.status).toBe("active");

    // 4.7 Baja lógica (`status: "deleted"`) ejecutada por `securityAdmin` (`security.manage`) -> 200 OK
    const deleteRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${targetUser.id}/status`,
      headers: {
        authorization: `Bearer ${secAdminTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "deleted" },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().data.user.status).toBe("deleted");
    expect(deleteRes.json().data.user.deletedAt).toEqual(expect.any(String));

    // Una cuenta eliminada lógicamente no puede ser reactivada -> 403 USER_DELETED
    const reactivateDeletedRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${targetUser.id}/status`,
      headers: {
        authorization: `Bearer ${secAdminTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "active" },
    });
    expect(reactivateDeletedRes.statusCode).toBe(403);
    expect(reactivateDeletedRes.json().error.code).toBe("USER_DELETED");

    // 4.8 Usuario inexistente -> 404 USER_NOT_FOUND
    const nonExistentId = randomUUID();
    const notFoundRes = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${nonExistentId}/status`,
      headers: {
        authorization: `Bearer ${secAdminTokens.accessToken}`,
        "content-type": "application/json",
      },
      payload: { status: "suspended" },
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json().error.code).toBe("USER_NOT_FOUND");
  });

  it("5. Regresión de concurrencia en /refresh, endurecimiento CSRF en /logout y fallo controlado de PostgreSQL (500 sin filtrar SQL)", async () => {
    const { user, password } = await seedUser({
      email: "concurrencia.refresh@sitecorp.cu",
    });

    const tokens = await loginAndGetTokens(user.email, password);

    // 5.1 Dos peticiones /refresh concurrentes con el mismo refresh token:
    // Exactamente una triunfa (200 OK) y la otra detecta el reuso (401 TOKEN_REUSE_DETECTED),
    // revocando la familia entera y la sesión.
    const [resA, resB] = await Promise.all([
      server.app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: {
          origin: ALLOWED_ORIGIN,
          "x-csrf-token": tokens.csrfCookie!,
          cookie: `sitecorp_rt=${tokens.refreshCookie}; __Host-sitecorp_csrf=${tokens.csrfCookie}`,
        },
      }),
      server.app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: {
          origin: ALLOWED_ORIGIN,
          "x-csrf-token": tokens.csrfCookie!,
          cookie: `sitecorp_rt=${tokens.refreshCookie}; __Host-sitecorp_csrf=${tokens.csrfCookie}`,
        },
      }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
    const failedRefresh = resA.statusCode === 401 ? resA : resB;
    expect(failedRefresh.json().error.code).toBe("TOKEN_REUSE_DETECTED");

    // 5.2 Endurecimiento CSRF en /logout:
    // Si se envía una cookie sitecorp_rt desconocida con un token CSRF malformado (aunque header === cookie),
    // verifyTokenFormatAndEquality lo rechaza con 403 CSRF_INVALID.
    const malformedCsrfRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": "forged-non-3-segment-token",
        cookie:
          "sitecorp_rt=cookie_desconocida_en_bd; __Host-sitecorp_csrf=forged-non-3-segment-token",
      },
    });
    expect(malformedCsrfRes.statusCode).toBe(403);
    expect(malformedCsrfRes.json().error.code).toBe("CSRF_INVALID");

    // 5.3 Fallo simulado de PostgreSQL en un endpoint -> 500 INTERNAL_SERVER_ERROR sin filtrar SQL ni tablas
    const { user: adminUser, password: adminPassword } = await seedUser({
      email: "admin.dbfail@sitecorp.cu",
    });
    await permissionRepo.grantPermission({
      userId: adminUser.id,
      permission: "users.manage",
      grantedBy: user.id,
      now: currentNow,
    });
    const adminTokens = await loginAndGetTokens(adminUser.email, adminPassword);

    // Simular fallo inesperado de PostgreSQL en findByEmail durante creación de usuario
    const origFindByEmail = userRepo.findByEmail.bind(userRepo);
    userRepo.findByEmail = async () => {
      throw new Error(
        'relation "sitecorp_auth.users" encountered fatal disk I/O error on SELECT * FROM sitecorp_auth.users'
      );
    };

    try {
      const dbErrorRes = await server.app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/users",
        headers: {
          authorization: `Bearer ${adminTokens.accessToken}`,
          "content-type": "application/json",
        },
        payload: {
          email: "fallo.sql@sitecorp.cu",
          initialPassword: "ClaveValida#2026_Segura!",
        },
      });
      expect(dbErrorRes.statusCode).toBe(500);
      const errJson = dbErrorRes.json();
      expect(errJson.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(errJson)).not.toContain("sitecorp_auth.users");
      expect(JSON.stringify(errJson)).not.toContain("SELECT *");
    } finally {
      userRepo.findByEmail = origFindByEmail;
    }

    // 5.4 Verificar que los logs de Pino nunca contienen contraseñas ni hashes Argon2id
    const allLogs = logChunks.join("\n");
    expect(allLogs).not.toContain(password);
    expect(allLogs).not.toContain(adminPassword);
    expect(allLogs).not.toContain("$argon2id$");
  });
});
