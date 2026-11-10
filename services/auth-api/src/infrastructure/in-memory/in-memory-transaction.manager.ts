import { randomUUID } from "node:crypto";
import {
  DatabaseQueryResult,
  IDatabaseExecutor,
  ITransactionManager,
  QueryResultRow,
  TransactionContext,
  TransactionOptions,
} from "../../interfaces";

/**
 * Gestor transaccional en memoria para pruebas unitarias sin base de datos.
 * Permite registrar repositorios con capacidad de snapshot/restore para simular
 * el comportamiento de ROLLBACK cuando una operación compuesta lanza un error.
 */
export interface SnapshotableRepository {
  createSnapshot(): unknown;
  restoreSnapshot(snapshot: unknown): void;
}

const NOOP_EXECUTOR: IDatabaseExecutor = {
  async query<TRow extends QueryResultRow = QueryResultRow>(): Promise<DatabaseQueryResult<TRow>> {
    return { rows: [], rowCount: 0 };
  },
};

export class InMemoryTransactionManager implements ITransactionManager {
  private readonly repositories: SnapshotableRepository[];

  constructor(repositories: SnapshotableRepository[] = []) {
    this.repositories = repositories;
  }

  async runInTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    const snapshots = this.repositories.map((repo) => ({
      repo,
      state: repo.createSnapshot(),
    }));

    const tx: TransactionContext = {
      transactionId: `inmem_tx_${randomUUID()}`,
      startedAt: new Date(),
      executor: NOOP_EXECUTOR,
    };

    try {
      return await work(tx);
    } catch (error) {
      for (const item of snapshots) {
        item.repo.restoreSnapshot(item.state);
      }
      throw error;
    }
  }
}
