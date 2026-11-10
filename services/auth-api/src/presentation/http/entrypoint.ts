import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadAllAuthSchemaMigrations,
  loadCryptoConfigFromEnv,
  loadHttpConfigFromEnv,
  LocalFileStorageService,
  PgPoolClientLike,
  PgPoolLike,
  PostgresActivationTokenRepository,
  PostgresCredentialRepository,
  PostgresDomainRepository,
  PostgresMigrationRunner,
  PostgresOperatorPermissionRepository,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresSubmodulesRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  SmtpTransactionalEmailService,
  loadSmtpConfigFromEnv,
} from "../../infrastructure";
import {
  AuthorizationPolicyService,
  QueryResultRow,
  RepositoryOperatorPrincipalResolver,
} from "../../interfaces";
import {
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "./server";

export interface StandaloneServerOptions {
  readonly env?: Record<string, string | undefined>;
  readonly customPool?: PgPoolLike;
  readonly logStream?: Writable;
  readonly nowProvider?: () => Date;
}

export interface RunningStandaloneServer {
  readonly server: BuiltAuthHttpServer;
  readonly pool: PgPoolLike;
  readonly listenAddress: string;
  readonly stop: () => Promise<void>;
}

function normalizePgQueryResult<TRow extends QueryResultRow>(
  res: pg.QueryResult<TRow> | pg.QueryResult<TRow>[]
): { rows: TRow[]; rowCount: number | null } {
  if (Array.isArray(res)) {
    const last = res[res.length - 1];
    return {
      rows: last?.rows ?? [],
      rowCount: last?.rowCount ?? (last?.rows ? last.rows.length : 0),
    };
  }
  return {
    rows: res?.rows ?? [],
    rowCount: res?.rowCount ?? (res?.rows ? res.rows.length : 0),
  };
}

export class PgPoolAdapter implements PgPoolLike {
  constructor(private readonly pool: pg.Pool) {}

  async connect(): Promise<PgPoolClientLike> {
    const client = await this.pool.connect();
    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ) => {
        const res =
          values && values.length > 0
            ? await client.query<TRow>(text, [...values])
            : await client.query<TRow>(text);
        return normalizePgQueryResult(res);
      },
      release: (err?: Error | boolean) => {
        client.release(err);
      },
    };
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ) {
    const res =
      values && values.length > 0
        ? await this.pool.query<TRow>(text, [...values])
        : await this.pool.query<TRow>(text);
    return normalizePgQueryResult(res);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

function resolveEffectiveEnvWithDevKeys(
  rawEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...rawEnv };
  const mode = (env.SITECORP_AUTH_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  const autoGen = env.SITECORP_AUTO_GENERATE_DEV_KEYS?.trim().toLowerCase() === "true";

  if (autoGen && (mode === "development" || mode === "test")) {
    const storageRootDir =
      env.STORAGE_LOCAL_ROOT_DIR?.trim() ||
      env.STORAGE_BASE_DIR?.trim() ||
      "/tmp/sitecorp-autonomous-storage";
    const keyFilePath = path.join(storageRootDir, ".dev-ed25519-keypair.json");
    const defaultKid = env.SITECORP_JWT_ACTIVE_KID?.trim() || "ed25519-local-dev-v1";

    let loaded: {
      kid: string;
      privateKeyPem: string;
      publicKeyPem: string;
      csrfHmacSecret: string;
    } | null = null;
    try {
      if (fs.existsSync(keyFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(keyFilePath, "utf8")) as {
          kid?: string;
          privateKeyPem?: string;
          publicKeyPem?: string;
          csrfHmacSecret?: string;
        };
        if (parsed?.kid && parsed?.privateKeyPem && parsed?.publicKeyPem) {
          loaded = {
            kid: parsed.kid,
            privateKeyPem: parsed.privateKeyPem,
            publicKeyPem: parsed.publicKeyPem,
            csrfHmacSecret:
              parsed.csrfHmacSecret && parsed.csrfHmacSecret.length >= 32
                ? parsed.csrfHmacSecret
                : randomBytes(32).toString("hex"),
          };
        }
      }
    } catch {
      loaded = null;
    }

    if (!loaded) {
      const generated = generateEphemeralEd25519KeyPair(defaultKid, mode);
      loaded = {
        kid: generated.kid,
        privateKeyPem: generated.privateKeyPem,
        publicKeyPem: generated.publicKeyPem,
        csrfHmacSecret: randomBytes(32).toString("hex"),
      };
      try {
        fs.mkdirSync(storageRootDir, { recursive: true });
        fs.writeFileSync(keyFilePath, JSON.stringify(loaded, null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });
      } catch {
        // En caso de sistema de archivos de solo lectura, usar el par en memoria
      }
    }

    if (!env.SITECORP_JWT_PRIVATE_KEY_PEM?.trim() || !env.SITECORP_JWT_PUBLIC_KEY_PEM?.trim()) {
      env.SITECORP_JWT_ACTIVE_KID = loaded.kid;
      env.SITECORP_JWT_PRIVATE_KEY_PEM = loaded.privateKeyPem;
      env.SITECORP_JWT_PUBLIC_KEY_PEM = loaded.publicKeyPem;
    }
    if (!env.SITECORP_CSRF_HMAC_SECRET?.trim()) {
      env.SITECORP_CSRF_HMAC_SECRET = loaded.csrfHmacSecret;
    }
    if (!env.SITECORP_HTTP_ALLOWED_ORIGINS?.trim()) {
      env.SITECORP_HTTP_ALLOWED_ORIGINS =
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173";
    }
  }

  return env;
}

/**
 * Factoría que inicializa y conecta todas las dependencias del backend autónomo
 * de autenticación y dominio (PostgreSQL, Criptografía Argon2id y Ed25519, Storage, SMTP, Fastify v5).
 */
export async function createStandaloneAuthApp(
  options: StandaloneServerOptions = {}
): Promise<{ server: BuiltAuthHttpServer; pool: PgPoolLike }> {
  const env = resolveEffectiveEnvWithDevKeys(options.env ?? process.env);

  // 1. Cargar configuraciones validadas (fail-closed)
  const httpConfig = loadHttpConfigFromEnv(env);
  const cryptoConfig = loadCryptoConfigFromEnv(env);

  // 2. Conectar pool PostgreSQL
  let pool: PgPoolLike;
  if (options.customPool) {
    pool = options.customPool;
  } else {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "La variable de entorno 'DATABASE_URL' es obligatoria para arrancar el backend autónomo."
      );
    }
    const rawPgPool = new pg.Pool({
      connectionString,
      max: Number(env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
      connectionTimeoutMillis: Number(env.DATABASE_CONNECT_TIMEOUT_MS ?? 5000),
    });
    pool = new PgPoolAdapter(rawPgPool);
  }

  // 3. Inicializar repositorios transaccionales y de dominio
  const txManager = new PostgresTransactionManager(pool);
  if (env.SITECORP_AUTO_MIGRATE?.trim().toLowerCase() === "true") {
    const migrationRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: httpConfig.environment,
    });
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: httpConfig.environment,
    });
    await migrationRunner.applyMigrations(migrations);
  }
  const userRepo = new PostgresUserRepository(txManager);
  const credentialRepo = new PostgresCredentialRepository(txManager);
  const sessionRepo = new PostgresSessionRepository(txManager, txManager);
  const activationTokenRepo = new PostgresActivationTokenRepository(txManager);
  const auditService = new PostgresSecurityAuditService(txManager);
  const permissionRepo = new PostgresOperatorPermissionRepository(txManager);
  const domainRepo = new PostgresDomainRepository(txManager);
  const submodulesRepo = new PostgresSubmodulesRepository(txManager, domainRepo);

  // 4. Storage local autónomo y correo transaccional SMTP (si está configurado)
  const storageRootDir =
    env.STORAGE_LOCAL_ROOT_DIR?.trim() ||
    env.STORAGE_BASE_DIR?.trim() ||
    "/tmp/sitecorp-autonomous-storage";
  const storageService = new LocalFileStorageService(txManager, storageRootDir);

  const smtpConfig = loadSmtpConfigFromEnv(env);
  const emailService = smtpConfig
    ? new SmtpTransactionalEmailService(smtpConfig)
    : undefined;

  // 5. Adaptadores criptográficos y autorización autoritativa
  const passwordHasher = new Argon2idPasswordHasher(cryptoConfig.argon2id);
  const tokenService = new JoseTokenService(cryptoConfig.jwt);
  const authPolicy = new AuthorizationPolicyService();
  const operatorPrincipalResolver = new RepositoryOperatorPrincipalResolver(
    permissionRepo
  );

  // 6. Sondas de preparación (/health/ready)
  const databaseReadinessCheck = async (): Promise<boolean> => {
    try {
      const res = await pool.query<{ ok: number }>("SELECT 1 AS ok");
      return res.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  };

  const cryptoReadinessCheck = async (): Promise<boolean> => {
    return (
      typeof cryptoConfig.jwt.activeSigningKey.kid === "string" &&
      cryptoConfig.jwt.activeSigningKey.kid.length > 0
    );
  };

  // 7. Construir servidor Fastify v5
  const server = await buildAuthHttpServer({
    httpConfig,
    tokenService,
    userRepo,
    sessionRepo,
    credentialRepo,
    activationTokenRepo,
    operatorPermissionRepo: permissionRepo,
    domainRepo,
    submodulesRepo,
    storageService,
    emailService,
    passwordHasher,
    auditService,
    txManager,
    authPolicy,
    operatorPrincipalResolver,
    databaseReadinessCheck,
    cryptoReadinessCheck,
    logStream: options.logStream,
    nowProvider: options.nowProvider,
  });

  return { server, pool };
}

/**
 * Arranca el servidor autónomo escuchando en HOST y PORT configurados
 * con soporte para graceful shutdown mediante SIGTERM / SIGINT.
 */
export async function startStandaloneServer(
  options: StandaloneServerOptions = {}
): Promise<RunningStandaloneServer> {
  const resolvedEnv = resolveEffectiveEnvWithDevKeys(options.env ?? process.env);
  const { server, pool } = await createStandaloneAuthApp({
    ...options,
    env: resolvedEnv,
  });
  const httpConfig = loadHttpConfigFromEnv(resolvedEnv);

  const listenAddress = await server.app.listen({
    host: httpConfig.host,
    port: httpConfig.port,
  });

  server.app.log.info(
    {
      address: listenAddress,
      host: httpConfig.host,
      port: httpConfig.port,
      environment: httpConfig.environment,
    },
    "SiteCorp Auth API server started successfully"
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.app.log.info("Initiating graceful shutdown...");
    try {
      await server.app.close();
      if (!options.customPool && "end" in pool && typeof pool.end === "function") {
        await pool.end();
      }
      server.app.log.info("SiteCorp Auth API server stopped cleanly");
    } catch (err) {
      server.app.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "Error during shutdown"
      );
      throw err;
    }
  };

  return {
    server,
    pool,
    listenAddress,
    stop,
  };
}

// Auto-arranque si se ejecuta directamente como script principal
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("entrypoint.ts") ||
    process.argv[1].endsWith("entrypoint.js"));

if (isDirectExecution) {
  startStandaloneServer()
    .then((running) => {
      const handleSignal = (signal: string) => {
        running.server.app.log.info(`Received ${signal}, shutting down...`);
        running
          .stop()
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      };

      process.on("SIGTERM", () => handleSignal("SIGTERM"));
      process.on("SIGINT", () => handleSignal("SIGINT"));
    })
    .catch((err) => {
      console.error("Fatal error starting SiteCorp Auth API:", err);
      process.exit(1);
    });
}
