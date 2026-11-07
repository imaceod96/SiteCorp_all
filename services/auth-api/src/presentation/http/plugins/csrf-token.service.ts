import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "../../../domain";
import {
  CsrfConfig,
  HttpConfigurationError,
  HTTP_SAFE_BOUNDS,
} from "../../../infrastructure/config/http-config";
import { isValidSessionId } from "../../../infrastructure/crypto/jose-token.service";

export class CsrfValidationError extends DomainError {
  public readonly code = "CSRF_INVALID";
  constructor(
    message: string = "Validación de seguridad CSRF fallida o token inválido."
  ) {
    super(message);
  }
}

const CSRF_DOMAIN_SEPARATOR = "sitecorp_csrf_v1";
const NONCE_REGEX = /^[A-Za-z0-9_-]{22}$/; // 16 bytes en base64url sin padding = 22 chars
const IAT_HEX_REGEX = /^[0-9a-f]{1,16}$/;
const HMAC_B64URL_REGEX = /^[A-Za-z0-9_-]{43}$/; // SHA-256 (32 bytes) en base64url = 43 chars

export interface VerifyCsrfTokenInput {
  readonly headerToken: string | undefined | null;
  readonly cookieToken: string | undefined | null;
  readonly expectedSessionId: string;
  readonly now?: Date;
}

/**
 * Servicio criptográfico de protección CSRF basado en Double-Submit Cookie
 * firmado con HMAC-SHA256 y vinculado al identificador de sesión (`sid`).
 *
 * Formato del token: `<nonce_16B_b64url>.<issuedAt_hex>.<hmac_sha256_b64url>`
 * Entrada del MAC: `"sitecorp_csrf_v1|<sid>|<nonce>|<issuedAt_hex>"`
 *
 * Propiedades de seguridad:
 * - Nonce CSPRNG de 128 bits (`randomBytes(16)`).
 * - Vinculación criptográfica estricta a `sid`: un token válido de la Sesión A
 *   es rechazado si se presenta con la Sesión B.
 * - Sin secretos ni `sid` expuestos en claro en el token.
 * - Comparación en tiempo constante (`timingSafeEqual`) tanto entre cookie y header
 *   como en la verificación del digest HMAC-SHA256.
 * - TTL acotado (`ttlSeconds`) y rechazo de marcas temporales futuras.
 */
export class CsrfTokenService {
  private readonly secretKey: Buffer;
  private readonly ttlSeconds: number;
  private readonly nowProvider: () => Date;

  constructor(config: CsrfConfig, nowProvider: () => Date = () => new Date()) {
    if (!config || typeof config.hmacSecret !== "string") {
      throw new HttpConfigurationError("El secreto HMAC de CSRF es obligatorio.");
    }
    const trimmedSecret = config.hmacSecret.trim();
    const secretBuf = Buffer.from(trimmedSecret, "utf8");
    if (secretBuf.byteLength < HTTP_SAFE_BOUNDS.minCsrfSecretBytes) {
      throw new HttpConfigurationError(
        `El secreto HMAC de CSRF debe tener al menos ${HTTP_SAFE_BOUNDS.minCsrfSecretBytes} bytes.`
      );
    }

    if (
      !Number.isInteger(config.ttlSeconds) ||
      config.ttlSeconds < HTTP_SAFE_BOUNDS.minCsrfTtlSeconds ||
      config.ttlSeconds > HTTP_SAFE_BOUNDS.maxCsrfTtlSeconds
    ) {
      throw new HttpConfigurationError(
        `El TTL de CSRF debe ser un entero entre ${HTTP_SAFE_BOUNDS.minCsrfTtlSeconds} y ${HTTP_SAFE_BOUNDS.maxCsrfTtlSeconds} segundos.`
      );
    }

    this.secretKey = secretBuf;
    this.ttlSeconds = config.ttlSeconds;
    this.nowProvider = nowProvider;
  }

  private computeHmacBase64Url(
    sessionId: string,
    nonce: string,
    iatHex: string
  ): string {
    const payload = `${CSRF_DOMAIN_SEPARATOR}|${sessionId}|${nonce}|${iatHex}`;
    return createHmac("sha256", this.secretKey)
      .update(payload, "utf8")
      .digest("base64url");
  }

  private static constantTimeStringEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.byteLength !== bufB.byteLength) {
      // Ejecutar comparación ficticia del mismo tamaño que bufA para no filtrar por corto-circuito
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Genera un nuevo token CSRF firmado y vinculado a `sessionId` (`sid`).
   */
  public generateToken(sessionId: string, now?: Date): string {
    if (!isValidSessionId(sessionId)) {
      throw new CsrfValidationError(
        "No se puede generar un token CSRF sin un identificador de sesión ('sid') válido."
      );
    }

    const currentNow = now ?? this.nowProvider();
    const nowSeconds = Math.floor(currentNow.getTime() / 1000);
    if (!Number.isFinite(nowSeconds) || nowSeconds <= 0) {
      throw new CsrfValidationError("Marca temporal inválida para token CSRF.");
    }

    const nonce = randomBytes(16).toString("base64url");
    const iatHex = nowSeconds.toString(16);
    const mac = this.computeHmacBase64Url(sessionId, nonce, iatHex);

    return `${nonce}.${iatHex}.${mac}`;
  }

  /**
   * Verifica de forma constante y determinista que:
   * 1. `headerToken` y `cookieToken` existan y sean idénticos en tiempo constante.
   * 2. El formato `<nonce>.<iatHex>.<hmac>` sea estricto.
   * 3. La marca temporal no esté en el futuro ni haya superado `ttlSeconds`.
   * 4. El HMAC-SHA256 coincida en tiempo constante con `expectedSessionId`.
   */
  public verifyToken(input: VerifyCsrfTokenInput): void {
    const { headerToken, cookieToken, expectedSessionId } = input;

    if (!isValidSessionId(expectedSessionId)) {
      throw new CsrfValidationError(
        "El identificador de sesión esperado para verificación CSRF no es válido."
      );
    }

    if (
      typeof headerToken !== "string" ||
      typeof cookieToken !== "string" ||
      headerToken.length === 0 ||
      cookieToken.length === 0 ||
      headerToken.length > 256 ||
      cookieToken.length > 256
    ) {
      throw new CsrfValidationError(
        "Falta el token CSRF en la cabecera o en la cookie."
      );
    }

    // 1. Comparar en tiempo constante header vs cookie
    const tokensMatch = CsrfTokenService.constantTimeStringEquals(
      headerToken,
      cookieToken
    );
    if (!tokensMatch) {
      throw new CsrfValidationError(
        "El token CSRF de la cabecera no coincide con la cookie CSRF."
      );
    }

    // 2. Validar formato estricto de 3 segmentos
    const parts = headerToken.split(".");
    if (parts.length !== 3) {
      throw new CsrfValidationError("Formato de token CSRF malformado.");
    }

    const [nonce, iatHex, providedMac] = parts as [string, string, string];
    if (
      !NONCE_REGEX.test(nonce) ||
      !IAT_HEX_REGEX.test(iatHex) ||
      !HMAC_B64URL_REGEX.test(providedMac)
    ) {
      throw new CsrfValidationError("Estructura de segmentos CSRF inválida.");
    }

    // 3. Verificar firma HMAC-SHA256 vinculada a `expectedSessionId` ANTES de revelar expiración
    const expectedMac = this.computeHmacBase64Url(
      expectedSessionId,
      nonce,
      iatHex
    );
    const macMatches = CsrfTokenService.constantTimeStringEquals(
      providedMac,
      expectedMac
    );
    if (!macMatches) {
      throw new CsrfValidationError(
        "Firma criptográfica CSRF inválida o token perteneciente a otra sesión."
      );
    }

    // 4. Verificar vigencia temporal (`iat` y `ttlSeconds`)
    const issuedAtSeconds = Number.parseInt(iatHex, 16);
    const currentNow = input.now ?? this.nowProvider();
    const nowSeconds = Math.floor(currentNow.getTime() / 1000);
    const maxClockSkewSeconds = 5;

    if (
      !Number.isSafeInteger(issuedAtSeconds) ||
      issuedAtSeconds <= 0 ||
      issuedAtSeconds > nowSeconds + maxClockSkewSeconds
    ) {
      throw new CsrfValidationError(
        "Marca temporal del token CSRF inválida."
      );
    }

    if (nowSeconds - issuedAtSeconds > this.ttlSeconds) {
      throw new CsrfValidationError("El token CSRF ha expirado.");
    }
  }

  /**
   * Verifica en tiempo constante la igualdad entre `headerToken` y `cookieToken`,
   * el formato estricto de 3 segmentos (`<nonce_22>.<iatHex>.<hmac_43>`) y la
   * vigencia temporal del token cuando la cookie de refresco ya no existe en BD.
   */
  public verifyTokenFormatAndEquality(input: {
    readonly headerToken: string | undefined | null;
    readonly cookieToken: string | undefined | null;
    readonly now?: Date;
  }): void {
    const { headerToken, cookieToken } = input;

    if (
      typeof headerToken !== "string" ||
      typeof cookieToken !== "string" ||
      headerToken.length === 0 ||
      cookieToken.length === 0 ||
      headerToken.length > 256 ||
      cookieToken.length > 256
    ) {
      throw new CsrfValidationError(
        "Falta el token CSRF en la cabecera o en la cookie."
      );
    }

    const tokensMatch = CsrfTokenService.constantTimeStringEquals(
      headerToken,
      cookieToken
    );
    if (!tokensMatch) {
      throw new CsrfValidationError(
        "El token CSRF de la cabecera no coincide con la cookie CSRF."
      );
    }

    const parts = headerToken.split(".");
    if (parts.length !== 3) {
      throw new CsrfValidationError("Formato de token CSRF malformado.");
    }

    const [nonce, iatHex, providedMac] = parts as [string, string, string];
    if (
      !NONCE_REGEX.test(nonce) ||
      !IAT_HEX_REGEX.test(iatHex) ||
      !HMAC_B64URL_REGEX.test(providedMac)
    ) {
      throw new CsrfValidationError("Estructura de segmentos CSRF inválida.");
    }

    const issuedAtSeconds = Number.parseInt(iatHex, 16);
    const currentNow = input.now ?? this.nowProvider();
    const nowSeconds = Math.floor(currentNow.getTime() / 1000);
    const maxClockSkewSeconds = 5;

    if (
      !Number.isSafeInteger(issuedAtSeconds) ||
      issuedAtSeconds <= 0 ||
      issuedAtSeconds > nowSeconds + maxClockSkewSeconds
    ) {
      throw new CsrfValidationError(
        "Marca temporal del token CSRF inválida."
      );
    }

    if (nowSeconds - issuedAtSeconds > this.ttlSeconds) {
      throw new CsrfValidationError("El token CSRF ha expirado.");
    }
  }
}

/**
 * Extrae y valida que el `Origin` (o `Referer` como fallback) de una petición
 * coincida con la lista blanca `allowedOrigins`.
 *
 * - Si `requireOriginHeader` es `true` (para rutas que autentican mediante cookie como `/refresh` o `/logout`),
 *   la ausencia de ambas cabeceras `Origin` y `Referer` lanza `CsrfValidationError` (fail-closed).
 * - Si `requireOriginHeader` es `false` (para rutas con `Bearer` o `/login` sin cookies),
 *   valida el origen siempre que alguna de las dos cabeceras esté presente.
 */
export function verifyRequestOrigin(options: {
  readonly originHeader: string | string[] | undefined;
  readonly refererHeader: string | string[] | undefined;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly requireOriginHeader: boolean;
}): void {
  const { originHeader, refererHeader, allowedOrigins, requireOriginHeader } =
    options;

  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const rawReferer = Array.isArray(refererHeader)
    ? refererHeader[0]
    : refererHeader;

  let extractedOrigin: string | null = null;

  if (typeof rawOrigin === "string" && rawOrigin.trim() !== "") {
    const trimmed = rawOrigin.trim();
    if (trimmed === "null") {
      throw new CsrfValidationError(
        "El origen 'null' (sandboxed/opaque origin) no está autorizado."
      );
    }
    try {
      extractedOrigin = new URL(trimmed).origin;
    } catch {
      throw new CsrfValidationError("Cabecera 'Origin' malformada.");
    }
  } else if (typeof rawReferer === "string" && rawReferer.trim() !== "") {
    try {
      extractedOrigin = new URL(rawReferer.trim()).origin;
    } catch {
      throw new CsrfValidationError("Cabecera 'Referer' malformada.");
    }
  }

  if (extractedOrigin === null) {
    if (requireOriginHeader) {
      throw new CsrfValidationError(
        "Se requiere cabecera 'Origin' o 'Referer' válida para operaciones con cookies."
      );
    }
    return;
  }

  if (!allowedOrigins.has(extractedOrigin)) {
    throw new CsrfValidationError(
      "El origen de la solicitud no se encuentra en la lista blanca autorizada."
    );
  }
}
