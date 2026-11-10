/**
 * Contratos de Base de Datos y Gestión Transaccional ACID para SiteCorp Auth API
 *
 * Permite compartir una única transacción física (`PoolClient` en PostgreSQL)
 * entre múltiples repositorios sin acoplar la capa de aplicación al driver `pg`.
 */

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface DatabaseQueryResult<TRow extends QueryResultRow = QueryResultRow> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

/**
 * Representa un ejecutor de consultas SQL parametrizadas (ya sea un Pool o un PoolClient
 * con transacción abierta).
 */
export interface IDatabaseExecutor {
  query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<DatabaseQueryResult<TRow>>;
}

/**
 * Contexto opaco de una transacción activa.
 * Expone el ejecutor dedicado a la transacción en curso.
 */
export interface TransactionContext {
  readonly transactionId: string;
  readonly startedAt: Date;
  readonly executor: IDatabaseExecutor;
}

/**
 * Cliente de base de datos que provee el ejecutor activo (transaccional si existe
 * una transacción en curso en el contexto asíncrono, o autocommit desde el pool en lecturas).
 */
export interface IDatabaseClient extends IDatabaseExecutor {
  /**
   * Devuelve el ejecutor asociado a la transacción activa en el contexto actual,
   * o el ejecutor por defecto del pool si no hay transacción abierta.
   */
  getActiveExecutor(): IDatabaseExecutor;

  /**
   * Indica si el contexto de ejecución actual se encuentra dentro de una transacción abierta.
   */
  isInTransaction(): boolean;
}

export type TransactionIsolationLevel =
  | "READ COMMITTED"
  | "REPEATABLE READ"
  | "SERIALIZABLE";

export interface TransactionOptions {
  /**
   * Nivel de aislamiento SQL opcional para la transacción.
   * Por defecto PostgreSQL utiliza READ COMMITTED combinado con bloqueos explícitos FOR UPDATE.
   */
  readonly isolationLevel?: TransactionIsolationLevel;

  /**
   * Timeout máximo de sentencia/transacción en milisegundos (SET LOCAL statement_timeout).
   */
  readonly statementTimeoutMs?: number;

  /**
   * Timeout máximo de espera de bloqueo de fila en milisegundos (SET LOCAL lock_timeout).
   */
  readonly lockTimeoutMs?: number;

  /**
   * Si se especifica, exige que toda operación de escritura se ejecute sin permitir
   * transacciones anidadas implícitas o utilice SAVEPOINT explícito.
   */
  readonly allowNestedSavepoint?: boolean;
}

export interface ITransactionManager {
  /**
   * Ejecuta `work` dentro de una única transacción ACID (`BEGIN ... COMMIT / ROLLBACK`).
   * - Todas las operaciones de repositorios invocadas dentro de `work` comparten la misma
   *   conexión física y transacción.
   * - Si `work` lanza cualquier excepción, ejecuta `ROLLBACK` automático y relanza el error.
   * - Garantiza la liberación de la conexión en el bloque `finally` y limpia cualquier
   *   contexto de autenticación local (`request.jwt.claim.*`).
   */
  runInTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;
}
