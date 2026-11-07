import { describe, it, expect } from "vitest";
import {
  PostgresTransactionManager,
  PgPoolLike,
  PgPoolClientLike,
  ConcurrentClientOperationError,
  TransactionCleanupError,
  UnscopedTransactionalWriteError,
  NestedTransactionNotAllowedError,
  PostgresMigrationRunner,
  loadInitialAuthSchemaMigration,
  ProductionDesignMigrationForbiddenError,
  MigrationIntegrityError,
  computeMigrationChecksum,
} from "../../src/infrastructure";
import { QueryResultRow } from "../../src/interfaces";

interface RecordedRelease {
  readonly destroyedWithError: Error | boolean | undefined;
}

class FaultInjectableMockPool implements PgPoolLike {
  public readonly executedSql: string[] = [];
  public readonly releases: RecordedRelease[] = [];
  public failOnCommit = false;
  public failOnRollback = false;
  public failOnResetAll = false;
  public failOnRollbackToSavepoint = false;
  public queryDelayMs = 0;

  async connect(): Promise<PgPoolClientLike> {
    let released = false;
    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string
      ): Promise<{ rows: TRow[]; rowCount: number | null }> => {
        if (released) {
          throw new Error("Client already released");
        }
        const normalized = text.trim().toUpperCase();
        this.executedSql.push(normalized);

        if (this.queryDelayMs > 0 && normalized.startsWith("SELECT SLOW")) {
          await new Promise((r) => setTimeout(r, this.queryDelayMs));
        }

        if (this.failOnCommit && normalized === "COMMIT") {
          throw new Error("Simulated PostgreSQL COMMIT failure (40001 serialization_failure)");
        }
        if (this.failOnRollback && normalized === "ROLLBACK") {
          throw new Error("Simulated PostgreSQL ROLLBACK socket disconnect");
        }
        if (this.failOnResetAll && normalized === "RESET ALL") {
          throw new Error("Simulated PostgreSQL RESET ALL failure");
        }
        if (
          this.failOnRollbackToSavepoint &&
          normalized.startsWith("ROLLBACK TO SAVEPOINT")
        ) {
          throw new Error("Simulated SAVEPOINT rollback failure");
        }

        return { rows: [], rowCount: 0 };
      },
      release: (err?: Error | boolean) => {
        if (!released) {
          released = true;
          this.releases.push({ destroyedWithError: err });
        }
      },
    };
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string
  ): Promise<{ rows: TRow[]; rowCount: number | null }> {
    this.executedSql.push(`POOL:${text.trim().toUpperCase()}`);
    return { rows: [], rowCount: 0 };
  }
}

describe("Unit Audit (Categoría A): PostgresTransactionManager & PostgresMigrationRunner Fault Handling (Fase 4F.2.1)", () => {
  it("1. Fallo de COMMIT: ejecuta ROLLBACK defensivo y descarta el PoolClient defectuoso (release(err))", async () => {
    const mockPool = new FaultInjectableMockPool();
    mockPool.failOnCommit = true;
    const txManager = new PostgresTransactionManager(mockPool);

    await expect(
      txManager.runInTransaction(async (tx) => {
        await tx.executor.query("INSERT INTO sitecorp_auth.users VALUES ('u1')");
      })
    ).rejects.toThrow("Simulated PostgreSQL COMMIT failure");

    // Verificar que intentó ROLLBACK tras el fallo de COMMIT y no ejecutó RESET ALL sobre una conexión rota
    expect(mockPool.executedSql).toContain("COMMIT");
    expect(mockPool.executedSql).toContain("ROLLBACK");
    expect(mockPool.executedSql).not.toContain("RESET ALL");

    // El cliente fue liberado pasándole el error para que el pool lo destruya y NO lo reutilice
    expect(mockPool.releases).toHaveLength(1);
    expect(mockPool.releases[0]?.destroyedWithError).toBeInstanceOf(Error);
  });

  it("2. Fallo de ROLLBACK: preserva el error original del caso de uso y descarta el PoolClient roto", async () => {
    const mockPool = new FaultInjectableMockPool();
    mockPool.failOnRollback = true;
    const txManager = new PostgresTransactionManager(mockPool);

    await expect(
      txManager.runInTransaction(async (tx) => {
        await tx.executor.query("UPDATE sitecorp_auth.users SET status = 'suspended'");
        throw new Error("Error de negocio en mitad de la transacción");
      })
    ).rejects.toThrow("Error de negocio en mitad de la transacción");

    expect(mockPool.executedSql).toContain("ROLLBACK");
    expect(mockPool.executedSql).not.toContain("RESET ALL");
    expect(mockPool.releases).toHaveLength(1);
    expect(mockPool.releases[0]?.destroyedWithError).toBeInstanceOf(Error);
    expect((mockPool.releases[0]?.destroyedWithError as Error).message).toContain(
      "Simulated PostgreSQL ROLLBACK socket disconnect"
    );
  });

  it("3. Fallo de RESET ALL: lanza TransactionCleanupError y descarta el PoolClient sucio para impedir fuga de contexto", async () => {
    const mockPool = new FaultInjectableMockPool();
    mockPool.failOnResetAll = true;
    const txManager = new PostgresTransactionManager(mockPool);

    await expect(
      txManager.runInTransaction(async (tx) => {
        await tx.executor.query("SELECT 1");
        return "ok";
      })
    ).rejects.toThrow(TransactionCleanupError);

    expect(mockPool.executedSql).toContain("COMMIT");
    expect(mockPool.executedSql).toContain("RESET ALL");
    expect(mockPool.releases).toHaveLength(1);
    expect(mockPool.releases[0]?.destroyedWithError).toBeInstanceOf(Error);
  });

  it("4. Operaciones paralelas inseguras sobre el mismo PoolClient: lanza ConcurrentClientOperationError, hace ROLLBACK y descarta el cliente", async () => {
    const mockPool = new FaultInjectableMockPool();
    mockPool.queryDelayMs = 25;
    const txManager = new PostgresTransactionManager(mockPool);

    await expect(
      txManager.runInTransaction(async (tx) => {
        // Dos consultas simultáneas sin await secuencial sobre el mismo PoolClient
        await Promise.all([
          tx.executor.query("SELECT SLOW 1"),
          tx.executor.query("SELECT SLOW 2"),
        ]);
      })
    ).rejects.toThrow(ConcurrentClientOperationError);

    expect(mockPool.executedSql).toContain("ROLLBACK");
    expect(mockPool.executedSql).not.toContain("COMMIT");
    expect(mockPool.releases).toHaveLength(1);
    expect(mockPool.releases[0]?.destroyedWithError).toBeInstanceOf(
      ConcurrentClientOperationError
    );
  });

  it("5. Error dentro de SAVEPOINT y fallo de ROLLBACK TO SAVEPOINT: revierte subtransacción o envenena la transacción padre si el savepoint falla", async () => {
    const mockPool = new FaultInjectableMockPool();
    const txManager = new PostgresTransactionManager(mockPool);

    // 5.1 Recuperación limpia de un SAVEPOINT cuando el padre maneja el error
    await txManager.runInTransaction(async (tx) => {
      await tx.executor.query("INSERT INTO sitecorp_auth.users VALUES ('padre')");

      await expect(
        txManager.runInTransaction(
          async (nestedTx) => {
            await nestedTx.executor.query("INSERT INTO sitecorp_auth.users VALUES ('hijo_fallido')");
            throw new Error("Fallo controlado en savepoint");
          },
          { allowNestedSavepoint: true }
        )
      ).rejects.toThrow("Fallo controlado en savepoint");

      await tx.executor.query("INSERT INTO sitecorp_auth.users VALUES ('despues_de_savepoint')");
    });

    expect(mockPool.executedSql).toContain("SAVEPOINT SP_1");
    expect(mockPool.executedSql).toContain("ROLLBACK TO SAVEPOINT SP_1");
    expect(mockPool.executedSql).toContain("RELEASE SAVEPOINT SP_1");
    expect(mockPool.executedSql).toContain("COMMIT");
    expect(mockPool.releases[0]?.destroyedWithError).toBeUndefined();

    // 5.2 Si ROLLBACK TO SAVEPOINT falla, la transacción padre queda envenenada y NO puede hacer COMMIT
    const brokenSpPool = new FaultInjectableMockPool();
    brokenSpPool.failOnRollbackToSavepoint = true;
    const brokenSpTxManager = new PostgresTransactionManager(brokenSpPool);

    await expect(
      brokenSpTxManager.runInTransaction(async () => {
        try {
          await brokenSpTxManager.runInTransaction(
            async () => {
              throw new Error("Error en savepoint con rollback roto");
            },
            { allowNestedSavepoint: true }
          );
        } catch {
          // Aunque el llamador capture el error del savepoint, la transacción padre está envenenada
        }
      })
    ).rejects.toThrow("Simulated SAVEPOINT rollback failure");

    expect(brokenSpPool.executedSql).toContain("ROLLBACK");
    expect(brokenSpPool.executedSql).not.toContain("COMMIT");
    expect(brokenSpPool.releases[0]?.destroyedWithError).toBeInstanceOf(Error);
  });

  it("6. Rechazo de escrituras y bloqueos FOR UPDATE fuera del contexto transaccional permitido", async () => {
    const mockPool = new FaultInjectableMockPool();
    const strictTxManager = new PostgresTransactionManager(mockPool, {
      rejectUnscopedWrites: true,
    });

    // SELECT ... FOR UPDATE fuera de transacción siempre es rechazado
    await expect(
      strictTxManager.query("SELECT id FROM sitecorp_auth.users WHERE id = $1 FOR UPDATE", ["u1"])
    ).rejects.toThrow(UnscopedTransactionalWriteError);

    // DML (INSERT / UPDATE / DELETE) fuera de transacción es rechazado cuando rejectUnscopedWrites = true
    await expect(
      strictTxManager.query("DELETE FROM sitecorp_auth.sessions WHERE id = $1", ["s1"])
    ).rejects.toThrow(UnscopedTransactionalWriteError);

    // Transacciones anidadas sin allowNestedSavepoint son rechazadas
    await expect(
      strictTxManager.runInTransaction(async () => {
        await strictTxManager.runInTransaction(async () => "no permitido");
      })
    ).rejects.toThrow(NestedTransactionNotAllowedError);
  });

  it("7. Auditoría del Migration Runner: bloquea archivos .design.sql y scripts de rollback en entornos productivos y verifica checksums", async () => {
    const mockPool = new FaultInjectableMockPool();
    const txManager = new PostgresTransactionManager(mockPool);

    // 7.1 Prohibido cargar el archivo .design.sql cuando environment = 'production'
    expect(() =>
      loadInitialAuthSchemaMigration(process.cwd(), { environment: "production" })
    ).toThrow(ProductionDesignMigrationForbiddenError);

    // 7.2 Prohibido cargar el archivo .design.sql si connectionHint apunta a Supabase Cloud
    expect(() =>
      loadInitialAuthSchemaMigration(process.cwd(), {
        connectionHint: "postgresql://postgres@db.xxxx.supabase.co:5432/postgres",
      })
    ).toThrow(ProductionDesignMigrationForbiddenError);

    // 7.3 Prohibido aplicar una migración marcada como isDesignArtifact en un runner de producción
    const designMigration = loadInitialAuthSchemaMigration(process.cwd(), {
      environment: "test",
    });
    const prodRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "production",
    });

    await expect(prodRunner.applyMigrations([designMigration])).rejects.toThrow(
      ProductionDesignMigrationForbiddenError
    );

    // 7.4 Prohibido aplicar scripts de rollback o DROP SCHEMA en el runner de avance incluso en test
    const testRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const rollbackSql = "DROP SCHEMA IF EXISTS sitecorp_auth CASCADE;";
    await expect(
      testRunner.applyMigrations([
        {
          version: "0001_sitecorp_auth_schema.rollback",
          description: "Rollback script",
          sql: rollbackSql,
          checksumSha256: computeMigrationChecksum(rollbackSql),
        },
      ])
    ).rejects.toThrow(ProductionDesignMigrationForbiddenError);

    // 7.5 Prohibido aplicar una migración cuyo checksumSha256 no coincida con su propio SQL
    await expect(
      testRunner.applyMigrations([
        {
          version: "0002_tampered",
          description: "Tampered SQL",
          sql: "SELECT 1;",
          checksumSha256: "0".repeat(64),
        },
      ])
    ).rejects.toThrow(MigrationIntegrityError);
  });
});
