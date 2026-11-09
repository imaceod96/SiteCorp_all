import Fastify, { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import {
  AdminCreateUserUseCase,
  AdminUpdateStatusUseCase,
  ChangePasswordUseCase,
  ConsumeActivationTokenUseCase,
  GenerateActivationTokenUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
} from "../../application";
import {
  AuthorizationPolicyService,
  RepositoryOperatorPrincipalResolver,
} from "../../interfaces";
import { validateHttpConfig } from "../../infrastructure/config/http-config";
import { AuthCookieService } from "./plugins/cookies.service";
import { CsrfTokenService } from "./plugins/csrf-token.service";
import {
  Argon2ConcurrencyGate,
  ConcurrencyLimitedPasswordHasher,
} from "./concurrency/argon2-concurrency-gate";
import {
  BoundedMemoryRateLimiter,
  IRateLimiter,
} from "./concurrency/rate-limiter";
import {
  registerSecurityHooks,
  resolveSafeRequestId,
} from "./plugins/security-headers";
import { registerErrorHandlers } from "./plugins/error-handler";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerDomainRoutes } from "./routes/domain.routes";
import { registerStorageRoutes } from "./routes/storage.routes";
import { AuthHttpServerDependencies } from "./types";

/**
 * Rutas de redacción automática para el logger estructurado Pino.
 * Garantiza que ninguna cabecera ni campo de credencial/secreto sea escrito en claro en logs.
 */
export const PINO_REDACT_PATHS: readonly string[] = Object.freeze([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "currentPassword",
  "newPassword",
  "initialPassword",
  "temporaryPassword",
  "passwordHash",
  "refreshToken",
  "rawRefreshToken",
  "newRefreshToken",
  "tokenHash",
  "accessToken",
  "csrfSecret",
  "hmacSecret",
  "privateKeyPem",
  "secret",
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'reply.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  "*.authorization",
  "*.cookie",
  "*.headers.authorization",
  "*.headers.cookie",
  '*.headers["set-cookie"]',
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.initialPassword",
  "*.temporaryPassword",
  "*.passwordHash",
  "*.refreshToken",
  "*.rawRefreshToken",
  "*.newRefreshToken",
  "*.tokenHash",
  "*.accessToken",
  "*.csrfSecret",
  "*.hmacSecret",
  "*.privateKeyPem",
  "*.secret",
]);

export interface BuiltAuthHttpServer {
  readonly app: FastifyInstance;
  readonly cookieService: AuthCookieService;
  readonly csrfTokenService: CsrfTokenService;
  readonly argon2Gate: Argon2ConcurrencyGate;
  readonly rateLimiter: IRateLimiter;
}

/**
 * Factoría que construye y configura una instancia aislada de Fastify v5
 * con todos los controles transversales de seguridad y los endpoints de
 * autenticación SIN abrir ningún socket TCP ni escuchar puertos automáticamente.
 *
 * Permite ejecutar pruebas integrales con `app.inject()` y cerrar recursos
 * ordenadamente mediante `await app.close()`.
 */
export async function buildAuthHttpServer(
  deps: AuthHttpServerDependencies
): Promise<BuiltAuthHttpServer> {
  // 1. Revalidar la configuración HTTP (fail-closed)
  const httpConfig = validateHttpConfig({
    environment: deps.httpConfig.environment,
    host: deps.httpConfig.host,
    port: deps.httpConfig.port,
    allowedOrigins: deps.httpConfig.allowedOrigins,
    trustedProxies: deps.httpConfig.trustedProxies,
    limits: deps.httpConfig.limits,
    cookies: deps.httpConfig.cookies,
    csrf: deps.httpConfig.csrf,
    argon2Gate: deps.httpConfig.argon2Gate,
    rateLimit: deps.httpConfig.rateLimit,
    logging: deps.httpConfig.logging,
  });

  const nowProvider = deps.nowProvider ?? (() => new Date());

  // 2. Instanciar servicios transversales de seguridad (o reutilizar los inyectados)
  const cookieService =
    deps.cookieService ?? new AuthCookieService(httpConfig.cookies);
  const csrfTokenService =
    deps.csrfTokenService ??
    new CsrfTokenService(httpConfig.csrf, nowProvider);
  const argon2Gate =
    deps.argon2Gate ?? new Argon2ConcurrencyGate(httpConfig.argon2Gate);
  const rateLimiter =
    deps.rateLimiter ??
    new BoundedMemoryRateLimiter(httpConfig.rateLimit.maxEntries, nowProvider);

  // Envolver el passwordHasher en el semáforo de concurrencia Argon2id
  const gatedPasswordHasher = deps.passwordHasher
    ? deps.passwordHasher instanceof ConcurrencyLimitedPasswordHasher
      ? deps.passwordHasher
      : new ConcurrencyLimitedPasswordHasher(deps.passwordHasher, argon2Gate)
    : undefined;

  const loginUseCase =
    deps.loginUseCase ??
    (deps.credentialRepo && gatedPasswordHasher && deps.auditService
      ? new LoginUseCase(
          deps.userRepo,
          deps.credentialRepo,
          deps.sessionRepo,
          gatedPasswordHasher,
          deps.tokenService,
          deps.auditService,
          deps.maxFailedLoginAttempts ?? 5,
          deps.lockDurationMs ?? 15 * 60 * 1000,
          deps.txManager
        )
      : undefined);

  const refreshSessionUseCase =
    deps.refreshSessionUseCase ??
    (deps.auditService
      ? new RefreshSessionUseCase(
          deps.userRepo,
          deps.sessionRepo,
          deps.tokenService,
          deps.auditService,
          deps.txManager
        )
      : undefined);

  const logoutUseCase =
    deps.logoutUseCase ??
    (deps.auditService
      ? new LogoutUseCase(
          deps.sessionRepo,
          deps.tokenService,
          deps.auditService,
          deps.txManager
        )
      : undefined);

  const changePasswordUseCase =
    deps.changePasswordUseCase ??
    (deps.credentialRepo && gatedPasswordHasher && deps.auditService
      ? new ChangePasswordUseCase(
          deps.userRepo,
          deps.credentialRepo,
          deps.sessionRepo,
          gatedPasswordHasher,
          deps.auditService,
          deps.txManager
        )
      : undefined);

  const authPolicy = deps.authPolicy ?? new AuthorizationPolicyService();
  const operatorPrincipalResolver =
    deps.operatorPrincipalResolver ??
    (deps.operatorPermissionRepo
      ? new RepositoryOperatorPrincipalResolver(deps.operatorPermissionRepo)
      : undefined);

  const adminCreateUserUseCase =
    deps.adminCreateUserUseCase ??
    (deps.credentialRepo && gatedPasswordHasher && deps.auditService
      ? new AdminCreateUserUseCase(
          deps.userRepo,
          deps.credentialRepo,
          gatedPasswordHasher,
          deps.auditService,
          authPolicy,
          deps.txManager
        )
      : undefined);

  const adminUpdateStatusUseCase =
    deps.adminUpdateStatusUseCase ??
    (deps.auditService
      ? new AdminUpdateStatusUseCase(
          deps.userRepo,
          deps.sessionRepo,
          deps.auditService,
          authPolicy,
          deps.txManager,
          deps.operatorPermissionRepo
        )
      : undefined);

  const generateActivationTokenUseCase =
    deps.generateActivationTokenUseCase ??
    (deps.activationTokenRepo && deps.auditService && deps.txManager
      ? new GenerateActivationTokenUseCase(
          deps.userRepo,
          deps.activationTokenRepo,
          deps.auditService,
          deps.txManager
        )
      : undefined);

  const consumeActivationTokenUseCase =
    deps.consumeActivationTokenUseCase ??
    (deps.credentialRepo &&
    deps.activationTokenRepo &&
    deps.sessionRepo &&
    gatedPasswordHasher &&
    deps.auditService &&
    deps.txManager
      ? new ConsumeActivationTokenUseCase(
          deps.userRepo,
          deps.credentialRepo,
          deps.activationTokenRepo,
          deps.sessionRepo,
          gatedPasswordHasher,
          deps.auditService,
          deps.txManager
        )
      : undefined);

  // 3. Configurar logger Pino con redacción estricta de credenciales y secretos
  const loggerConfig = httpConfig.logging.enabled
    ? {
        level: httpConfig.logging.level,
        redact: {
          paths: [...PINO_REDACT_PATHS],
          censor: "[REDACTED]",
        },
        ...(deps.logStream ? { stream: deps.logStream } : {}),
      }
    : false;

  // 4. Crear instancia Fastify sin abrir puertos
  const app = Fastify({
    logger: loggerConfig,
    trustProxy:
      httpConfig.trustedProxies === false
        ? false
        : [...httpConfig.trustedProxies],
    bodyLimit: httpConfig.limits.globalBodyLimitBytes,
    requestTimeout: httpConfig.limits.requestTimeoutMs,
    connectionTimeout: httpConfig.limits.connectionTimeoutMs,
    genReqId: (req) => resolveSafeRequestId(req as never),
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: false,
        coerceTypes: false,
        allErrors: false,
      },
    },
  });

  let shuttingDown = false;

  // 5. Registrar @fastify/helmet (cabeceras de endurecimiento HTTP)
  await app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    noSniff: true,
    referrerPolicy: { policy: "no-referrer" },
    hsts: httpConfig.cookies.secure
      ? {
          maxAge: 63072000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  });

  // 6. Registrar @fastify/cors con allowlist estricta (prohibido '*' con credentials)
  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      if (!origin) {
        // Petición same-origin o sin cabecera Origin: no añadir cabeceras CORS
        callback(null, false);
        return;
      }
      if (httpConfig.allowedOrigins.has(origin)) {
        callback(null, origin);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-CSRF-Token",
      "X-Request-Id",
    ],
    exposedHeaders: [
      "X-Request-Id",
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 600,
  });

  // 7. Registrar @fastify/cookie
  await app.register(fastifyCookie);

  // 8. Registrar hooks transversales de seguridad y manejadores de errores
  registerSecurityHooks(app, httpConfig);
  registerErrorHandlers(app);

  // 9. Registrar endpoints de salud (/health/live y /health/ready)
  registerHealthRoutes(app, {
    readinessTimeoutMs: httpConfig.limits.readinessTimeoutMs,
    isShuttingDown: () => shuttingDown || argon2Gate.isShuttingDown(),
    databaseReadinessCheck: deps.databaseReadinessCheck,
    cryptoReadinessCheck: deps.cryptoReadinessCheck,
    nowProvider,
  });

  // 10. Registrar endpoints de autenticación (/api/v1/auth/*)
  registerAuthRoutes(app, {
    httpConfig,
    tokenService: deps.tokenService,
    userRepo: deps.userRepo,
    sessionRepo: deps.sessionRepo,
    cookieService,
    csrfTokenService,
    rateLimiter,
    loginUseCase,
    refreshSessionUseCase,
    logoutUseCase,
    changePasswordUseCase,
    consumeActivationTokenUseCase,
    authPolicy,
    operatorPrincipalResolver,
    nowProvider,
  });

  // 11. Registrar endpoints administrativos (/api/v1/auth/admin/*)
  registerAdminRoutes(app, {
    httpConfig,
    tokenService: deps.tokenService,
    userRepo: deps.userRepo,
    sessionRepo: deps.sessionRepo,
    rateLimiter,
    adminCreateUserUseCase,
    adminUpdateStatusUseCase,
    generateActivationTokenUseCase,
    authPolicy,
    operatorPrincipalResolver,
    nowProvider,
  });

  // 12. Registrar endpoints de dominio si domainRepo está disponible (/api/v1/domain/*)
  if (deps.domainRepo) {
    registerDomainRoutes(app, {
      httpConfig,
      tokenService: deps.tokenService,
      userRepo: deps.userRepo,
      sessionRepo: deps.sessionRepo,
      domainRepo: deps.domainRepo,
      rateLimiter,
      authPolicy,
      operatorPrincipalResolver,
      nowProvider,
    });
  }

  // 13. Registrar endpoints de storage si storageService está disponible (/api/v1/storage/*)
  if (deps.storageService) {
    registerStorageRoutes(app, {
      httpConfig,
      tokenService: deps.tokenService,
      userRepo: deps.userRepo,
      sessionRepo: deps.sessionRepo,
      storageService: deps.storageService,
      domainRepo: deps.domainRepo,
      authPolicy,
      operatorPrincipalResolver,
      nowProvider,
    });
  }

  // 14. Cierre ordenado de recursos al invocar `await app.close()`
  app.addHook("onClose", async () => {
    shuttingDown = true;
    argon2Gate.shutdown();
    rateLimiter.clear();
  });

  return Object.freeze({
    app,
    cookieService,
    csrfTokenService,
    argon2Gate,
    rateLimiter,
  });
}
