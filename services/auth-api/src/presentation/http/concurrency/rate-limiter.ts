import { createHash } from "node:crypto";
import { DomainError } from "../../../domain";
import {
  HttpConfigurationError,
  HTTP_SAFE_BOUNDS,
  RateLimitRuleConfig,
} from "../../../infrastructure/config/http-config";

export class RateLimitExceededError extends DomainError {
  public readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(
    public readonly retryAfterSeconds: number,
    public readonly limit: number,
    public readonly remaining: number = 0,
    public readonly resetAtEpochSeconds: number = 0,
    message: string = "Se ha excedido el límite de solicitudes permitidas. Intente nuevamente más tarde."
  ) {
    super(message);
  }
}

export type RateLimitOperation =
  | "login"
  | "refresh"
  | "logout"
  | "change_password"
  | "me"
  | "admin"
  | "activation"
  | "reset_password";

export type RateLimitDimension = "ip" | "account" | "user" | "token";

export interface RateLimitConsumeInput {
  readonly operation: RateLimitOperation;
  readonly dimension: RateLimitDimension;
  /** Identificador crudo (ej. IP, email, userId o cookie token). Se normaliza y hashea internamente con SHA-256. */
  readonly rawIdentifier: string;
  readonly rule: RateLimitRuleConfig;
  readonly now?: Date;
}

export interface RateLimitStatus {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAtEpochSeconds: number;
}

export interface IRateLimiter {
  consume(input: RateLimitConsumeInput): Promise<RateLimitStatus>;
  consumeOrThrow(input: RateLimitConsumeInput): Promise<RateLimitStatus>;
  clear(): void;
  size(): number;
}

interface BucketEntry {
  count: number;
  resetAtMs: number;
}

/**
 * Hashea de forma irreversible mediante SHA-256 cualquier identificador de rate limit
 * (IP, correo normalizado, userId o cookie de refresh), garantizando que el rate limiter
 * jamás almacene contraseñas, tokens crudos ni correos en texto plano en memoria.
 */
export function hashRateLimitIdentifier(
  operation: RateLimitOperation,
  dimension: RateLimitDimension,
  rawIdentifier: string
): string {
  const normalized =
    dimension === "account" || dimension === "ip"
      ? rawIdentifier.trim().toLowerCase()
      : rawIdentifier.trim();

  const digest = createHash("sha256")
    .update(`sitecorp_rl_v1|${operation}|${dimension}|${normalized}`, "utf8")
    .digest("hex");

  return `${operation}:${dimension}:${digest}`;
}

/**
 * Rate Limiter en memoria con cota estricta de entradas (`maxEntries`) y desalojo LRU O(1).
 *
 * NOTA ARQUITECTÓNICA SOBRE ENTORNOS MULTIPROCESO:
 * - Esta implementación protege la memoria y capacidad de un proceso Node.js individual
 *   (adecuado para despliegue mononodo en VPS, donde el consumo máximo de memoria para
 *   `maxEntries = 10_000` es inferior a 2 MiB).
 * - El bloqueo de cuenta ante ataques de fuerza bruta sobre contraseñas (`failed_login_attempts`
 *   y `locked_until` en `sitecorp_auth.users`) ya es global y transaccional en PostgreSQL.
 * - Si en el futuro se despliegan múltiples réplicas/workers de `auth-api`, la interfaz
 *   asíncrona `IRateLimiter` permite inyectar un adaptador compartido en PostgreSQL o Redis
 *   sin modificar ningún controlador ni hook HTTP.
 */
export class BoundedMemoryRateLimiter implements IRateLimiter {
  private readonly maxEntries: number;
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly nowProvider: () => Date;

  constructor(
    maxEntries: number = 10000,
    nowProvider: () => Date = () => new Date()
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < HTTP_SAFE_BOUNDS.minRateLimitEntries ||
      maxEntries > HTTP_SAFE_BOUNDS.maxRateLimitEntries
    ) {
      throw new HttpConfigurationError(
        `BoundedMemoryRateLimiter.maxEntries debe ser un entero entre ${HTTP_SAFE_BOUNDS.minRateLimitEntries} y ${HTTP_SAFE_BOUNDS.maxRateLimitEntries}.`
      );
    }
    this.maxEntries = maxEntries;
    this.nowProvider = nowProvider;
  }

  private evictExpiredOrOldest(nowMs: number): void {
    // 1. Intentar purgar primero entradas ya expiradas en el frente del Map (orden de inserción/uso)
    for (const [key, entry] of this.buckets.entries()) {
      if (entry.resetAtMs <= nowMs) {
        this.buckets.delete(key);
      }
      if (this.buckets.size < this.maxEntries) {
        return;
      }
    }

    // 2. Si aún está lleno con entradas activas, desalojar la entrada menos recientemente usada (LRU: primera clave del Map)
    while (this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) break;
      this.buckets.delete(oldestKey);
    }
  }

  public async consume(input: RateLimitConsumeInput): Promise<RateLimitStatus> {
    const { operation, dimension, rawIdentifier, rule } = input;
    if (!rawIdentifier || typeof rawIdentifier !== "string") {
      throw new HttpConfigurationError(
        "El identificador para rate limiting es obligatorio."
      );
    }

    const nowMs = (input.now ?? this.nowProvider()).getTime();
    const key = hashRateLimitIdentifier(operation, dimension, rawIdentifier);

    let entry = this.buckets.get(key);

    if (entry && entry.resetAtMs <= nowMs) {
      this.buckets.delete(key);
      entry = undefined;
    }

    if (!entry) {
      if (this.buckets.size >= this.maxEntries) {
        this.evictExpiredOrOldest(nowMs);
      }
      entry = {
        count: 1,
        resetAtMs: nowMs + rule.windowMs,
      };
      this.buckets.set(key, entry);
    } else {
      // Actualizar orden LRU moviendo la clave al final del Map
      this.buckets.delete(key);
      entry.count += 1;
      this.buckets.set(key, entry);
    }

    const resetAtEpochSeconds = Math.ceil(entry.resetAtMs / 1000);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAtMs - nowMs) / 1000)
    );

    if (entry.count > rule.maxRequests) {
      return Object.freeze({
        allowed: false,
        limit: rule.maxRequests,
        remaining: 0,
        retryAfterSeconds,
        resetAtEpochSeconds,
      });
    }

    return Object.freeze({
      allowed: true,
      limit: rule.maxRequests,
      remaining: Math.max(0, rule.maxRequests - entry.count),
      retryAfterSeconds: 0,
      resetAtEpochSeconds,
    });
  }

  public async consumeOrThrow(
    input: RateLimitConsumeInput
  ): Promise<RateLimitStatus> {
    const status = await this.consume(input);
    if (!status.allowed) {
      throw new RateLimitExceededError(
        status.retryAfterSeconds,
        status.limit,
        status.remaining,
        status.resetAtEpochSeconds
      );
    }
    return status;
  }

  public clear(): void {
    this.buckets.clear();
  }

  public size(): number {
    return this.buckets.size;
  }
}
