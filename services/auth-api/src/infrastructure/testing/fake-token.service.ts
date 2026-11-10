import { createHash, randomBytes } from "node:crypto";
import {
  ITokenService,
  AccessTokenPayload,
  SignedToken,
  OpaqueToken,
} from "../../interfaces";
import { TokenInvalidError } from "../../domain";

/**
 * @warning TEST DOUBLE ONLY — NOT SUITABLE FOR PRODUCTION
 *
 * Emite y valida tokens de prueba sin criptografía asimétrica real.
 * En producción se utilizará el estándar RFC 7519 (JWT con firma HMAC-SHA256 / Ed25519).
 */
export class FakeTokenService implements ITokenService {
  async signAccessToken(
    payload: Omit<AccessTokenPayload, "iat" | "exp">
  ): Promise<SignedToken> {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 3600;

    const fullPayload: AccessTokenPayload = {
      ...payload,
      sub: payload.sub as AccessTokenPayload["sub"],
      email: payload.email as AccessTokenPayload["email"],
      role: payload.role as AccessTokenPayload["role"],
      iat: nowSec,
      exp: expSec,
    };

    const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
    const fakeSignature = createHash("sha256")
      .update(`${encodedHeader}.${encodedPayload}.fake_secret`)
      .digest("hex");

    return {
      token: `${encodedHeader}.${encodedPayload}.${fakeSignature}`,
      tokenType: "Bearer",
      expiresInSeconds: 3600,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      throw new TokenInvalidError("El formato del access token es inválido.");
    }

    try {
      const decodedJson = Buffer.from(parts[1], "base64url").toString("utf-8");
      const payload = JSON.parse(decodedJson) as AccessTokenPayload;

      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        throw new TokenInvalidError("El access token ha expirado.");
      }

      return payload;
    } catch (err) {
      if (err instanceof TokenInvalidError) throw err;
      throw new TokenInvalidError("No se pudo decodificar el access token.");
    }
  }

  generateOpaqueToken(): OpaqueToken {
    const rawToken = `sct_${randomBytes(32).toString("hex")}`;
    const tokenHash = this.hashOpaqueToken(rawToken);
    return {
      rawToken,
      tokenHash,
    };
  }

  hashOpaqueToken(rawToken: string): string {
    return createHash("sha256").update(rawToken.trim()).digest("hex");
  }
}
