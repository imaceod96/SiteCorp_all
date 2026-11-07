import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDatabaseClient, ITransactionManager } from "../../interfaces";

export interface MigrationDefinition {
  readonly version: string;
  readonly description: string;
  readonly sql: string;
  readonly checksumSha256: string;
  readonly isDesignArtifact?: boolean;
  readonly sourceFileName?: string;
}

export class MigrationIntegrityError extends Error {
  public readonly code = "MIGRATION_CHECKSUM_MISMATCH";
  constructor(version: string, expected: string, actual: string) {
    super(
      `Error de integridad en migración '${version}': checksum esperado (${expected}) difiere del calculado (${actual}).`
    );
    this.name = "MigrationIntegrityError";
  }
}

export class ProductionDesignMigrationForbiddenError extends Error {
  public readonly code = "PRODUCTION_DESIGN_MIGRATION_FORBIDDEN";
  constructor(artifactName: string) {
    super(
      `Ejecución bloqueada por seguridad: el artefacto de diseño o rollback '${artifactName}' no puede ejecutarse automáticamente en entornos productivos ni sobre conexiones remotas protegidas.`
    );
    this.name = "ProductionDesignMigrationForbiddenError";
  }
}

export function computeMigrationChecksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function isProtectedProductionTarget(
  environment?: string,
  connectionHint?: string
): boolean {
  const env = (environment ?? process.env.NODE_ENV ?? "development")
    .trim()
    .toLowerCase();
  if (env === "production" || env === "prod") {
    return true;
  }
  const hint = (connectionHint ?? "").toLowerCase();
  if (
    hint.includes("supabase.co") ||
    hint.includes("pooler.supabase.com") ||
    hint.includes("production")
  ) {
    return true;
  }
  return false;
}

/**
 * Carga el archivo de diseño SQL `0001_sitecorp_auth_schema.design.sql` eliminando
 * los delimitadores `BEGIN;` y `COMMIT;` externos para que `PostgresMigrationRunner`
 * lo ejecute dentro de su propia transacción controlada.
 *
 * Bloquea su carga si `NODE_ENV === 'production'` o si el entorno objetivo es productivo.
 */
export function loadInitialAuthSchemaMigration(
  baseDir?: string,
  options?: { environment?: string; connectionHint?: string }
): MigrationDefinition {
  const sourceFileName = "0001_sitecorp_auth_schema.design.sql";
  if (isProtectedProductionTarget(options?.environment, options?.connectionHint)) {
    throw new ProductionDesignMigrationForbiddenError(sourceFileName);
  }

  const filePath = resolve(
    baseDir ?? process.cwd(),
    `db/migrations/${sourceFileName}`
  );
  const rawSql = readFileSync(filePath, "utf8");

  const innerSql = rawSql
    .replace(/^\s*BEGIN\s*;/im, "")
    .replace(/COMMIT\s*;\s*$/im, "")
    .trim();

  const checksumSha256 = computeMigrationChecksum(innerSql);

  return {
    version: "0001_sitecorp_auth_schema",
    description: "Initial isolated sitecorp_auth schema, constraints, and indexes",
    sql: innerSql,
    checksumSha256,
    isDesignArtifact: true,
    sourceFileName,
  };
}

/**
 * Carga el archivo de diseño SQL `0002_sitecorp_auth_operator_permissions.design.sql`
 * para la tabla autoritativa de permisos de operadores administrativos.
 *
 * Bloquea su carga si `NODE_ENV === 'production'` o si el entorno objetivo es productivo.
 */
export function loadOperatorPermissionsMigration(
  baseDir?: string,
  options?: { environment?: string; connectionHint?: string }
): MigrationDefinition {
  const sourceFileName = "0002_sitecorp_auth_operator_permissions.design.sql";
  if (isProtectedProductionTarget(options?.environment, options?.connectionHint)) {
    throw new ProductionDesignMigrationForbiddenError(sourceFileName);
  }

  const filePath = resolve(
    baseDir ?? process.cwd(),
    `db/migrations/${sourceFileName}`
  );
  const rawSql = readFileSync(filePath, "utf8");

  const innerSql = rawSql
    .replace(/^\s*BEGIN\s*;/im, "")
    .replace(/COMMIT\s*;\s*$/im, "")
    .trim();

  const checksumSha256 = computeMigrationChecksum(innerSql);

  return {
    version: "0002_sitecorp_auth_operator_permissions",
    description:
      "Authoritative persistent operator permissions table, constraints, and indexes",
    sql: innerSql,
    checksumSha256,
    isDesignArtifact: true,
    sourceFileName,
  };
}

/**
 * Carga la secuencia completa de migraciones de diseño de SiteCorp Auth (`0001` y `0002`).
 */
export function loadAllAuthSchemaMigrations(
  baseDir?: string,
  options?: { environment?: string; connectionHint?: string }
): readonly MigrationDefinition[] {
  return [
    loadInitialAuthSchemaMigration(baseDir, options),
    loadOperatorPermissionsMigration(baseDir, options),
  ];
}

/**
 * Ejecutor de migraciones versionadas para el entorno aislado de SiteCorp Auth API.
 *
 * - Impide la ejecución automática de archivos `.design.sql` o `.rollback.design.sql` en producción.
 * - Valida que el `checksumSha256` declarado coincida con el SHA-256 real de `migration.sql` antes de ejecutar.
 * - Adquiere bloqueo consultivo `pg_advisory_xact_lock` para impedir ejecuciones concurrentes.
 * - Verifica checksums SHA-256 de las migraciones previamente aplicadas en `sitecorp_auth.schema_migrations`.
 * - Ejecuta cada migración pendiente dentro de una transacción ACID (`runInTransaction`).
 */
export class PostgresMigrationRunner {
  private static readonly MIGRATION_ADVISORY_LOCK_KEY = 849201746;

  constructor(
    private readonly db: IDatabaseClient,
    private readonly txManager: ITransactionManager,
    private readonly options: {
      environment?: string;
      connectionHint?: string;
    } = {}
  ) {}

  private assertMigrationAllowed(migration: MigrationDefinition): void {
    const fileOrVersion = migration.sourceFileName ?? migration.version;

    // 1. Prohibir siempre ejecutar scripts de rollback en el runner de avance
    if (
      fileOrVersion.toLowerCase().includes("rollback") ||
      /^\s*DROP\s+SCHEMA\s+IF\s+EXISTS\s+sitecorp_auth\s+CASCADE/im.test(migration.sql)
    ) {
      throw new ProductionDesignMigrationForbiddenError(fileOrVersion);
    }

    // 2. Prohibir ejecutar artefactos .design.sql en entornos productivos o conexiones remotas protegidas
    const isDesign =
      migration.isDesignArtifact === true ||
      fileOrVersion.toLowerCase().endsWith(".design.sql");

    if (
      isDesign &&
      isProtectedProductionTarget(
        this.options.environment,
        this.options.connectionHint
      )
    ) {
      throw new ProductionDesignMigrationForbiddenError(fileOrVersion);
    }

    // 3. Verificar que el checksumSha256 declarado sea un SHA-256 válido y coincida con el contenido SQL
    const actualSqlChecksum = computeMigrationChecksum(migration.sql);
    if (
      !/^[0-9a-f]{64}$/.test(migration.checksumSha256) ||
      migration.checksumSha256 !== actualSqlChecksum
    ) {
      throw new MigrationIntegrityError(
        migration.version,
        migration.checksumSha256,
        actualSqlChecksum
      );
    }
  }

  async applyMigrations(
    migrations: readonly MigrationDefinition[]
  ): Promise<readonly string[]> {
    const appliedNow: string[] = [];

    for (const migration of migrations) {
      this.assertMigrationAllowed(migration);

      await this.txManager.runInTransaction(async (tx) => {
        // 1. Bloqueo consultivo transaccional para serializar migraciones concurrentes
        await tx.executor.query(`SELECT pg_advisory_xact_lock($1)`, [
          PostgresMigrationRunner.MIGRATION_ADVISORY_LOCK_KEY,
        ]);

        // 2. Asegurar existencia del esquema y tabla de control antes de consultar versiones
        await tx.executor.query(`CREATE SCHEMA IF NOT EXISTS sitecorp_auth`);
        await tx.executor.query(`
          CREATE TABLE IF NOT EXISTS sitecorp_auth.schema_migrations (
            version         VARCHAR(64) PRIMARY KEY,
            description     VARCHAR(255) NOT NULL,
            checksum_sha256 CHAR(64) NOT NULL,
            status          VARCHAR(16) NOT NULL DEFAULT 'applied',
            applied_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            applied_by      VARCHAR(128) NOT NULL DEFAULT CURRENT_USER,
            execution_ms    INTEGER NOT NULL CHECK (execution_ms >= 0),
            CONSTRAINT chk_schema_migrations_status CHECK (
              status IN ('applied', 'failed', 'rolled_back')
            ),
            CONSTRAINT chk_schema_migrations_checksum_hex CHECK (
              checksum_sha256 ~ '^[0-9a-f]{64}$'
            )
          )
        `);

        // 3. Verificar si la versión ya fue aplicada y comprobar su checksum SHA-256
        const existing = await tx.executor.query<{
          version: string;
          checksum_sha256: string;
          status: string;
        }>(
          `SELECT version, checksum_sha256, status
           FROM sitecorp_auth.schema_migrations
           WHERE version = $1
           FOR UPDATE`,
          [migration.version]
        );

        const row = existing.rows[0];
        if (row && row.status === "applied") {
          const storedChecksum = row.checksum_sha256.trim();
          if (storedChecksum !== migration.checksumSha256) {
            throw new MigrationIntegrityError(
              migration.version,
              storedChecksum,
              migration.checksumSha256
            );
          }
          return;
        }

        // 4. Ejecutar DDL de la migración dentro de la transacción activa
        const t0 = Date.now();
        await tx.executor.query(migration.sql);
        const executionMs = Math.max(0, Date.now() - t0);

        // 5. Registrar versión aplicada con su checksum
        await tx.executor.query(
          `INSERT INTO sitecorp_auth.schema_migrations (
             version, description, checksum_sha256, status, applied_at, execution_ms
           ) VALUES ($1, $2, $3, 'applied', CURRENT_TIMESTAMP, $4)
           ON CONFLICT (version) DO UPDATE SET
             checksum_sha256 = EXCLUDED.checksum_sha256,
             status = 'applied',
             applied_at = CURRENT_TIMESTAMP,
             execution_ms = EXCLUDED.execution_ms`,
          [migration.version, migration.description, migration.checksumSha256, executionMs]
        );

        appliedNow.push(migration.version);
      });
    }

    return appliedNow;
  }

  async getAppliedMigrations(): Promise<
    readonly { version: string; checksumSha256: string; status: string }[]
  > {
    const result = await this.db.getActiveExecutor().query<{
      version: string;
      checksum_sha256: string;
      status: string;
    }>(
      `SELECT version, checksum_sha256, status
       FROM sitecorp_auth.schema_migrations
       ORDER BY version ASC`
    );
    return result.rows.map((row) => ({
      version: row.version,
      checksumSha256: row.checksum_sha256.trim(),
      status: row.status,
    }));
  }
}
