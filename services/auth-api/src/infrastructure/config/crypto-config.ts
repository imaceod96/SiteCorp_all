import {
  KeyObject,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { DomainError } from "../../domain";

/**
 * Error de configuración criptográfica lanzado cuando los parámetros de Argon2id
 * o las claves/contratos de JWT incumplen las cotas de seguridad requeridas.
 */
export class CryptoConfigurationError extends DomainError {
  public readonly code = "CRYPTO_CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parámetros configurables para el adaptador Argon2id.
 *
 * NOTA OPERATIVA PARA INFRAESTRUCTURA ETECSA:
 * Los valores por defecto siguen el mínimo recomendado por OWASP Password Storage
 * Cheat Sheet para Argon2id (m = 19 MiB / 19456 KiB, t = 2 iteraciones, p = 1 hilo,
 * tagLength = 32 bytes). Los valores definitivos de producción DEBEN calibrarse
 * mediante benchmark real sobre la CPU y memoria RAM disponibles en el VPS de ETECSA
 * antes del despliegue, junto con un semáforo/cola de concurrencia en la capa HTTP
 * para evitar agotamiento de RAM bajo picos de peticiones de login.
 */
export interface Argon2idConfig {
  /** Coste de memoria en KiB (por defecto: 19456 KiB = 19 MiB; rango seguro: 8192..262144 KiB) */
  readonly memoryCostKiB: number;
  /** Número de iteraciones/pasadas (por defecto: 2; rango seguro: 1..10) */
  readonly timeCost: number;
  /** Grado de paralelismo / carriles (por defecto: 1; rango seguro: 1..8) */
  readonly parallelism: number;
  /** Longitud del digest de salida en bytes (por defecto: 32; rango seguro: 16..64) */
  readonly outputLen: number;
  /** Longitud máxima de contraseña en bytes UTF-8 para mitigar DoS (por defecto: 128) */
  readonly maxPasswordBytes: number;
}

export const DEFAULT_ARGON2ID_CONFIG: Argon2idConfig = Object.freeze({
  memoryCostKiB: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  maxPasswordBytes: 128,
});

export const ARGON2ID_SAFE_BOUNDS = Object.freeze({
  minMemoryCostKiB: 8192, // 8 MiB mínimo admisible
  maxMemoryCostKiB: 262144, // 256 MiB cota superior anti-OOM por hash individual
  minTimeCost: 1,
  maxTimeCost: 10,
  minParallelism: 1,
  maxParallelism: 8,
  minOutputLen: 16,
  maxOutputLen: 64,
  minMaxPasswordBytes: 64,
  maxMaxPasswordBytes: 1024,
});

/**
 * Clave asimétrica Ed25519 (EdDSA) activa para firma y verificación de Access Tokens.
 */
export interface JwtSigningKeyConfig {
  /** Identificador único de la clave en la cabecera JWT (`kid`) */
  readonly kid: string;
  /** Clave privada Ed25519 en formato PEM (PKCS#8) para firmar tokens */
  readonly privateKeyPem: string;
  /** Clave pública Ed25519 en formato PEM (SPKI) para verificar tokens */
  readonly publicKeyPem: string;
}

/**
 * Clave pública Ed25519 (EdDSA) adicional para verificar tokens emitidos con
 * claves anteriores durante ventanas de rotación sin invalidar sesiones activas.
 */
export interface JwtVerificationKeyConfig {
  readonly kid: string;
  readonly publicKeyPem: string;
}

/**
 * Contrato de configuración para emisión y verificación de JWT y Refresh Tokens.
 */
export interface JwtServiceConfig {
  /** Emisor esperado (`iss`), p.ej. "urn:sitecorp:auth-api" */
  readonly issuer: string;
  /** Audiencia esperada (`aud`), p.ej. "urn:sitecorp:api" */
  readonly audience: string;
  /** Tiempo de vida del Access Token en segundos (por defecto: 900s = 15 minutos) */
  readonly accessTokenTtlSeconds: number;
  /** Tolerancia de deriva de reloj en segundos para `exp`/`iat` (por defecto: 0s) */
  readonly clockToleranceSeconds?: number;
  /** Si es true, exige que todo Access Token firmado y verificado incluya el claim `sid` */
  readonly requireSessionId?: boolean;
  /** Clave asimétrica activa para firmar nuevos Access Tokens */
  readonly activeSigningKey: JwtSigningKeyConfig;
  /** Claves públicas históricas admitidas exclusivamente para verificación (rotación de claves) */
  readonly additionalVerificationKeys?: readonly JwtVerificationKeyConfig[];
  /** Función proveedora de tiempo actual (inyectable para pruebas deterministas) */
  readonly nowProvider?: () => Date;
}

/**
 * Configuración criptográfica consolidada del backend de autenticación de SiteCorp.
 */
export interface AuthCryptoConfig {
  readonly environment: "development" | "test" | "production";
  readonly argon2id: Argon2idConfig;
  readonly jwt: JwtServiceConfig;
}

export const JWT_SAFE_BOUNDS = Object.freeze({
  minAccessTokenTtlSeconds: 60, // 1 minuto mínimo
  maxAccessTokenTtlSeconds: 3600, // 60 minutos máximo para JWT stateless
  maxClockToleranceSeconds: 60,
});

const KID_REGEX = /^[A-Za-z0-9_.:-]{2,128}$/;

/**
 * Valida que los parámetros de Argon2id estén dentro de cotas seguras contra
 * configuraciones débiles o ataques de denegación de servicio (OOM / CPU exhaustion).
 */
export function validateArgon2idConfig(
  partial?: Partial<Argon2idConfig>
): Argon2idConfig {
  const config: Argon2idConfig = {
    memoryCostKiB: partial?.memoryCostKiB ?? DEFAULT_ARGON2ID_CONFIG.memoryCostKiB,
    timeCost: partial?.timeCost ?? DEFAULT_ARGON2ID_CONFIG.timeCost,
    parallelism: partial?.parallelism ?? DEFAULT_ARGON2ID_CONFIG.parallelism,
    outputLen: partial?.outputLen ?? DEFAULT_ARGON2ID_CONFIG.outputLen,
    maxPasswordBytes:
      partial?.maxPasswordBytes ?? DEFAULT_ARGON2ID_CONFIG.maxPasswordBytes,
  };

  if (
    !Number.isInteger(config.memoryCostKiB) ||
    config.memoryCostKiB < ARGON2ID_SAFE_BOUNDS.minMemoryCostKiB ||
    config.memoryCostKiB > ARGON2ID_SAFE_BOUNDS.maxMemoryCostKiB
  ) {
    throw new CryptoConfigurationError(
      `Argon2id memoryCostKiB debe ser un entero entre ${ARGON2ID_SAFE_BOUNDS.minMemoryCostKiB} y ${ARGON2ID_SAFE_BOUNDS.maxMemoryCostKiB} KiB.`
    );
  }

  if (
    !Number.isInteger(config.timeCost) ||
    config.timeCost < ARGON2ID_SAFE_BOUNDS.minTimeCost ||
    config.timeCost > ARGON2ID_SAFE_BOUNDS.maxTimeCost
  ) {
    throw new CryptoConfigurationError(
      `Argon2id timeCost debe ser un entero entre ${ARGON2ID_SAFE_BOUNDS.minTimeCost} y ${ARGON2ID_SAFE_BOUNDS.maxTimeCost}.`
    );
  }

  if (
    !Number.isInteger(config.parallelism) ||
    config.parallelism < ARGON2ID_SAFE_BOUNDS.minParallelism ||
    config.parallelism > ARGON2ID_SAFE_BOUNDS.maxParallelism
  ) {
    throw new CryptoConfigurationError(
      `Argon2id parallelism debe ser un entero entre ${ARGON2ID_SAFE_BOUNDS.minParallelism} y ${ARGON2ID_SAFE_BOUNDS.maxParallelism}.`
    );
  }

  if (
    !Number.isInteger(config.outputLen) ||
    config.outputLen < ARGON2ID_SAFE_BOUNDS.minOutputLen ||
    config.outputLen > ARGON2ID_SAFE_BOUNDS.maxOutputLen
  ) {
    throw new CryptoConfigurationError(
      `Argon2id outputLen debe ser un entero entre ${ARGON2ID_SAFE_BOUNDS.minOutputLen} y ${ARGON2ID_SAFE_BOUNDS.maxOutputLen} bytes.`
    );
  }

  if (
    !Number.isInteger(config.maxPasswordBytes) ||
    config.maxPasswordBytes < ARGON2ID_SAFE_BOUNDS.minMaxPasswordBytes ||
    config.maxPasswordBytes > ARGON2ID_SAFE_BOUNDS.maxMaxPasswordBytes
  ) {
    throw new CryptoConfigurationError(
      `Argon2id maxPasswordBytes debe ser un entero entre ${ARGON2ID_SAFE_BOUNDS.minMaxPasswordBytes} y ${ARGON2ID_SAFE_BOUNDS.maxMaxPasswordBytes} bytes.`
    );
  }

  return Object.freeze(config);
}

/**
 * Valida la configuración del servicio JWT incluyendo la verificación criptográfica
 * de claves Ed25519 y su correspondencia matemática, sin exponer jamás material de
 * claves privadas en los mensajes de error.
 */
export function validateJwtServiceConfig(config: JwtServiceConfig): JwtServiceConfig {
  if (!config || typeof config !== "object") {
    throw new CryptoConfigurationError("La configuración de JWT es obligatoria.");
  }

  const issuer = typeof config.issuer === "string" ? config.issuer.trim() : "";
  const audience = typeof config.audience === "string" ? config.audience.trim() : "";

  if (issuer.length < 3 || issuer.length > 255 || /\s/.test(issuer)) {
    throw new CryptoConfigurationError(
      "JWT issuer ('iss') es obligatorio, sin espacios y debe tener entre 3 y 255 caracteres."
    );
  }

  if (audience.length < 3 || audience.length > 255 || /\s/.test(audience)) {
    throw new CryptoConfigurationError(
      "JWT audience ('aud') es obligatorio, sin espacios y debe tener entre 3 y 255 caracteres."
    );
  }

  if (
    !Number.isInteger(config.accessTokenTtlSeconds) ||
    config.accessTokenTtlSeconds < JWT_SAFE_BOUNDS.minAccessTokenTtlSeconds ||
    config.accessTokenTtlSeconds > JWT_SAFE_BOUNDS.maxAccessTokenTtlSeconds
  ) {
    throw new CryptoConfigurationError(
      `JWT accessTokenTtlSeconds debe ser un entero entre ${JWT_SAFE_BOUNDS.minAccessTokenTtlSeconds} y ${JWT_SAFE_BOUNDS.maxAccessTokenTtlSeconds} segundos.`
    );
  }

  const clockToleranceSeconds = config.clockToleranceSeconds ?? 0;
  if (
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > JWT_SAFE_BOUNDS.maxClockToleranceSeconds
  ) {
    throw new CryptoConfigurationError(
      `JWT clockToleranceSeconds debe ser un entero entre 0 y ${JWT_SAFE_BOUNDS.maxClockToleranceSeconds} segundos.`
    );
  }

  if (!config.activeSigningKey || typeof config.activeSigningKey !== "object") {
    throw new CryptoConfigurationError("JWT activeSigningKey es obligatoria.");
  }

  const activeKid =
    typeof config.activeSigningKey.kid === "string"
      ? config.activeSigningKey.kid.trim()
      : "";
  if (!KID_REGEX.test(activeKid)) {
    throw new CryptoConfigurationError(
      "JWT activeSigningKey.kid es obligatorio (2..128 caracteres alfanuméricos, '_', '.', ':' o '-')."
    );
  }

  const privatePem =
    typeof config.activeSigningKey.privateKeyPem === "string"
      ? config.activeSigningKey.privateKeyPem.trim()
      : "";
  if (!privatePem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new CryptoConfigurationError(
      "JWT activeSigningKey.privateKeyPem debe ser una clave privada PKCS#8 en formato PEM."
    );
  }

  const publicPem =
    typeof config.activeSigningKey.publicKeyPem === "string"
      ? config.activeSigningKey.publicKeyPem.trim()
      : "";
  if (!publicPem.includes("-----BEGIN PUBLIC KEY-----")) {
    throw new CryptoConfigurationError(
      "JWT activeSigningKey.publicKeyPem debe ser una clave pública SPKI en formato PEM."
    );
  }

  // Validación criptográfica real de par de claves Ed25519 sin filtrar el contenido PEM en errores
  let privateKeyObj: KeyObject;
  let publicKeyObj: KeyObject;
  try {
    privateKeyObj = createPrivateKey({
      key: privatePem,
      format: "pem",
      type: "pkcs8",
    });
    publicKeyObj = createPublicKey({
      key: publicPem,
      format: "pem",
      type: "spki",
    });
  } catch {
    throw new CryptoConfigurationError(
      "No se pudo parsear criptográficamente el par de claves PEM de activeSigningKey."
    );
  }

  if (
    privateKeyObj.asymmetricKeyType !== "ed25519" ||
    publicKeyObj.asymmetricKeyType !== "ed25519"
  ) {
    throw new CryptoConfigurationError(
      "Se requieren exclusivamente claves asimétricas Ed25519 (EdDSA)."
    );
  }

  const derivedPublicPem = createPublicKey(privateKeyObj)
    .export({ type: "spki", format: "pem" })
    .toString()
    .trim();
  const canonicalActivePublicPem = publicKeyObj
    .export({ type: "spki", format: "pem" })
    .toString()
    .trim();

  if (derivedPublicPem !== canonicalActivePublicPem) {
    throw new CryptoConfigurationError(
      "La clave pública configurada en activeSigningKey no corresponde matemáticamente a su clave privada Ed25519."
    );
  }

  const seenKids = new Set<string>([activeKid]);
  const seenPublicPems = new Set<string>([canonicalActivePublicPem]);
  const additionalKeys: JwtVerificationKeyConfig[] = [];

  for (const extraKey of config.additionalVerificationKeys ?? []) {
    const extraKid = typeof extraKey?.kid === "string" ? extraKey.kid.trim() : "";
    const extraPub =
      typeof extraKey?.publicKeyPem === "string" ? extraKey.publicKeyPem.trim() : "";

    if (!KID_REGEX.test(extraKid)) {
      throw new CryptoConfigurationError(
        "Toda clave en additionalVerificationKeys debe incluir un 'kid' válido (2..128 caracteres)."
      );
    }
    if (seenKids.has(extraKid)) {
      throw new CryptoConfigurationError(
        `Identificador de clave JWT ('kid') duplicado en el llavero: '${extraKid}'.`
      );
    }
    if (!extraPub.includes("-----BEGIN PUBLIC KEY-----")) {
      throw new CryptoConfigurationError(
        `La clave pública para el 'kid' '${extraKid}' debe estar en formato SPKI PEM.`
      );
    }

    let extraPubObj: KeyObject;
    try {
      extraPubObj = createPublicKey({
        key: extraPub,
        format: "pem",
        type: "spki",
      });
    } catch {
      throw new CryptoConfigurationError(
        `No se pudo parsear la clave pública adicional con kid '${extraKid}'.`
      );
    }

    if (extraPubObj.asymmetricKeyType !== "ed25519") {
      throw new CryptoConfigurationError(
        `La clave pública adicional con kid '${extraKid}' no es una clave Ed25519 válida.`
      );
    }

    const canonicalExtraPubPem = extraPubObj
      .export({ type: "spki", format: "pem" })
      .toString()
      .trim();

    if (seenPublicPems.has(canonicalExtraPubPem)) {
      throw new CryptoConfigurationError(
        `El material de la clave pública con kid '${extraKid}' está duplicado en el llavero.`
      );
    }

    seenKids.add(extraKid);
    seenPublicPems.add(canonicalExtraPubPem);
    additionalKeys.push(
      Object.freeze({ kid: extraKid, publicKeyPem: canonicalExtraPubPem })
    );
  }

  return Object.freeze({
    issuer,
    audience,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    clockToleranceSeconds,
    requireSessionId: config.requireSessionId ?? false,
    activeSigningKey: Object.freeze({
      kid: activeKid,
      privateKeyPem: privatePem,
      publicKeyPem: canonicalActivePublicPem,
    }),
    additionalVerificationKeys: Object.freeze(additionalKeys),
    nowProvider: config.nowProvider,
  });
}

const ALLOWED_ENVIRONMENTS = new Set(["development", "test", "production"]);

/**
 * Carga y valida la configuración criptográfica desde un diccionario de variables de entorno
 * (por ejemplo `process.env`) sin almacenar secretos en el repositorio.
 *
 * En entorno `"production"`, exige explícitamente `SITECORP_JWT_ISSUER`,
 * `SITECORP_JWT_AUDIENCE`, `SITECORP_JWT_ACTIVE_KID`, `SITECORP_JWT_PRIVATE_KEY_PEM`
 * y `SITECORP_JWT_PUBLIC_KEY_PEM` (fallando de forma cerrada ante configuración incompleta).
 */
export function loadCryptoConfigFromEnv(
  env: Record<string, string | undefined>
): AuthCryptoConfig {
  if (!env || typeof env !== "object") {
    throw new CryptoConfigurationError(
      "El diccionario de variables de entorno es obligatorio."
    );
  }

  const rawEnvInput = env.SITECORP_AUTH_ENV ?? env.NODE_ENV;
  const rawEnv =
    rawEnvInput === undefined || rawEnvInput.trim() === ""
      ? "development"
      : rawEnvInput.trim();

  if (!ALLOWED_ENVIRONMENTS.has(rawEnv)) {
    throw new CryptoConfigurationError(
      "El entorno configurado ('SITECORP_AUTH_ENV' / 'NODE_ENV') es inválido. Valores permitidos: 'development', 'test', 'production'."
    );
  }

  const environment = rawEnv as "development" | "test" | "production";

  const normalizePem = (val: string | undefined): string =>
    (val ?? "").replace(/\\n/g, "\n").trim();

  const parseOptionalInt = (
    raw: string | undefined,
    fallback: number,
    name: string
  ): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed)) {
      throw new CryptoConfigurationError(
        `La variable '${name}' debe ser un número entero válido.`
      );
    }
    return parsed;
  };

  if (environment === "production") {
    if (!env.SITECORP_JWT_ISSUER || env.SITECORP_JWT_ISSUER.trim() === "") {
      throw new CryptoConfigurationError(
        "En producción es obligatorio definir explícitamente 'SITECORP_JWT_ISSUER'."
      );
    }
    if (!env.SITECORP_JWT_AUDIENCE || env.SITECORP_JWT_AUDIENCE.trim() === "") {
      throw new CryptoConfigurationError(
        "En producción es obligatorio definir explícitamente 'SITECORP_JWT_AUDIENCE'."
      );
    }
    if (!env.SITECORP_JWT_ACTIVE_KID || env.SITECORP_JWT_ACTIVE_KID.trim() === "") {
      throw new CryptoConfigurationError(
        "En producción es obligatorio definir explícitamente 'SITECORP_JWT_ACTIVE_KID'."
      );
    }
    if (
      !env.SITECORP_JWT_PRIVATE_KEY_PEM ||
      env.SITECORP_JWT_PRIVATE_KEY_PEM.trim() === ""
    ) {
      throw new CryptoConfigurationError(
        "En producción es obligatorio definir 'SITECORP_JWT_PRIVATE_KEY_PEM'."
      );
    }
    if (
      !env.SITECORP_JWT_PUBLIC_KEY_PEM ||
      env.SITECORP_JWT_PUBLIC_KEY_PEM.trim() === ""
    ) {
      throw new CryptoConfigurationError(
        "En producción es obligatorio definir 'SITECORP_JWT_PUBLIC_KEY_PEM'."
      );
    }
  }

  let additionalVerificationKeys: JwtVerificationKeyConfig[] = [];
  if (
    env.SITECORP_JWT_ADDITIONAL_PUBLIC_KEYS_JSON &&
    env.SITECORP_JWT_ADDITIONAL_PUBLIC_KEYS_JSON.trim() !== ""
  ) {
    try {
      const parsed = JSON.parse(
        env.SITECORP_JWT_ADDITIONAL_PUBLIC_KEYS_JSON
      ) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("No es un arreglo JSON.");
      }
      additionalVerificationKeys = parsed.map((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return {
          kid: typeof obj?.kid === "string" ? obj.kid : "",
          publicKeyPem:
            typeof obj?.publicKeyPem === "string"
              ? normalizePem(obj.publicKeyPem)
              : "",
        };
      });
    } catch {
      throw new CryptoConfigurationError(
        "La variable 'SITECORP_JWT_ADDITIONAL_PUBLIC_KEYS_JSON' no contiene un JSON válido de claves públicas."
      );
    }
  }

  const argon2id = validateArgon2idConfig({
    memoryCostKiB: parseOptionalInt(
      env.SITECORP_ARGON2_MEMORY_KIB,
      DEFAULT_ARGON2ID_CONFIG.memoryCostKiB,
      "SITECORP_ARGON2_MEMORY_KIB"
    ),
    timeCost: parseOptionalInt(
      env.SITECORP_ARGON2_TIME_COST,
      DEFAULT_ARGON2ID_CONFIG.timeCost,
      "SITECORP_ARGON2_TIME_COST"
    ),
    parallelism: parseOptionalInt(
      env.SITECORP_ARGON2_PARALLELISM,
      DEFAULT_ARGON2ID_CONFIG.parallelism,
      "SITECORP_ARGON2_PARALLELISM"
    ),
  });

  if (
    environment === "production" &&
    env.SITECORP_JWT_REQUIRE_SESSION_ID !== undefined &&
    env.SITECORP_JWT_REQUIRE_SESSION_ID.trim().toLowerCase() !== "true"
  ) {
    throw new CryptoConfigurationError(
      "En producción 'requireSessionId' debe ser obligatoriamente true; no se permite desactivar 'SITECORP_JWT_REQUIRE_SESSION_ID'."
    );
  }

  const requireSessionId =
    environment === "production"
      ? true
      : env.SITECORP_JWT_REQUIRE_SESSION_ID?.trim().toLowerCase() === "true";

  const jwt = validateJwtServiceConfig({
    issuer: env.SITECORP_JWT_ISSUER ?? "urn:sitecorp:auth-api",
    audience: env.SITECORP_JWT_AUDIENCE ?? "urn:sitecorp:api",
    accessTokenTtlSeconds: parseOptionalInt(
      env.SITECORP_JWT_ACCESS_TTL_SECONDS,
      900,
      "SITECORP_JWT_ACCESS_TTL_SECONDS"
    ),
    requireSessionId,
    activeSigningKey: {
      kid: env.SITECORP_JWT_ACTIVE_KID ?? "",
      privateKeyPem: normalizePem(env.SITECORP_JWT_PRIVATE_KEY_PEM),
      publicKeyPem: normalizePem(env.SITECORP_JWT_PUBLIC_KEY_PEM),
    },
    additionalVerificationKeys,
  });

  return Object.freeze({
    environment,
    argon2id,
    jwt,
  });
}

/**
 * Genera un par de claves asimétricas Ed25519 efímeras en memoria para pruebas automatizadas.
 *
 * PROHIBIDO EN PRODUCCIÓN: Sólo permite `environment` en `"test"` o `"development"`.
 * Lanza `CryptoConfigurationError` si se invoca en `"production"` o con cualquier
 * entorno desconocido, garantizando fallo cerrado (fail-closed).
 */
export function generateEphemeralEd25519KeyPair(
  kid: string = "ed25519-test-key-v1",
  environment: string = process.env.SITECORP_AUTH_ENV ?? process.env.NODE_ENV ?? "test"
): JwtSigningKeyConfig {
  const normalizedEnv =
    typeof environment === "string" ? environment.trim().toLowerCase() : "";

  if (normalizedEnv !== "test" && normalizedEnv !== "development") {
    throw new CryptoConfigurationError(
      "No se permite generar claves Ed25519 efímeras fuera de los entornos 'test' o 'development'."
    );
  }

  const trimmedKid = typeof kid === "string" ? kid.trim() : "";
  if (!KID_REGEX.test(trimmedKid)) {
    throw new CryptoConfigurationError(
      "El 'kid' de la clave efímera debe tener entre 2 y 128 caracteres válidos."
    );
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return Object.freeze({
    kid: trimmedKid,
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
  });
}
