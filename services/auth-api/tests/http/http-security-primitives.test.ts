import { describe, expect, it } from "vitest";
import {
  HttpConfigurationError,
  loadHttpConfigFromEnv,
  validateHttpConfig,
} from "../../src/infrastructure/config/http-config";
import {
  AuthCookieService,
  CookieExpirationError,
} from "../../src/presentation/http/plugins/cookies.service";
import {
  CsrfTokenService,
  CsrfValidationError,
  verifyRequestOrigin,
} from "../../src/presentation/http/plugins/csrf-token.service";
import {
  Argon2ConcurrencyGate,
  Argon2ConcurrencySaturationError,
  ConcurrencyLimitedPasswordHasher,
} from "../../src/presentation/http/concurrency/argon2-concurrency-gate";
import {
  BoundedMemoryRateLimiter,
  RateLimitExceededError,
  hashRateLimitIdentifier,
} from "../../src/presentation/http/concurrency/rate-limiter";
import { FakePasswordHasher } from "../../src/infrastructure/testing/fake-password-hasher";

const VALID_CSRF_SECRET =
  "a9f4c8e2b7d1065394827165f0e9d8c7b6a594837261504f3e2d1c0b9a876543";
const VALID_SESSION_ID_A = "sess_550e8400-e29b-41d4-a716-446655440001";
const VALID_SESSION_ID_B = "sess_550e8400-e29b-41d4-a716-446655440002";

describe("FASE 4G.2B.1 — Configuración Segura HTTP (http-config)", () => {
  it("valida correctamente una configuración de producción con orígenes HTTPS y secreto fuerte", () => {
    const config = validateHttpConfig({
      environment: "production",
      allowedOrigins: ["https://portal.sitecorp.example"],
      trustedProxies: ["127.0.0.1", "::1"],
      cookies: {
        secure: true,
        sameSite: "Strict",
      },
      csrf: {
        hmacSecret: VALID_CSRF_SECRET,
      },
    });

    expect(config.environment).toBe("production");
    expect(config.allowedOrigins.has("https://portal.sitecorp.example")).toBe(true);
    expect(config.cookies.refreshCookieName).toBe("sitecorp_rt");
    expect(config.cookies.refreshCookiePath).toBe("/api/v1/auth");
    expect(config.cookies.csrfCookieName).toBe("__Host-sitecorp_csrf");
    expect(config.cookies.csrfCookiePath).toBe("/");
    expect(config.cookies.secure).toBe(true);
    expect(config.argon2Gate.maxConcurrent).toBe(2);
    expect(config.argon2Gate.maxQueueSize).toBe(8);
  });

  it("falla de forma cerrada (fail-closed) en producción si faltan allowedOrigins o usan HTTP", () => {
    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: [],
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: ["http://inseguro.sitecorp.example"],
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);
  });

  it("rechaza comodines ('*'), barras finales o rutas en allowedOrigins", () => {
    expect(() =>
      validateHttpConfig({
        environment: "development",
        allowedOrigins: ["*"],
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "development",
        allowedOrigins: ["https://portal.sitecorp.example/"],
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "development",
        allowedOrigins: ["https://portal.sitecorp.example/ruta"],
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);
  });

  it("rechaza cookies inseguras en producción o secretos CSRF débiles / placeholder", () => {
    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: ["https://portal.sitecorp.example"],
        cookies: { secure: false },
        csrf: { hmacSecret: VALID_CSRF_SECRET },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: ["https://portal.sitecorp.example"],
        csrf: { hmacSecret: "secreto-demasiado-corto" },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: ["https://portal.sitecorp.example"],
        csrf: {
          hmacSecret:
            "REEMPLAZAR_CON_SECRETO_CSPRNG_DE_AL_MENOS_32_BYTES_EN_PRODUCCION",
        },
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      validateHttpConfig({
        environment: "production",
        allowedOrigins: ["https://portal.sitecorp.example"],
        csrf: { hmacSecret: "a".repeat(64) },
      })
    ).toThrow(HttpConfigurationError);
  });

  it("rechaza trustProxy global ('*' o 'true') en loadHttpConfigFromEnv", () => {
    expect(() =>
      loadHttpConfigFromEnv({
        SITECORP_AUTH_ENV: "production",
        SITECORP_HTTP_ALLOWED_ORIGINS: "https://portal.sitecorp.example",
        SITECORP_HTTP_TRUSTED_PROXIES: "true",
        SITECORP_CSRF_HMAC_SECRET: VALID_CSRF_SECRET,
      })
    ).toThrow(HttpConfigurationError);

    expect(() =>
      loadHttpConfigFromEnv({
        SITECORP_AUTH_ENV: "production",
        SITECORP_HTTP_ALLOWED_ORIGINS: "https://portal.sitecorp.example",
        SITECORP_HTTP_TRUSTED_PROXIES: "*",
        SITECORP_CSRF_HMAC_SECRET: VALID_CSRF_SECRET,
      })
    ).toThrow(HttpConfigurationError);
  });
});

describe("FASE 4G.2B.1 — Servicio de Cookies (AuthCookieService)", () => {
  it("calcula el Max-Age restante acotado por refreshTokenExpiresAt, sessionExpiresAt y maxRefreshTtlSeconds", () => {
    const config = validateHttpConfig({
      environment: "production",
      allowedOrigins: ["https://portal.sitecorp.example"],
      csrf: { hmacSecret: VALID_CSRF_SECRET },
    });
    const service = new AuthCookieService(config.cookies);
    const now = new Date("2026-11-07T12:00:00.000Z");

    // sessionExpiresAt vence en 600s, refreshTokenExpiresAt en 3600s -> debe acotar a 600s
    const { maxAgeSeconds } = service.calculateRemainingMaxAgeSeconds({
      refreshTokenExpiresAt: new Date(now.getTime() + 3600 * 1000),
      sessionExpiresAt: new Date(now.getTime() + 600 * 1000),
      now,
    });
    expect(maxAgeSeconds).toBe(600);

    // Expirado -> lanza CookieExpirationError
    expect(() =>
      service.calculateRemainingMaxAgeSeconds({
        refreshTokenExpiresAt: new Date(now.getTime() - 1000),
        now,
      })
    ).toThrow(CookieExpirationError);
  });

  it("construye opciones RFC 6265bis exactas sin Domain para sitecorp_rt y __Host-sitecorp_csrf", () => {
    const config = validateHttpConfig({
      environment: "production",
      allowedOrigins: ["https://portal.sitecorp.example"],
      csrf: { hmacSecret: VALID_CSRF_SECRET },
    });
    const service = new AuthCookieService(config.cookies);
    const now = new Date("2026-11-07T12:00:00.000Z");
    const expires = new Date(now.getTime() + 7200 * 1000);

    const rtOpts = service.buildRefreshCookieOptions({
      refreshTokenExpiresAt: expires,
      now,
    });
    expect(rtOpts).toEqual({
      path: "/api/v1/auth",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 7200,
      expires,
    });
    expect("domain" in rtOpts).toBe(false);

    const csrfOpts = service.buildCsrfCookieOptions({
      refreshTokenExpiresAt: expires,
      now,
    });
    expect(csrfOpts).toEqual({
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      maxAge: 7200,
      expires,
    });
    expect("domain" in csrfOpts).toBe(false);
  });

  it("rechaza configuración de cookie __Host- si secure es false o Path no es '/'", () => {
    expect(() =>
      AuthCookieService.assertValidCookieConfig({
        refreshCookieName: "sitecorp_rt",
        refreshCookiePath: "/api/v1/auth",
        csrfCookieName: "__Host-sitecorp_csrf",
        csrfCookiePath: "/",
        secure: false,
        sameSite: "Strict",
        maxRefreshTtlSeconds: 3600,
      })
    ).toThrow(HttpConfigurationError);
  });
});

describe("FASE 4G.2B.1 — Servicio CSRF Firmado y Vinculado a Sesión (CsrfTokenService)", () => {
  it("genera y verifica un token CSRF válido vinculado a sid sin exponer secretos", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const service = new CsrfTokenService(
      {
        hmacSecret: VALID_CSRF_SECRET,
        ttlSeconds: 3600,
        headerName: "x-csrf-token",
      },
      () => now
    );

    const token = service.generateToken(VALID_SESSION_ID_A, now);
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain(VALID_CSRF_SECRET);
    expect(token).not.toContain(VALID_SESSION_ID_A);

    expect(() =>
      service.verifyToken({
        headerToken: token,
        cookieToken: token,
        expectedSessionId: VALID_SESSION_ID_A,
        now: new Date(now.getTime() + 60 * 1000),
      })
    ).not.toThrow();
  });

  it("rechaza un token CSRF legítimo si se presenta en otra sesión distinta (sid_A !== sid_B)", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const service = new CsrfTokenService(
      {
        hmacSecret: VALID_CSRF_SECRET,
        ttlSeconds: 3600,
        headerName: "x-csrf-token",
      },
      () => now
    );

    const tokenSessionA = service.generateToken(VALID_SESSION_ID_A, now);

    expect(() =>
      service.verifyToken({
        headerToken: tokenSessionA,
        cookieToken: tokenSessionA,
        expectedSessionId: VALID_SESSION_ID_B,
        now,
      })
    ).toThrow(CsrfValidationError);
  });

  it("rechaza tokens CSRF expirados, alterados o con discrepancia entre header y cookie", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const service = new CsrfTokenService(
      {
        hmacSecret: VALID_CSRF_SECRET,
        ttlSeconds: 600,
        headerName: "x-csrf-token",
      },
      () => now
    );

    const token = service.generateToken(VALID_SESSION_ID_A, now);
    const otherToken = service.generateToken(VALID_SESSION_ID_A, now);

    // Discrepancia header vs cookie
    expect(() =>
      service.verifyToken({
        headerToken: token,
        cookieToken: otherToken,
        expectedSessionId: VALID_SESSION_ID_A,
        now,
      })
    ).toThrow(CsrfValidationError);

    // Alteración de 1 carácter en la firma HMAC
    const tampered =
      token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(() =>
      service.verifyToken({
        headerToken: tampered,
        cookieToken: tampered,
        expectedSessionId: VALID_SESSION_ID_A,
        now,
      })
    ).toThrow(CsrfValidationError);

    // Expirado (> 600s)
    expect(() =>
      service.verifyToken({
        headerToken: token,
        cookieToken: token,
        expectedSessionId: VALID_SESSION_ID_A,
        now: new Date(now.getTime() + 601 * 1000),
      })
    ).toThrow(CsrfValidationError);
  });

  it("valida estrictamente Origin y Referer contra allowedOrigins", () => {
    const allowed = new Set(["https://portal.sitecorp.example"]);

    expect(() =>
      verifyRequestOrigin({
        originHeader: "https://portal.sitecorp.example",
        refererHeader: undefined,
        allowedOrigins: allowed,
        requireOriginHeader: true,
      })
    ).not.toThrow();

    // Fallback a Referer cuando falta Origin
    expect(() =>
      verifyRequestOrigin({
        originHeader: undefined,
        refererHeader: "https://portal.sitecorp.example/login?next=/dashboard",
        allowedOrigins: allowed,
        requireOriginHeader: true,
      })
    ).not.toThrow();

    // Rechaza cuando falta Origin y Referer si requireOriginHeader=true
    expect(() =>
      verifyRequestOrigin({
        originHeader: undefined,
        refererHeader: undefined,
        allowedOrigins: allowed,
        requireOriginHeader: true,
      })
    ).toThrow(CsrfValidationError);

    // Rechaza Origin cruzado no autorizado incluso si requireOriginHeader=false
    expect(() =>
      verifyRequestOrigin({
        originHeader: "https://attacker.example",
        refererHeader: undefined,
        allowedOrigins: allowed,
        requireOriginHeader: false,
      })
    ).toThrow(CsrfValidationError);

    // Rechaza Origin 'null'
    expect(() =>
      verifyRequestOrigin({
        originHeader: "null",
        refererHeader: undefined,
        allowedOrigins: allowed,
        requireOriginHeader: false,
      })
    ).toThrow(CsrfValidationError);
  });
});

describe("FASE 4G.2B.1 — Control de Concurrencia Argon2id (Argon2ConcurrencyGate)", () => {
  it("respeta maxConcurrent, procesa la cola en orden estricto FIFO y protege contra doble release()", async () => {
    const gate = new Argon2ConcurrencyGate({
      maxConcurrent: 2,
      maxQueueSize: 4,
      acquireTimeoutMs: 2000,
    });

    const executionOrder: number[] = [];
    let peakActive = 0;

    const lease1 = await gate.acquire();
    const lease2 = await gate.acquire();
    expect(gate.getMetrics().activeCount).toBe(2);

    // Encolar tareas 3, 4 y 5
    const p3 = gate.run(async () => {
      peakActive = Math.max(peakActive, gate.getMetrics().activeCount);
      executionOrder.push(3);
    });
    const p4 = gate.run(async () => {
      peakActive = Math.max(peakActive, gate.getMetrics().activeCount);
      executionOrder.push(4);
    });
    const p5 = gate.run(async () => {
      peakActive = Math.max(peakActive, gate.getMetrics().activeCount);
      executionOrder.push(5);
    });

    expect(gate.getMetrics().queuedCount).toBe(3);

    // Llamar release() dos veces sobre lease1 solo debe liberar un único slot
    lease1.release();
    lease1.release();

    lease2.release();
    await Promise.all([p3, p4, p5]);

    expect(peakActive).toBeLessThanOrEqual(2);
    expect(executionOrder).toEqual([3, 4, 5]);
    expect(gate.getMetrics().activeCount).toBe(0);
    expect(gate.getMetrics().queuedCount).toBe(0);
  });

  it("rechaza con Argon2ConcurrencySaturationError (QUEUE_FULL y QUEUE_TIMEOUT) y limpia canceladas", async () => {
    const gate = new Argon2ConcurrencyGate({
      maxConcurrent: 1,
      maxQueueSize: 1,
      acquireTimeoutMs: 100,
    });

    const lease1 = await gate.acquire();

    // Llenar el único espacio de cola con una solicitud cancelable
    const abortController = new AbortController();
    const queuedPromise = gate.acquire(abortController.signal);
    expect(gate.getMetrics().queuedCount).toBe(1);

    // Siguiente solicitud debe fallar inmediatamente por QUEUE_FULL
    await expect(gate.acquire()).rejects.toThrowError(
      Argon2ConcurrencySaturationError
    );

    // Cancelar la solicitud en cola -> debe limpiarse inmediatamente
    abortController.abort();
    await expect(queuedPromise).rejects.toMatchObject({
      code: "AUTH_SERVER_BUSY",
      reason: "ABORTED",
    });
    expect(gate.getMetrics().queuedCount).toBe(0);

    // Ahora probar vencimiento por QUEUE_TIMEOUT
    const timeoutPromise = gate.acquire();
    await expect(timeoutPromise).rejects.toMatchObject({
      code: "AUTH_SERVER_BUSY",
      reason: "QUEUE_TIMEOUT",
    });

    lease1.release();
    expect(gate.getMetrics().activeCount).toBe(0);
  });

  it("libera siempre el slot en finally cuando la tarea lanza un error y funciona con ConcurrencyLimitedPasswordHasher", async () => {
    const gate = new Argon2ConcurrencyGate({
      maxConcurrent: 1,
      maxQueueSize: 2,
      acquireTimeoutMs: 1000,
    });

    await expect(
      gate.run(async () => {
        throw new Error("Fallo simulado");
      })
    ).rejects.toThrow("Fallo simulado");

    expect(gate.getMetrics().activeCount).toBe(0);

    const hasher = new ConcurrencyLimitedPasswordHasher(
      new FakePasswordHasher(),
      gate
    );
    const hashed = await hasher.hash("ClaveSegura#2026!");
    expect(await hasher.verify("ClaveSegura#2026!", hashed)).toBe(true);
    expect(gate.getMetrics().activeCount).toBe(0);
  });
});

describe("FASE 4G.2B.1 — Rate Limiter Acotado en Memoria (BoundedMemoryRateLimiter)", () => {
  it("aplica límites independientes por IP, cuenta y operación sin almacenar texto plano", async () => {
    let now = new Date("2026-11-07T12:00:00.000Z");
    const limiter = new BoundedMemoryRateLimiter(100, () => now);
    const rule = { maxRequests: 2, windowMs: 60000 };

    const hashedKey = hashRateLimitIdentifier(
      "login",
      "account",
      "Usuario@SiteCorp.CU "
    );
    expect(hashedKey).not.toContain("usuario@sitecorp.cu");
    expect(hashedKey).toMatch(/^login:account:[0-9a-f]{64}$/);

    // 1.ª y 2.ª petición permitidas
    const s1 = await limiter.consumeOrThrow({
      operation: "login",
      dimension: "account",
      rawIdentifier: "Usuario@SiteCorp.CU",
      rule,
    });
    expect(s1.remaining).toBe(1);

    const s2 = await limiter.consumeOrThrow({
      operation: "login",
      dimension: "account",
      rawIdentifier: "usuario@sitecorp.cu",
      rule,
    });
    expect(s2.remaining).toBe(0);

    // 3.ª petición excede el límite -> lanza RateLimitExceededError con Retry-After
    await expect(
      limiter.consumeOrThrow({
        operation: "login",
        dimension: "account",
        rawIdentifier: "usuario@sitecorp.cu",
        rule,
      })
    ).rejects.toThrow(RateLimitExceededError);

    // Otra operación o dimensión con el mismo identificador sigue permitida independientemente
    const ipStatus = await limiter.consumeOrThrow({
      operation: "login",
      dimension: "ip",
      rawIdentifier: "192.0.2.10",
      rule,
    });
    expect(ipStatus.allowed).toBe(true);

    // Avanzar reloj más allá de la ventana de 60s -> se restablece la cuota
    now = new Date(now.getTime() + 61000);
    const afterReset = await limiter.consumeOrThrow({
      operation: "login",
      dimension: "account",
      rawIdentifier: "usuario@sitecorp.cu",
      rule,
    });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });

  it("mantiene la memoria estrictamente acotada a maxEntries mediante desalojo LRU", async () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const limiter = new BoundedMemoryRateLimiter(100, () => now);
    const rule = { maxRequests: 5, windowMs: 60000 };

    for (let i = 0; i < 250; i++) {
      await limiter.consume({
        operation: "login",
        dimension: "ip",
        rawIdentifier: `198.51.100.${i}`,
        rule,
      });
    }

    expect(limiter.size()).toBeLessThanOrEqual(100);
  });
});
