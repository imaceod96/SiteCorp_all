import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  AuthUser,
  AuthSession,
  RefreshToken,
  SecurityEvent,
  createUserId,
  createEmail,
  DuplicateEmailError,
  InvalidCredentialsError,
  AccountLockedError,
  TokenReuseDetectedError,
  UserSuspendedError,
  ForbiddenError,
} from "../../src/domain";
import {
  QueryResultRow,
  AuthenticatedPrincipal,
} from "../../src/interfaces";
import {
  PostgresTransactionManager,
  PgPoolLike,
  PgPoolClientLike,
  NestedTransactionNotAllowedError,
  UnscopedTransactionalWriteError,
  PostgresUserRepository,
  PostgresCredentialRepository,
  PostgresSessionRepository,
  PostgresSecurityAuditService,
  PostgresMigrationRunner,
  loadInitialAuthSchemaMigration,
  MigrationIntegrityError,
  FakePasswordHasher,
  FakeTokenService,
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

/**
 * Adaptador de `PgPoolLike` sobre el motor PostgreSQL 16 real embebido (`PGlite`).
 *
 * - Serializa la adquisición de clientes transaccionales exclusivos (`connect()`) mediante un mutex FIFO
 *   (igual que un `pg.Pool` con `max: 1` o cuando varias transacciones compiten por filas bloqueadas
 *   en una misma instancia embebida) y rastrea exactamente las conexiones prestadas (`activeClients`)
 *   para verificar la ausencia de conexiones retenidas en `finally`.
 */
class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0;
  private totalAcquiredCount = 0;
  private totalReleasedCount = 0;
  private waitQueue: Array<() => void> = [];
  private isLocked = false;

  constructor(private readonly pglite: PGlite) {}

  public getActiveClientCount(): number {
    return this.activeClientCount;
  }

  public getStats(): { active: number; acquired: number; released: number } {
    return {
      active: this.activeClientCount,
      acquired: this.totalAcquiredCount,
      released: this.totalReleasedCount,
    };
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
    this.totalAcquiredCount += 1;
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
          this.totalReleasedCount += 1;
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

describe("PostgreSQL Real Engine Integration: Schema, ACID Transactions & Concurrency (Fase 4F.2)", () => {
  let pglite: PGlite;
  let poolAdapter: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let userRepo: PostgresUserRepository;
  let credRepo: PostgresCredentialRepository;
  let sessionRepo: PostgresSessionRepository;
  let auditService: PostgresSecurityAuditService;
  let migrationRunner: PostgresMigrationRunner;

  let passwordHasher: FakePasswordHasher;
  let tokenService: FakeTokenService;
  let authPolicy: MockAuthorizationPolicyService;

  let loginUseCase: LoginUseCase;
  let logoutUseCase: LogoutUseCase;
  let refreshUseCase: RefreshSessionUseCase;
  let changePasswordUseCase: ChangePasswordUseCase;
  let adminCreateUserUseCase: AdminCreateUserUseCase;
  let adminUpdateStatusUseCase: AdminUpdateStatusUseCase;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;

    poolAdapter = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(poolAdapter);

    userRepo = new PostgresUserRepository(txManager);
    credRepo = new PostgresCredentialRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager, txManager);
    auditService = new PostgresSecurityAuditService(txManager);
    migrationRunner = new PostgresMigrationRunner(txManager, txManager);

    // Aplicar el diseño SQL real de sitecorp_auth
    const initialMigration = loadInitialAuthSchemaMigration();
    const applied = await migrationRunner.applyMigrations([initialMigration]);
    expect(applied).toEqual(["0001_sitecorp_auth_schema"]);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    // Limpiar datos entre pruebas respetando el orden inverso de FK (con ON DELETE RESTRICT activo)
    await poolAdapter.query(`DELETE FROM sitecorp_auth.security_audit_events`);
    await poolAdapter.query(`DELETE FROM sitecorp_auth.refresh_tokens`);
    await poolAdapter.query(`DELETE FROM sitecorp_auth.sessions`);
    await poolAdapter.query(`DELETE FROM sitecorp_auth.user_credentials`);
    await poolAdapter.query(`DELETE FROM sitecorp_auth.users`);

    passwordHasher = new FakePasswordHasher();
    tokenService = new FakeTokenService();
    authPolicy = new MockAuthorizationPolicyService();

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
    logoutUseCase = new LogoutUseCase(
      sessionRepo,
      tokenService,
      auditService,
      txManager
    );
    refreshUseCase = new RefreshSessionUseCase(
      userRepo,
      sessionRepo,
      tokenService,
      auditService,
      txManager
    );
    changePasswordUseCase = new ChangePasswordUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      auditService,
      txManager
    );
    adminCreateUserUseCase = new AdminCreateUserUseCase(
      userRepo,
      credRepo,
      passwordHasher,
      auditService,
      authPolicy,
      txManager
    );
    adminUpdateStatusUseCase = new AdminUpdateStatusUseCase(
      userRepo,
      sessionRepo,
      auditService,
      authPolicy,
      txManager
    );
  });

  it("1. Migraciones versionadas e integridad de checksum SHA-256 en PostgreSQL real", async () => {
    const initialMigration = loadInitialAuthSchemaMigration();
    // Segunda ejecución idempotente: no vuelve a aplicar si el checksum coincide
    const reRun = await migrationRunner.applyMigrations([initialMigration]);
    expect(reRun).toEqual([]);

    // Si alguien altera el SQL de una migración ya aplicada, lanza MigrationIntegrityError
    const tamperedMigration = {
      ...initialMigration,
      checksumSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    await expect(
      migrationRunner.applyMigrations([tamperedMigration])
    ).rejects.toThrow(MigrationIntegrityError);

    expect(poolAdapter.getActiveClientCount()).toBe(0);
  });

  it("2. Restricciones CHECK, Foreign Keys (ON DELETE RESTRICT) y unicidad de email_normalized en SQL real", async () => {
    const u1 = AuthUser.create(
      createUserId("550e8400-e29b-41d4-a716-446655440101"),
      createEmail("  Arquitecto@SiteCorp.CU ")
    );
    await userRepo.save(u1);

    // Intento de insertar otro usuario con el mismo correo normalizado -> SQLSTATE 23505 -> DuplicateEmailError
    const u2 = AuthUser.create(
      createUserId("550e8400-e29b-41d4-a716-446655440102"),
      createEmail("arquitecto@sitecorp.cu")
    );
    await expect(userRepo.save(u2)).rejects.toThrow(DuplicateEmailError);

    // Insertar credencial asociada a u1
    await credRepo.save({
      id: "cred_u1",
      userId: u1.id,
      algorithm: "argon2id",
      passwordHash: await passwordHasher.hash("SiteCorp.2026#ValidPass"),
      version: 1,
      createdAt: new Date(),
    });

    // Verificar que ON DELETE RESTRICT impide borrar físicamente el usuario mientras tiene credencial
    await expect(userRepo.delete(u1.id)).rejects.toThrow();

    // Verificar que chk_refresh_tokens_hash_format rechaza un hash que no sea hex de 64 caracteres
    const session = AuthSession.create("sess_chk_1", u1.id);
    await sessionRepo.createSession(session);
    const badToken = RefreshToken.create(
      "rt_bad_hash",
      session.id,
      "not_a_64_char_hex_hash",
      "fam_chk_1"
    );
    await expect(sessionRepo.createRefreshToken(badToken)).rejects.toThrow();
  });

  it("3. Transacción A y B: Login exitoso atómico y registro concurrente de intentos fallidos en PostgreSQL", async () => {
    const userId = createUserId("550e8400-e29b-41d4-a716-446655440110");
    const email = createEmail("login.pg@sitecorp.cu");
    const password = "SiteCorp.2026#PostgresPassword";

    await userRepo.save(AuthUser.create(userId, email));
    await credRepo.save({
      id: "cred_pg_110",
      userId,
      algorithm: "argon2id",
      passwordHash: await passwordHasher.hash(password),
      version: 1,
      createdAt: new Date(),
    });

    // Disparar 5 intentos fallidos concurrentes contra PostgreSQL
    const failedCalls = Array.from({ length: 5 }, () =>
      loginUseCase.execute({
        email: "login.pg@sitecorp.cu",
        password: "WrongPassword#2026",
      })
    );
    const outcomes = await Promise.allSettled(failedCalls);
    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);

    // El contador en PostgreSQL debe ser exactamente 5 y la cuenta debe estar bloqueada
    const lockedUser = await userRepo.findById(userId);
    expect(lockedUser?.failedLoginAttempts).toBe(5);
    expect(lockedUser?.isLocked()).toBe(true);

    // Intento con contraseña válida mientras está bloqueado -> AccountLockedError
    await expect(
      loginUseCase.execute({
        email: "login.pg@sitecorp.cu",
        password,
      })
    ).rejects.toThrow(AccountLockedError);

    // Simular expiración del bloqueo en base de datos y realizar login exitoso
    const unlockedUser = AuthUser.reconstitute({
      id: userId,
      email,
      status: "active",
      mustChangePassword: false,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 60_000),
      createdAt: lockedUser!.createdAt,
      updatedAt: new Date(),
      deletedAt: null,
    });
    await userRepo.update(unlockedUser);

    const loginRes = await loginUseCase.execute({
      email: "login.pg@sitecorp.cu",
      password,
      ipAddress: "10.10.0.25",
      userAgent: "SiteCorp-PG-Test",
    });

    expect(loginRes.accessToken).toBeDefined();
    expect(loginRes.refreshToken).toBeDefined();

    const afterSuccess = await userRepo.findById(userId);
    expect(afterSuccess?.failedLoginAttempts).toBe(0);
    expect(afterSuccess?.lockedUntil).toBeNull();
    expect(poolAdapter.getActiveClientCount()).toBe(0);
  });

  it("4. Transacción C y D: Rotación concurrente de refresh tokens y persistencia irreversible de revocación por reuso", async () => {
    const userId = createUserId("550e8400-e29b-41d4-a716-446655440120");
    const email = createEmail("rotacion.pg@sitecorp.cu");
    const password = "SiteCorp.2026#RotatePassword";

    await userRepo.save(AuthUser.create(userId, email));
    await credRepo.save({
      id: "cred_pg_120",
      userId,
      algorithm: "argon2id",
      passwordHash: await passwordHasher.hash(password),
      version: 1,
      createdAt: new Date(),
    });

    const login = await loginUseCase.execute({
      email: "rotacion.pg@sitecorp.cu",
      password,
    });

    // Lanzar 4 solicitudes concurrentes de refresh con el mismo token inicial
    const concurrentRotations = await Promise.allSettled([
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken }),
    ]);

    const succeeded = concurrentRotations.filter((r) => r.status === "fulfilled");
    const failed = concurrentRotations.filter((r) => r.status === "rejected");

    // Exactamente 1 rotación triunfa; las 3 restantes detectan que el token ya fue rotado/revocado
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(3);
    for (const r of failed) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        TokenReuseDetectedError
      );
    }

    // Verificar en PostgreSQL que al haberse detectado reuso en las llamadas concurrentes,
    // TODA la familia (incluido el token nuevo emitido en la primera petición) y la sesión quedaron REVOCADAS
    // y que dicha revocación NO se revirtió por el lanzamiento de TokenReuseDetectedError
    const winningRefresh = (
      succeeded[0] as PromiseFulfilledResult<{ newRefreshToken: string }>
    ).value;
    const newHash = tokenService.hashOpaqueToken(winningRefresh.newRefreshToken);
    const persistedNewToken = await sessionRepo.findRefreshTokenByHash(newHash);

    expect(persistedNewToken).not.toBeNull();
    expect(persistedNewToken?.isRevoked).toBe(true);

    // Comprobar en SQL que el sistema JAMÁS emitió dos refresh tokens hijos a partir del mismo token padre:
    // en la familia solo existen exactamente 2 filas (el padre original y el único hijo emitido en la primera rotación).
    const familyCountRes = await poolAdapter.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM sitecorp_auth.refresh_tokens
       WHERE family_id = $1`,
      [persistedNewToken!.familyId]
    );
    expect(familyCountRes.rows[0]?.total).toBe(2);

    // No confundir la emisión previa de winningRefresh.newRefreshToken con su validez posterior a la revocación:
    // intentar usar el token hijo tras la revocación de toda la familia es rechazado inmediatamente.
    await expect(
      refreshUseCase.execute({ rawRefreshToken: winningRefresh.newRefreshToken })
    ).rejects.toThrow(TokenReuseDetectedError);

    const persistedSession = await sessionRepo.findSessionById(
      persistedNewToken!.sessionId
    );
    expect(persistedSession?.isRevoked).toBe(true);

    // Verificar que el evento TOKEN_REUSE_DETECTED quedó persistido en PostgreSQL
    const auditEvents = await auditService.findRecentByUserId(userId);
    expect(auditEvents.some((e) => e.eventType === "TOKEN_REUSE_DETECTED")).toBe(true);
    expect(poolAdapter.getActiveClientCount()).toBe(0);
  });

  it("5. Transacción F y Rollback: Cambio de contraseña revoca todas las sesiones y hace ROLLBACK completo si ocurre un fallo intermedio", async () => {
    const userId = createUserId("550e8400-e29b-41d4-a716-446655440130");
    const email = createEmail("cambio.pg@sitecorp.cu");
    const initialPassword = "SiteCorp.2026#OldPassword";

    await userRepo.save(
      AuthUser.create(userId, email, {
        status: "pending_password_change",
        mustChangePassword: true,
      })
    );
    await credRepo.save({
      id: "cred_pg_130",
      userId,
      algorithm: "argon2id",
      passwordHash: await passwordHasher.hash(initialPassword),
      version: 1,
      createdAt: new Date(),
    });

    const login = await loginUseCase.execute({
      email: "cambio.pg@sitecorp.cu",
      password: initialPassword,
    });

    // 5.1 Simular fallo forzado en el último paso de una transacción multi-repositorio:
    //     Actualizar credencial + actualizar usuario + lanzar excepción -> debe hacer ROLLBACK de ambos
    await expect(
      txManager.runInTransaction(async () => {
        const u = await userRepo.findByIdForUpdate(userId);
        u!.markPasswordChanged();
        await userRepo.update(u!);
        throw new Error("Fallo simulado antes de confirmar cambio de clave");
      })
    ).rejects.toThrow("Fallo simulado");

    // Verificar en PostgreSQL que el ROLLBACK restauró mustChangePassword = true y status = pending_password_change
    const userAfterRollback = await userRepo.findById(userId);
    expect(userAfterRollback?.mustChangePassword).toBe(true);
    expect(userAfterRollback?.status).toBe("pending_password_change");

    // 5.2 Ejecutar ChangePasswordUseCase completo exitosamente
    const newPassword = "SiteCorp.2026#NewStrongPassword!";
    await changePasswordUseCase.execute({
      userId,
      currentPassword: initialPassword,
      newPassword,
    });

    const userAfterCommit = await userRepo.findById(userId);
    expect(userAfterCommit?.mustChangePassword).toBe(false);
    expect(userAfterCommit?.status).toBe("active");

    const credAfterCommit = await credRepo.findByUserId(userId);
    expect(credAfterCommit?.version).toBe(2);

    // La sesión previa quedó revocada en PostgreSQL
    const oldTokenHash = tokenService.hashOpaqueToken(login.refreshToken);
    const oldToken = await sessionRepo.findRefreshTokenByHash(oldTokenHash);
    expect(oldToken?.isRevoked).toBe(true);
  });

  it("6. Transacción E, G y H: Creación administrativa, suspensión, baja lógica y revocación masiva en PostgreSQL", async () => {
    const adminOperator: AuthenticatedPrincipal = {
      userId: createUserId("550e8400-e29b-41d4-a716-446655440999"),
      email: createEmail("admin.root@sitecorp.cu"),
      permissions: new Set(["security.manage"]),
      isPlatformAdmin: true,
    };

    const tempPassword = "SiteCorp.2026#CreatedByAdmin";
    const createdUser = await adminCreateUserUseCase.execute(
      {
        email: "empleado.nuevo@sitecorp.cu",
        initialPassword: tempPassword,
        mustChangePassword: true,
      },
      adminOperator
    );

    // Iniciar dos sesiones con el usuario recién creado y cerrar la primera con LogoutUseCase (Transacción E)
    const login1 = await loginUseCase.execute({
      email: "empleado.nuevo@sitecorp.cu",
      password: tempPassword,
    });
    const tokenHash1 = tokenService.hashOpaqueToken(login1.refreshToken);
    const token1BeforeLogout = await sessionRepo.findRefreshTokenByHash(tokenHash1);
    expect(token1BeforeLogout).not.toBeNull();
    await logoutUseCase.execute({
      sessionId: token1BeforeLogout!.sessionId,
      userId: createdUser.id,
    });
    const session1AfterLogout = await sessionRepo.findSessionById(
      token1BeforeLogout!.sessionId
    );
    expect(session1AfterLogout?.isRevoked).toBe(true);

    // Segunda sesión activa antes de suspensión administrativa
    const login = await loginUseCase.execute({
      email: "empleado.nuevo@sitecorp.cu",
      password: tempPassword,
    });

    // Suspender al usuario administrativamente -> actualiza estado y revoca todas sus sesiones en la misma transacción
    await adminUpdateStatusUseCase.execute(
      { userId: createdUser.id, status: "suspended" },
      adminOperator
    );

    // Intentar refrescar con el token previo falla porque la sesión fue revocada y el usuario está suspendido
    await expect(
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken })
    ).rejects.toThrow();

    // Intentar login lanza UserSuspendedError
    await expect(
      loginUseCase.execute({
        email: "empleado.nuevo@sitecorp.cu",
        password: tempPassword,
      })
    ).rejects.toThrow(UserSuspendedError);

    // Dar de baja lógica (soft delete) al usuario -> revoca sesiones y oculta existencia ante login (InvalidCredentialsError)
    await adminUpdateStatusUseCase.execute(
      { userId: createdUser.id, status: "deleted" },
      adminOperator
    );

    const deletedInDb = await userRepo.findById(createdUser.id);
    expect(deletedInDb?.status).toBe("deleted");
    expect(deletedInDb?.deletedAt).not.toBeNull();

    await expect(
      loginUseCase.execute({
        email: "empleado.nuevo@sitecorp.cu",
        password: tempPassword,
      })
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("7. Limpieza de contexto de autenticación (request.jwt.claim.sub), prohibición de transacciones anidadas y ausencia de conexiones retenidas", async () => {
    // 7.1 Llamar setTransactionAuthContext fuera de una transacción debe lanzar UnscopedTransactionalWriteError
    await expect(
      txManager.setTransactionAuthContext({
        sub: "550e8400-e29b-41d4-a716-446655440777",
        role: "authenticated",
      })
    ).rejects.toThrow(UnscopedTransactionalWriteError);

    // 7.2 Dentro de una transacción, setTransactionAuthContext establece request.jwt.claim.sub localmente
    await txManager.runInTransaction(async (tx) => {
      await txManager.setTransactionAuthContext({
        sub: "550e8400-e29b-41d4-a716-446655440777",
        role: "authenticated",
        sessionId: "sess_ctx_test",
      });

      const insideRes = await tx.executor.query<{ sub: string; role: string }>(
        `SELECT
           current_setting('request.jwt.claim.sub', true) AS sub,
           current_setting('request.jwt.claim.role', true) AS role`
      );
      expect(insideRes.rows[0]?.sub).toBe("550e8400-e29b-41d4-a716-446655440777");
      expect(insideRes.rows[0]?.role).toBe("authenticated");

      // Intentar anidar otra transacción sin allowNestedSavepoint debe lanzar NestedTransactionNotAllowedError
      await expect(
        txManager.runInTransaction(async () => "nested")
      ).rejects.toThrow(NestedTransactionNotAllowedError);
    });

    // 7.3 Al finalizar la transacción y devolver la conexión al pool, el contexto NO persiste en la siguiente consulta
    const outsideRes = await txManager.query<{ sub: string | null }>(
      `SELECT nullif(current_setting('request.jwt.claim.sub', true), '') AS sub`
    );
    expect(outsideRes.rows[0]?.sub).toBeNull();

    // 7.4 Verificar que todas las conexiones prestadas fueron liberadas en finally
    const stats = poolAdapter.getStats();
    expect(stats.active).toBe(0);
    expect(stats.acquired).toBe(stats.released);
  });

  it("8. SAVEPOINT real en PostgreSQL, ROLLBACK ante fallo intermedio en RefreshSessionUseCase y concurrencia de cambio de contraseña / revocación", async () => {
    const userId = createUserId("550e8400-e29b-41d4-a716-446655440180");
    const email = createEmail("savepoint.concurrencia@sitecorp.cu");
    const initialPassword = "SiteCorp.2026#InitialPass";

    // 8.1 Probar SAVEPOINT real en PostgreSQL: la transacción padre inserta el usuario,
    //     un SAVEPOINT intenta insertar un email duplicado (falla con DuplicateEmailError y hace ROLLBACK TO SAVEPOINT),
    //     y la transacción padre continúa e inserta la credencial con COMMIT exitoso.
    await txManager.runInTransaction(async () => {
      await userRepo.save(AuthUser.create(userId, email));

      await expect(
        txManager.runInTransaction(
          async () => {
            await userRepo.save(
              AuthUser.create(
                createUserId("550e8400-e29b-41d4-a716-446655440181"),
                email
              )
            );
          },
          { allowNestedSavepoint: true }
        )
      ).rejects.toThrow(DuplicateEmailError);

      await credRepo.save({
        id: "cred_pg_180",
        userId,
        algorithm: "argon2id",
        passwordHash: await passwordHasher.hash(initialPassword),
        version: 1,
        createdAt: new Date(),
      });
    });

    const savedUser = await userRepo.findById(userId);
    expect(savedUser).not.toBeNull();

    const login = await loginUseCase.execute({
      email: "savepoint.concurrencia@sitecorp.cu",
      password: initialPassword,
    });

    // 8.2 Simular un fallo a mitad de RefreshSessionUseCase (después de rotateRefreshTokenAtomic, al firmar el access token):
    //     gracias a la unidad transaccional de RefreshSessionUseCase, la rotación del refresh token hace ROLLBACK
    //     y el refresh token original del cliente NO se pierde ni queda revocado.
    const failingTokenService = new FakeTokenService();
    failingTokenService.signAccessToken = async () => {
      throw new Error("Fallo simulado del firmador JWT a mitad de RefreshSessionUseCase");
    };
    const failingRefreshUseCase = new RefreshSessionUseCase(
      userRepo,
      sessionRepo,
      failingTokenService,
      auditService,
      txManager
    );

    await expect(
      failingRefreshUseCase.execute({ rawRefreshToken: login.refreshToken })
    ).rejects.toThrow("Fallo simulado del firmador JWT");

    const originalTokenHash = tokenService.hashOpaqueToken(login.refreshToken);
    const tokenAfterFailedRefresh =
      await sessionRepo.findRefreshTokenByHash(originalTokenHash);
    expect(tokenAfterFailedRefresh?.isRevoked).toBe(false);

    // 8.3 Cambio de contraseña concurrente con RefreshSessionUseCase:
    //     Ejecutar en paralelo un cambio de contraseña y un refresco de sesión.
    //     Al finalizar, todas las sesiones previas (incluido cualquier token rotado antes del cambio de clave)
    //     deben estar revocadas si el cambio de contraseña se ejecutó después, o el refresco rechazado si se ejecutó después.
    const newPassword = "SiteCorp.2026#ConcurrentNewPass!";
    const [pwdOutcome, refreshOutcome] = await Promise.allSettled([
      changePasswordUseCase.execute({
        userId,
        currentPassword: initialPassword,
        newPassword,
      }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken }),
    ]);

    expect(pwdOutcome.status).toBe("fulfilled");
    if (refreshOutcome.status === "fulfilled") {
      // Si el refresh entró en la cola antes del cambio de contraseña, el cambio de contraseña
      // posterior revocó inmediatamente toda la sesión y el nuevo token emitido:
      const rotatedHash = tokenService.hashOpaqueToken(
        refreshOutcome.value.newRefreshToken
      );
      const rotatedTokenInDb = await sessionRepo.findRefreshTokenByHash(rotatedHash);
      expect(rotatedTokenInDb?.isRevoked).toBe(true);
    }
  });

  it("9. Limpieza de contexto entre usuarios distintos, rechazo de bloqueos fuera de transacción, restricción pending_password_change en admin y sanitización de auditoría", async () => {
    const userA = createUserId("550e8400-e29b-41d4-a716-446655440191");
    const userB = createUserId("550e8400-e29b-41d4-a716-446655440192");

    // 9.1 Transacción del Usuario A seguida de Transacción del Usuario B: sin contaminación cruzada de claims
    await txManager.runInTransaction(async (tx) => {
      await txManager.setTransactionAuthContext({
        sub: userA,
        role: "authenticated",
        sessionId: "sess_A",
      });
      const resA = await tx.executor.query<{ sub: string }>(
        `SELECT current_setting('request.jwt.claim.sub', true) AS sub`
      );
      expect(resA.rows[0]?.sub).toBe(userA);
    });

    await txManager.runInTransaction(async (tx) => {
      // Antes de establecer el contexto de B, el valor heredado de A debe estar vacío
      const beforeB = await tx.executor.query<{ sub: string | null }>(
        `SELECT nullif(current_setting('request.jwt.claim.sub', true), '') AS sub`
      );
      expect(beforeB.rows[0]?.sub).toBeNull();

      await txManager.setTransactionAuthContext({
        sub: userB,
        role: "pending_password_change",
        sessionId: "sess_B",
      });
      const resB = await tx.executor.query<{ sub: string; role: string }>(
        `SELECT
           current_setting('request.jwt.claim.sub', true) AS sub,
           current_setting('request.jwt.claim.role', true) AS role`
      );
      expect(resB.rows[0]?.sub).toBe(userB);
      expect(resB.rows[0]?.role).toBe("pending_password_change");
    });

    // 9.2 Rechazo de findByIdForUpdate y findByUserIdForUpdate fuera de una transacción activa
    await expect(userRepo.findByIdForUpdate(userA)).rejects.toThrow(
      UnscopedTransactionalWriteError
    );
    await expect(credRepo.findByUserIdForUpdate(userA)).rejects.toThrow(
      UnscopedTransactionalWriteError
    );

    // 9.3 Un operador administrativo con mustChangePassword = true tiene bloqueadas las acciones administrativas
    const restrictedAdminId = createUserId("550e8400-e29b-41d4-a716-446655440193");
    await userRepo.save(
      AuthUser.create(restrictedAdminId, createEmail("admin.pendiente@sitecorp.cu"), {
        status: "pending_password_change",
        mustChangePassword: true,
      })
    );
    const restrictedOperator: AuthenticatedPrincipal = {
      userId: restrictedAdminId,
      email: createEmail("admin.pendiente@sitecorp.cu"),
      permissions: new Set(["security.manage"]),
      isPlatformAdmin: true,
    };

    await expect(
      adminCreateUserUseCase.execute(
        { email: "no.permitido@sitecorp.cu" },
        restrictedOperator
      )
    ).rejects.toThrow(ForbiddenError);

    // 9.4 Sanitización recursiva en PostgresSecurityAuditService: nunca almacena passwords ni tokens en JSONB
    await auditService.recordEvent(
      SecurityEvent.create("550e8400-e29b-41d4-a716-446655440901", "LOGIN_FAILED", {
        userId: restrictedAdminId,
        metadata: {
          reason: "TEST_REDACTION",
          password: "PlainTextSecretPassword!",
          rawRefreshToken: "raw_secret_token_value",
          nested: {
            passwordHash: "$argon2id$secret",
            safeField: "conservado",
          },
        },
      })
    );

    const events = await auditService.findRecentByUserId(restrictedAdminId);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata?.password).toBe("[REDACTED]");
    expect(events[0]?.metadata?.rawRefreshToken).toBe("[REDACTED]");
    expect(
      (events[0]?.metadata?.nested as Record<string, unknown>)?.passwordHash
    ).toBe("[REDACTED]");
    expect(
      (events[0]?.metadata?.nested as Record<string, unknown>)?.safeField
    ).toBe("conservado");
  });
});
