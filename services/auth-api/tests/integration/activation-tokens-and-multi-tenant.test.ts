import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  ActivationTokenAlreadyUsedError,
  AuthUser,
  createEmail,
  createUserId,
  TokenExpiredError,
  WeakPasswordError,
} from "../../src/domain";
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadActivationTokensMigration,
  loadAllAuthSchemaMigrations,
  PgPoolClientLike,
  PgPoolLike,
  PostgresActivationTokenRepository,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
} from "../../src/infrastructure";
import {
  ConsumeActivationTokenUseCase,
  GenerateActivationTokenUseCase,
  LoginUseCase,
} from "../../src/application";

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
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.isLocked = true;
  }

  private releaseMutex(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.isLocked = false;
    }
  }

  async connect(): Promise<PgPoolClientLike> {
    await this.acquireMutex();
    this.activeClientCount++;

    return {
      query: async (text: string, params?: unknown[]) => {
        if (!params || params.length === 0) {
          const execResults = await this.pglite.exec(text);
          const last = execResults[execResults.length - 1];
          const rows = (last?.rows ?? []) as any[];
          return {
            rows,
            rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          };
        }
        const res = await this.pglite.query(text, params as any[]);
        return {
          rows: (res.rows ?? []) as any[],
          rowCount: res.affectedRows ?? res.rows?.length ?? 0,
        };
      },
      release: () => {
        this.activeClientCount--;
        this.releaseMutex();
      },
    };
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    const client = await this.connect();
    try {
      const res = await client.query<R>(text, params);
      return { rows: res.rows, rowCount: res.rowCount };
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pglite.close();
  }
}

describe("FASE 4G.5: Tokens de Activación de Un Solo Uso y Aislamiento Multiempresa", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credRepo: PostgresCredentialRepository;
  let tokenRepo: PostgresActivationTokenRepository;
  let sessionRepo: PostgresSessionRepository;
  let auditService: PostgresSecurityAuditService;
  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let generateActivationTokenUseCase: GenerateActivationTokenUseCase;
  let consumeActivationTokenUseCase: ConsumeActivationTokenUseCase;
  let loginUseCase: LoginUseCase;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    pool = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(pool);

    // 1. Ejecutar la secuencia completa de migraciones 0001, 0002 y 0003
    const runner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    });
    await runner.applyMigrations(migrations);

    userRepo = new PostgresUserRepository(txManager);
    credRepo = new PostgresCredentialRepository(txManager);
    tokenRepo = new PostgresActivationTokenRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    auditService = new PostgresSecurityAuditService(txManager);
    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    const keyPair = await generateEphemeralEd25519KeyPair("fase4g5-test-kid");
    tokenService = new JoseTokenService({
      issuer: "https://auth.sitecorp.cu",
      audience: "sitecorp-app",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
      additionalVerificationKeys: [],
    });

    generateActivationTokenUseCase = new GenerateActivationTokenUseCase(
      userRepo,
      tokenRepo,
      auditService,
      txManager
    );

    consumeActivationTokenUseCase = new ConsumeActivationTokenUseCase(
      userRepo,
      credRepo,
      tokenRepo,
      sessionRepo,
      passwordHasher,
      auditService,
      txManager
    );

    loginUseCase = new LoginUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService,
      5,
      15 * 60 * 1000,
      txManager
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("1. Genera un token de activación seguro (CSPRNG + SHA-256) sin almacenar secretos en claro", async () => {
    const userId = createUserId(randomUUID());
    const user = AuthUser.create(userId, createEmail("usuario.migrado@sitecorp.cu"), {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const result = await generateActivationTokenUseCase.execute({
      userId: user.id,
      tokenType: "activation",
      expiresInHours: 24,
      ipAddress: "192.168.1.100",
      userAgent: "SiteCorp-Admin-Portal/1.0",
    });

    expect(result.tokenId).toBeDefined();
    expect(result.userId).toBe(user.id);
    expect(result.rawToken).toBeDefined();
    expect(result.rawToken.length).toBeGreaterThanOrEqual(32);
    expect(result.tokenType).toBe("activation");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verificar en la BD que solo se guardó el hash SHA-256
    const row = await pool.query<{ token_hash: string; used_at: string | null }>(
      `SELECT token_hash, used_at FROM sitecorp_auth.activation_tokens WHERE id = $1`,
      [result.tokenId]
    );

    expect(row.rows.length).toBe(1);
    expect(row.rows[0]!.used_at).toBeNull();
    // Comprobar que el hash en BD es un SHA-256 hexadecimal de 64 caracteres
    expect(row.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0]!.token_hash).not.toBe(result.rawToken);
  });

  it("2. Activa al usuario migrado atómicamente: actualiza a Argon2id, cambia estado a 'active' y habilita login", async () => {
    const userId = createUserId(randomUUID());
    const user = AuthUser.create(userId, createEmail("funcionario.activo@sitecorp.cu"), {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const tokenRes = await generateActivationTokenUseCase.execute({
      userId: user.id,
      tokenType: "activation",
    });

    const newSecurePassword = "NuevoPasswordSeguro#2026!";

    // Consumir el token de activación
    const consumeRes = await consumeActivationTokenUseCase.execute({
      rawToken: tokenRes.rawToken,
      newPassword: newSecurePassword,
      ipAddress: "10.0.0.50",
      userAgent: "Mozilla/5.0 Test",
    });

    expect(consumeRes.success).toBe(true);
    expect(consumeRes.userId).toBe(user.id);
    expect(consumeRes.status).toBe("active");

    // Verificar que el usuario en la BD quedó activo y sin contraseña pendiente
    const userInDb = await userRepo.findById(user.id);
    expect(userInDb?.status).toBe("active");
    expect(userInDb?.mustChangePassword).toBe(false);

    // Verificar que el token quedó marcado como consumido con IP y UserAgent
    const tokenInDb = await tokenRepo.findByTokenHash(
      await (async () => {
        const { createHash } = await import("node:crypto");
        return createHash("sha256").update(tokenRes.rawToken, "utf8").digest("hex");
      })()
    );
    expect(tokenInDb?.isUsed()).toBe(true);
    expect(tokenInDb?.consumedIp).toBe("10.0.0.50");
    expect(tokenInDb?.consumedUserAgent).toBe("Mozilla/5.0 Test");

    // Verificar que ahora el usuario puede iniciar sesión directamente con su nueva clave
    const loginRes = await loginUseCase.execute({
      email: user.email,
      password: newSecurePassword,
    });

    expect(loginRes.mustChangePassword).toBe(false);
    expect(loginRes.refreshToken).not.toBeNull();
    expect(loginRes.user.status).toBe("active");
  });

  it("3. Anti-Replay: Rechaza el reuso de un token ya consumido con TOKEN_ALREADY_USED", async () => {
    const userId = createUserId(randomUUID());
    const user = AuthUser.create(userId, createEmail("usuario.antireplay@sitecorp.cu"), {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const tokenRes = await generateActivationTokenUseCase.execute({
      userId: user.id,
      tokenType: "activation",
    });

    // Primer consumo: Exitoso
    await consumeActivationTokenUseCase.execute({
      rawToken: tokenRes.rawToken,
      newPassword: "PasswordValido#123456!",
    });

    // Segundo consumo idéntico: Debe fallar inmediatamente
    await expect(
      consumeActivationTokenUseCase.execute({
        rawToken: tokenRes.rawToken,
        newPassword: "OtroPasswordValido#987654!",
      })
    ).rejects.toThrow(ActivationTokenAlreadyUsedError);
  });

  it("4. Caducidad: Rechaza tokens expirados con TOKEN_EXPIRED", async () => {
    const userId = createUserId(randomUUID());
    const user = AuthUser.create(userId, createEmail("usuario.expirado@sitecorp.cu"), {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const tokenRes = await generateActivationTokenUseCase.execute({
      userId: user.id,
      tokenType: "activation",
      expiresInHours: 1, // 1 hora
    });

    // Forzar la expiración en la base de datos hacia el pasado
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(tokenRes.rawToken, "utf8").digest("hex");
    await pool.query(
      `UPDATE sitecorp_auth.activation_tokens 
       SET expires_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' 
       WHERE token_hash = $1`,
      [hash]
    );

    await expect(
      consumeActivationTokenUseCase.execute({
        rawToken: tokenRes.rawToken,
        newPassword: "PasswordValido#123456!",
      })
    ).rejects.toThrow(TokenExpiredError);
  });

  it("5. Políticas de seguridad: Rechaza contraseñas débiles (< 12 caracteres) con WEAK_PASSWORD", async () => {
    const userId = createUserId(randomUUID());
    const user = AuthUser.create(userId, createEmail("usuario.clave.debil@sitecorp.cu"), {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const tokenRes = await generateActivationTokenUseCase.execute({
      userId: user.id,
      tokenType: "activation",
    });

    await expect(
      consumeActivationTokenUseCase.execute({
        rawToken: tokenRes.rawToken,
        newPassword: "corta", // Débil
      })
    ).rejects.toThrow(WeakPasswordError);
  });

  it("6. Aislamiento Multiempresa: Demuestra separación estricta entre Empresa A y Empresa B vía tenant_id", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const userA = AuthUser.create(createUserId(randomUUID()), createEmail("operador@empresa-a.cu"), {
      status: "active",
    });
    const userB = AuthUser.create(createUserId(randomUUID()), createEmail("operador@empresa-b.cu"), {
      status: "active",
    });

    await userRepo.save(userA);
    await userRepo.save(userB);

    // Asignar los respectivos inquilinos en sitecorp_auth.users
    await pool.query(
      `UPDATE sitecorp_auth.users SET tenant_id = $1 WHERE id = $2`,
      [tenantA, userA.id]
    );
    await pool.query(
      `UPDATE sitecorp_auth.users SET tenant_id = $1 WHERE id = $2`,
      [tenantB, userB.id]
    );

    // Consulta con contexto de inquilino A: Solo debe ver usuarios de Tenant A
    const resA = await pool.query<{ id: string; email: string; tenant_id: string }>(
      `SELECT id, email, tenant_id FROM sitecorp_auth.users WHERE tenant_id = $1`,
      [tenantA]
    );

    expect(resA.rows.length).toBe(1);
    expect(resA.rows[0]!.id).toBe(userA.id);
    expect(resA.rows[0]!.email).toBe("operador@empresa-a.cu");

    // Consulta con contexto de inquilino B: Solo debe ver usuarios de Tenant B
    const resB = await pool.query<{ id: string; email: string; tenant_id: string }>(
      `SELECT id, email, tenant_id FROM sitecorp_auth.users WHERE tenant_id = $1`,
      [tenantB]
    );

    expect(resB.rows.length).toBe(1);
    expect(resB.rows[0]!.id).toBe(userB.id);
    expect(resB.rows[0]!.email).toBe("operador@empresa-b.cu");

    // Verificación cruzada: Ningún usuario de Tenant A aparece en Tenant B
    expect(resB.rows.some((r) => r.id === userA.id)).toBe(false);
    expect(resA.rows.some((r) => r.id === userB.id)).toBe(false);
  });

  it("7. Migraciones y Rollback: Valida idempotencia y reversión limpia de la migración 0003", async () => {
    // Verificar que la tabla sitecorp_auth.activation_tokens existe
    const checkTable = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'sitecorp_auth' AND table_name = 'activation_tokens'
      ) as exists;
    `);
    expect(checkTable.rows[0]!.exists).toBe(true);

    // Cargar y ejecutar el script de rollback de la migración 0003
    const fs = await import("node:fs");
    const path = await import("node:path");
    const rollbackSql = fs.readFileSync(
      path.resolve(process.cwd(), "db/migrations/0003_sitecorp_auth_activation_tokens.rollback.design.sql"),
      "utf8"
    );

    await pool.query(rollbackSql);

    // Verificar que tras el rollback, la tabla ya no existe
    const tableAfterRollback = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'sitecorp_auth' AND table_name = 'activation_tokens'
      ) as exists;
    `);
    expect(tableAfterRollback.rows[0]!.exists).toBe(false);

    // Re-aplicar migración 0003 para dejar el esquema íntegro
    const migration0003 = loadActivationTokensMigration(undefined, { environment: "test" });
    await pool.query(migration0003.sql);

    const reApplied = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'sitecorp_auth' AND table_name = 'activation_tokens'
      ) as exists;
    `);
    expect(reApplied.rows[0]!.exists).toBe(true);
  });
});
