import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import {
  AuthUser,
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
} from "../../src/infrastructure";
import { QueryResultRow } from "../../src/interfaces";
import {
  createStandaloneAuthApp,
  startStandaloneServer,
} from "../../src/presentation/http";
import { runMigrationCli } from "../../src/cli/migrate";
import { runBootstrapAdminCli } from "../../src/cli/bootstrap-admin";

class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0;
  private waitQueue: Array<() => void> = [];
  private isLocked = false;

  constructor(private readonly pglite: PGlite) {}

  private async acquireMutex(): Promise<void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private releaseMutex(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.isLocked = false;
    }
  }

  async connect(): Promise<PgPoolClientLike> {
    await this.acquireMutex();
    this.activeClientCount += 1;
    let released = false;

    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ): Promise<{ rows: TRow[]; rowCount: number | null }> => {
        if (released) {
          throw new Error("Attempted to query on a released PoolClient.");
        }
        if (!values || values.length === 0) {
          const execResults = await this.pglite.exec(text);
          const last = execResults[execResults.length - 1];
          const rows = (last?.rows ?? []) as TRow[];
          return {
            rows,
            rowCount:
              rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          };
        }
        const res = await this.pglite.query<TRow>(text, [...values]);
        return {
          rows: res.rows,
          rowCount:
            res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
        };
      },
      release: () => {
        if (!released) {
          released = true;
          this.activeClientCount -= 1;
          this.releaseMutex();
        }
      },
    };
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[]; rowCount: number | null }> {
    await this.acquireMutex();
    try {
      if (!values || values.length === 0) {
        const execResults = await this.pglite.exec(text);
        const last = execResults[execResults.length - 1];
        const rows = (last?.rows ?? []) as TRow[];
        return {
          rows,
          rowCount:
            rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
        };
      }
      const res = await this.pglite.query<TRow>(text, [...values]);
      return {
        rows: res.rows,
        rowCount:
          res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
      };
    } finally {
      this.releaseMutex();
    }
  }

  async end(): Promise<void> {
    // PGlite lifecycle managed in afterAll
  }
}

describe("FASE 4G.3: Standalone Server & CLI Tools", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let keyPair: {
    privateKeyPem: string;
    publicKeyPem: string;
    kid: string;
  };

  const createSilentStream = () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    pool = new EmbeddedPostgresPoolAdapter(pglite);
    keyPair = await generateEphemeralEd25519KeyPair("sitecorp-test-key-2026");
  });

  afterAll(async () => {
    await pglite.close();
  });

  describe("CLI: migrate.ts", () => {
    it("fails when no connection string and no pool is provided", async () => {
      await expect(
        runMigrationCli({
          databaseUrl: undefined,
          customPool: undefined,
        })
      ).rejects.toThrow("DATABASE_URL");
    });

    it(
      "runs migrations 'up' successfully using customPool",
      async () => {
        const result = await runMigrationCli({
          customPool: pool,
          command: "up",
          environment: "test",
        });

        expect(result.applied.length).toBeGreaterThan(0);
        expect(result.totalApplied).toBe(result.applied.length);
      },
      30000
    );

    it("is idempotent: re-running 'up' applies 0 additional migrations", async () => {
      const result = await runMigrationCli({
        customPool: pool,
        command: "up",
        environment: "test",
      });

      expect(result.applied.length).toBe(0);
      expect(result.totalApplied).toBeGreaterThan(0);
    });

    it("returns migration status correctly with command: 'status'", async () => {
      const result = await runMigrationCli({
        customPool: pool,
        command: "status",
        environment: "test",
      });

      expect(result.totalApplied).toBeGreaterThan(0);
      expect(result.applied.length).toBe(result.totalApplied);
    });
  });

  describe("CLI: bootstrap-admin.ts", () => {
    it("fails if SITECORP_ALLOW_INITIAL_ADMIN_BOOTSTRAP is false or missing", async () => {
      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "false",
        })
      ).rejects.toThrow("deshabilitado");
    });

    it("fails if confirmation is missing", async () => {
      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "true",
          confirm: false,
        })
      ).rejects.toThrow("confirmación");
    });

    it("fails if email is missing or empty", async () => {
      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "true",
          confirm: true,
          email: "",
        })
      ).rejects.toThrow("especificar el correo");
    });

    it("fails if target user does not exist", async () => {
      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "true",
          confirm: true,
          email: "nonexistent@sitecorp.cu",
        })
      ).rejects.toThrow("no existe en sitecorp_auth.users");
    });

    it("fails if target user has pending password change (mustChangePassword = true)", async () => {
      const txManager = new PostgresTransactionManager(pool);
      const userRepo = new PostgresUserRepository(txManager);
      const credRepo = new PostgresCredentialRepository(txManager);
      const hasher = new Argon2idPasswordHasher({
        memoryCostKiB: 19456,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
      });

      const user = AuthUser.create(
        createUserId(randomUUID()),
        createEmail("pending-pwd@sitecorp.cu"),
        {
          status: "pending_password_change",
          mustChangePassword: true,
          now: new Date(),
        }
      );
      await userRepo.save(user);
      const passwordHash = await hasher.hash("TempPassword#2026!");
      await credRepo.save({
        id: randomUUID(),
        userId: user.id,
        algorithm: hasher.algorithm,
        passwordHash,
        version: 1,
        createdAt: new Date(),
      });

      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "true",
          confirm: true,
          email: "pending-pwd@sitecorp.cu",
        })
      ).rejects.toThrow("cambio de contraseña pendiente");
    });

    it("successfully bootstraps the first operator admin with confirm", async () => {
      const txManager = new PostgresTransactionManager(pool);
      const userRepo = new PostgresUserRepository(txManager);
      const credRepo = new PostgresCredentialRepository(txManager);
      const hasher = new Argon2idPasswordHasher({
        memoryCostKiB: 19456,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
      });

      const user = AuthUser.create(
        createUserId(randomUUID()),
        createEmail("first-admin@sitecorp.cu"),
        {
          status: "active",
          mustChangePassword: false,
          now: new Date(),
        }
      );
      await userRepo.save(user);
      const passwordHash = await hasher.hash("SecureAdminPassword#2026!");
      await credRepo.save({
        id: randomUUID(),
        userId: user.id,
        algorithm: hasher.algorithm,
        passwordHash,
        version: 1,
        createdAt: new Date(),
      });

      const result = await runBootstrapAdminCli({
        customPool: pool,
        allowBootstrapEnv: "true",
        confirm: true,
        email: "first-admin@sitecorp.cu",
      });

      expect(result.success).toBe(true);
      expect(result.grantedRecords.length).toBeGreaterThan(0);
      const permNames = result.grantedRecords.map((r) => r.permission);
      expect(permNames).toContain("users.manage");
      expect(permNames).toContain("security.manage");
      expect(permNames).toContain("security.admin");
    });

    it("refuses subsequent bootstrap execution (single-execution protection)", async () => {
      await expect(
        runBootstrapAdminCli({
          customPool: pool,
          allowBootstrapEnv: "true",
          confirm: true,
          email: "first-admin@sitecorp.cu",
        })
      ).rejects.toThrow();
    });
  });

  describe("Standalone Server Factory and Health Probes", () => {
    const getValidEnv = (): Record<string, string> => ({
      NODE_ENV: "test",
      SITECORP_HTTP_PORT: "4010",
      SITECORP_HTTP_HOST: "127.0.0.1",
      SITECORP_JWT_PRIVATE_KEY_PEM: keyPair.privateKeyPem,
      SITECORP_JWT_PUBLIC_KEY_PEM: keyPair.publicKeyPem,
      SITECORP_JWT_ACTIVE_KID: keyPair.kid,
      SITECORP_JWT_ISSUER: "https://auth.sitecorp.cu",
      SITECORP_JWT_AUDIENCE: "sitecorp-app",
      SITECORP_COOKIE_DOMAIN: "sitecorp.cu",
      SITECORP_COOKIE_SECURE: "true",
      SITECORP_COOKIE_SAME_SITE: "strict",
      SITECORP_CSRF_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
      SITECORP_CORS_ALLOWED_ORIGINS: "https://app.sitecorp.cu",
      SITECORP_RATE_LIMIT_GLOBAL_MAX: "1000",
      SITECORP_RATE_LIMIT_GLOBAL_WINDOW_MS: "60000",
      SITECORP_RATE_LIMIT_AUTH_MAX: "100",
      SITECORP_RATE_LIMIT_AUTH_WINDOW_MS: "60000",
      SITECORP_ARGON2_MEMORY_KIB: "19456",
      SITECORP_ARGON2_TIME_COST: "2",
      SITECORP_ARGON2_PARALLELISM: "1",
    });

    it("creates standalone app and responds to liveness probe", async () => {
      const { server } = await createStandaloneAuthApp({
        env: getValidEnv(),
        customPool: pool,
        logStream: createSilentStream(),
      });

      const liveRes = await server.app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(liveRes.statusCode).toBe(200);
      const liveJson = liveRes.json();
      expect(liveJson.data.status).toBe("ok");

      await server.app.close();
    });

    it("responds to readiness probe with database and crypto checks", async () => {
      const { server } = await createStandaloneAuthApp({
        env: getValidEnv(),
        customPool: pool,
        logStream: createSilentStream(),
      });

      const readyRes = await server.app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(readyRes.statusCode).toBe(200);
      const readyJson = readyRes.json();
      expect(readyJson.data.status).toBe("ready");

      await server.app.close();
    });

    it("can start and stop standalone server cleanly", async () => {
      const running = await startStandaloneServer({
        env: {
          ...getValidEnv(),
          SITECORP_HTTP_PORT: "4011",
        },
        customPool: pool,
        logStream: createSilentStream(),
      });

      expect(running.listenAddress).toBeDefined();

      // Execute stop cleanly
      await expect(running.stop()).resolves.toBeUndefined();
    });
  });
});
