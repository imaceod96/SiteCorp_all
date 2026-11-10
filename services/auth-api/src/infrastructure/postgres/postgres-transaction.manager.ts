import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  DatabaseQueryResult,
  IDatabaseClient,
  IDatabaseExecutor,
  ITransactionManager,
  QueryResultRow,
  TransactionContext,
  TransactionIsolationLevel,
  TransactionOptions,
} from "../../interfaces";

/**
 * Interfaz mínima compatible con `pg.Pool` (y adaptadores equivalentes de pruebas con PostgreSQL real)
 * para evitar acoplar estáticamente el constructor a una instancia de red si se inyecta un pool compatible.
 */
export interface PgPoolLike {
  connect(): Promise<PgPoolClientLike>;
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

export interface PgPoolClientLike {
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
  release(err?: Error | boolean): void;
}

export class NestedTransactionNotAllowedError extends Error {
  public readonly code = "NESTED_TRANSACTION_NOT_ALLOWED";
  constructor() {
    super(
      "No se permiten transacciones anidadas sin habilitar explícitamente 'allowNestedSavepoint: true'."
    );
    this.name = "NestedTransactionNotAllowedError";
  }
}

export class UnscopedTransactionalWriteError extends Error {
  public readonly code = "UNSCOPED_TRANSACTIONAL_WRITE";
  constructor(operation: string) {
    super(
      `Violación de seguridad transaccional: la operación '${operation}' exige ejecutarse dentro de una transacción activa (runInTransaction).`
    );
    this.name = "UnscopedTransactionalWriteError";
  }
}

export class ConcurrentClientOperationError extends Error {
  public readonly code = "CONCURRENT_CLIENT_OPERATION";
  constructor() {
    super(
      "Operación paralela insegura detectada sobre el mismo PoolClient transaccional. Las consultas dentro de una misma transacción deben ser secuenciales."
    );
    this.name = "ConcurrentClientOperationError";
  }
}

export class TransactionCleanupError extends Error {
  public readonly code = "TRANSACTION_CLEANUP_FAILED";
  constructor(cause?: unknown) {
    super(
      `Fallo crítico al limpiar el contexto de la conexión PostgreSQL (RESET ALL): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "TransactionCleanupError";
  }
}

const ALLOWED_ISOLATION_LEVELS: ReadonlySet<TransactionIsolationLevel> = new Set([
  "READ COMMITTED",
  "REPEATABLE READ",
  "SERIALIZABLE",
]);

const FOR_UPDATE_OR_SHARE_REGEX = /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i;
const DML_WRITE_STATEMENT_REGEX = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i;

interface ActivePgTransactionState {
  readonly transactionId: string;
  readonly startedAt: Date;
  readonly client: PgPoolClientLike;
  readonly executor: IDatabaseExecutor;
  savepointDepth: number;
  inFlightOperations: number;
  poisoned: boolean;
  poisonReason: Error | null;
}

function createGuardedClientExecutor(stateRef: {
  current?: ActivePgTransactionState;
}): IDatabaseExecutor {
  return {
    async query<TRow extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = []
    ): Promise<DatabaseQueryResult<TRow>> {
      const state = stateRef.current;
      if (!state) {
        throw new Error("Estado transaccional interno no inicializado.");
      }

      if (state.poisoned) {
        throw (
          state.poisonReason ??
          new Error(
            "La transacción actual se encuentra abortada/envenenada y no admite nuevas consultas."
          )
        );
      }

      if (state.inFlightOperations > 0) {
        const err = new ConcurrentClientOperationError();
        state.poisoned = true;
        state.poisonReason = err;
        throw err;
      }

      state.inFlightOperations += 1;
      try {
        const result = await state.client.query<TRow>(sql, params as unknown[]);
        return {
          rows: result.rows,
          rowCount: result.rowCount ?? result.rows.length,
        };
      } finally {
        state.inFlightOperations -= 1;
      }
    },
  };
}

/**
 * Implementación de `IDatabaseClient` e `ITransactionManager` sobre PostgreSQL (`pg`).
 *
 * Garantías de seguridad y aislamiento (Fase 4F.2.1):
 * 1. Una única conexión `PoolClient` física por transacción (`BEGIN ... COMMIT / ROLLBACK`).
 * 2. Propagación automática y segura mediante `AsyncLocalStorage` sin fugas entre peticiones concurrentes.
 * 3. Prohibición de operaciones paralelas inseguras sobre el mismo `PoolClient` (`ConcurrentClientOperationError`).
 * 4. Descarte y destrucción de conexiones rotas o en estado desconocido (`client.release(err)`):
 *    si falla `BEGIN`, `COMMIT`, `ROLLBACK`, un `SAVEPOINT` o `RESET ALL`, la conexión NUNCA vuelve al pool como reutilizable.
 * 5. Limpieza garantizada de variables de contexto (`RESET ALL` + `set_config(..., true)`).
 * 6. Prohibición de `SELECT ... FOR UPDATE` fuera de transacción y soporte opcional `rejectUnscopedWrites`.
 */
export class PostgresTransactionManager implements IDatabaseClient, ITransactionManager {
  private readonly storage = new AsyncLocalStorage<ActivePgTransactionState>();
  private readonly poolExecutor: IDatabaseExecutor;
  private readonly defaultStatementTimeoutMs: number;
  private readonly defaultLockTimeoutMs: number;
  private readonly rejectUnscopedWrites: boolean;

  constructor(
    private readonly pool: PgPoolLike | Pool,
    options: {
      defaultStatementTimeoutMs?: number;
      defaultLockTimeoutMs?: number;
      rejectUnscopedWrites?: boolean;
    } = {}
  ) {
    this.defaultStatementTimeoutMs = options.defaultStatementTimeoutMs ?? 10000;
    this.defaultLockTimeoutMs = options.defaultLockTimeoutMs ?? 5000;
    this.rejectUnscopedWrites = options.rejectUnscopedWrites ?? false;

    this.poolExecutor = {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        sql: string,
        params: readonly unknown[] = []
      ): Promise<DatabaseQueryResult<TRow>> => {
        if (FOR_UPDATE_OR_SHARE_REGEX.test(sql)) {
          throw new UnscopedTransactionalWriteError("SELECT ... FOR UPDATE/SHARE");
        }
        if (this.rejectUnscopedWrites && DML_WRITE_STATEMENT_REGEX.test(sql)) {
          throw new UnscopedTransactionalWriteError(
            sql.trim().split(/\s+/)[0]?.toUpperCase() ?? "WRITE_DML"
          );
        }
        const res = await (this.pool as PgPoolLike).query<TRow>(sql, params as unknown[]);
        return {
          rows: res.rows,
          rowCount: res.rowCount ?? res.rows.length,
        };
      },
    };
  }

  public isInTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  public getActiveExecutor(): IDatabaseExecutor {
    const active = this.storage.getStore();
    if (active) {
      return active.executor;
    }
    return this.poolExecutor;
  }

  /**
   * Exige que exista una transacción activa en el contexto actual y devuelve su ejecutor.
   * Evita consultas o escrituras accidentales fuera de la transacción en operaciones críticas.
   */
  public requireTransactionExecutor(operationName: string): IDatabaseExecutor {
    const active = this.storage.getStore();
    if (!active) {
      throw new UnscopedTransactionalWriteError(operationName);
    }
    return active.executor;
  }

  public async query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<TRow>> {
    return this.getActiveExecutor().query<TRow>(sql, params);
  }

  /**
   * Establece el contexto de autenticación verificada (`request.jwt.claim.sub` y `role`)
   * EXCLUSIVAMENTE con ámbito local a la transacción activa (`is_local = true` / `SET LOCAL`).
   * Prohibido llamarlo fuera de una transacción para impedir contaminar conexiones del pool.
   */
  public async setTransactionAuthContext(claims: {
    sub: string;
    role: string;
    sessionId?: string;
  }): Promise<void> {
    const executor = this.requireTransactionExecutor("setTransactionAuthContext");
    await executor.query(
      `SELECT
         set_config('request.jwt.claim.sub', $1::text, true),
         set_config('request.jwt.claim.role', $2::text, true),
         set_config('request.jwt.claims', $3::text, true)`,
      [
        claims.sub,
        claims.role,
        JSON.stringify({
          sub: claims.sub,
          role: claims.role,
          sid: claims.sessionId ?? null,
        }),
      ]
    );
  }

  public async runInTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const existingState = this.storage.getStore();

    // Manejo de transacciones anidadas: prohibidas por defecto salvo autorización explícita con SAVEPOINT
    if (existingState) {
      if (!options.allowNestedSavepoint) {
        throw new NestedTransactionNotAllowedError();
      }

      if (existingState.inFlightOperations > 0) {
        const concurrentErr = new ConcurrentClientOperationError();
        existingState.poisoned = true;
        existingState.poisonReason = concurrentErr;
        throw concurrentErr;
      }

      existingState.savepointDepth += 1;
      const savepointName = `sp_${existingState.savepointDepth}`;

      try {
        await existingState.executor.query(`SAVEPOINT ${savepointName}`);
      } catch (savepointErr) {
        existingState.savepointDepth -= 1;
        existingState.poisoned = true;
        existingState.poisonReason =
          savepointErr instanceof Error
            ? savepointErr
            : new Error(String(savepointErr));
        throw savepointErr;
      }

      const nestedTxContext: TransactionContext = {
        transactionId: `${existingState.transactionId}:${savepointName}`,
        startedAt: new Date(),
        executor: existingState.executor,
      };

      try {
        const result = await work(nestedTxContext);
        await existingState.executor.query(`RELEASE SAVEPOINT ${savepointName}`);
        return result;
      } catch (err) {
        try {
          // Si fue un error de concurrencia en el mismo cliente, la transacción padre queda envenenada
          if (err instanceof ConcurrentClientOperationError) {
            existingState.poisoned = true;
            existingState.poisonReason = err;
          } else {
            await existingState.executor.query(
              `ROLLBACK TO SAVEPOINT ${savepointName}`
            );
            await existingState.executor.query(
              `RELEASE SAVEPOINT ${savepointName}`
            );
          }
        } catch (spRollbackErr) {
          existingState.poisoned = true;
          existingState.poisonReason =
            spRollbackErr instanceof Error
              ? spRollbackErr
              : new Error(String(spRollbackErr));
        }
        throw err;
      } finally {
        existingState.savepointDepth -= 1;
      }
    }

    const isolation: TransactionIsolationLevel =
      options.isolationLevel ?? "READ COMMITTED";
    if (!ALLOWED_ISOLATION_LEVELS.has(isolation)) {
      throw new Error(`Nivel de aislamiento SQL no permitido: '${String(isolation)}'`);
    }

    const client = await (this.pool as PgPoolLike | Pool).connect();
    const stateRef: { current?: ActivePgTransactionState } = {};
    const executor = createGuardedClientExecutor(stateRef);
    const transactionId = `pg_tx_${randomUUID()}`;
    const startedAt = new Date();

    const state: ActivePgTransactionState = {
      transactionId,
      startedAt,
      client,
      executor,
      savepointDepth: 0,
      inFlightOperations: 0,
      poisoned: false,
      poisonReason: null,
    };
    stateRef.current = state;

    const txContext: TransactionContext = {
      transactionId,
      startedAt,
      executor,
    };

    let shouldDestroyClient: Error | boolean = false;
    let primaryError: unknown = undefined;
    let hasPrimaryError = false;
    let workResult!: T;

    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);

      const statementTimeout = Math.max(
        100,
        Math.floor(options.statementTimeoutMs ?? this.defaultStatementTimeoutMs)
      );
      const lockTimeout = Math.max(
        100,
        Math.floor(options.lockTimeoutMs ?? this.defaultLockTimeoutMs)
      );

      await client.query(
        `SELECT
           set_config('statement_timeout', $1::text, true),
           set_config('lock_timeout', $2::text, true),
           set_config('request.jwt.claim.sub', '', true),
           set_config('request.jwt.claim.role', '', true),
           set_config('request.jwt.claims', '', true)`,
        [`${statementTimeout}ms`, `${lockTimeout}ms`]
      );

      workResult = await this.storage.run(state, () => work(txContext));

      if (state.poisoned) {
        throw (
          state.poisonReason ??
          new Error("La transacción fue marcada como corrupta/envenenada antes de COMMIT.")
        );
      }

      try {
        await client.query("COMMIT");
      } catch (commitError) {
        // Un fallo en COMMIT deja la transacción en estado incierto/abortado;
        // intentamos ROLLBACK defensivo y marcamos la conexión para destrucción obligatoria.
        shouldDestroyClient =
          commitError instanceof Error ? commitError : new Error(String(commitError));
        try {
          await client.query("ROLLBACK");
        } catch {
          // El cliente ya está marcado con shouldDestroyClient para ser descartado del pool
        }
        throw commitError;
      }
    } catch (error) {
      hasPrimaryError = true;
      primaryError = error;

      // Si el error no provino del propio COMMIT (donde ya se intentó ROLLBACK), ejecutamos ROLLBACK
      if (!shouldDestroyClient) {
        if (state.poisoned && state.poisonReason) {
          shouldDestroyClient = state.poisonReason;
        }
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          // Si ROLLBACK falla, la conexión está rota o en estado desconocido:
          // jamás debe volver al pool como reutilizable.
          shouldDestroyClient =
            rollbackError instanceof Error
              ? rollbackError
              : new Error(String(rollbackError));
        }
      }
    } finally {
      if (!shouldDestroyClient) {
        try {
          await client.query("RESET ALL");
        } catch (resetError) {
          // Si RESET ALL falla, la conexión podría retener variables de sesión (request.jwt.claim.*):
          // se marca obligatoriamente como defectuosa al liberarla al pool.
          shouldDestroyClient =
            resetError instanceof Error ? resetError : new Error(String(resetError));
          if (!hasPrimaryError) {
            hasPrimaryError = true;
            primaryError = new TransactionCleanupError(resetError);
          }
        }
      }

      if (shouldDestroyClient) {
        client.release(shouldDestroyClient);
      } else {
        client.release();
      }
    }

    if (hasPrimaryError) {
      throw primaryError;
    }

    return workResult;
  }
}
