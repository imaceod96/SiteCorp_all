import pg from "pg";
import { Writable } from "node:stream";
import {
  Argon2idPasswordHasher,
  JoseTokenService,
  loadCryptoConfigFromEnv,
  loadHttpConfigFromEnv,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresOperatorPermissionRepository,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
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

export class PgPoolAdapter implements PgPoolLike {
  constructor(private readonly pool: pg.Pool) {}

  async connect(): Promise<PgPoolClientLike> {
    const client = await this.pool.connect();
    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ) => {
        const res = await client.query<TRow>(text, values ? [...values] : undefined);
        return {
          rows: res.rows,
          rowCount: res.rowCount,
        };
      },
      release: () => {
        client.release();
      },
    };
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ) {
    const res = await this.pool.query<TRow>(text, values ? [...values] : undefined);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Factoría que inicializa y conecta todas las dependencias del backend autónomo
 * de autenticación (PostgreSQL, Criptografía Argon2id y Ed25519, Fastify v5).
 */
export async function createStandaloneAuthApp(
  options: StandaloneServerOptions = {}
): Promise<{ server: BuiltAuthHttpServer; pool: PgPoolLike }> {
  const env = options.env ?? process.env;

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

  // 3. Inicializar repositorios transaccionales
  const txManager = new PostgresTransactionManager(pool);
  const userRepo = new PostgresUserRepository(txManager);
  const credentialRepo = new PostgresCredentialRepository(txManager);
  const sessionRepo = new PostgresSessionRepository(txManager, txManager);
  const auditService = new PostgresSecurityAuditService(txManager);
  const permissionRepo = new PostgresOperatorPermissionRepository(txManager);

  // 4. Adaptadores criptográficos y autorización autoritativa
  const passwordHasher = new Argon2idPasswordHasher(cryptoConfig.argon2id);
  const tokenService = new JoseTokenService(cryptoConfig.jwt);
  const authPolicy = new AuthorizationPolicyService();
  const operatorPrincipalResolver = new RepositoryOperatorPrincipalResolver(
    permissionRepo
  );

  // 5. Sondas de preparación (/health/ready)
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

  // 6. Construir servidor Fastify v5
  const server = await buildAuthHttpServer({
    httpConfig,
    tokenService,
    userRepo,
    sessionRepo,
    credentialRepo,
    operatorPermissionRepo: permissionRepo,
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
  const { server, pool } = await createStandaloneAuthApp(options);
  const httpConfig = loadHttpConfigFromEnv(options.env ?? process.env);

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
