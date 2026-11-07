import { DomainError } from "../../domain";

/**
 * Error de configuración HTTP lanzado cuando las opciones del servidor,
 * orígenes CORS, parámetros de cookies, CSRF, límites o concurrencia
 * incumplen las políticas de seguridad (arranque fail-closed).
 */
export class HttpConfigurationError extends DomainError {
  public readonly code = "HTTP_CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
  }
}

export type CookieSameSitePolicy = "Strict" | "Lax";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface HttpLimitsConfig {
  readonly globalBodyLimitBytes: number;
  readonly authBodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  readonly readinessTimeoutMs: number;
}

export interface AuthCookieConfig {
  readonly refreshCookieName: "sitecorp_rt";
  readonly refreshCookiePath: "/api/v1/auth";
  readonly csrfCookieName: "__Host-sitecorp_csrf" | "sitecorp_csrf";
  readonly csrfCookiePath: "/";
  readonly secure: boolean;
  readonly sameSite: CookieSameSitePolicy;
  readonly maxRefreshTtlSeconds: number;
}

export interface CsrfConfig {
  readonly hmacSecret: string;
  readonly ttlSeconds: number;
  readonly headerName: "x-csrf-token";
}

export interface Argon2ConcurrencyConfig {
  readonly maxConcurrent: number;
  readonly maxQueueSize: number;
  readonly acquireTimeoutMs: number;
}

export interface RateLimitRuleConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export interface AuthRateLimitConfig {
  readonly maxEntries: number;
  readonly loginByIp: RateLimitRuleConfig;
  readonly loginByAccount: RateLimitRuleConfig;
  readonly refreshByIp: RateLimitRuleConfig;
  readonly refreshByToken: RateLimitRuleConfig;
  readonly logoutByIp: RateLimitRuleConfig;
  readonly logoutByActor: RateLimitRuleConfig;
  readonly changePasswordByIp: RateLimitRuleConfig;
  readonly changePasswordByUser: RateLimitRuleConfig;
  readonly meByIp: RateLimitRuleConfig;
  readonly meByUser: RateLimitRuleConfig;
  readonly adminByIp: RateLimitRuleConfig;
  readonly adminByUser: RateLimitRuleConfig;
}

export interface HttpLoggingConfig {
  readonly enabled: boolean;
  readonly level: LogLevel;
}

export interface AuthHttpConfig {
  readonly environment: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly trustedProxies: false | readonly string[];
  readonly limits: HttpLimitsConfig;
  readonly cookies: AuthCookieConfig;
  readonly csrf: CsrfConfig;
  readonly argon2Gate: Argon2ConcurrencyConfig;
  readonly rateLimit: AuthRateLimitConfig;
  readonly logging: HttpLoggingConfig;
}

export const HTTP_SAFE_BOUNDS = Object.freeze({
  minBodyLimitBytes: 1024, // 1 KiB
  maxGlobalBodyLimitBytes: 65536, // 64 KiB
  maxAuthBodyLimitBytes: 16384, // 16 KiB
  minTimeoutMs: 100,
  maxTimeoutMs: 60000,
  minRefreshTtlSeconds: 60,
  maxRefreshTtlSeconds: 30 * 24 * 60 * 60, // 30 días
  minCsrfSecretBytes: 32, // 256 bits
  minCsrfTtlSeconds: 60,
  maxCsrfTtlSeconds: 30 * 24 * 60 * 60,
  minArgon2Concurrent: 1,
  maxArgon2Concurrent: 16,
  minArgon2QueueSize: 0,
  maxArgon2QueueSize: 64,
  minArgon2TimeoutMs: 100,
  maxArgon2TimeoutMs: 15000,
  minRateLimitEntries: 100,
  maxRateLimitEntries: 100000,
});

const ALLOWED_ENVIRONMENTS = new Set(["development", "test", "production"]);
const ALLOWED_LOG_LEVELS = new Set<LogLevel>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

const FORBIDDEN_PLACEHOLDER_SECRETS = new Set([
  "reemplazar_con_secreto_csprng_de_al_menos_32_bytes_en_produccion",
  "changeme",
  "secret",
  "default_secret",
  "00000000000000000000000000000000",
]);

function validateOriginUrl(rawOrigin: string, environment: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed === "*" || trimmed.includes("*")) {
    throw new HttpConfigurationError(
      "No se permiten comodines ('*') ni orígenes vacíos en 'allowedOrigins'."
    );
  }
  if (trimmed.endsWith("/")) {
    throw new HttpConfigurationError(
      `El origen '${trimmed}' no debe incluir barra final ('/').`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpConfigurationError(
      `El origen '${trimmed}' no tiene un formato de URL válido.`
    );
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new HttpConfigurationError(
      `El origen '${trimmed}' no debe contener ruta, query ni fragmento.`
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpConfigurationError(
      `El origen '${trimmed}' debe utilizar el esquema 'https:' o 'http:'.`
    );
  }

  if (environment === "production" && parsed.protocol !== "https:") {
    throw new HttpConfigurationError(
      `En producción todos los orígenes permitidos deben utilizar obligatoriamente 'https://' (recibido: '${trimmed}').`
    );
  }

  return parsed.origin;
}

function validateCsrfHmacSecret(secret: string, environment: string): string {
  if (typeof secret !== "string") {
    throw new HttpConfigurationError(
      "El secreto HMAC de CSRF es obligatorio."
    );
  }
  const trimmed = secret.trim();
  const byteLength = Buffer.byteLength(trimmed, "utf8");
  if (byteLength < HTTP_SAFE_BOUNDS.minCsrfSecretBytes) {
    throw new HttpConfigurationError(
      `El secreto HMAC de CSRF debe tener al menos ${HTTP_SAFE_BOUNDS.minCsrfSecretBytes} bytes (256 bits).`
    );
  }

  if (FORBIDDEN_PLACEHOLDER_SECRETS.has(trimmed.toLowerCase())) {
    throw new HttpConfigurationError(
      "El secreto HMAC de CSRF configurado corresponde a un marcador de posición inseguro prohibido."
    );
  }

  // Comprobar entropía mínima básica (rechazar repetición de un único carácter en producción)
  const uniqueChars = new Set(trimmed).size;
  if (environment === "production" && uniqueChars < 8) {
    throw new HttpConfigurationError(
      "El secreto HMAC de CSRF carece de diversidad de caracteres suficiente para producción."
    );
  }

  return trimmed;
}

function validateTrustedProxies(
  input: false | readonly string[] | undefined
): false | readonly string[] {
  if (input === false || input === undefined) {
    return false;
  }
  if (!Array.isArray(input)) {
    throw new HttpConfigurationError(
      "'trustedProxies' debe ser 'false' o un arreglo de direcciones IP / subredes CIDR confiables."
    );
  }
  const cleaned: string[] = [];
  for (const item of input) {
    const trimmed = typeof item === "string" ? item.trim() : "";
    if (!trimmed) continue;
    if (trimmed === "*" || trimmed.toLowerCase() === "true") {
      throw new HttpConfigurationError(
        "Se prohíbe configurar 'trustedProxies' con '*' o 'true' global; especifique IPs o CIDRs explícitos del proxy inverso."
      );
    }
    if (!/^[0-9a-fA-F:./]+$/.test(trimmed)) {
      throw new HttpConfigurationError(
        `Dirección o CIDR de proxy inválido en 'trustedProxies': '${trimmed}'.`
      );
    }
    cleaned.push(trimmed);
  }
  return cleaned.length > 0 ? Object.freeze(cleaned) : false;
}

export interface PartialAuthHttpConfigInput {
  readonly environment?: "development" | "test" | "production";
  readonly host?: string;
  readonly port?: number;
  readonly allowedOrigins?: Iterable<string>;
  readonly trustedProxies?: false | readonly string[];
  readonly limits?: Partial<HttpLimitsConfig>;
  readonly cookies?: Partial<
    Pick<AuthCookieConfig, "secure" | "sameSite" | "maxRefreshTtlSeconds">
  >;
  readonly csrf?: Partial<Pick<CsrfConfig, "hmacSecret" | "ttlSeconds">>;
  readonly argon2Gate?: Partial<Argon2ConcurrencyConfig>;
  readonly rateLimit?: {
    readonly maxEntries?: number;
    readonly loginByIp?: Partial<RateLimitRuleConfig>;
    readonly loginByAccount?: Partial<RateLimitRuleConfig>;
    readonly refreshByIp?: Partial<RateLimitRuleConfig>;
    readonly refreshByToken?: Partial<RateLimitRuleConfig>;
    readonly logoutByIp?: Partial<RateLimitRuleConfig>;
    readonly logoutByActor?: Partial<RateLimitRuleConfig>;
    readonly changePasswordByIp?: Partial<RateLimitRuleConfig>;
    readonly changePasswordByUser?: Partial<RateLimitRuleConfig>;
    readonly meByIp?: Partial<RateLimitRuleConfig>;
    readonly meByUser?: Partial<RateLimitRuleConfig>;
    readonly adminByIp?: Partial<RateLimitRuleConfig>;
    readonly adminByUser?: Partial<RateLimitRuleConfig>;
  };
  readonly logging?: Partial<HttpLoggingConfig>;
}

function validateRateLimitRule(
  rule: Partial<RateLimitRuleConfig> | undefined,
  defaultMax: number,
  defaultWindowMs: number,
  name: string
): RateLimitRuleConfig {
  const maxRequests = rule?.maxRequests ?? defaultMax;
  const windowMs = rule?.windowMs ?? defaultWindowMs;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000) {
    throw new HttpConfigurationError(
      `Rate limit '${name}.maxRequests' debe ser un entero entre 1 y 10000.`
    );
  }
  if (!Number.isInteger(windowMs) || windowMs < 100 || windowMs > 86400000) {
    throw new HttpConfigurationError(
      `Rate limit '${name}.windowMs' debe ser un entero entre 100 y 86400000 ms.`
    );
  }
  return Object.freeze({ maxRequests, windowMs });
}

/**
 * Construye y valida de forma determinista un objeto AuthHttpConfig.
 * En entorno `"production"` aplica comportamiento fail-closed estricto.
 */
export function validateHttpConfig(
  input: PartialAuthHttpConfigInput
): AuthHttpConfig {
  if (!input || typeof input !== "object") {
    throw new HttpConfigurationError("La configuración HTTP es obligatoria.");
  }

  const environment = input.environment ?? "development";
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new HttpConfigurationError(
      `Entorno HTTP inválido: '${String(environment)}'. Valores permitidos: 'development', 'test', 'production'.`
    );
  }

  const host = (input.host ?? "127.0.0.1").trim();
  if (!host) {
    throw new HttpConfigurationError("El 'host' HTTP no puede estar vacío.");
  }

  const port = input.port ?? 4010;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpConfigurationError(
      "El 'port' HTTP debe ser un número entero entre 1 y 65535."
    );
  }

  const rawOrigins = input.allowedOrigins
    ? Array.from(input.allowedOrigins)
    : [];
  if (environment === "production" && rawOrigins.length === 0) {
    throw new HttpConfigurationError(
      "En producción es obligatorio configurar al menos un origen HTTPS en 'allowedOrigins'."
    );
  }

  const validatedOrigins = new Set<string>();
  for (const origin of rawOrigins) {
    validatedOrigins.add(validateOriginUrl(origin, environment));
  }

  const trustedProxies = validateTrustedProxies(input.trustedProxies);

  // Límites HTTP
  const globalBodyLimitBytes =
    input.limits?.globalBodyLimitBytes ?? 16384; // 16 KiB
  const authBodyLimitBytes =
    input.limits?.authBodyLimitBytes ?? 4096; // 4 KiB
  const requestTimeoutMs = input.limits?.requestTimeoutMs ?? 10000;
  const connectionTimeoutMs = input.limits?.connectionTimeoutMs ?? 5000;
  const readinessTimeoutMs = input.limits?.readinessTimeoutMs ?? 1500;

  if (
    !Number.isInteger(globalBodyLimitBytes) ||
    globalBodyLimitBytes < HTTP_SAFE_BOUNDS.minBodyLimitBytes ||
    globalBodyLimitBytes > HTTP_SAFE_BOUNDS.maxGlobalBodyLimitBytes
  ) {
    throw new HttpConfigurationError(
      `globalBodyLimitBytes debe ser un entero entre ${HTTP_SAFE_BOUNDS.minBodyLimitBytes} y ${HTTP_SAFE_BOUNDS.maxGlobalBodyLimitBytes} bytes.`
    );
  }

  if (
    !Number.isInteger(authBodyLimitBytes) ||
    authBodyLimitBytes < HTTP_SAFE_BOUNDS.minBodyLimitBytes ||
    authBodyLimitBytes > HTTP_SAFE_BOUNDS.maxAuthBodyLimitBytes ||
    authBodyLimitBytes > globalBodyLimitBytes
  ) {
    throw new HttpConfigurationError(
      `authBodyLimitBytes debe ser un entero entre ${HTTP_SAFE_BOUNDS.minBodyLimitBytes} y ${Math.min(
        HTTP_SAFE_BOUNDS.maxAuthBodyLimitBytes,
        globalBodyLimitBytes
      )} bytes.`
    );
  }

  for (const [name, val] of [
    ["requestTimeoutMs", requestTimeoutMs],
    ["connectionTimeoutMs", connectionTimeoutMs],
    ["readinessTimeoutMs", readinessTimeoutMs],
  ] as const) {
    if (
      !Number.isInteger(val) ||
      val < HTTP_SAFE_BOUNDS.minTimeoutMs ||
      val > HTTP_SAFE_BOUNDS.maxTimeoutMs
    ) {
      throw new HttpConfigurationError(
        `${name} debe ser un entero entre ${HTTP_SAFE_BOUNDS.minTimeoutMs} y ${HTTP_SAFE_BOUNDS.maxTimeoutMs} ms.`
      );
    }
  }

  // Cookies
  const cookieSecure =
    input.cookies?.secure ?? (environment === "production" ? true : false);
  if (environment === "production" && cookieSecure !== true) {
    throw new HttpConfigurationError(
      "En producción 'cookies.secure' debe ser obligatoriamente true."
    );
  }

  const sameSite: CookieSameSitePolicy = input.cookies?.sameSite ?? "Strict";
  if (sameSite !== "Strict" && sameSite !== "Lax") {
    throw new HttpConfigurationError(
      "La política 'cookies.sameSite' debe ser 'Strict' o 'Lax'."
    );
  }

  const maxRefreshTtlSeconds =
    input.cookies?.maxRefreshTtlSeconds ?? 14 * 24 * 60 * 60; // 14 días (1209600s)
  if (
    !Number.isInteger(maxRefreshTtlSeconds) ||
    maxRefreshTtlSeconds < HTTP_SAFE_BOUNDS.minRefreshTtlSeconds ||
    maxRefreshTtlSeconds > HTTP_SAFE_BOUNDS.maxRefreshTtlSeconds
  ) {
    throw new HttpConfigurationError(
      `cookies.maxRefreshTtlSeconds debe estar entre ${HTTP_SAFE_BOUNDS.minRefreshTtlSeconds} y ${HTTP_SAFE_BOUNDS.maxRefreshTtlSeconds} segundos.`
    );
  }

  // Prefijo __Host- requiere obligatoriamente Secure=true, Path=/ y sin Domain
  const csrfCookieName = cookieSecure
    ? "__Host-sitecorp_csrf"
    : "sitecorp_csrf";

  // CSRF
  if (!input.csrf?.hmacSecret) {
    throw new HttpConfigurationError(
      "Es obligatorio proporcionar 'csrf.hmacSecret' (mínimo 32 bytes)."
    );
  }
  const hmacSecret = validateCsrfHmacSecret(input.csrf.hmacSecret, environment);
  const csrfTtlSeconds = input.csrf?.ttlSeconds ?? maxRefreshTtlSeconds;
  if (
    !Number.isInteger(csrfTtlSeconds) ||
    csrfTtlSeconds < HTTP_SAFE_BOUNDS.minCsrfTtlSeconds ||
    csrfTtlSeconds > HTTP_SAFE_BOUNDS.maxCsrfTtlSeconds
  ) {
    throw new HttpConfigurationError(
      `csrf.ttlSeconds debe estar entre ${HTTP_SAFE_BOUNDS.minCsrfTtlSeconds} y ${HTTP_SAFE_BOUNDS.maxCsrfTtlSeconds} segundos.`
    );
  }

  // Argon2ConcurrencyGate (valores conservadores por defecto: maxConcurrent=2, maxQueueSize=8)
  const maxConcurrent = input.argon2Gate?.maxConcurrent ?? 2;
  const maxQueueSize = input.argon2Gate?.maxQueueSize ?? 8;
  const acquireTimeoutMs = input.argon2Gate?.acquireTimeoutMs ?? 2500;

  if (
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < HTTP_SAFE_BOUNDS.minArgon2Concurrent ||
    maxConcurrent > HTTP_SAFE_BOUNDS.maxArgon2Concurrent
  ) {
    throw new HttpConfigurationError(
      `argon2Gate.maxConcurrent debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2Concurrent} y ${HTTP_SAFE_BOUNDS.maxArgon2Concurrent}.`
    );
  }

  if (
    !Number.isInteger(maxQueueSize) ||
    maxQueueSize < HTTP_SAFE_BOUNDS.minArgon2QueueSize ||
    maxQueueSize > HTTP_SAFE_BOUNDS.maxArgon2QueueSize
  ) {
    throw new HttpConfigurationError(
      `argon2Gate.maxQueueSize debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2QueueSize} y ${HTTP_SAFE_BOUNDS.maxArgon2QueueSize}.`
    );
  }

  if (
    !Number.isInteger(acquireTimeoutMs) ||
    acquireTimeoutMs < HTTP_SAFE_BOUNDS.minArgon2TimeoutMs ||
    acquireTimeoutMs > HTTP_SAFE_BOUNDS.maxArgon2TimeoutMs
  ) {
    throw new HttpConfigurationError(
      `argon2Gate.acquireTimeoutMs debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2TimeoutMs} y ${HTTP_SAFE_BOUNDS.maxArgon2TimeoutMs} ms.`
    );
  }

  // Rate Limiting
  const maxEntries = input.rateLimit?.maxEntries ?? 10000;
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < HTTP_SAFE_BOUNDS.minRateLimitEntries ||
    maxEntries > HTTP_SAFE_BOUNDS.maxRateLimitEntries
  ) {
    throw new HttpConfigurationError(
      `rateLimit.maxEntries debe ser un entero entre ${HTTP_SAFE_BOUNDS.minRateLimitEntries} y ${HTTP_SAFE_BOUNDS.maxRateLimitEntries}.`
    );
  }

  const rateLimit: AuthRateLimitConfig = Object.freeze({
    maxEntries,
    loginByIp: validateRateLimitRule(
      input.rateLimit?.loginByIp,
      10,
      60000,
      "loginByIp"
    ),
    loginByAccount: validateRateLimitRule(
      input.rateLimit?.loginByAccount,
      5,
      60000,
      "loginByAccount"
    ),
    refreshByIp: validateRateLimitRule(
      input.rateLimit?.refreshByIp,
      20,
      60000,
      "refreshByIp"
    ),
    refreshByToken: validateRateLimitRule(
      input.rateLimit?.refreshByToken,
      10,
      60000,
      "refreshByToken"
    ),
    logoutByIp: validateRateLimitRule(
      input.rateLimit?.logoutByIp,
      30,
      60000,
      "logoutByIp"
    ),
    logoutByActor: validateRateLimitRule(
      input.rateLimit?.logoutByActor,
      15,
      60000,
      "logoutByActor"
    ),
    changePasswordByIp: validateRateLimitRule(
      input.rateLimit?.changePasswordByIp,
      10,
      60000,
      "changePasswordByIp"
    ),
    changePasswordByUser: validateRateLimitRule(
      input.rateLimit?.changePasswordByUser,
      5,
      300000,
      "changePasswordByUser"
    ),
    meByIp: validateRateLimitRule(input.rateLimit?.meByIp, 60, 60000, "meByIp"),
    meByUser: validateRateLimitRule(
      input.rateLimit?.meByUser,
      60,
      60000,
      "meByUser"
    ),
    adminByIp: validateRateLimitRule(
      input.rateLimit?.adminByIp,
      30,
      60000,
      "adminByIp"
    ),
    adminByUser: validateRateLimitRule(
      input.rateLimit?.adminByUser,
      30,
      60000,
      "adminByUser"
    ),
  });

  // Logging
  const loggingEnabled =
    input.logging?.enabled ?? (environment !== "test");
  const loggingLevel: LogLevel =
    input.logging?.level ?? (environment === "test" ? "silent" : "info");

  if (!ALLOWED_LOG_LEVELS.has(loggingLevel)) {
    throw new HttpConfigurationError(
      `Nivel de log inválido: '${String(loggingLevel)}'.`
    );
  }

  return Object.freeze({
    environment,
    host,
    port,
    allowedOrigins: validatedOrigins,
    trustedProxies,
    limits: Object.freeze({
      globalBodyLimitBytes,
      authBodyLimitBytes,
      requestTimeoutMs,
      connectionTimeoutMs,
      readinessTimeoutMs,
    }),
    cookies: Object.freeze({
      refreshCookieName: "sitecorp_rt",
      refreshCookiePath: "/api/v1/auth",
      csrfCookieName,
      csrfCookiePath: "/",
      secure: cookieSecure,
      sameSite,
      maxRefreshTtlSeconds,
    }),
    csrf: Object.freeze({
      hmacSecret,
      ttlSeconds: csrfTtlSeconds,
      headerName: "x-csrf-token",
    }),
    argon2Gate: Object.freeze({
      maxConcurrent,
      maxQueueSize,
      acquireTimeoutMs,
    }),
    rateLimit,
    logging: Object.freeze({
      enabled: Boolean(loggingEnabled),
      level: loggingLevel,
    }),
  });
}

/**
 * Carga y valida la configuración HTTP desde variables de entorno (`process.env`).
 * En producción exige explícitamente `SITECORP_HTTP_ALLOWED_ORIGINS` y
 * `SITECORP_CSRF_HMAC_SECRET`, aplicando fallo cerrado (fail-closed).
 */
export function loadHttpConfigFromEnv(
  env: Record<string, string | undefined>
): AuthHttpConfig {
  if (!env || typeof env !== "object") {
    throw new HttpConfigurationError(
      "El diccionario de variables de entorno es obligatorio."
    );
  }

  const rawEnvInput = env.SITECORP_AUTH_ENV ?? env.NODE_ENV;
  const rawEnv =
    rawEnvInput === undefined || rawEnvInput.trim() === ""
      ? "development"
      : rawEnvInput.trim();

  if (!ALLOWED_ENVIRONMENTS.has(rawEnv)) {
    throw new HttpConfigurationError(
      "El entorno configurado ('SITECORP_AUTH_ENV' / 'NODE_ENV') es inválido. Valores permitidos: 'development', 'test', 'production'."
    );
  }

  const environment = rawEnv as "development" | "test" | "production";

  const parseOptionalInt = (
    raw: string | undefined,
    fallback: number,
    name: string
  ): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed)) {
      throw new HttpConfigurationError(
        `La variable '${name}' debe ser un número entero válido.`
      );
    }
    return parsed;
  };

  const parseOptionalBoolean = (
    raw: string | undefined,
    fallback: boolean,
    name: string
  ): boolean => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const norm = raw.trim().toLowerCase();
    if (norm === "true" || norm === "1") return true;
    if (norm === "false" || norm === "0") return false;
    throw new HttpConfigurationError(
      `La variable '${name}' debe ser 'true' o 'false'.`
    );
  };

  const rawOriginsStr = env.SITECORP_HTTP_ALLOWED_ORIGINS ?? "";
  const allowedOrigins = rawOriginsStr
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  let trustedProxies: false | readonly string[] = false;
  const rawProxies = env.SITECORP_HTTP_TRUSTED_PROXIES?.trim() ?? "";
  if (rawProxies !== "" && rawProxies.toLowerCase() !== "false") {
    if (rawProxies.toLowerCase() === "true" || rawProxies === "*") {
      throw new HttpConfigurationError(
        "No se permite configurar 'SITECORP_HTTP_TRUSTED_PROXIES' con 'true' ni '*'; especifique las IPs o CIDRs de su proxy inverso."
      );
    }
    trustedProxies = rawProxies
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  const cookieSecure = parseOptionalBoolean(
    env.SITECORP_HTTP_COOKIE_SECURE,
    environment === "production",
    "SITECORP_HTTP_COOKIE_SECURE"
  );

  const rawSameSite = env.SITECORP_HTTP_COOKIE_SAMESITE?.trim();
  const sameSite: CookieSameSitePolicy =
    rawSameSite === undefined || rawSameSite === ""
      ? "Strict"
      : (rawSameSite as CookieSameSitePolicy);

  const csrfSecret = env.SITECORP_CSRF_HMAC_SECRET ?? "";
  if (!csrfSecret || csrfSecret.trim() === "") {
    throw new HttpConfigurationError(
      "Es obligatorio definir la variable 'SITECORP_CSRF_HMAC_SECRET' con al menos 32 bytes."
    );
  }

  const maxRefreshTtlSeconds = parseOptionalInt(
    env.SITECORP_HTTP_REFRESH_MAX_AGE_SECONDS,
    14 * 24 * 60 * 60,
    "SITECORP_HTTP_REFRESH_MAX_AGE_SECONDS"
  );

  const logLevelRaw = env.SITECORP_LOG_LEVEL?.trim();
  const logLevel: LogLevel =
    logLevelRaw && logLevelRaw !== ""
      ? (logLevelRaw as LogLevel)
      : environment === "test"
      ? "silent"
      : "info";

  return validateHttpConfig({
    environment,
    host: env.SITECORP_HTTP_HOST ?? "127.0.0.1",
    port: parseOptionalInt(env.SITECORP_HTTP_PORT, 4010, "SITECORP_HTTP_PORT"),
    allowedOrigins,
    trustedProxies,
    limits: {
      globalBodyLimitBytes: parseOptionalInt(
        env.SITECORP_HTTP_GLOBAL_BODY_LIMIT_BYTES,
        16384,
        "SITECORP_HTTP_GLOBAL_BODY_LIMIT_BYTES"
      ),
      authBodyLimitBytes: parseOptionalInt(
        env.SITECORP_HTTP_AUTH_BODY_LIMIT_BYTES,
        4096,
        "SITECORP_HTTP_AUTH_BODY_LIMIT_BYTES"
      ),
      requestTimeoutMs: parseOptionalInt(
        env.SITECORP_HTTP_REQUEST_TIMEOUT_MS,
        10000,
        "SITECORP_HTTP_REQUEST_TIMEOUT_MS"
      ),
      connectionTimeoutMs: parseOptionalInt(
        env.SITECORP_HTTP_CONNECTION_TIMEOUT_MS,
        5000,
        "SITECORP_HTTP_CONNECTION_TIMEOUT_MS"
      ),
      readinessTimeoutMs: parseOptionalInt(
        env.SITECORP_HTTP_READINESS_TIMEOUT_MS,
        1500,
        "SITECORP_HTTP_READINESS_TIMEOUT_MS"
      ),
    },
    cookies: {
      secure: cookieSecure,
      sameSite,
      maxRefreshTtlSeconds,
    },
    csrf: {
      hmacSecret: csrfSecret,
      ttlSeconds: parseOptionalInt(
        env.SITECORP_CSRF_TTL_SECONDS,
        maxRefreshTtlSeconds,
        "SITECORP_CSRF_TTL_SECONDS"
      ),
    },
    argon2Gate: {
      maxConcurrent: parseOptionalInt(
        env.SITECORP_ARGON2_MAX_CONCURRENT,
        2,
        "SITECORP_ARGON2_MAX_CONCURRENT"
      ),
      maxQueueSize: parseOptionalInt(
        env.SITECORP_ARGON2_MAX_QUEUE,
        8,
        "SITECORP_ARGON2_MAX_QUEUE"
      ),
      acquireTimeoutMs: parseOptionalInt(
        env.SITECORP_ARGON2_QUEUE_TIMEOUT_MS,
        2500,
        "SITECORP_ARGON2_QUEUE_TIMEOUT_MS"
      ),
    },
    rateLimit: {
      maxEntries: parseOptionalInt(
        env.SITECORP_RATE_LIMIT_MAX_ENTRIES,
        10000,
        "SITECORP_RATE_LIMIT_MAX_ENTRIES"
      ),
      loginByIp: {
        maxRequests: parseOptionalInt(
          env.SITECORP_RATE_LIMIT_LOGIN_IP_MAX,
          10,
          "SITECORP_RATE_LIMIT_LOGIN_IP_MAX"
        ),
        windowMs: parseOptionalInt(
          env.SITECORP_RATE_LIMIT_LOGIN_IP_WINDOW_MS,
          60000,
          "SITECORP_RATE_LIMIT_LOGIN_IP_WINDOW_MS"
        ),
      },
      loginByAccount: {
        maxRequests: parseOptionalInt(
          env.SITECORP_RATE_LIMIT_LOGIN_ACCOUNT_MAX,
          5,
          "SITECORP_RATE_LIMIT_LOGIN_ACCOUNT_MAX"
        ),
        windowMs: parseOptionalInt(
          env.SITECORP_RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_MS,
          60000,
          "SITECORP_RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_MS"
        ),
      },
    },
    logging: {
      enabled: parseOptionalBoolean(
        env.SITECORP_LOG_ENABLED,
        environment !== "test",
        "SITECORP_LOG_ENABLED"
      ),
      level: logLevel,
    },
  });
}
