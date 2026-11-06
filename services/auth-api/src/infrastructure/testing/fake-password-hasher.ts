import { createHash } from "node:crypto";
import { IPasswordHasher } from "../../interfaces";

/**
 * @warning TEST DOUBLE ONLY — NOT SUITABLE FOR PRODUCTION
 *
 * Este adaptador es exclusivo para pruebas unitarias e integración en memoria.
 * En producción se utilizará Argon2id conforme a RFC 9106 con parámetros OWASP.
 */
export class FakePasswordHasher implements IPasswordHasher {
  public readonly algorithm = "argon2id" as const;

  async hash(plainText: string): Promise<string> {
    const digest = createHash("sha256").update(`sitecorp_salt_${plainText}`).digest("hex");
    return `$fake_argon2id$v=19$${digest}`;
  }

  async verify(plainText: string, hash: string): Promise<boolean> {
    const expected = await this.hash(plainText);
    return expected === hash;
  }

  needsRehash(_hash: string): boolean {
    return false;
  }
}
