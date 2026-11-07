import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  createUserId,
  createEmail,
  InvalidCredentialsError,
  SessionInvalidError,
  TokenInvalidError,
  TokenReuseDetectedError,
  UserSuspendedError,
} from "../../src/domain";
import { QueryResultRow, AuthenticatedPrincipal } from "../../src/interfaces";
import {
  PostgresTransactionManager,
  PgPoolLike,
  PgPoolClientLike,
  PostgresUserRepository,
  PostgresCredentialRepository,
  PostgresSessionRepository,
  PostgresSecurityAuditService,
  PostgresMigrationRunner,
  loadInitialAuthSchemaMigration,
  Argon2idPasswordHasher,
  JoseTokenService,
  verifyAccessTokenSessionState,
  generateEphemeralEd25519KeyPair,
  MockAuthorizationPolicyService,
} from "../../src/infrastructure";
import {
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
  ChangePasswordUseCase,
  AdminCreateUserUseCase,
  AdminUpdateStatusUseCase,
} from "../../src/application";

class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0;
  private waitQueue: Array<() => void> = [];
  private isLocked = false;

  constructor(private readonly pglite: PGlite) {}

  public getActiveClientCount(): number {
    return this.activeClientCount;
  }

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
            rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          };
        }
        const res = await this.pglite.query<TRow>(text, [...values]);
        return {
          rows: res.rows,
          rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
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
          rowCount: last?.affectedRows ?? rows.length,
        };
      }
      const res = await this.pglite.query<TRow>(text, [...values]);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    } finally {
      this.releaseMutex();
    }
  }
}

describe("Fase 4G.1 & 4G.1.1 — Integración End-to-End: Criptografía Real + Vinculación sid + Revocación de Sesiones en PostgreSQL Real", () => {
  let pglite: PGlite;
  let pool: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credentialRepo: PostgresCredentialRepository;
  let sessionRepo: PostgresSessionRepository;
  let auditService: PostgresSecurityAuditService;
  let passwordHasher: Argon2idPasswordHasher;
  let tokenService: JoseTokenService;
  let authzService: MockAuthorizationPolicyService;

  const signingKey = generateEphemeralEd25519KeyPair("ed25519-pg-int-key-1", "test");

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;

    pool = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(pool);
    userRepo = new PostgresUserRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    auditService = new PostgresSecurityAuditService(txManager);

    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    tokenService = new JoseTokenService({
      issuer: "urn:sitecorp:auth-api",
      audience: "urn:sitecorp:api",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: signingKey,
    });

    authzService = new MockAuthorizationPolicyService();

    const runner = new PostgresMigrationRunner(txManager, txManager);
    await runner.applyMigrations([loadInitialAuthSchemaMigration()]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM sitecorp_auth.security_audit_events`);
    await pool.query(`DELETE FROM sitecorp_auth.refresh_tokens`);
    await pool.query(`DELETE FROM sitecorp_auth.sessions`);
    await pool.query(`DELETE FROM sitecorp_auth.user_credentials`);
    await pool.query(`DELETE FROM sitecorp_auth.users`);
  });

  it("1. Ejecuta el ciclo completo AdminCreateUser -> Login -> ChangePassword -> Login -> Refresh & Reuse Detection vinculando sid y sin almacenar secretos en claro", async () => {
    const adminId = createUserId(randomUUID());
    const adminPrincipal: AuthenticatedPrincipal = {
      userId: adminId,
      email: createEmail("admin@sitecorp.cu"),
      permissions: new Set(["security.manage"]),
      isPlatformAdmin: true,
    };

    const adminCreateUseCase = new AdminCreateUserUseCase(
      userRepo,
      credentialRepo,
      passwordHasher,
      auditService,
      authzService,
      txManager
    );

    const loginUseCase = new LoginUseCase(
      userRepo,
      credentialRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService,
      5,
      15 * 60 * 1000,
      txManager
    );

    const changePasswordUseCase = new ChangePasswordUseCase(
      userRepo,
      credentialRepo,
      sessionRepo,
      passwordHasher,
      auditService,
      txManager
    );

    const refreshUseCase = new RefreshSessionUseCase(
      userRepo,
      sessionRepo,
      tokenService,
      auditService,
      txManager
    );

    const tempPassword = "TempPassword#2026_SiteCorp!";
    const createdUser = await adminCreateUseCase.execute(
      {
        email: "ingeniero.red@sitecorp.cu",
        initialPassword: tempPassword,
        mustChangePassword: true,
      },
      adminPrincipal
    );

    expect(createdUser.mustChangePassword).toBe(true);
    expect(pool.getActiveClientCount()).toBe(0);

    const storedCredInitial = await credentialRepo.findByUserId(createdUser.id);
    expect(storedCredInitial).not.toBeNull();
    expect(storedCredInitial!.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/
    );
    expect(storedCredInitial!.passwordHash).not.toContain(tempPassword);

    // Login inicial: emite JWT Ed25519 con claim `sid` vinculado a la sesión PostgreSQL
    const firstLogin = await loginUseCase.execute({
      email: "ingeniero.red@sitecorp.cu",
      password: tempPassword,
      ipAddress: "10.20.30.41",
      userAgent: "Mozilla/5.0",
    });

    expect(firstLogin.mustChangePassword).toBe(true);
    expect(firstLogin.refreshToken).toMatch(/^sct_[A-Za-z0-9_-]{43}$/);

    const firstTokenClaims = await tokenService.verifyAccessToken(
      firstLogin.accessToken
    );
    expect(firstTokenClaims.sub).toBe(createdUser.id);
    expect(firstTokenClaims.role).toBe("pending_password_change");
    expect(firstTokenClaims.scope).toBe("auth:change_password");
    expect(firstTokenClaims.sid).toMatch(/^sess_[0-9a-f-]{36}$/i);

    // La comprobación stateful de sesión confirma que la sesión `sid` está activa en PostgreSQL
    const activeState1 = await verifyAccessTokenSessionState(
      firstTokenClaims,
      sessionRepo,
      userRepo
    );
    expect(activeState1.session.id).toBe(firstTokenClaims.sid);
    expect(activeState1.user.id).toBe(createdUser.id);

    // Anti-enumeración con Argon2id real cuando un usuario no existe
    await expect(
      loginUseCase.execute({
        email: "inexistente@sitecorp.cu",
        password: "CualquierPassword#2026!",
      })
    ).rejects.toThrow(InvalidCredentialsError);

    // Cambio obligatorio de contraseña con Argon2id real -> revoca la primera sesión en PostgreSQL
    const newPassword = "NuevaClave#Definitiva_2026!";
    await changePasswordUseCase.execute({
      userId: createdUser.id,
      currentPassword: tempPassword,
      newPassword,
    });

    // El primer JWT sigue siendo criptográficamente válido hasta su `exp` (stateless),
    // PERO la comprobación de sesión lo rechaza de inmediato porque ChangePassword revocó la sesión
    await expect(
      tokenService.verifyAccessToken(firstLogin.accessToken)
    ).resolves.toBeDefined();
    await expect(
      verifyAccessTokenSessionState(firstTokenClaims, sessionRepo, userRepo)
    ).rejects.toThrow(SessionInvalidError);

    // Segundo login con la nueva contraseña -> nueva sesión (`sid` distinto) y acceso completo
    const secondLogin = await loginUseCase.execute({
      email: "ingeniero.red@sitecorp.cu",
      password: newPassword,
      ipAddress: "10.20.30.41",
      userAgent: "Mozilla/5.0",
    });

    const secondTokenClaims = await tokenService.verifyAccessToken(
      secondLogin.accessToken
    );
    expect(secondTokenClaims.role).toBe("authenticated");
    expect(secondTokenClaims.scope).toBe("api:full");
    expect(secondTokenClaims.sid).not.toBe(firstTokenClaims.sid);

    // Rotación de Refresh Token CSPRNG: conserva el mismo `sid` de la sesión pero emite un nuevo `jti`
    const rotated = await refreshUseCase.execute({
      rawRefreshToken: secondLogin.refreshToken,
      ipAddress: "10.20.30.41",
      userAgent: "Mozilla/5.0",
    });

    const rotatedClaims = await tokenService.verifyAccessToken(
      rotated.accessToken
    );
    expect(rotatedClaims.sid).toBe(secondTokenClaims.sid);
    expect(rotatedClaims.jti).not.toBe(secondTokenClaims.jti);

    // Reutilizar el refresh token ya rotado dispara TokenReuseDetectedError y revoca la familia + sesión
    await expect(
      refreshUseCase.execute({
        rawRefreshToken: secondLogin.refreshToken,
        ipAddress: "10.20.30.99",
        userAgent: "Attacker-Client/1.0",
      })
    ).rejects.toThrow(TokenReuseDetectedError);

    // Tras la detección de reuso, `verifyAccessTokenSessionState` rechaza inmediatamente el JWT rotado
    await expect(
      verifyAccessTokenSessionState(rotatedClaims, sessionRepo, userRepo)
    ).rejects.toThrow(SessionInvalidError);

    // Auditoría de tablas PostgreSQL: ningún refresh token ni contraseña en claro existe en BD
    const rawRefreshRows = await pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM sitecorp_auth.refresh_tokens"
    );
    expect(rawRefreshRows.rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rawRefreshRows.rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).not.toContain("sct_");
    }

    const rawAuditRows = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM sitecorp_auth.security_audit_events"
    );
    const serializedAudit = JSON.stringify(rawAuditRows.rows);
    expect(serializedAudit).not.toContain(tempPassword);
    expect(serializedAudit).not.toContain(newPassword);
    expect(serializedAudit).not.toContain(firstLogin.refreshToken);
    expect(serializedAudit).not.toContain(secondLogin.refreshToken);
    expect(serializedAudit).not.toContain(rotated.newRefreshToken);
    expect(pool.getActiveClientCount()).toBe(0);
  });

  it("2. Verifica la revocación de sesiones en Logout, Suspensión administrativa, Baja lógica y suplantación de sid entre usuarios", async () => {
    const adminPrincipal: AuthenticatedPrincipal = {
      userId: createUserId(randomUUID()),
      email: createEmail("admin.sec@sitecorp.cu"),
      permissions: new Set(["security.manage", "security.admin"]),
      isPlatformAdmin: true,
    };

    const adminCreateUseCase = new AdminCreateUserUseCase(
      userRepo,
      credentialRepo,
      passwordHasher,
      auditService,
      authzService,
      txManager
    );
    const adminUpdateStatusUseCase = new AdminUpdateStatusUseCase(
      userRepo,
      sessionRepo,
      auditService,
      authzService,
      txManager
    );
    const loginUseCase = new LoginUseCase(
      userRepo,
      credentialRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService,
      5,
      15 * 60 * 1000,
      txManager
    );
    const logoutUseCase = new LogoutUseCase(
      sessionRepo,
      tokenService,
      auditService,
      txManager
    );

    const passwordA = "ClaveOperadorA#2026!";
    const passwordB = "ClaveOperadorB#2026!";

    const userA = await adminCreateUseCase.execute(
      {
        email: "operador.a@sitecorp.cu",
        initialPassword: passwordA,
        mustChangePassword: false,
      },
      adminPrincipal
    );
    const userB = await adminCreateUseCase.execute(
      {
        email: "operador.b@sitecorp.cu",
        initialPassword: passwordB,
        mustChangePassword: false,
      },
      adminPrincipal
    );

    // 1. Login de A y Logout por sessionId (`sid` extraído del JWT)
    const loginA1 = await loginUseCase.execute({
      email: "operador.a@sitecorp.cu",
      password: passwordA,
    });
    const claimsA1 = await tokenService.verifyAccessToken(loginA1.accessToken);
    await expect(
      verifyAccessTokenSessionState(claimsA1, sessionRepo, userRepo)
    ).resolves.toBeDefined();

    await logoutUseCase.execute({
      sessionId: claimsA1.sid,
      userId: userA.id,
    });

    await expect(
      verifyAccessTokenSessionState(claimsA1, sessionRepo, userRepo)
    ).rejects.toThrow(SessionInvalidError);

    // 2. Nuevo login de A y de B -> intento de cruzar el `sid` de B con el `sub` de A
    const loginA2 = await loginUseCase.execute({
      email: "operador.a@sitecorp.cu",
      password: passwordA,
    });
    const loginB1 = await loginUseCase.execute({
      email: "operador.b@sitecorp.cu",
      password: passwordB,
    });

    const claimsA2 = await tokenService.verifyAccessToken(loginA2.accessToken);
    const claimsB1 = await tokenService.verifyAccessToken(loginB1.accessToken);

    await expect(
      verifyAccessTokenSessionState(
        { ...claimsA2, sid: claimsB1.sid },
        sessionRepo,
        userRepo
      )
    ).rejects.toThrow(TokenInvalidError);

    // 3. Suspensión administrativa de A -> revoca sus sesiones y bloquea validación de sesión
    await adminUpdateStatusUseCase.execute(
      { userId: userA.id, status: "suspended" },
      adminPrincipal
    );

    await expect(
      verifyAccessTokenSessionState(claimsA2, sessionRepo, userRepo)
    ).rejects.toThrow(SessionInvalidError);

    await expect(
      loginUseCase.execute({
        email: "operador.a@sitecorp.cu",
        password: passwordA,
      })
    ).rejects.toThrow(UserSuspendedError);

    // 4. Baja lógica (deleted) de B -> revoca sus sesiones y bloquea validación de sesión
    await adminUpdateStatusUseCase.execute(
      { userId: userB.id, status: "deleted" },
      adminPrincipal
    );

    await expect(
      verifyAccessTokenSessionState(claimsB1, sessionRepo, userRepo)
    ).rejects.toThrow(SessionInvalidError);
    expect(pool.getActiveClientCount()).toBe(0);
  });
});
