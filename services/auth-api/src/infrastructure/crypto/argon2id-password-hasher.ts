import { Algorithm, Version, hash, verify, parseOptions } from "@node-rs/argon2";
import { IPasswordHasher } from "../../interfaces";
import {
  Argon2idConfig,
  ARGON2ID_SAFE_BOUNDS,
  CryptoConfigurationError,
  validateArgon2idConfig,
} from "../config/crypto-config";

const PHC_ARGON2ID_PREFIX = "$argon2id$v=19$";
const PHC_UNPADDED_B64_REGEX = /^[A-Za-z0-9+/]+$/;
const FALLBACK_TIMING_PASSWORD = "__sitecorp_bounded_fallback_input_for_invalid_length__";

/**
 * Preimagen centinela utilizada únicamente para generar y demostrar en pruebas que
 * `DUMMY_ARGON2ID_HASH` es un hash Argon2id v=19 real, válido y matemáticamente verificable.
 * `LoginUseCase` ignora siempre el booleano devuelto al verificar contra `DUMMY_ARGON2ID_HASH`.
 */
export const DUMMY_ARGON2ID_PREIMAGE =
  "__sitecorp_anti_enumeration_dummy_preimage_v1__";

/**
 * Hash Argon2id v=19 real, válido y verificable (m=19456 KiB, t=2, p=1, sal CSPRNG de 16 bytes,
 * digest de 32 bytes) utilizado por `LoginUseCase` cuando el usuario no existe, está eliminado,
 * suspendido o bloqueado.
 *
 * LÍMITES FÍSICOS DE ANTI-ENUMERACIÓN POR TIEMPO:
 * - Ejecutar Argon2id real contra este hash elimina la diferencia macroscópica de órdenes de
 *   magnitud (~40-80ms de cómputo Argon2id vs <0.1ms si se omitiera el hash).
 * - Si `Argon2idPasswordHasher` se instancia con parámetros calibrados distintos de los valores
 *   por defecto (p.ej. `m=32768, t=3`), `verify()` genera y cachea perezosamente un hash dummy
 *   con los parámetros calibrados de la instancia para mantener el mismo coste computacional.
 * - No se promete igualdad matemática perfecta de tiempos de respuesta: existen variaciones
 *   físicas inevitables de planificación de CPU/hilos del sistema operativo y de I/O en PostgreSQL.
 */
export const DUMMY_ARGON2ID_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$29RXI0hXtMDRMmbe3/7zdg$OvdMWPHapeufQQ7Uqsz2aYDyzKplvPMt3iAN8/1b/5w";

/**
 * Adaptador real de hashing de contraseñas basado en Argon2id (`@node-rs/argon2`).
 */
export class Argon2idPasswordHasher implements IPasswordHasher {
  public readonly algorithm = "argon2id" as const;
  private readonly config: Argon2idConfig;
  private calibratedDummyHashPromise: Promise<string> | null = null;

  constructor(partialConfig?: Partial<Argon2idConfig>) {
    this.config = validateArgon2idConfig(partialConfig);
  }

  public getConfig(): Argon2idConfig {
    return this.config;
  }

  private assertValidPlainPasswordInput(plainPassword: string): void {
    if (typeof plainPassword !== "string" || plainPassword.length === 0) {
      throw new CryptoConfigurationError(
        "La contraseña proporcionada al adaptador de hashing no puede estar vacía."
      );
    }

    const byteLength = Buffer.byteLength(plainPassword, "utf8");
    if (byteLength > this.config.maxPasswordBytes) {
      throw new CryptoConfigurationError(
        `La contraseña excede el límite máximo de seguridad de ${this.config.maxPasswordBytes} bytes UTF-8.`
      );
    }
  }

  private isStructurallySafePhcString(passwordHash: string): boolean {
    if (
      typeof passwordHash !== "string" ||
      !passwordHash.startsWith(PHC_ARGON2ID_PREFIX)
    ) {
      return false;
    }

    const segments = passwordHash.split("$");
    if (segments.length !== 6) {
      return false;
    }

    const saltB64 = segments[4] ?? "";
    const digestB64 = segments[5] ?? "";

    if (
      !saltB64 ||
      !digestB64 ||
      !PHC_UNPADDED_B64_REGEX.test(saltB64) ||
      !PHC_UNPADDED_B64_REGEX.test(digestB64)
    ) {
      return false;
    }

    const saltBytes = Buffer.from(saltB64, "base64");
    const digestBytes = Buffer.from(digestB64, "base64");

    // Exigir sal de al menos 16 bytes (128 bits) y digest dentro de cotas seguras (16..64 bytes)
    if (
      saltBytes.byteLength < 16 ||
      saltBytes.byteLength > 64 ||
      digestBytes.byteLength < ARGON2ID_SAFE_BOUNDS.minOutputLen ||
      digestBytes.byteLength > ARGON2ID_SAFE_BOUNDS.maxOutputLen
    ) {
      return false;
    }

    try {
      const parsed = parseOptions(passwordHash);
      if (
        parsed.memoryCost < ARGON2ID_SAFE_BOUNDS.minMemoryCostKiB ||
        parsed.memoryCost > ARGON2ID_SAFE_BOUNDS.maxMemoryCostKiB ||
        parsed.timeCost < ARGON2ID_SAFE_BOUNDS.minTimeCost ||
        parsed.timeCost > ARGON2ID_SAFE_BOUNDS.maxTimeCost ||
        parsed.parallelism < ARGON2ID_SAFE_BOUNDS.minParallelism ||
        parsed.parallelism > ARGON2ID_SAFE_BOUNDS.maxParallelism
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async getCalibratedDummyHash(): Promise<string> {
    if (!this.needsRehash(DUMMY_ARGON2ID_HASH)) {
      return DUMMY_ARGON2ID_HASH;
    }
    if (!this.calibratedDummyHashPromise) {
      this.calibratedDummyHashPromise = this.hash(DUMMY_ARGON2ID_PREIMAGE);
    }
    return this.calibratedDummyHashPromise;
  }

  async hash(plainPassword: string): Promise<string> {
    this.assertValidPlainPasswordInput(plainPassword);

    return hash(plainPassword, {
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
      memoryCost: this.config.memoryCostKiB,
      timeCost: this.config.timeCost,
      parallelism: this.config.parallelism,
      outputLen: this.config.outputLen,
    });
  }

  async verify(plainPassword: string, passwordHash: string): Promise<boolean> {
    if (typeof plainPassword !== "string") {
      return false;
    }

    if (!this.isStructurallySafePhcString(passwordHash)) {
      return false;
    }

    // Si la contraseña es vacía o excede maxPasswordBytes, ejecutamos igualmente el cómputo
    // Argon2id sobre una entrada acotada para no revelar un cortocircuito temporal instantáneo,
    // pero forzamos el resultado final a `false`.
    const byteLength = Buffer.byteLength(plainPassword, "utf8");
    const isOutOfBoundsPassword =
      plainPassword.length === 0 || byteLength > this.config.maxPasswordBytes;
    const effectivePassword = isOutOfBoundsPassword
      ? FALLBACK_TIMING_PASSWORD
      : plainPassword;

    // Si se está verificando contra DUMMY_ARGON2ID_HASH con una contraseña distinta de la
    // preimagen centinela y la instancia tiene parámetros calibrados distintos de los por defecto,
    // usar el hash dummy calibrado a `this.config`.
    let effectiveHash = passwordHash;
    if (
      passwordHash === DUMMY_ARGON2ID_HASH &&
      effectivePassword !== DUMMY_ARGON2ID_PREIMAGE &&
      this.needsRehash(DUMMY_ARGON2ID_HASH)
    ) {
      try {
        effectiveHash = await this.getCalibratedDummyHash();
      } catch {
        effectiveHash = DUMMY_ARGON2ID_HASH;
      }
    }

    try {
      const matched = await verify(effectiveHash, effectivePassword, {
        algorithm: Algorithm.Argon2id,
      });
      return isOutOfBoundsPassword ? false : matched;
    } catch {
      return false;
    }
  }

  needsRehash(passwordHash: string): boolean {
    if (!this.isStructurallySafePhcString(passwordHash)) {
      return true;
    }

    try {
      const parsed = parseOptions(passwordHash);

      if (
        parsed.memoryCost !== this.config.memoryCostKiB ||
        parsed.timeCost !== this.config.timeCost ||
        parsed.parallelism !== this.config.parallelism
      ) {
        return true;
      }

      const segments = passwordHash.split("$");
      const rawSaltB64 = segments[4] ?? "";
      const rawHashB64 = segments[5] ?? "";

      const saltBytes = Buffer.from(rawSaltB64, "base64");
      const digestBytes = Buffer.from(rawHashB64, "base64");

      if (
        saltBytes.byteLength !== 16 ||
        digestBytes.byteLength !== this.config.outputLen
      ) {
        return true;
      }

      return false;
    } catch {
      return true;
    }
  }
}
