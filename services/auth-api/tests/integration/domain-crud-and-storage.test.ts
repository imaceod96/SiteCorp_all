import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  AuthSession,
  AuthUser,
  createEmail,
  createUserId,
} from "../../src/domain";
import {
  AuthorizationPolicyService,
  QueryResultRow,
} from "../../src/interfaces";
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadAllAuthSchemaMigrations,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
  validateHttpConfig,
} from "../../src/infrastructure";
import { PostgresDomainRepository } from "../../src/infrastructure/postgres/postgres-domain.repository";
import { LocalFileStorageService, PathTraversalError, InvalidMimeTypeError } from "../../src/infrastructure/storage/local-file-storage.service";
import {
  buildAuthHttpServer,
  BuiltAuthHttpServer,
} from "../../src/presentation/http";

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
          rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
        };
      }
      const res = await this.pglite.query<TRow>(text, [...values]);
      return {
        rows: res.rows,
        rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
      };
    } finally {
      this.releaseMutex();
    }
  }
}

describe("FASE 4G.6 — Autonomous Domain Schema, Multi-Tenant Storage & Domain APIs", () => {
  let pglite: PGlite;
  let poolAdapter: EmbeddedPostgresPoolAdapter;
  let txManager: PostgresTransactionManager;
  let domainRepo: PostgresDomainRepository;
  let storageService: LocalFileStorageService;
  let serverInstance: BuiltAuthHttpServer;
  let userRepo: PostgresUserRepository;
  let sessionRepo: PostgresSessionRepository;
  let credentialRepo: PostgresCredentialRepository;
  let tokenService: JoseTokenService;
  let testStorageDir: string;

  beforeAll(async () => {
    pglite = new PGlite();
    poolAdapter = new EmbeddedPostgresPoolAdapter(pglite);
    txManager = new PostgresTransactionManager(poolAdapter);

    // Configurar directorio de pruebas para Storage
    testStorageDir = join(process.cwd(), "tmp_test_storage_" + Date.now());
    mkdirSync(testStorageDir, { recursive: true });

    // Aplicar la secuencia de migraciones 0001, 0002, 0003, 0004
    const migrationRunner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    });
    const migrations = loadAllAuthSchemaMigrations();
    await migrationRunner.applyMigrations(migrations);

    domainRepo = new PostgresDomainRepository(txManager);
    storageService = new LocalFileStorageService(txManager, testStorageDir);

    userRepo = new PostgresUserRepository(txManager);
    sessionRepo = new PostgresSessionRepository(txManager);
    credentialRepo = new PostgresCredentialRepository(txManager);

    const keyPair = await generateEphemeralEd25519KeyPair("fase4g6-test-kid");
    tokenService = new JoseTokenService({
      issuer: "https://auth.sitecorp.cu",
      audience: "sitecorp-app",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
      additionalVerificationKeys: [],
    });

    const httpConfig = validateHttpConfig({
      environment: "test",
      host: "127.0.0.1",
      port: 4010,
      allowedOrigins: ["http://localhost:3000"],
      cookies: {
        secure: false,
        sameSite: "Lax",
      },
      csrf: {
        hmacSecret: "0123456789abcdef0123456789abcdef",
      },
    });

    serverInstance = await buildAuthHttpServer({
      httpConfig,
      tokenService,
      userRepo,
      sessionRepo,
      credentialRepo,
      domainRepo,
      storageService,
      passwordHasher: new Argon2idPasswordHasher({ timeCost: 1, memoryCostKiB: 1024, parallelism: 1 }),
      authPolicy: new AuthorizationPolicyService(),
    });
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.app.close();
    }
    if (pglite) {
      await pglite.close();
    }
    rmSync(testStorageDir, { recursive: true, force: true });
  });

  describe("1. Multi-Tenant Domain Schema & Isolation", () => {
    it("crea empresas independientes y garantiza aislamiento estricto de trabajadores", async () => {
      const companyA = await domainRepo.createCompanyClient({
        code: "COMP_A",
        name: "Empresa Alfa S.A.",
      });
      const companyB = await domainRepo.createCompanyClient({
        code: "COMP_B",
        name: "Empresa Beta S.A.",
      });

      expect(companyA.id).toBeDefined();
      expect(companyB.id).toBeDefined();

      const workerA1 = await domainRepo.createWorker({
        companyClientId: companyA.id,
        identificationNumber: "11111111111",
        firstName: "Juan",
        lastName: "Pérez",
      });

      const workerB1 = await domainRepo.createWorker({
        companyClientId: companyB.id,
        identificationNumber: "22222222222",
        firstName: "Maria",
        lastName: "Gómez",
      });

      const listA = await domainRepo.listWorkersByCompany(companyA.id);
      expect(listA.length).toBe(1);
      expect(listA[0]!.id).toBe(workerA1.id);

      const listB = await domainRepo.listWorkersByCompany(companyB.id);
      expect(listB.length).toBe(1);
      expect(listB[0]!.id).toBe(workerB1.id);

      // Verificación de aislamiento horizontal
      const crossFetch = await domainRepo.getWorkerById(companyA.id, workerB1.id);
      expect(crossFetch).toBeNull();
    });

    it("gestiona contratos y ledger de vacaciones de forma atómica", async () => {
      const company = await domainRepo.createCompanyClient({
        code: "COMP_VAC",
        name: "Vacation Test Corp",
      });

      const worker = await domainRepo.createWorker({
        companyClientId: company.id,
        identificationNumber: "33333333333",
        firstName: "Carlos",
        lastName: "Rodríguez",
      });

      const contract = await domainRepo.createContract({
        companyClientId: company.id,
        workerId: worker.id,
        startDate: new Date("2026-01-01"),
        baseSalary: 150000,
      });

      expect(contract.id).toBeDefined();
      expect(contract.status).toBe("active");

      // Transacción de devengo de vacaciones (+15 días)
      const vacAfterAccrual = await domainRepo.recordVacationMovement({
        companyClientId: company.id,
        workerId: worker.id,
        year: 2026,
        movementType: "ACCRUAL",
        days: 15,
        notes: "Devengo anual",
      });

      expect(Number(vacAfterAccrual.daysAccrued)).toBe(15);
      expect(Number(vacAfterAccrual.balance)).toBe(15);

      // Consumo de 5 días de vacaciones
      const vacAfterTaken = await domainRepo.recordVacationMovement({
        companyClientId: company.id,
        workerId: worker.id,
        year: 2026,
        movementType: "TAKEN",
        days: 5,
        notes: "Vacaciones de verano",
      });

      expect(Number(vacAfterTaken.daysTaken)).toBe(5);
      expect(Number(vacAfterTaken.balance)).toBe(10);
    });
  });

  describe("2. Self-Hosted Storage & Path Traversal Protections", () => {
    it("sube, descarga y elimina un objeto con verificación SHA-256", async () => {
      const buffer = Buffer.from("Contenido de prueba para documento PDF de SiteCorp", "utf8");

      const uploaded = await storageService.uploadFile({
        bucketId: "documents",
        objectName: "contrato_firmado.pdf",
        contentBuffer: buffer,
        mimeType: "application/pdf",
      });

      expect(uploaded.objectName).toBe("contrato_firmado.pdf");
      expect(uploaded.sha256Checksum).toBeDefined();

      // Descarga e integridad SHA-256
      const { record, contentBuffer } = await storageService.downloadFile("documents", "contrato_firmado.pdf");
      expect(record.id).toBe(uploaded.id);
      expect(contentBuffer.toString("utf8")).toBe(buffer.toString("utf8"));

      // Eliminación
      const deleted = await storageService.deleteFile("documents", "contrato_firmado.pdf");
      expect(deleted).toBe(true);
    });

    it("bloquea intentos de Path Traversal y tipos MIME no permitidos", async () => {
      // Path traversal
      await expect(
        storageService.uploadFile({
          bucketId: "documents",
          objectName: "../../../etc/passwd",
          contentBuffer: Buffer.from("hack"),
          mimeType: "text/plain",
        })
      ).rejects.toThrow(PathTraversalError);

      // MIME no permitido en 'avatars' (solo png, jpeg, webp)
      await expect(
        storageService.uploadFile({
          bucketId: "avatars",
          objectName: "malware.exe",
          contentBuffer: Buffer.from("binary"),
          mimeType: "application/x-msdownload",
        })
      ).rejects.toThrow(InvalidMimeTypeError);
    });
  });

  describe("3. HTTP Endpoints for Domain & Storage", () => {
    it("permite listar empresas mediante el endpoint de dominio autenticado", async () => {
      // Crear un usuario autenticado de prueba
      const userId = createUserId(randomUUID());
      const user = AuthUser.reconstitute({
        id: userId,
        email: createEmail("domain_admin@sitecorp.com"),
        status: "active",
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await userRepo.save(user);

      const sessionId = `sess_${randomUUID()}`;
      const session = AuthSession.create(sessionId, userId, {
        ipAddress: "127.0.0.1",
        userAgent: "IntegrationTest",
      });
      await sessionRepo.createSession(session);

      const { token: accessToken } = await tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        sid: session.id,
        scope: "api:full",
        role: "authenticated",
        mustChangePassword: false,
      });

      const response = await serverInstance.app.inject({
        method: "GET",
        url: "/api/v1/domain/companies",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.companies).toBeDefined();
      expect(Array.isArray(payload.data.companies)).toBe(true);
    });
  });
});
