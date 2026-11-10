import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, decodeProtectedHeader, errors, jwtVerify } from "jose";
import {
  TokenExpiredError,
  TokenInvalidError,
  createEmail,
  createUserId,
  isValidEmail,
  isValidUserId,
} from "../../domain";
import {
  AccessTokenPayload,
  ITokenService,
  OpaqueToken,
  SignedToken,
} from "../../interfaces";
import {
  JwtServiceConfig,
  validateJwtServiceConfig,
} from "../config/crypto-config";

const ALLOWED_ACCESS_ROLES = new Set(["authenticated", "pending_password_change"]);
const ALLOWED_ACCESS_SCOPES = new Set(["api:full", "auth:change_password"]);
const OPAQUE_TOKEN_BYTE_LENGTH = 32; // 256 bits de entropía CSPRNG
const OPAQUE_TOKEN_PREFIX = "sct_";
const OPAQUE_TOKEN_REGEX = /^sct_([A-Za-z0-9_-]{43})$/;
const MAX_JWT_LENGTH_BYTES = 4096;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const UUID_V4_JTI_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_REGEX = /^sess_[A-Za-z0-9_-]{4,120}$/;

/**
 * Valida que un identificador de sesión (`sid`) tenga el formato canónico del backend
 * (`sess_<identificador>`), sin espacios, caracteres de control ni inyecciones.
 */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_REGEX.test(value);
}

/**
 * Servicio real de emisión/verificación de Access Tokens JWT (EdDSA / Ed25519) y
 * generación de Refresh Tokens opacos CSPRNG + hash SHA-256.
 *
 * Decisiones de seguridad y arquitectura:
 * 1. Algoritmo asimétrico exclusivo: `EdDSA` sobre curva `Ed25519`.
 *    - El servicio firma con clave privada (`PKCS#8`) y verifica con un llavero de claves
 *      públicas (`SPKI`) indexado por `kid`.
 *    - Previene ataques de confusión de algoritmo (`HS256` con clave pública) y rechaza
 *      explícitamente `alg: "none"` o cualquier algoritmo distinto de `EdDSA`.
 * 2. Vinculación inequívoca con la sesión del backend (`sid`):
 *    - `LoginUseCase` y `RefreshSessionUseCase` vinculan el `session.id` (`sess_<uuid>`) en el
 *      claim `sid` del JWT firmado.
 *    - `JoseTokenService` valida estrictamente el formato de `sid` y descarta cualquier claim
 *      no canónico o privilegio inyectado por el cliente.
 * 3. Relación con la revocación de sesiones en PostgreSQL:
 *    - `verifyAccessToken()` realiza la verificación criptográfica y estructural stateless.
 *    - La revocación de una sesión en PostgreSQL (por `LogoutUseCase`, `ChangePasswordUseCase`,
 *      `AdminUpdateStatusUseCase` o detección de reuso en `RefreshSessionUseCase`) detiene de
 *      inmediato la rotación en `/refresh`, pero NO invalida mágicamente un JWT stateless antes
 *      de su `exp` (`accessTokenTtlSeconds`, por defecto 900s = 15 min) salvo que el endpoint
 *      protegido ejecute la comprobación de sesión mediante `verifyAccessTokenSessionState()`.
 * 4. Refresh tokens opacos:
 *    - Generados mediante `crypto.randomBytes(32)` (256 bits CSPRNG), codificados en `base64url`
 *      canónico con prefijo `sct_` (`^sct_[A-Za-z0-9_-]{43}$`), sin PII.
 *    - Validación estricta de formato antes de calcular `SHA-256` (`CHAR(64)` hex en minúsculas).
 */
export class JoseTokenService implements ITokenService {
  private readonly config: JwtServiceConfig;
  private readonly activeSigningKey: KeyObject;
  private readonly verificationKeysByKid: ReadonlyMap<string, KeyObject>;
  private readonly nowProvider: () => Date;

  constructor(rawConfig: JwtServiceConfig) {
    this.config = validateJwtServiceConfig(rawConfig);
    this.nowProvider = this.config.nowProvider ?? (() => new Date());

    this.activeSigningKey = createPrivateKey({
      key: this.config.activeSigningKey.privateKeyPem,
      format: "pem",
      type: "pkcs8",
    });

    const activePublicObj = createPublicKey({
      key: this.config.activeSigningKey.publicKeyPem,
      format: "pem",
      type: "spki",
    });

    const keyMap = new Map<string, KeyObject>();
    keyMap.set(this.config.activeSigningKey.kid, activePublicObj);

    for (const extra of this.config.additionalVerificationKeys ?? []) {
      const extraPubObj = createPublicKey({
        key: extra.publicKeyPem,
        format: "pem",
        type: "spki",
      });
      keyMap.set(extra.kid, extraPubObj);
    }

    this.verificationKeysByKid = keyMap;
  }

  /**
   * Comprueba que un refresh token opaco cumpla exactamente el formato `sct_<43 chars base64url>`
   * con codificación canónica de 32 bytes (256 bits de entropía).
   */
  public isValidOpaqueTokenFormat(rawToken: unknown): rawToken is string {
    if (typeof rawToken !== "string") {
      return false;
    }
    const match = OPAQUE_TOKEN_REGEX.exec(rawToken);
    if (!match || !match[1]) {
      return false;
    }
    const body = match[1];
    const decoded = Buffer.from(body, "base64url");
    return (
      decoded.byteLength === OPAQUE_TOKEN_BYTE_LENGTH &&
      decoded.toString("base64url") === body
    );
  }

  async signAccessToken(
    payload: Omit<AccessTokenPayload, "iat" | "exp">
  ): Promise<SignedToken> {
    if (!payload || typeof payload !== "object") {
      throw new TokenInvalidError("El payload del Access Token es obligatorio.");
    }

    if (!isValidUserId(payload.sub)) {
      throw new TokenInvalidError(
        "El claim 'sub' debe ser un identificador de usuario UUID v4 válido."
      );
    }

    if (!isValidEmail(payload.email)) {
      throw new TokenInvalidError("El claim 'email' debe tener un formato válido.");
    }

    if (
      typeof payload.role !== "string" ||
      !ALLOWED_ACCESS_ROLES.has(payload.role)
    ) {
      throw new TokenInvalidError(
        "El claim 'role' no pertenece al conjunto de roles de sesión permitidos."
      );
    }

    if (this.config.requireSessionId && payload.sid === undefined) {
      throw new TokenInvalidError(
        "El identificador de sesión ('sid') es obligatorio para emitir el Access Token."
      );
    }

    let canonicalSid: string | undefined;
    if (payload.sid !== undefined) {
      if (!isValidSessionId(payload.sid)) {
        throw new TokenInvalidError(
          "El identificador de sesión ('sid') no cumple el formato canónico requerido."
        );
      }
      canonicalSid = payload.sid;
    }

    const canonicalSub = createUserId(payload.sub);
    const canonicalEmail = createEmail(payload.email);
    const canonicalRole = payload.role;

    const defaultScope =
      canonicalRole === "pending_password_change"
        ? "auth:change_password"
        : "api:full";
    const requestedScope =
      typeof payload.scope === "string" ? payload.scope : defaultScope;

    if (!ALLOWED_ACCESS_SCOPES.has(requestedScope)) {
      throw new TokenInvalidError(
        "El claim 'scope' solicitado no es válido para emisión de Access Token."
      );
    }

    if (
      canonicalRole === "pending_password_change" &&
      requestedScope !== "auth:change_password"
    ) {
      throw new TokenInvalidError(
        "Un token con rol 'pending_password_change' sólo puede recibir el scope 'auth:change_password'."
      );
    }

    const nowSeconds = Math.floor(this.nowProvider().getTime() / 1000);
    const expSeconds = nowSeconds + this.config.accessTokenTtlSeconds;
    const jti = randomUUID();

    // Sólo se incluyen claims canónicos validados por el servidor; cualquier otro campo se descarta
    const claimsToSign: Record<string, string> = {
      email: canonicalEmail,
      role: canonicalRole,
      scope: requestedScope,
    };
    if (canonicalSid !== undefined) {
      claimsToSign.sid = canonicalSid;
    }

    const token = await new SignJWT(claimsToSign)
      .setProtectedHeader({
        alg: "EdDSA",
        typ: "JWT",
        kid: this.config.activeSigningKey.kid,
      })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setSubject(canonicalSub)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expSeconds)
      .setJti(jti)
      .sign(this.activeSigningKey);

    return {
      token,
      tokenType: "Bearer",
      expiresInSeconds: this.config.accessTokenTtlSeconds,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      Buffer.byteLength(token, "utf8") > MAX_JWT_LENGTH_BYTES
    ) {
      throw new TokenInvalidError("El formato del token de acceso es inválido.");
    }

    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      parts.some(
        (p) =>
          p.length === 0 ||
          Buffer.from(p, "base64url").toString("base64url") !== p
      )
    ) {
      throw new TokenInvalidError(
        "El token de acceso no cumple la estructura compacta JWS canónica de 3 segmentos."
      );
    }

    let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
    try {
      protectedHeader = decodeProtectedHeader(token);
    } catch {
      throw new TokenInvalidError(
        "No se pudo decodificar la cabecera protegida del token de acceso."
      );
    }

    // Fijación estricta de algoritmo y tipo de cabecera antes de buscar clave
    if (protectedHeader.alg !== "EdDSA") {
      throw new TokenInvalidError(
        "Algoritmo de firma JWT no permitido. Se requiere exclusivamente EdDSA."
      );
    }

    if (protectedHeader.typ !== "JWT") {
      throw new TokenInvalidError(
        "La cabecera protegida del token debe incluir explícitamente typ: 'JWT'."
      );
    }

    const kid =
      typeof protectedHeader.kid === "string" ? protectedHeader.kid.trim() : "";
    if (!kid) {
      throw new TokenInvalidError(
        "El token de acceso carece del identificador de clave ('kid') obligatorio."
      );
    }

    const verificationKey = this.verificationKeysByKid.get(kid);
    if (!verificationKey) {
      throw new TokenInvalidError(
        "El identificador de clave ('kid') del token no es reconocido."
      );
    }

    const requiredClaims = [
      "iss",
      "aud",
      "sub",
      "iat",
      "exp",
      "jti",
      "email",
      "role",
    ];
    if (this.config.requireSessionId) {
      requiredClaims.push("sid");
    }

    let verifiedPayload: Record<string, unknown>;
    try {
      const result = await jwtVerify(token, verificationKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ["EdDSA"],
        typ: "JWT",
        currentDate: this.nowProvider(),
        clockTolerance: this.config.clockToleranceSeconds ?? 0,
        requiredClaims,
      });
      verifiedPayload = result.payload as Record<string, unknown>;
    } catch (err: unknown) {
      if (err instanceof errors.JWTExpired) {
        throw new TokenExpiredError();
      }
      throw new TokenInvalidError();
    }

    const rawIss = verifiedPayload.iss;
    const rawAud = verifiedPayload.aud;
    const rawSub = verifiedPayload.sub;
    const rawEmail = verifiedPayload.email;
    const rawRole = verifiedPayload.role;
    const rawScope = verifiedPayload.scope;
    const rawSid = verifiedPayload.sid;
    const rawJti = verifiedPayload.jti;
    const rawIat = verifiedPayload.iat;
    const rawExp = verifiedPayload.exp;

    if (rawIss !== this.config.issuer || rawAud !== this.config.audience) {
      throw new TokenInvalidError(
        "Los claims 'iss' o 'aud' no coinciden exactamente con el contrato esperado."
      );
    }

    if (!isValidUserId(rawSub)) {
      throw new TokenInvalidError("El claim 'sub' del token verificado es inválido.");
    }

    if (!isValidEmail(rawEmail)) {
      throw new TokenInvalidError("El claim 'email' del token verificado es inválido.");
    }

    if (typeof rawRole !== "string" || !ALLOWED_ACCESS_ROLES.has(rawRole)) {
      throw new TokenInvalidError("El claim 'role' del token verificado es inválido.");
    }

    if (
      rawScope !== undefined &&
      (typeof rawScope !== "string" || !ALLOWED_ACCESS_SCOPES.has(rawScope))
    ) {
      throw new TokenInvalidError("El claim 'scope' del token verificado es inválido.");
    }

    const resolvedScope =
      typeof rawScope === "string"
        ? rawScope
        : rawRole === "pending_password_change"
          ? "auth:change_password"
          : "api:full";

    if (
      rawRole === "pending_password_change" &&
      resolvedScope !== "auth:change_password"
    ) {
      throw new TokenInvalidError(
        "Inconsistencia de seguridad entre 'role' y 'scope' en el token."
      );
    }

    if (this.config.requireSessionId && rawSid === undefined) {
      throw new TokenInvalidError(
        "El token de acceso carece del identificador de sesión ('sid') obligatorio."
      );
    }

    if (rawSid !== undefined && !isValidSessionId(rawSid)) {
      throw new TokenInvalidError(
        "El claim 'sid' del token verificado tiene un formato inválido."
      );
    }

    if (typeof rawJti !== "string" || !UUID_V4_JTI_REGEX.test(rawJti)) {
      throw new TokenInvalidError(
        "El claim 'jti' del token verificado debe ser un UUID v4 válido."
      );
    }

    if (
      typeof rawIat !== "number" ||
      !Number.isInteger(rawIat) ||
      typeof rawExp !== "number" ||
      !Number.isInteger(rawExp) ||
      rawExp <= rawIat ||
      rawExp - rawIat > this.config.accessTokenTtlSeconds
    ) {
      throw new TokenInvalidError(
        "Los claims temporales ('iat'/'exp') del token son inválidos o exceden el TTL máximo."
      );
    }

    const nowSeconds = Math.floor(this.nowProvider().getTime() / 1000);
    const tolerance = this.config.clockToleranceSeconds ?? 0;
    if (rawIat > nowSeconds + tolerance) {
      throw new TokenInvalidError(
        "El token tiene una fecha de emisión ('iat') en el futuro."
      );
    }

    const canonicalPayload: AccessTokenPayload = {
      sub: createUserId(rawSub),
      email: createEmail(rawEmail),
      role: rawRole,
      scope: resolvedScope,
      ...(rawSid !== undefined ? { sid: rawSid } : {}),
      jti: rawJti.toLowerCase(),
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: rawIat,
      exp: rawExp,
    };

    return Object.freeze(canonicalPayload);
  }

  generateOpaqueToken(): OpaqueToken {
    const entropy = randomBytes(OPAQUE_TOKEN_BYTE_LENGTH);
    const rawToken = `${OPAQUE_TOKEN_PREFIX}${entropy.toString("base64url")}`;
    const tokenHash = this.hashOpaqueToken(rawToken);

    return {
      rawToken,
      tokenHash,
    };
  }

  hashOpaqueToken(rawToken: string): string {
    if (!this.isValidOpaqueTokenFormat(rawToken)) {
      throw new TokenInvalidError(
        "El refresh token opaco es inválido o no cumple el formato CSPRNG de 256 bits ('sct_<base64url>')."
      );
    }

    return createHash("sha256").update(rawToken, "utf8").digest("hex");
  }

  /**
   * Compara en tiempo constante (constant-time) el hash SHA-256 de un refresh token
   * opaco recibido frente a un hash hexadecimal esperado de 64 caracteres.
   */
  verifyOpaqueTokenHash(rawToken: string, expectedHashHex: string): boolean {
    if (
      !this.isValidOpaqueTokenFormat(rawToken) ||
      typeof expectedHashHex !== "string" ||
      !SHA256_HEX_REGEX.test(expectedHashHex)
    ) {
      return false;
    }

    const actualDigest = createHash("sha256").update(rawToken, "utf8").digest();
    const expectedDigest = Buffer.from(expectedHashHex, "hex");

    if (actualDigest.byteLength !== expectedDigest.byteLength) {
      return false;
    }

    return timingSafeEqual(actualDigest, expectedDigest);
  }
}
