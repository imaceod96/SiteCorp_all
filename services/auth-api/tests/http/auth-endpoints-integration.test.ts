import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Writable } from "node:stream";
import {
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  AuthenticatedPrincipal,
  IPasswordHasher,
  QueryResultRow,
} from "../../src/interfaces";
import {
  Argon2idPasswordHasher,
  JoseTokenService,
  MockAuthorizationPolicyService,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  generateEphemeralEd25519KeyPair,
  loadInitialAuthSchemaMigration,
  validateHttpConfig,
} from "../../src/infrastructure";
import { AdminCreateUserUseCase } from "../../src/application";
import {
  BuiltAuthHttpServer,
  buildAuthHttpServer,
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

interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly raw: string;
}

function parseSetCookieHeaders(
  header: string | string[] | undefined
): Map<string, ParsedSetCookie> {
  const list = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const map = new Map<string, ParsedSetCookie>();
  for (const raw of list) {
    const firstPart = raw.split(";")[0] ?? "";
    const eqIdx = firstPart.indexOf("=");
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      map.set(name, { name, value, raw });
    }
  }
  return map;
}

const ALLOWED_ORIGIN = "https://app.sitecorp.local";
const CSRF_SECRET =
  "sitecorp_csrf_hmac_secret_256_bits_minimum_length_test_key_2026";

function createTestHttpConfig(overrides?: {
  maxConcurrentArgon2?: number;
  maxQueueArgon2?: number;
  acquireTimeoutMs?: number;
  loginIpMax?: number;
  loginAccountMax?: number;
}) {
  return validateHttpConfig({
    environment: "test",
    host: "127.0.0.1",
    port: 3001,
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
      hmacSecret: CSRF_SECRET,
      ttlSeconds: 14 * 24 * 60 * 60,
    },
    argon2Gate: {
      maxConcurrent: overrides?.maxConcurrentArgon2 ?? 4,
      maxQueueSize: overrides?.maxQueueArgon2 ?? 16,
      acquireTimeoutMs: overrides?.acquireTimeoutMs ?? 5000,
    },
    rateLimit: {
      maxEntries: 5000,
      loginByIp: {
        windowMs: 60000,
        maxRequests: overrides?.loginIpMax ?? 50,
      },
      loginByAccount: {
        windowMs: 60000,
        maxRequests: overrides?.loginAccountMax ?? 50,
      },
      refreshByIp: {
        windowMs: 60000,
        maxRequests: 50,
      },
      refreshByToken: {
        windowMs: 60000,
        maxRequests: 50,
      },
      changePasswordByIp: {
        windowMs: 60000,
        maxRequests: 50,
      },
      changePasswordByUser: {
        windowMs: 60000,
        maxRequests: 50,
      },
      logoutByIp: {
        windowMs: 60000,
        maxRequests: 50,
      },
      logoutByActor: {
        windowMs: 60000,
        maxRequests: 50,
      },
      meByIp: {
        windowMs: 60000,
        maxRequests: 100,
      },
      meByUser: {
        windowMs: 60000,
        maxRequests: 100,
      },
      adminByIp: {
        windowMs: 60000,
        maxRequests: 50,
      },
      adminByUser: {
        windowMs: 60000,
        maxRequests: 50,
      },
    },
    logging: {
      level: "info",
      enabled: true,
    },
  });
}

describe("Fase 4G.2B.2 — Integración HTTP + Criptografía Real + PostgreSQL (PGlite): Endpoints de Autenticación", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credentialRepo: PostgresCredentialRepository;
  let sessionRepo: PostgresSessionRepository;
  let auditService: PostgresSecurityAuditService;
  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let authzService: MockAuthorizationPolicyService;
  let adminCreateUseCase: AdminCreateUserUseCase;

  let server: BuiltAuthHttpServer;
  let capturedLogs: string[];
  let logStream: Writable;

  const signingKey = generateEphemeralEd25519KeyPair(
    "ed25519-http-auth-key-1",
    "test"
  );

  const adminPrincipal: AuthenticatedPrincipal = {
    userId: createUserId("550e8400-e29b-41d4-a716-446655440900"),
    email: createEmail("admin.http@sitecorp.cu"),
    permissions: new Set(["security.manage", "security.admin"]),
    isPlatformAdmin: true,
  };

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;

    pool = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(pool);
    userRepo = new PostgresUserRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    auditService = new PostgresSecurityAuditService(txManager);

    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    tokenService = new JoseTokenService({
      issuer: "urn:sitecorp:auth-api",
      audience: "urn:sitecorp:api",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: signingKey,
    });

    authzService = new MockAuthorizationPolicyService();
    adminCreateUseCase = new AdminCreateUserUseCase(
      userRepo,
      credentialRepo,
      passwordHasher,
      auditService,
      authzService,
      txManager
    );

    const runner = new PostgresMigrationRunner(txManager, txManager);
    await runner.applyMigrations([loadInitialAuthSchemaMigration()]);
  });

  afterAll(async () => {
    if (server) {
      await server.app.close();
    }
    await pglite.close();
  });

  beforeEach(async () => {
    if (server) {
      await server.app.close();
    }

    await pool.query(`DELETE FROM sitecorp_auth.security_audit_events`);
    await pool.query(`DELETE FROM sitecorp_auth.refresh_tokens`);
    await pool.query(`DELETE FROM sitecorp_auth.sessions`);
    await pool.query(`DELETE FROM sitecorp_auth.user_credentials`);
    await pool.query(`DELETE FROM sitecorp_auth.users`);

    capturedLogs = [];
    logStream = new Writable({
      write(chunk, _encoding, callback) {
        capturedLogs.push(chunk.toString("utf8"));
        callback();
      },
    });

    server = await buildAuthHttpServer({
      httpConfig: createTestHttpConfig(),
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      passwordHasher,
      auditService,
      txManager,
      logStream,
    });
  });

  async function seedActiveUser(
    email = "operador.activo@sitecorp.cu",
    password = "SiteCorp#2026_ValidActivePass!"
  ) {
    const created = await adminCreateUseCase.execute(
      {
        email,
        initialPassword: password,
        mustChangePassword: false,
      },
      adminPrincipal
    );
    return { user: created, password };
  }

  async function seedPendingUser(
    email = "operador.temporal@sitecorp.cu",
    tempPassword = "SiteCorp#2026_TempInitPass!"
  ) {
    const created = await adminCreateUseCase.execute(
      {
        email,
        initialPassword: tempPassword,
        mustChangePassword: true,
      },
      adminPrincipal
    );
    return { user: created, tempPassword };
  }

  it("1. Login de usuario activo (Escenario 1) y perfil en GET /api/v1/auth/me (Escenario 14): emite JWT api:full, cookie sitecorp_rt HttpOnly y cookie __Host-sitecorp_csrf sin exponer refreshToken en JSON", async () => {
    const { user, password } = await seedActiveUser();

    const loginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "user-agent": "SiteCorp-Browser/1.0",
      },
      payload: {
        email: "  OPERADOR.ACTIVO@sitecorp.cu ",
        password,
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.tokenType).toBe("Bearer");
    expect(body.data.expiresInSeconds).toBe(900);
    expect(body.data.mustChangePassword).toBe(false);
    expect(body.data.csrfToken).toMatch(
      /^[A-Za-z0-9_-]{22}\.[0-9a-f]+\.[A-Za-z0-9_-]{43}$/
    );
    expect(body.data.user).toEqual({
      id: user.id,
      email: "operador.activo@sitecorp.cu",
      status: "active",
      mustChangePassword: false,
    });
    // Prohibido incluir refreshToken en el cuerpo JSON
    expect(body.data.refreshToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sct_");

    // Verificar cookies emitidas
    const cookies = parseSetCookieHeaders(loginRes.headers["set-cookie"]);
    const rtCookie = cookies.get("sitecorp_rt");
    const csrfCookie = cookies.get("__Host-sitecorp_csrf");
    expect(rtCookie).toBeDefined();
    expect(rtCookie!.value).toMatch(/^sct_[A-Za-z0-9_-]{43}$/);
    expect(rtCookie!.raw).toContain("HttpOnly");
    expect(rtCookie!.raw).toContain("Secure");
    expect(rtCookie!.raw).toContain("Path=/api/v1/auth");
    expect(rtCookie!.raw).toContain("SameSite=Strict");
    expect(rtCookie!.raw).not.toMatch(/Domain=/i);

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie!.value).toBe(body.data.csrfToken);
    expect(csrfCookie!.raw).not.toContain("HttpOnly");
    expect(csrfCookie!.raw).toContain("Secure");
    expect(csrfCookie!.raw).toContain("Path=/");

    // Escenario 14: GET /api/v1/auth/me con usuario activo
    const meRes = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${body.data.accessToken}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json();
    expect(meBody.data.user).toEqual({
      id: user.id,
      email: "operador.activo@sitecorp.cu",
      status: "active",
      mustChangePassword: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(meBody.data.session).toEqual({
      id: expect.stringMatching(/^sess_/),
      createdAt: expect.any(String),
      lastActivityAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(meBody.data.user.passwordHash).toBeUndefined();
    expect(meBody.data.user.failedLoginAttempts).toBeUndefined();
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("2. Login con mustChangePassword=true (Escenario 2), bloqueo en /me (Escenario 15), cambio obligatorio en /change-password (Escenario 17) y flujo E2E completo (Escenario 18)", async () => {
    // Primero sembrar un usuario activo para obtener cookies previas y comprobar que el login temporal las limpia
    const prevActive = await seedActiveUser(
      "previo@sitecorp.cu",
      "PrevioPass#2026_Valid!"
    );
    const prevLoginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: prevActive.user.email,
        password: prevActive.password,
      },
    });
    const prevCookies = parseSetCookieHeaders(
      prevLoginRes.headers["set-cookie"]
    );
    const prevRtValue = prevCookies.get("sitecorp_rt")!.value;
    const prevCsrfValue = prevCookies.get("__Host-sitecorp_csrf")!.value;

    // Sembrar usuario con contraseña temporal (mustChangePassword = true)
    const { user: tempUser, tempPassword } = await seedPendingUser();

    // Escenario 2: Login con contraseña temporal enviando cookies previas en el navegador
    const tempLoginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        cookie: `sitecorp_rt=${prevRtValue}; __Host-sitecorp_csrf=${prevCsrfValue}`,
      },
      payload: {
        email: tempUser.email,
        password: tempPassword,
      },
    });

    expect(tempLoginRes.statusCode).toBe(200);
    const tempLoginBody = tempLoginRes.json();
    expect(tempLoginBody.data.mustChangePassword).toBe(true);
    expect(tempLoginBody.data.csrfToken).toBeNull();
    expect(tempLoginBody.data.refreshToken).toBeUndefined();
    expect(tempLoginBody.data.user.status).toBe("pending_password_change");
    expect(tempLoginBody.data.user.mustChangePassword).toBe(true);

    // Verificar que las cookies previas fueron limpiadas (Max-Age=0) y NO se emitió ningún sitecorp_rt nuevo
    const clearedCookies = parseSetCookieHeaders(
      tempLoginRes.headers["set-cookie"]
    );
    expect(clearedCookies.get("sitecorp_rt")?.value).toBe("");
    expect(clearedCookies.get("sitecorp_rt")?.raw).toContain("Max-Age=0");
    expect(clearedCookies.get("__Host-sitecorp_csrf")?.value).toBe("");
    expect(clearedCookies.get("__Host-sitecorp_csrf")?.raw).toContain(
      "Max-Age=0"
    );

    const tempAccessToken = tempLoginBody.data.accessToken as string;
    const decodedTemp = await tokenService.verifyAccessToken(tempAccessToken);
    expect(decodedTemp.role).toBe("pending_password_change");
    expect(decodedTemp.scope).toBe("auth:change_password");

    // Escenario 15: GET /api/v1/auth/me está bloqueado con 403 PASSWORD_CHANGE_REQUIRED
    const blockedMeRes = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${tempAccessToken}`,
      },
    });
    expect(blockedMeRes.statusCode).toBe(403);
    expect(blockedMeRes.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // Escenario 17: POST /api/v1/auth/change-password con el JWT restringido
    const newStrongPassword = "NuevaClave#Definitiva_2026!";
    const changePwdRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${tempAccessToken}`,
        "content-type": "application/json",
      },
      payload: {
        currentPassword: tempPassword,
        newPassword: newStrongPassword,
      },
    });

    expect(changePwdRes.statusCode).toBe(200);
    expect(changePwdRes.json().data).toEqual({
      passwordChanged: true,
      sessionsRevoked: true,
      reauthenticationRequired: true,
    });

    // Escenario 16 y 18: El JWT temporal queda inmediatamente invalidado tras el cambio de contraseña
    const meWithOldTokenRes = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${tempAccessToken}`,
      },
    });
    expect(meWithOldTokenRes.statusCode).toBe(401);
    expect(meWithOldTokenRes.json().error.code).toBe("SESSION_INVALID");

    // Escenario 18 (continuación): Nuevo login con la nueva contraseña -> acceso completo -> /me -> /refresh -> /logout
    const secondLoginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: tempUser.email,
        password: newStrongPassword,
      },
    });
    expect(secondLoginRes.statusCode).toBe(200);
    const secondBody = secondLoginRes.json();
    expect(secondBody.data.mustChangePassword).toBe(false);
    expect(secondBody.data.csrfToken).toEqual(expect.any(String));

    const secondCookies = parseSetCookieHeaders(
      secondLoginRes.headers["set-cookie"]
    );
    const rt2 = secondCookies.get("sitecorp_rt")!.value;
    const csrf2 = secondCookies.get("__Host-sitecorp_csrf")!.value;

    const meAfterChangeRes = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${secondBody.data.accessToken}`,
      },
    });
    expect(meAfterChangeRes.statusCode).toBe(200);
    expect(meAfterChangeRes.json().data.user.status).toBe("active");

    const refreshRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrf2,
        cookie: `sitecorp_rt=${rt2}; __Host-sitecorp_csrf=${csrf2}`,
      },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshCookies = parseSetCookieHeaders(
      refreshRes.headers["set-cookie"]
    );
    const rt3 = refreshCookies.get("sitecorp_rt")!.value;
    const csrf3 = refreshCookies.get("__Host-sitecorp_csrf")!.value;
    expect(rt3).not.toBe(rt2);

    const logoutRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrf3,
        cookie: `sitecorp_rt=${rt3}; __Host-sitecorp_csrf=${csrf3}`,
      },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().data.loggedOut).toBe(true);
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("3. Escenarios 3, 4, 5, 6 y 7: Contraseña incorrecta (401), usuario inexistente (401), usuario eliminado (401), usuario suspendido (403) y bloqueo por 5 intentos fallidos (423)", async () => {
    const { user, password } = await seedActiveUser(
      "seguridad.estados@sitecorp.cu",
      "ClaveValida#2026_Seguridad!"
    );

    // Escenario 4: Usuario inexistente -> 401 INVALID_CREDENTIALS
    const nonExistentRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: "fantasma.noexiste@sitecorp.cu",
        password: "CualquierPassword#2026",
      },
    });
    expect(nonExistentRes.statusCode).toBe(401);
    expect(nonExistentRes.json().error.code).toBe("INVALID_CREDENTIALS");

    // Escenario 3 y 7: 4 intentos fallidos devuelven 401 INVALID_CREDENTIALS y el 5to devuelve 423 ACCOUNT_LOCKED
    for (let attempt = 1; attempt <= 4; attempt++) {
      const badRes = await server.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: {
          email: user.email,
          password: `ClaveIncorrecta#${attempt}_2026`,
        },
      });
      expect(badRes.statusCode).toBe(401);
      expect(badRes.json().error.code).toBe("INVALID_CREDENTIALS");
    }

    const fifthBadRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: user.email,
        password: "ClaveIncorrecta#5_2026",
      },
    });
    expect(fifthBadRes.statusCode).toBe(423);
    expect(fifthBadRes.json().error.code).toBe("ACCOUNT_LOCKED");
    expect(fifthBadRes.json().error.details.lockedUntil).toEqual(
      expect.any(String)
    );

    // Incluso con la contraseña correcta mientras está bloqueado devuelve 423 ACCOUNT_LOCKED
    const lockedWithGoodPwd = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: user.email,
        password,
      },
    });
    expect(lockedWithGoodPwd.statusCode).toBe(423);

    // Escenario 6: Usuario suspendido -> 403 USER_SUSPENDED
    const suspendedUser = await userRepo.findById(user.id);
    suspendedUser!.resetFailedAttempts();
    suspendedUser!.suspend();
    await userRepo.update(suspendedUser!);

    const suspendedRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: user.email,
        password,
      },
    });
    expect(suspendedRes.statusCode).toBe(403);
    expect(suspendedRes.json().error.code).toBe("USER_SUSPENDED");

    // Escenario 5: Usuario eliminado (baja lógica) -> 401 INVALID_CREDENTIALS (sin revelar existencia)
    const deletedUser = await userRepo.findById(user.id);
    deletedUser!.softDelete();
    await userRepo.update(deletedUser!);

    const deletedRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: user.email,
        password,
      },
    });
    expect(deletedRes.statusCode).toBe(401);
    expect(deletedRes.json().error.code).toBe("INVALID_CREDENTIALS");
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("4. Escenarios 8, 9 y 10: Refresh válido rota cookies/CSRF, rechaza ataques CSRF (sin token, otra sesión sid, Origin inválido) sin corromper la sesión, y detecta reutilización de refresh token revocando familia y sesión", async () => {
    const userA = await seedActiveUser(
      "usuario.a@sitecorp.cu",
      "ClaveUsuarioA#2026!"
    );
    const userB = await seedActiveUser(
      "usuario.b@sitecorp.cu",
      "ClaveUsuarioB#2026!"
    );

    const loginARes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userA.user.email, password: userA.password },
    });
    const loginBRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userB.user.email, password: userB.password },
    });

    const cookiesA1 = parseSetCookieHeaders(loginARes.headers["set-cookie"]);
    const rtA1 = cookiesA1.get("sitecorp_rt")!.value;
    const csrfA1 = cookiesA1.get("__Host-sitecorp_csrf")!.value;

    const cookiesB1 = parseSetCookieHeaders(loginBRes.headers["set-cookie"]);
    const csrfB1 = cookiesB1.get("__Host-sitecorp_csrf")!.value;

    // Escenario 10.A: Refresh sin cabecera X-CSRF-Token -> 403 CSRF_INVALID
    const noCsrfRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfA1}`,
      },
    });
    expect(noCsrfRes.statusCode).toBe(403);
    expect(noCsrfRes.json().error.code).toBe("CSRF_INVALID");

    // Escenario 10.B: Refresh con el token CSRF válido de la Sesión B sobre la cookie sitecorp_rt de la Sesión A -> 403 CSRF_INVALID
    const crossSessionCsrfRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrfB1,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfB1}`,
      },
    });
    expect(crossSessionCsrfRes.statusCode).toBe(403);
    expect(crossSessionCsrfRes.json().error.code).toBe("CSRF_INVALID");

    // Escenario 10.C: Refresh con Origin malicioso -> 403 CSRF_INVALID
    const badOriginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: "https://evil.attacker.example",
        "x-csrf-token": csrfA1,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfA1}`,
      },
    });
    expect(badOriginRes.statusCode).toBe(403);
    expect(badOriginRes.json().error.code).toBe("CSRF_INVALID");

    // Escenario 8: Como los intentos CSRF inválidos fueron rechazados ANTES de rotar,
    // el token legítimo rtA1 sigue intacto y rota exitosamente.
    const validRefreshRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrfA1,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfA1}`,
      },
    });
    expect(validRefreshRes.statusCode).toBe(200);
    const refreshBody = validRefreshRes.json();
    expect(refreshBody.data.accessToken).toEqual(expect.any(String));
    expect(refreshBody.data.csrfToken).toEqual(expect.any(String));
    expect(refreshBody.data.newRefreshToken).toBeUndefined();

    const cookiesA2 = parseSetCookieHeaders(
      validRefreshRes.headers["set-cookie"]
    );
    const rtA2 = cookiesA2.get("sitecorp_rt")!.value;
    const csrfA2 = cookiesA2.get("__Host-sitecorp_csrf")!.value;
    expect(rtA2).not.toBe(rtA1);

    // Escenario 9: Reutilización maliciosa del token ya rotado rtA1 -> 401 TOKEN_REUSE_DETECTED,
    // revoca toda la familia y la sesión, y limpia las cookies en la respuesta.
    const reuseRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrfA1,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfA1}`,
      },
    });
    expect(reuseRes.statusCode).toBe(401);
    expect(reuseRes.json().error.code).toBe("TOKEN_REUSE_DETECTED");

    const reuseClearedCookies = parseSetCookieHeaders(
      reuseRes.headers["set-cookie"]
    );
    expect(reuseClearedCookies.get("sitecorp_rt")?.value).toBe("");
    expect(reuseClearedCookies.get("sitecorp_rt")?.raw).toContain("Max-Age=0");

    // Incluso el nuevo token rtA2 y el nuevo accessToken de la sesión A quedaron invalidados
    const refreshWithA2AfterReuse = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrfA2,
        cookie: `sitecorp_rt=${rtA2}; __Host-sitecorp_csrf=${csrfA2}`,
      },
    });
    expect(refreshWithA2AfterReuse.statusCode).toBe(401);

    const meAfterReuse = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${refreshBody.data.accessToken}`,
      },
    });
    expect(meAfterReuse.statusCode).toBe(401);
    expect(meAfterReuse.json().error.code).toBe("SESSION_INVALID");
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("5. Escenarios 11, 12, 13 y 16: Logout por cookie, Logout por Bearer (incluyendo cookie expirada/ausente), protección anti-IDOR entre usuarios y Logout allDevices: true", async () => {
    const userA = await seedActiveUser(
      "logout.a@sitecorp.cu",
      "ClaveLogoutA#2026!"
    );
    const userB = await seedActiveUser(
      "logout.b@sitecorp.cu",
      "ClaveLogoutB#2026!"
    );

    // 1. Escenario 11: Logout por cookie
    const loginA1 = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userA.user.email, password: userA.password },
    });
    const cookiesA1 = parseSetCookieHeaders(loginA1.headers["set-cookie"]);
    const rtA1 = cookiesA1.get("sitecorp_rt")!.value;
    const csrfA1 = cookiesA1.get("__Host-sitecorp_csrf")!.value;
    const accessA1 = loginA1.json().data.accessToken as string;

    const logoutByCookieRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        "x-csrf-token": csrfA1,
        cookie: `sitecorp_rt=${rtA1}; __Host-sitecorp_csrf=${csrfA1}`,
      },
    });
    expect(logoutByCookieRes.statusCode).toBe(200);
    expect(logoutByCookieRes.json().data.loggedOut).toBe(true);

    // Escenario 16: Tras el logout, /me con accessA1 es rechazado con 401 SESSION_INVALID
    const meAfterCookieLogout = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${accessA1}`,
      },
    });
    expect(meAfterCookieLogout.statusCode).toBe(401);
    expect(meAfterCookieLogout.json().error.code).toBe("SESSION_INVALID");

    // 2. Escenario 12: Logout por Bearer cuando la cookie no está o expiró, y protección anti-IDOR
    const loginA2 = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userA.user.email, password: userA.password },
    });
    const accessA2 = loginA2.json().data.accessToken as string;

    const loginB1 = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userB.user.email, password: userB.password },
    });
    const cookiesB1 = parseSetCookieHeaders(loginB1.headers["set-cookie"]);
    const rtB1 = cookiesB1.get("sitecorp_rt")!.value;
    const csrfB1 = cookiesB1.get("__Host-sitecorp_csrf")!.value;

    // Intento de A (con su Bearer válido) de cerrar la sesión de B pasando la cookie de B -> 403 FORBIDDEN
    const crossUserLogoutRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${accessA2}`,
        "x-csrf-token": csrfB1,
        cookie: `sitecorp_rt=${rtB1}; __Host-sitecorp_csrf=${csrfB1}`,
      },
    });
    expect(crossUserLogoutRes.statusCode).toBe(403);
    expect(crossUserLogoutRes.json().error.code).toBe("FORBIDDEN");

    // Logout legítimo de A2 únicamente mediante Authorization: Bearer (sin cookie)
    const logoutByBearerRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        authorization: `Bearer ${accessA2}`,
      },
    });
    expect(logoutByBearerRes.statusCode).toBe(200);
    expect(logoutByBearerRes.json().data.loggedOut).toBe(true);

    const meA2AfterBearerLogout = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${accessA2}`,
      },
    });
    expect(meA2AfterBearerLogout.statusCode).toBe(401);

    // 3. Escenario 13: Logout de todas las sesiones (allDevices: true)
    // Crear dos sesiones simultáneas para el usuario B (ya tiene B1, creamos B2)
    const loginB2 = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: userB.user.email, password: userB.password },
    });
    const accessB1 = loginB1.json().data.accessToken as string;
    const accessB2 = loginB2.json().data.accessToken as string;

    // allDevices: true sin cabecera Authorization: Bearer es rechazado con 401
    const allDevicesNoBearerRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "x-csrf-token": csrfB1,
        cookie: `sitecorp_rt=${rtB1}; __Host-sitecorp_csrf=${csrfB1}`,
      },
      payload: { allDevices: true },
    });
    expect(allDevicesNoBearerRes.statusCode).toBe(401);

    // allDevices: true con Authorization: Bearer válido revoca tanto B1 como B2
    const allDevicesValidRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${accessB2}`,
        "content-type": "application/json",
      },
      payload: { allDevices: true },
    });
    expect(allDevicesValidRes.statusCode).toBe(200);

    const meB1 = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessB1}` },
    });
    const meB2 = await server.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessB2}` },
    });
    expect(meB1.statusCode).toBe(401);
    expect(meB2.statusCode).toBe(401);
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("6. Escenarios 19 y 20: Cambio de contraseña rechaza clave débil (400 WEAK_PASSWORD), clave idéntica a la actual (400 SAME_PASSWORD) y conflicto optimista de versión (409 CONCURRENT_CREDENTIAL_MODIFICATION)", async () => {
    const { user, password } = await seedActiveUser(
      "politica.clave@sitecorp.cu",
      "ClaveInicial#2026_Robusta!"
    );

    const loginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: user.email, password },
    });
    const accessToken = loginRes.json().data.accessToken as string;

    // Escenario 19.A: Contraseña débil (cumple longitud >= 12 del esquema JSON pero viola complejidad de PasswordPolicy) -> 400 WEAK_PASSWORD
    const weakRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        currentPassword: password,
        newPassword: "solominusculas12345",
      },
    });
    expect(weakRes.statusCode).toBe(400);
    expect(weakRes.json().error.code).toBe("WEAK_PASSWORD");

    // Escenario 19.B: Contraseña igual a la actual -> 400 SAME_PASSWORD
    const sameRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        currentPassword: password,
        newPassword: password,
      },
    });
    expect(sameRes.statusCode).toBe(400);
    expect(sameRes.json().error.code).toBe("SAME_PASSWORD");

    // Escenario 20: Conflicto optimista de versión de credencial -> 409 CONCURRENT_CREDENTIAL_MODIFICATION
    // Simulamos una modificación concurrente de la versión de la credencial en BD mientras se calcula el hash de la nueva clave
    let interceptNextHash = true;
    const racingHasher: IPasswordHasher = {
      algorithm: "argon2id",
      hash: async (plain: string) => {
        const hashed = await passwordHasher.hash(plain);
        if (interceptNextHash) {
          interceptNextHash = false;
          await pool.query(
            `UPDATE sitecorp_auth.user_credentials
             SET version = version + 1
             WHERE user_id = $1`,
            [user.id]
          );
        }
        return hashed;
      },
      verify: (plain: string, hash: string) =>
        passwordHasher.verify(plain, hash),
      needsRehash: (hash: string) => passwordHasher.needsRehash(hash),
    };

    const racingServer = await buildAuthHttpServer({
      httpConfig: createTestHttpConfig(),
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      passwordHasher: racingHasher,
      auditService,
      txManager,
      logStream,
    });

    try {
      const conflictRes = await racingServer.app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: {
          origin: ALLOWED_ORIGIN,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        payload: {
          currentPassword: password,
          newPassword: "NuevaClave#SinConflicto_2026!",
        },
      });
      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().error.code).toBe(
        "CONCURRENT_CREDENTIAL_MODIFICATION"
      );
    } finally {
      await racingServer.app.close();
    }
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("7. Escenarios 21 y 22: Validación estricta de esquemas (additionalProperties: false, tipos, longitudes -> 400 VALIDATION_ERROR), 413 PAYLOAD_TOO_LARGE y 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    // 21.A: Campo inesperado en /login (additionalProperties: false) -> 400 VALIDATION_ERROR
    const extraFieldLoginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: "usuario@sitecorp.cu",
        password: "Password#2026",
        role: "superadmin",
      },
    });
    expect(extraFieldLoginRes.statusCode).toBe(400);
    expect(extraFieldLoginRes.json().error.code).toBe("VALIDATION_ERROR");

    // 21.B: Contraseña que excede 128 caracteres -> 400 VALIDATION_ERROR sin reflejar la contraseña en el error
    const hugePassword = `Secret#${"A".repeat(140)}`;
    const tooLongPwdRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        email: "usuario@sitecorp.cu",
        password: hugePassword,
      },
    });
    expect(tooLongPwdRes.statusCode).toBe(400);
    expect(tooLongPwdRes.json().error.code).toBe("VALIDATION_ERROR");
    expect(tooLongPwdRes.body).not.toContain(hugePassword);

    // 21.C: Intento de inyectar userId en el cuerpo de /change-password -> 400 VALIDATION_ERROR
    const { user, password } = await seedActiveUser(
      "schema.check@sitecorp.cu",
      "SchemaCheck#2026_Valid!"
    );
    const loginRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: { email: user.email, password },
    });
    const accessToken = loginRes.json().data.accessToken as string;

    const injectedUserIdRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      payload: {
        userId: "550e8400-e29b-41d4-a716-446655440999",
        currentPassword: password,
        newPassword: "NuevaClave#Valida_2026!",
      },
    });
    expect(injectedUserIdRes.statusCode).toBe(400);
    expect(injectedUserIdRes.json().error.code).toBe("VALIDATION_ERROR");

    // 22.A: Payload mayor a 4096 bytes en /login -> 413 PAYLOAD_TOO_LARGE
    const oversizedPayload = JSON.stringify({
      email: "usuario@sitecorp.cu",
      password: "A".repeat(5000),
    });
    const tooLargeRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: oversizedPayload,
    });
    expect(tooLargeRes.statusCode).toBe(413);
    expect(tooLargeRes.json().error.code).toBe("PAYLOAD_TOO_LARGE");

    // 22.B: Content-Type inválido en POST -> 415 UNSUPPORTED_MEDIA_TYPE
    const wrongContentTypeRes = await server.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "text/plain",
      },
      payload: '{"email":"usuario@sitecorp.cu","password":"Password#2026"}',
    });
    expect(wrongContentTypeRes.statusCode).toBe(415);
    expect(wrongContentTypeRes.json().error.code).toBe(
      "UNSUPPORTED_MEDIA_TYPE"
    );
  });

  it("8. Escenarios 23, 24 y 25: Rate limiting 429 (con Retry-After), saturación de Argon2ConcurrencyGate 503 (AUTH_SERVICE_BUSY), redacción de secretos en logs Pino y cero fugas SQL", async () => {
    const secretPlainPassword = "SuperSecret#2026_MustNeverAppearInLogs!";
    const { user } = await seedActiveUser(
      "ratelimit.logs@sitecorp.cu",
      secretPlainPassword
    );

    // 23.A: Rate limiting 429 en /login (configurando maxRequests = 2)
    const rateLimitedServer = await buildAuthHttpServer({
      httpConfig: createTestHttpConfig({ loginAccountMax: 2 }),
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      passwordHasher,
      auditService,
      txManager,
      logStream,
    });

    try {
      for (let i = 0; i < 2; i++) {
        const res = await rateLimitedServer.app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          headers: {
            origin: ALLOWED_ORIGIN,
            "content-type": "application/json",
          },
          payload: { email: user.email, password: secretPlainPassword },
        });
        expect(res.statusCode).toBe(200);
      }

      const thirdRes = await rateLimitedServer.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: { email: user.email, password: secretPlainPassword },
      });
      expect(thirdRes.statusCode).toBe(429);
      expect(thirdRes.json().error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(thirdRes.headers["retry-after"]).toBeDefined();
    } finally {
      await rateLimitedServer.app.close();
    }

    // 23.B: Saturación de Argon2ConcurrencyGate -> 503 AUTH_SERVER_BUSY
    let releaseSlowHasher!: () => void;
    const slowHasherBarrier = new Promise<void>((resolve) => {
      releaseSlowHasher = resolve;
    });

    const slowHasher: IPasswordHasher = {
      algorithm: "argon2id",
      hash: (plain: string) => passwordHasher.hash(plain),
      verify: async (plain: string, hash: string) => {
        await slowHasherBarrier;
        return passwordHasher.verify(plain, hash);
      },
      needsRehash: (hash: string) => passwordHasher.needsRehash(hash),
    };

    const busyServer = await buildAuthHttpServer({
      httpConfig: createTestHttpConfig({
        maxConcurrentArgon2: 1,
        maxQueueArgon2: 1,
        acquireTimeoutMs: 2000,
      }),
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      passwordHasher: slowHasher,
      auditService,
      txManager,
      logStream,
    });

    try {
      // Petición 1 ocupa el único slot activo; Petición 2 ocupa el único slot de cola;
      // Petición 3 desborda la cola y recibe inmediatamente 503 AUTH_SERVER_BUSY
      const req1Promise = busyServer.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: { email: user.email, password: secretPlainPassword },
      });
      const req2Promise = busyServer.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: { email: user.email, password: secretPlainPassword },
      });

      // Dar un tick para que req1 y req2 entren al gate
      await new Promise((r) => setTimeout(r, 25));

      const req3Res = await busyServer.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: { email: user.email, password: secretPlainPassword },
      });

      expect(req3Res.statusCode).toBe(503);
      expect(req3Res.json().error.code).toBe("AUTH_SERVER_BUSY");
      expect(req3Res.headers["retry-after"]).toBeDefined();

      releaseSlowHasher();
      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
    } finally {
      releaseSlowHasher();
      await busyServer.app.close();
    }

    // Escenario 24: Ningún log capturado por Pino contiene contraseñas ni tokens en claro
    const joinedLogs = capturedLogs.join("\n");
    expect(joinedLogs).not.toContain(secretPlainPassword);
    expect(joinedLogs).not.toContain("sct_");
    expect(joinedLogs).not.toContain("$argon2id$");

    // Escenario 25: Ausencia total de fugas de clientes SQL
    expect(pool.getActiveClientCount()).toBe(0);
  });
});
