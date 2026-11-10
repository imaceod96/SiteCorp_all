import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthSession,
  AuthUser,
  AccountLockedError,
  DuplicateEmailError,
  InvalidCredentialsError,
  UserId,
  UserNotFoundError,
  UserSuspendedError,
  WeakPasswordError,
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  AuthenticatedPrincipal,
  IOperatorPrincipalResolver,
} from "../../src/interfaces";
import {
  InMemorySessionRepository,
  InMemoryUserRepository,
  MockAuthorizationPolicyService,
  JoseTokenService,
  generateEphemeralEd25519KeyPair,
  validateHttpConfig,
} from "../../src/infrastructure";
import {
  buildAuthHttpServer,
  createAuthGuardHook,
  RateLimitExceededError,
  Argon2ConcurrencySaturationError,
} from "../../src/presentation/http";

const TEST_CSRF_SECRET =
  "b8e3d9c1a6f2054283716054e9d8c7b6a594837261504f3e2d1c0b9a87654321";
const ALLOWED_ORIGIN = "https://portal.sitecorp.example";

function createTestInfrastructure(options?: {
  trustedProxies?: false | readonly string[];
  cookieSecure?: boolean;
  databaseReadinessCheck?: () => Promise<boolean>;
  cryptoReadinessCheck?: () => Promise<boolean>;
  operatorPrincipalResolver?: IOperatorPrincipalResolver;
  logLines?: string[];
}) {
  const keyPair = generateEphemeralEd25519KeyPair("ed25519-http-test-v1", "test");
  const tokenService = new JoseTokenService({
    issuer: "urn:sitecorp:auth-api",
    audience: "urn:sitecorp:api",
    accessTokenTtlSeconds: 900,
    requireSessionId: true,
    activeSigningKey: keyPair,
  });

  const userRepo = new InMemoryUserRepository();
  const sessionRepo = new InMemorySessionRepository();
  const authPolicy = new MockAuthorizationPolicyService();

  const logLines = options?.logLines;
  const logStream = logLines
    ? new Writable({
        write(chunk, _encoding, callback) {
          logLines.push(chunk.toString("utf8"));
          callback();
        },
      })
    : undefined;

  const httpConfig = validateHttpConfig({
    environment: options?.cookieSecure ? "production" : "test",
    allowedOrigins: [ALLOWED_ORIGIN],
    trustedProxies: options?.trustedProxies ?? false,
    limits: {
      globalBodyLimitBytes: 2048,
      authBodyLimitBytes: 1024,
      readinessTimeoutMs: 200,
    },
    cookies: {
      secure: options?.cookieSecure ?? true,
      sameSite: "Strict",
    },
    csrf: {
      hmacSecret: TEST_CSRF_SECRET,
    },
    logging: {
      enabled: Boolean(logLines),
      level: logLines ? "info" : "silent",
    },
  });

  return {
    httpConfig,
    tokenService,
    userRepo,
    sessionRepo,
    authPolicy,
    logStream,
    databaseReadinessCheck: options?.databaseReadinessCheck,
    cryptoReadinessCheck: options?.cryptoReadinessCheck,
    operatorPrincipalResolver: options?.operatorPrincipalResolver,
  };
}

describe("FASE 4G.2B.1 — Servidor Fastify, Health Checks, Headers, CORS, Proxy y Errores", () => {
  it("GET /health/live devuelve 200 OK sin consultar dependencias externas e incluye cabeceras de seguridad", async () => {
    let dbCalled = false;
    const deps = createTestInfrastructure({
      databaseReadinessCheck: async () => {
        dbCalled = true;
        return false;
      },
    });
    const { app } = await buildAuthHttpServer(deps);

    const res = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: {
        "x-request-id": "req-live-check-0001",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dbCalled).toBe(false);
    expect(res.headers["x-request-id"]).toBe("req-live-check-0001");
    expect(res.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate, private"
    );
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["strict-transport-security"]).toContain("max-age=63072000");

    const body = res.json();
    expect(body.data).toEqual({ status: "ok" });
    expect(body.meta.requestId).toBe("req-live-check-0001");

    await app.close();
  });

  it("GET /health/ready verifica sondas de PostgreSQL y criptografía con timeout y falla tras onClose", async () => {
    let dbHealthy = true;
    let cryptoHealthy = true;

    const deps = createTestInfrastructure({
      databaseReadinessCheck: async () => dbHealthy,
      cryptoReadinessCheck: async () => cryptoHealthy,
    });
    const { app } = await buildAuthHttpServer(deps);

    // 1. Ambas sondas OK -> 200
    const resOk = await app.inject({ method: "GET", url: "/health/ready" });
    expect(resOk.statusCode).toBe(200);
    expect(resOk.json().data).toEqual({ status: "ready" });

    // 2. Falla PostgreSQL -> 503
    dbHealthy = false;
    const resDbFail = await app.inject({ method: "GET", url: "/health/ready" });
    expect(resDbFail.statusCode).toBe(503);
    expect(resDbFail.json().error.code).toBe("SERVICE_UNAVAILABLE");

    // 2.B Falla subsistema criptográfico -> 503
    dbHealthy = true;
    cryptoHealthy = false;
    const resCryptoFail = await app.inject({
      method: "GET",
      url: "/health/ready",
    });
    expect(resCryptoFail.statusCode).toBe(503);
    expect(resCryptoFail.json().error.code).toBe("SERVICE_UNAVAILABLE");

    // 3. Sonda lenta que excede readinessTimeoutMs (200ms) -> 503
    cryptoHealthy = true;
    const slowDeps = createTestInfrastructure({
      databaseReadinessCheck: () =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 500)),
    });
    const slowServer = await buildAuthHttpServer(slowDeps);
    const resTimeout = await slowServer.app.inject({
      method: "GET",
      url: "/health/ready",
    });
    expect(resTimeout.statusCode).toBe(503);

    await slowServer.app.close();
    await app.close();
  });

  it("aplica CORS estricto por allowlist y rechaza orígenes no autorizados en mutaciones", async () => {
    const deps = createTestInfrastructure();
    const { app } = await buildAuthHttpServer(deps);

    app.post("/test-mutating", async (_req, reply) => {
      return reply.code(200).send({ data: { ok: true } });
    });

    // 1. Preflight desde origen permitido -> 204 con cabeceras CORS
    const preflightAllowed = await app.inject({
      method: "OPTIONS",
      url: "/test-mutating",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "POST",
      },
    });
    expect(preflightAllowed.statusCode).toBe(204);
    expect(preflightAllowed.headers["access-control-allow-origin"]).toBe(
      ALLOWED_ORIGIN
    );
    expect(preflightAllowed.headers["access-control-allow-credentials"]).toBe(
      "true"
    );

    // 2. Preflight desde origen NO permitido -> no devuelve access-control-allow-origin
    const preflightDisallowed = await app.inject({
      method: "OPTIONS",
      url: "/test-mutating",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });
    expect(
      preflightDisallowed.headers["access-control-allow-origin"]
    ).toBeUndefined();

    // 3. POST desde origen no autorizado -> rechazado en onRequest con 403 CSRF_INVALID
    const postDisallowed = await app.inject({
      method: "POST",
      url: "/test-mutating",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(postDisallowed.statusCode).toBe(403);
    expect(postDisallowed.json().error.code).toBe("CSRF_INVALID");

    // 4. POST con cookie sitecorp_rt pero SIN cabecera Origin ni Referer -> 403 CSRF_INVALID
    const postCookieNoOrigin = await app.inject({
      method: "POST",
      url: "/test-mutating",
      headers: {
        cookie: "sitecorp_rt=sct_dummy_token",
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(postCookieNoOrigin.statusCode).toBe(403);
    expect(postCookieNoOrigin.json().error.code).toBe("CSRF_INVALID");

    await app.close();
  });

  it("no confía en X-Forwarded-For cuando trustProxy es false y sí lo respeta tras proxy local autorizado", async () => {
    const untrustedDeps = createTestInfrastructure({ trustedProxies: false });
    const untrustedServer = await buildAuthHttpServer(untrustedDeps);
    untrustedServer.app.get("/test-ip", async (req) => ({ ip: req.ip }));

    const resUntrusted = await untrustedServer.app.inject({
      method: "GET",
      url: "/test-ip",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "203.0.113.195",
      },
    });
    expect(resUntrusted.json().ip).toBe("127.0.0.1");
    await untrustedServer.app.close();

    const trustedDeps = createTestInfrastructure({
      trustedProxies: ["127.0.0.1"],
    });
    const trustedServer = await buildAuthHttpServer(trustedDeps);
    trustedServer.app.get("/test-ip", async (req) => ({ ip: req.ip }));

    const resTrusted = await trustedServer.app.inject({
      method: "GET",
      url: "/test-ip",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-forwarded-for": "203.0.113.195",
      },
    });
    expect(resTrusted.json().ip).toBe("203.0.113.195");
    await trustedServer.app.close();
  });

  it("valida Content-Type: application/json (415), bodyLimit (413), additionalProperties: false (400) y 404 uniforme", async () => {
    const deps = createTestInfrastructure();
    const { app } = await buildAuthHttpServer(deps);

    app.post(
      "/test-validation",
      {
        schema: {
          body: {
            type: "object",
            required: ["email", "password"],
            additionalProperties: false,
            properties: {
              email: { type: "string", minLength: 3 },
              password: { type: "string", minLength: 8 },
            },
          },
        },
      },
      async () => ({ data: { ok: true } })
    );

    // 1. Content-Type: text/plain -> 415 UNSUPPORTED_MEDIA_TYPE
    const res415 = await app.inject({
      method: "POST",
      url: "/test-validation",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "text/plain",
      },
      payload: "email=a&password=b",
    });
    expect(res415.statusCode).toBe(415);
    expect(res415.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    // 2. Payload > 2048 bytes -> 413 PAYLOAD_TOO_LARGE
    const res413 = await app.inject({
      method: "POST",
      url: "/test-validation",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "user@sitecorp.cu",
        password: "A".repeat(3000),
      }),
    });
    expect(res413.statusCode).toBe(413);
    expect(res413.json().error.code).toBe("PAYLOAD_TOO_LARGE");

    // 3. Propiedad adicional no permitida (ej. "role": "super_admin") -> 400 VALIDATION_ERROR sin filtrar password
    const secretAttempt = "MiClaveSuperSecreta#2026!";
    const res400 = await app.inject({
      method: "POST",
      url: "/test-validation",
      headers: {
        origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        email: "user@sitecorp.cu",
        password: secretAttempt,
        role: "super_admin",
      }),
    });
    expect(res400.statusCode).toBe(400);
    expect(res400.json().error.code).toBe("VALIDATION_ERROR");
    expect(res400.body).not.toContain(secretAttempt);

    // 4. Ruta inexistente -> 404 ROUTE_NOT_FOUND
    const res404 = await app.inject({
      method: "GET",
      url: "/api/v1/auth/no-existe",
    });
    expect(res404.statusCode).toBe(404);
    expect(res404.json().error.code).toBe("ROUTE_NOT_FOUND");

    await app.close();
  });

  it("mapea todos los errores de dominio y de infraestructura a códigos HTTP exactos sin filtrar SQL ni stack traces", async () => {
    const deps = createTestInfrastructure();
    const { app, cookieService } = await buildAuthHttpServer(deps);

    app.get("/test-error/:kind", async (req, reply) => {
      const { kind } = req.params as { kind: string };
      switch (kind) {
        case "invalid-creds":
          throw new InvalidCredentialsError();
        case "suspended":
          throw new UserSuspendedError("La cuenta de usuario se encuentra suspendida.");
        case "locked":
          throw new AccountLockedError(new Date("2026-11-07T15:00:00.000Z"));
        case "weak-password":
          throw new WeakPasswordError(["Falta carácter especial"]);
        case "duplicate":
          throw new DuplicateEmailError("dup@sitecorp.cu");
        case "not-found":
          throw new UserNotFoundError();
        case "rate-limit":
          throw new RateLimitExceededError(42, 10, 0, 1794060000);
        case "argon2-busy":
          throw new Argon2ConcurrencySaturationError("QUEUE_FULL");
        case "sql-crash": {
          const pgError = new Error(
            'select password_hash from sitecorp_auth.user_credentials where user_id = $1'
          );
          (pgError as { code?: string }).code = "42P01";
          throw pgError;
        }
        case "cookies-clear": {
          cookieService.clearAuthCookies(reply);
          return reply.code(200).send({ data: { cleared: true } });
        }
        default:
          return { data: {} };
      }
    });

    const r401 = await app.inject({ method: "GET", url: "/test-error/invalid-creds" });
    expect(r401.statusCode).toBe(401);
    expect(r401.json().error.code).toBe("INVALID_CREDENTIALS");

    const r403 = await app.inject({ method: "GET", url: "/test-error/suspended" });
    expect(r403.statusCode).toBe(403);
    expect(r403.json().error.code).toBe("USER_SUSPENDED");

    const r423 = await app.inject({ method: "GET", url: "/test-error/locked" });
    expect(r423.statusCode).toBe(423);
    expect(r423.json().error.details.lockedUntil).toBe("2026-11-07T15:00:00.000Z");

    const r400 = await app.inject({ method: "GET", url: "/test-error/weak-password" });
    expect(r400.statusCode).toBe(400);
    expect(r400.json().error.code).toBe("WEAK_PASSWORD");

    const r409 = await app.inject({ method: "GET", url: "/test-error/duplicate" });
    expect(r409.statusCode).toBe(409);
    expect(r409.json().error.code).toBe("DUPLICATE_EMAIL");

    const r404 = await app.inject({ method: "GET", url: "/test-error/not-found" });
    expect(r404.statusCode).toBe(404);
    expect(r404.json().error.code).toBe("USER_NOT_FOUND");

    const r429 = await app.inject({ method: "GET", url: "/test-error/rate-limit" });
    expect(r429.statusCode).toBe(429);
    expect(r429.headers["retry-after"]).toBe("42");
    expect(r429.headers["x-ratelimit-limit"]).toBe("10");

    const r503 = await app.inject({ method: "GET", url: "/test-error/argon2-busy" });
    expect(r503.statusCode).toBe(503);
    expect(r503.headers["retry-after"]).toBe("5");
    expect(r503.json().error.code).toBe("AUTH_SERVER_BUSY");

    const r500 = await app.inject({ method: "GET", url: "/test-error/sql-crash" });
    expect(r500.statusCode).toBe(500);
    expect(r500.json().error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(r500.body).not.toContain("sitecorp_auth");
    expect(r500.body).not.toContain("password_hash");

    // Verificar atributos de borrado de cookies con Path exacto
    const rClear = await app.inject({ method: "GET", url: "/test-error/cookies-clear" });
    const setCookies = rClear.headers["set-cookie"] as string[];
    expect(Array.isArray(setCookies)).toBe(true);
    expect(setCookies).toHaveLength(2);
    expect(setCookies[0]).toContain("sitecorp_rt=;");
    expect(setCookies[0]).toContain("Path=/api/v1/auth");
    expect(setCookies[0]).toContain("Max-Age=0");
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[0]).toContain("Secure");
    expect(setCookies[1]).toContain("__Host-sitecorp_csrf=;");
    expect(setCookies[1]).toContain("Path=/;");
    expect(setCookies[1]).toContain("Max-Age=0");
    expect(setCookies[1]).toContain("Secure");

    await app.close();
  });
});

describe("FASE 4G.2B.1 — Guard de Autenticación y Autorización de 7 Pasos y Redacción de Logs", () => {
  it("ejecuta los 7 pasos del guard: acepta sesión activa, bloquea pending_password_change en api:full y revoca al instante tras logout/suspensión", async () => {
    let operatorHasAdminPerm = true;
    const deps = createTestInfrastructure({
      operatorPrincipalResolver: {
        async resolvePrincipal(user: AuthUser): Promise<AuthenticatedPrincipal> {
          return {
            userId: user.id,
            email: user.email,
            permissions: new Set(operatorHasAdminPerm ? ["users.manage"] : []),
            isPlatformAdmin: operatorHasAdminPerm,
            mustChangePassword: user.mustChangePassword,
            role: user.mustChangePassword
              ? "pending_password_change"
              : "authenticated",
          };
        },
      },
    });

    const { app } = await buildAuthHttpServer(deps);

    const fullScopeGuard = createAuthGuardHook(deps, {
      allowPendingPasswordChange: false,
    });
    const changePasswordGuard = createAuthGuardHook(deps, {
      allowPendingPasswordChange: true,
    });
    const adminGuard = createAuthGuardHook(deps, {
      adminRequirement: { action: "manage_users" },
    });

    app.get(
      "/protected-profile",
      { preHandler: [fullScopeGuard] },
      async (req) => ({
        data: {
          userId: req.authContext?.user.id,
          sessionId: req.authContext?.session.id,
          scope: req.authContext?.claims.scope,
        },
      })
    );

    app.post(
      "/protected-change-password",
      { preHandler: [changePasswordGuard] },
      async (req) => ({
        data: {
          userId: req.authContext?.user.id,
          scope: req.authContext?.claims.scope,
        },
      })
    );

    app.post(
      "/protected-admin",
      { preHandler: [adminGuard] },
      async (req) => ({
        data: {
          operatorId: req.authContext?.operator?.userId,
        },
      })
    );

    // Crear usuario activo y sesión
    const activeUserId: UserId = createUserId(randomUUID());
    const activeUser = AuthUser.create(
      activeUserId,
      createEmail("activo@sitecorp.cu"),
      { status: "active", mustChangePassword: false }
    );
    await deps.userRepo.save(activeUser);

    const activeSessionId = `sess_${randomUUID()}`;
    const activeSession = AuthSession.create(activeSessionId, activeUser.id);
    await deps.sessionRepo.createSession(activeSession);

    const signedActiveToken = await deps.tokenService.signAccessToken({
      sub: activeUser.id,
      email: activeUser.email,
      role: "authenticated",
      scope: "api:full",
      sid: activeSession.id,
    });

    // 1. Petición sin Authorization -> 401 UNAUTHORIZED
    const resNoAuth = await app.inject({
      method: "GET",
      url: "/protected-profile",
    });
    expect(resNoAuth.statusCode).toBe(401);

    // 2. Petición con token válido y sesión activa -> 200 OK
    const resActiveOk = await app.inject({
      method: "GET",
      url: "/protected-profile",
      headers: {
        authorization: `Bearer ${signedActiveToken.token}`,
      },
    });
    expect(resActiveOk.statusCode).toBe(200);
    expect(resActiveOk.json().data).toEqual({
      userId: activeUser.id,
      sessionId: activeSession.id,
      scope: "api:full",
    });

    // 3. Crear usuario en pending_password_change
    const tempUserId = createUserId(randomUUID());
    const tempUser = AuthUser.create(
      tempUserId,
      createEmail("temporal@sitecorp.cu"),
      { status: "pending_password_change", mustChangePassword: true }
    );
    await deps.userRepo.save(tempUser);

    const tempSessionId = `sess_${randomUUID()}`;
    const tempSession = AuthSession.create(tempSessionId, tempUser.id);
    await deps.sessionRepo.createSession(tempSession);

    const signedTempToken = await deps.tokenService.signAccessToken({
      sub: tempUser.id,
      email: tempUser.email,
      role: "pending_password_change",
      scope: "auth:change_password",
      sid: tempSession.id,
    });

    // 3.A: Usuario pending_password_change bloqueado en /protected-profile -> 403 PASSWORD_CHANGE_REQUIRED
    const resTempBlocked = await app.inject({
      method: "GET",
      url: "/protected-profile",
      headers: {
        authorization: `Bearer ${signedTempToken.token}`,
      },
    });
    expect(resTempBlocked.statusCode).toBe(403);
    expect(resTempBlocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // 3.B: Usuario pending_password_change permitido en /protected-change-password -> 200 OK
    const resTempAllowed = await app.inject({
      method: "POST",
      url: "/protected-change-password",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${signedTempToken.token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(resTempAllowed.statusCode).toBe(200);

    // 4. Autorización administrativa en tiempo real (IOperatorPrincipalResolver)
    const resAdminOk = await app.inject({
      method: "POST",
      url: "/protected-admin",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${signedActiveToken.token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(resAdminOk.statusCode).toBe(200);

    // Si se retiran permisos al operador en tiempo real, el MISMO JWT es rechazado de inmediato con 403 FORBIDDEN
    operatorHasAdminPerm = false;
    const resAdminRevoked = await app.inject({
      method: "POST",
      url: "/protected-admin",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${signedActiveToken.token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(resAdminRevoked.statusCode).toBe(403);
    expect(resAdminRevoked.json().error.code).toBe("FORBIDDEN");

    // 5. Revocación inmediata de sesión: al revocar la sesión en el repositorio, el JWT falla al instante con 401
    await deps.sessionRepo.revokeSession(activeSession.id);
    const resAfterRevoke = await app.inject({
      method: "GET",
      url: "/protected-profile",
      headers: {
        authorization: `Bearer ${signedActiveToken.token}`,
      },
    });
    expect(resAfterRevoke.statusCode).toBe(401);
    expect(resAfterRevoke.json().error.code).toBe("SESSION_INVALID");

    await app.close();
  });

  it("redacta automáticamente Authorization, Cookie, Set-Cookie, password y refreshToken en los logs de Pino", async () => {
    const logLines: string[] = [];
    const deps = createTestInfrastructure({ logLines });
    const { app, cookieService } = await buildAuthHttpServer(deps);

    const sensitiveBearer = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjMifQ.secreto_jwt_firma";
    const sensitiveCookieRt = "sct_SuperSecretRefreshTokenValue9876543210";
    const sensitivePassword = "PlainTextPassword#2026_NoFiltrar!";

    app.post("/test-log-redaction", async (req, reply) => {
      req.log.info(
        {
          password: sensitivePassword,
          refreshToken: sensitiveCookieRt,
        },
        "Testing secret redaction in logs"
      );

      cookieService.setRefreshTokenCookie(reply, sensitiveCookieRt, {
        refreshTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      });

      return reply.code(200).send({ data: { ok: true } });
    });

    const res = await app.inject({
      method: "POST",
      url: "/test-log-redaction",
      headers: {
        origin: ALLOWED_ORIGIN,
        authorization: `Bearer ${sensitiveBearer}`,
        cookie: `sitecorp_rt=${sensitiveCookieRt}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const combinedLogs = logLines.join("\n");
    expect(combinedLogs.length).toBeGreaterThan(0);
    expect(combinedLogs).not.toContain(sensitiveBearer);
    expect(combinedLogs).not.toContain(sensitiveCookieRt);
    expect(combinedLogs).not.toContain(sensitivePassword);
    expect(combinedLogs).toContain("[REDACTED]");

    await app.close();
  });
});
