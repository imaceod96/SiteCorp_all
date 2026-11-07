import pg from "pg";
import {
  loadAllAuthSchemaMigrations,
  PgPoolLike,
  PostgresMigrationRunner,
  PostgresTransactionManager,
} from "../infrastructure";
import { PgPoolAdapter } from "../presentation/http/entrypoint";

export interface MigrationCliOptions {
  readonly databaseUrl?: string;
  readonly customPool?: PgPoolLike;
  readonly environment?: string;
  readonly command?: "up" | "status";
}

export async function runMigrationCli(
  options: MigrationCliOptions = {}
): Promise<{ applied: readonly string[]; totalApplied: number }> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  let pool: PgPoolLike;

  if (options.customPool) {
    pool = options.customPool;
  } else {
    if (!databaseUrl) {
      throw new Error(
        "Se requiere la variable de entorno 'DATABASE_URL' para ejecutar las migraciones."
      );
    }
    const rawPgPool = new pg.Pool({ connectionString: databaseUrl });
    pool = new PgPoolAdapter(rawPgPool);
  }

  const txManager = new PostgresTransactionManager(pool);
  const runner = new PostgresMigrationRunner(txManager, txManager, {
    environment: options.environment ?? process.env.NODE_ENV ?? "development",
  });

  const command = options.command ?? "up";

  try {
    if (command === "status") {
      const applied = await runner.getAppliedMigrations();
      console.log(`\n[SITECORP AUTH MIGRATIONS STATUS] Total aplicadas: ${applied.length}`);
      for (const m of applied) {
        console.log(` - Versión: ${m.version} | Estado: ${m.status} | Checksum: ${m.checksumSha256.substring(0, 16)}...`);
      }
      return { applied: applied.map((a) => a.version), totalApplied: applied.length };
    }

    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: options.environment ?? process.env.NODE_ENV,
    });
    const appliedNow = await runner.applyMigrations(migrations);

    console.log(`\n[SITECORP AUTH MIGRATIONS] Migraciones ejecutadas exitosamente: ${appliedNow.length}`);
    for (const v of appliedNow) {
      console.log(` ✓ ${v}`);
    }

    const total = await runner.getAppliedMigrations();
    return { applied: appliedNow, totalApplied: total.length };
  } finally {
    if (!options.customPool && "end" in pool && typeof pool.end === "function") {
      await pool.end();
    }
  }
}

// Auto-ejecución si se invoca como CLI directo
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("migrate.ts") || process.argv[1].endsWith("migrate.js"));

if (isDirectExecution) {
  const cmd = process.argv.includes("status") ? "status" : "up";
  runMigrationCli({ command: cmd })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n[ERROR] Fallo al ejecutar migraciones de SiteCorp Auth:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
