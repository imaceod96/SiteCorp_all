import { DomainError } from "../../../domain";
import { IPasswordHasher } from "../../../interfaces";
import {
  Argon2ConcurrencyConfig,
  HttpConfigurationError,
  HTTP_SAFE_BOUNDS,
} from "../../../infrastructure/config/http-config";

/**
 * Error lanzado cuando el semáforo de concurrencia de Argon2id rechaza una solicitud
 * por cola llena (`maxQueueSize`), vencimiento de espera (`acquireTimeoutMs`),
 * cancelación (`AbortSignal`) o cierre del servidor (`shuttingDown`).
 * Se mapea a HTTP `503 Service Unavailable` (`AUTH_SERVER_BUSY`, `Retry-After: 5`).
 */
export class Argon2ConcurrencySaturationError extends DomainError {
  public readonly code = "AUTH_SERVER_BUSY";
  public readonly retryAfterSeconds = 5;

  constructor(
    public readonly reason:
      | "QUEUE_FULL"
      | "QUEUE_TIMEOUT"
      | "ABORTED"
      | "SHUTTING_DOWN",
    message: string = "El servicio de autenticación se encuentra temporalmente saturado. Intente nuevamente en unos segundos."
  ) {
    super(message);
  }
}

export interface Argon2Lease {
  /** Libera el slot de ejecución adquirido. Es idempotente: llamadas duplicadas son ignoradas de forma segura. */
  release(): void;
}

interface QueuedWaiter {
  readonly id: symbol;
  settled: boolean;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onAbort?: () => void;
  readonly signal?: AbortSignal;
  readonly resolve: (lease: Argon2Lease) => void;
  readonly reject: (err: Error) => void;
}

export interface Argon2GateMetrics {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly maxConcurrent: number;
  readonly maxQueueSize: number;
  readonly acquireTimeoutMs: number;
  readonly isShuttingDown: boolean;
}

/**
 * Semáforo FIFO y cola acotada para controlar el número máximo de operaciones
 * Argon2id concurrentes en un proceso Node.js, protegiendo al VPS frente a
 * agotamiento de memoria nativa (OOM).
 *
 * Garantías:
 * - Orden estricto FIFO.
 * - Liberación garantizada en bloque `finally` dentro de `run()`.
 * - Protección contra liberaciones duplicadas (`released` flag por lease).
 * - Limpieza inmediata de solicitudes en cola cuando expira `acquireTimeoutMs` o se dispara `AbortSignal`.
 * - Cierre ordenado (`shutdown()`).
 */
export class Argon2ConcurrencyGate {
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly acquireTimeoutMs: number;
  private activeCount = 0;
  private shuttingDown = false;
  private readonly queue: QueuedWaiter[] = [];

  constructor(config: Partial<Argon2ConcurrencyConfig> = {}) {
    const maxConcurrent = config.maxConcurrent ?? 2;
    const maxQueueSize = config.maxQueueSize ?? 8;
    const acquireTimeoutMs = config.acquireTimeoutMs ?? 2500;

    if (
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < HTTP_SAFE_BOUNDS.minArgon2Concurrent ||
      maxConcurrent > HTTP_SAFE_BOUNDS.maxArgon2Concurrent
    ) {
      throw new HttpConfigurationError(
        `Argon2ConcurrencyGate.maxConcurrent debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2Concurrent} y ${HTTP_SAFE_BOUNDS.maxArgon2Concurrent}.`
      );
    }

    if (
      !Number.isInteger(maxQueueSize) ||
      maxQueueSize < HTTP_SAFE_BOUNDS.minArgon2QueueSize ||
      maxQueueSize > HTTP_SAFE_BOUNDS.maxArgon2QueueSize
    ) {
      throw new HttpConfigurationError(
        `Argon2ConcurrencyGate.maxQueueSize debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2QueueSize} y ${HTTP_SAFE_BOUNDS.maxArgon2QueueSize}.`
      );
    }

    if (
      !Number.isInteger(acquireTimeoutMs) ||
      acquireTimeoutMs < HTTP_SAFE_BOUNDS.minArgon2TimeoutMs ||
      acquireTimeoutMs > HTTP_SAFE_BOUNDS.maxArgon2TimeoutMs
    ) {
      throw new HttpConfigurationError(
        `Argon2ConcurrencyGate.acquireTimeoutMs debe ser un entero entre ${HTTP_SAFE_BOUNDS.minArgon2TimeoutMs} y ${HTTP_SAFE_BOUNDS.maxArgon2TimeoutMs} ms.`
      );
    }

    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  private createLease(): Argon2Lease {
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) {
          return; // Protección contra liberaciones duplicadas
        }
        released = true;
        this.onSlotReleased();
      },
    });
  }

  private onSlotReleased(): void {
    // Despachar el siguiente elemento vivo en orden estricto FIFO
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.settled) {
        continue;
      }
      next.settled = true;
      clearTimeout(next.timer);
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      // Transferimos el slot activo directamente al waiter desencolado
      next.resolve(this.createLease());
      return;
    }

    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  private removeWaiterFromQueue(id: symbol): void {
    const idx = this.queue.findIndex((item) => item.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  /**
   * Adquiere un slot de ejecución Argon2id o espera en la cola FIFO hasta `acquireTimeoutMs`.
   */
  public acquire(signal?: AbortSignal): Promise<Argon2Lease> {
    if (this.shuttingDown) {
      return Promise.reject(
        new Argon2ConcurrencySaturationError(
          "SHUTTING_DOWN",
          "El servidor se encuentra en proceso de apagado."
        )
      );
    }

    if (signal?.aborted) {
      return Promise.reject(
        new Argon2ConcurrencySaturationError(
          "ABORTED",
          "La solicitud fue cancelada antes de adquirir el slot de Argon2id."
        )
      );
    }

    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      return Promise.resolve(this.createLease());
    }

    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new Argon2ConcurrencySaturationError("QUEUE_FULL")
      );
    }

    return new Promise<Argon2Lease>((resolve, reject) => {
      const id = Symbol("argon2-waiter");

      const timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        this.removeWaiterFromQueue(id);
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
        reject(new Argon2ConcurrencySaturationError("QUEUE_TIMEOUT"));
      }, this.acquireTimeoutMs);

      const onAbort = (): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        clearTimeout(timer);
        this.removeWaiterFromQueue(id);
        signal?.removeEventListener("abort", onAbort);
        reject(
          new Argon2ConcurrencySaturationError(
            "ABORTED",
            "La solicitud fue cancelada mientras esperaba en la cola de Argon2id."
          )
        );
      };

      const waiter: QueuedWaiter = {
        id,
        settled: false,
        timer,
        onAbort: signal ? onAbort : undefined,
        signal,
        resolve,
        reject,
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.queue.push(waiter);
    });
  }

  /**
   * Ejecuta una tarea asíncrona dentro del semáforo garantizando la liberación
   * del slot en un bloque `finally` incluso si `task()` lanza una excepción.
   */
  public async run<T>(
    task: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const lease = await this.acquire(signal);
    try {
      return await task();
    } finally {
      lease.release();
    }
  }

  /**
   * Rechaza todas las solicitudes en cola y marca la compuerta en estado de cierre.
   */
  public shutdown(): void {
    this.shuttingDown = true;
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(
        new Argon2ConcurrencySaturationError(
          "SHUTTING_DOWN",
          "El servicio de autenticación se está cerrando."
        )
      );
    }
  }

  public getMetrics(): Argon2GateMetrics {
    return Object.freeze({
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
      acquireTimeoutMs: this.acquireTimeoutMs,
      isShuttingDown: this.shuttingDown,
    });
  }

  public isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}

/**
 * Decorador de `IPasswordHasher` que protege automáticamente cada operación
 * `hash()` y `verify()` mediante un `Argon2ConcurrencyGate` compartido.
 */
export class ConcurrencyLimitedPasswordHasher implements IPasswordHasher {
  public readonly algorithm: "argon2id" | "bcrypt";

  constructor(
    private readonly innerHasher: IPasswordHasher,
    private readonly gate: Argon2ConcurrencyGate
  ) {
    this.algorithm = innerHasher.algorithm;
  }

  async hash(plainPassword: string): Promise<string> {
    return this.gate.run(() => this.innerHasher.hash(plainPassword));
  }

  async verify(plainPassword: string, passwordHash: string): Promise<boolean> {
    return this.gate.run(() =>
      this.innerHasher.verify(plainPassword, passwordHash)
    );
  }

  needsRehash(passwordHash: string): boolean {
    return this.innerHasher.needsRehash(passwordHash);
  }
}

