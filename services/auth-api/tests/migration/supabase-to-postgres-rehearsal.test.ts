import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import {
  AuthUser,
  createEmail,
  createUserId,
} from "../../src/domain"
import {
  Argon2idPasswordHasher,
  generateEphemeralEd25519KeyPair,
  JoseTokenService,
  loadAllAuthSchemaMigrations,
  PgPoolClientLike,
  PgPoolLike,
  PostgresCredentialRepository,
  PostgresMigrationRunner,
  PostgresSecurityAuditService,
  PostgresSessionRepository,
  PostgresTransactionManager,
  PostgresUserRepository,
} from "../../src/infrastructure"
import { QueryResultRow } from "../../src/interfaces"
import {
  ChangePasswordUseCase,
  LoginUseCase,
} from "../../src/application"

class EmbeddedPostgresPoolAdapter implements PgPoolLike {
  private activeClientCount = 0
  private waitQueue: Array<() => void> = []
  private isLocked = false

  constructor(private readonly pglite: PGlite) {}

  private async acquireMutex(): Promise<void> {
    if (!this.isLocked) {
      this.isLocked = true
      return
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve)
    })
  }

  private releaseMutex(): void {
    const next = this.waitQueue.shift()
    if (next) {
      next()
    } else {
      this.isLocked = false
    }
  }

  async connect(): Promise<PgPoolClientLike> {
    await this.acquireMutex()
    this.activeClientCount += 1
    let released = false

    return {
      query: async <TRow extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ): Promise<{ rows: TRow[]; rowCount: number | null }> => {
        if (released) {
          throw new Error("Attempted to query on a released PoolClient.")
        }
        if (!values || values.length === 0) {
          const execResults = await this.pglite.exec(text)
          const last = execResults[execResults.length - 1]
          const rows = (last?.rows ?? []) as TRow[]
          return {
            rows,
            rowCount: rows.length > 0 ? rows.length : (last?.affectedRows ?? 0),
          }
        }
        const res = await this.pglite.query<TRow>(text, [...values])
        return {
          rows: res.rows,
          rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0),
        }
      },
      release: () => {
        if (!released) {
          released = true
          this.activeClientCount -= 1
          this.releaseMutex()
        }
      },
    }
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[]; rowCount: number | null }> {
    await this.acquireMutex()
    try {
      if (!values || values.length === 0) {
        const execResults = await this.pglite.exec(text)
        const last = execResults[execResults.length - 1]
        const rows = (last?.rows ?? []) as TRow[]
        return {
          rows,
          rowCount: last?.affectedRows ?? rows.length,
        }
      }
      const res = await this.pglite.query<TRow>(text, [...values])
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      }
    } finally {
      this.releaseMutex()
    }
  }

  async end(): Promise<void> {}
}

interface SyntheticSupabaseUser {
  id: string
  email: string
  confirmed_at: string | null
  banned_until: string | null
  created_at: string
}

interface SyntheticProfile {
  id: string
  email: string
  full_name: string
  role: string
  tenant_id: string
}

describe("FASE 4G.4: Ensayo de Migración Supabase a PostgreSQL Aislado", () => {
  let pglite: PGlite
  let pool: EmbeddedPostgresPoolAdapter
  let txManager: PostgresTransactionManager
  let userRepo: PostgresUserRepository
  let credRepo: PostgresCredentialRepository
  let sessionRepo: PostgresSessionRepository
  let auditService: PostgresSecurityAuditService
  let passwordHasher: Argon2idPasswordHasher
  let tokenService: JoseTokenService

  const syntheticSupabaseUsers: SyntheticSupabaseUser[] = [
    {
      id: "a1111111-1111-4111-8111-111111111111",
      email: "director.general@sitecorp.cu",
      confirmed_at: "2025-01-15T08:30:00Z",
      banned_until: null,
      created_at: "2025-01-15T08:00:00Z",
    },
    {
      id: "b2222222-2222-4222-8222-222222222222",
      email: "especialista.rrhh@sitecorp.cu",
      confirmed_at: "2025-02-10T09:15:00Z",
      banned_until: null,
      created_at: "2025-02-10T09:00:00Z",
    },
    {
      id: "c3333333-3333-4333-8333-333333333333",
      email: "auditor.seguridad@sitecorp.cu",
      confirmed_at: "2025-03-01T14:00:00Z",
      banned_until: null,
      created_at: "2025-03-01T13:45:00Z",
    },
    {
      id: "d4444444-4444-4444-8444-444444444444",
      email: "usuario.suspendido@sitecorp.cu",
      confirmed_at: "2025-03-15T11:00:00Z",
      banned_until: "2099-12-31T23:59:59Z", // Banned
      created_at: "2025-03-15T10:30:00Z",
    },
    {
      id: "e5555555-5555-4555-8555-555555555555",
      email: "usuario.pendiente@sitecorp.cu",
      confirmed_at: null, // Sin confirmar
      banned_until: null,
      created_at: "2025-04-01T16:00:00Z",
    },
  ]

  const syntheticProfiles: SyntheticProfile[] = syntheticSupabaseUsers.map((u, i) => ({
    id: u.id,
    email: u.email,
    full_name: `Funcionario SiteCorp ${i + 1}`,
    role: i === 0 ? "platform_superadmin" : "client_user",
    tenant_id: "99999999-9999-4999-8999-999999999999",
  }))

  beforeAll(async () => {
    pglite = new PGlite()
    await pglite.waitReady
    pool = new EmbeddedPostgresPoolAdapter(pglite)
    txManager = new PostgresTransactionManager(pool)

    // 1. Ejecutar migraciones del esquema de autenticación propio
    const runner = new PostgresMigrationRunner(txManager, txManager, {
      environment: "test",
    })
    const migrations = loadAllAuthSchemaMigrations(undefined, {
      environment: "test",
    })
    await runner.applyMigrations(migrations)

    // 2. Simular esquema de dominio público (profiles y workers con FK a users)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        tenant_id UUID NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public.workers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        created_by UUID REFERENCES public.profiles(id)
      );
    `)

    userRepo = new PostgresUserRepository(txManager)
    credRepo = new PostgresCredentialRepository(txManager)
    sessionRepo = new PostgresSessionRepository(txManager, txManager)
    auditService = new PostgresSecurityAuditService(txManager)
    passwordHasher = new Argon2idPasswordHasher({
      memoryCostKiB: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    })

    const keyPair = await generateEphemeralEd25519KeyPair("migration-test-kid-2026")
    tokenService = new JoseTokenService({
      issuer: "https://auth.sitecorp.cu",
      audience: "sitecorp-app",
      accessTokenTtlSeconds: 900,
      requireSessionId: true,
      activeSigningKey: keyPair,
      additionalVerificationKeys: [],
    })
  })

  afterAll(async () => {
    await pglite.close()
  })

  it("1. Preserva exactamente el 100% de los UUIDs de Supabase en sitecorp_auth.users", async () => {
    // Ingesta simulada de la migración:
    for (const sUser of syntheticSupabaseUsers) {
      const status = sUser.banned_until
        ? "suspended"
        : "pending_password_change"

      const user = AuthUser.create(
        createUserId(sUser.id),
        createEmail(sUser.email),
        {
          status,
          mustChangePassword: true, // Regla de migración: forzar cambio
          now: new Date(sUser.created_at),
        }
      )

      await userRepo.save(user)

      // Generar contraseña provisional de alta entropía para activación
      const tempPassword = `SiteCorpTemp#${sUser.id.substring(0, 8)}!`
      const hash = await passwordHasher.hash(tempPassword)

      await credRepo.save({
        id: randomUUID(),
        userId: user.id,
        algorithm: passwordHasher.algorithm,
        passwordHash: hash,
        version: 1,
        createdAt: new Date(),
      })

      // Ingesta de profiles en public preservando el mismo UUID
      const userProfile = syntheticProfiles.find((p) => p.id === sUser.id)!
      await pool.query(
        `INSERT INTO public.profiles (id, email, full_name, role, tenant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userProfile.id,
          userProfile.email,
          userProfile.full_name,
          userProfile.role,
          userProfile.tenant_id,
        ]
      )
    }

    // Comprobación de integridad:
    for (const original of syntheticSupabaseUsers) {
      const migrated = await userRepo.findById(createUserId(original.id))
      expect(migrated).not.toBeNull()
      expect(migrated?.id).toBe(original.id) // UUID idéntico
      expect(migrated?.email).toBe(original.email)
      expect(migrated?.mustChangePassword).toBe(true)

      if (original.banned_until) {
        expect(migrated?.status).toBe("suspended")
      } else {
        expect(migrated?.status).toBe("pending_password_change")
      }
    }
  })

  it("2. Demuestra integridad referencial cero-huérfanos entre public.profiles y sitecorp_auth.users", async () => {
    const res = await pool.query<{ profile_id: string; user_id: string | null }>(`
      SELECT p.id AS profile_id, u.id AS user_id
      FROM public.profiles p
      LEFT JOIN sitecorp_auth.users u ON p.id = u.id
    `)

    expect(res.rows.length).toBe(syntheticSupabaseUsers.length)
    for (const row of res.rows) {
      expect(row.user_id).not.toBeNull()
      expect(row.user_id).toBe(row.profile_id)
    }
  })

  it("3. Ciclo E2E completo de activación: login inicial -> bloqueo mustChangePassword -> cambio exitoso -> login activo definitivo", async () => {
    const targetUser = syntheticSupabaseUsers[0]!
    const tempPassword = `SiteCorpTemp#${targetUser.id.substring(0, 8)}!`
    const definitivePassword = "DefinitiveSecurePassword#2026!"

    const loginUseCase = new LoginUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService,
      5,
      15 * 60 * 1000,
      txManager
    )

    const changePasswordUseCase = new ChangePasswordUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      auditService,
      txManager
    )

    // PASO A: Login con credencial temporal
    const loginInitial = await loginUseCase.execute({
      email: targetUser.email,
      password: tempPassword,
    })

    expect(loginInitial.mustChangePassword).toBe(true)
    expect(loginInitial.refreshToken).toBeNull() // No se emite refresh token mientras haya cambio pendiente
    expect(loginInitial.user.mustChangePassword).toBe(true)
    expect(loginInitial.accessToken).toBeDefined()

    // PASO B: Verificación de token restringido a cambio de contraseña
    const verified = await tokenService.verifyAccessToken(loginInitial.accessToken)
    expect(verified.scope).toBe("auth:change_password")

    // PASO C: Ejecución del cambio de contraseña
    await changePasswordUseCase.execute({
      userId: createUserId(targetUser.id),
      currentPassword: tempPassword,
      newPassword: definitivePassword,
    })

    // PASO D: Comprobación de que la bandera mustChangePassword se desactivó en la BD
    const userAfterChange = await userRepo.findById(createUserId(targetUser.id))
    expect(userAfterChange?.mustChangePassword).toBe(false)
    expect(userAfterChange?.status).toBe("active")

    // PASO E: Login definitivo con la nueva contraseña
    const loginDefinitive = await loginUseCase.execute({
      email: targetUser.email,
      password: definitivePassword,
    })

    expect(loginDefinitive.mustChangePassword).toBe(false)
    expect(loginDefinitive.refreshToken).not.toBeNull() // Refresh token emitido normalmente
    expect(loginDefinitive.user.mustChangePassword).toBe(false)

    const verifiedDefinitive = await tokenService.verifyAccessToken(loginDefinitive.accessToken)
    expect(verifiedDefinitive.scope).toBe("api:full")
  })
})
