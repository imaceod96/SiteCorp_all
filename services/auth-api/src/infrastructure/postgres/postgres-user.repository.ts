import {
  AuthUser,
  AuthUserStatus,
  DuplicateEmailError,
  Email,
  UserId,
  createEmail,
  createUserId,
} from "../../domain";
import {
  IDatabaseClient,
  IncrementFailedAttemptResult,
  IUserRepository,
} from "../../interfaces";
import { UnscopedTransactionalWriteError } from "./postgres-transaction.manager";

interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  status: string;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  [column: string]: unknown;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return toDate(value);
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Repositorio PostgreSQL de Usuarios (`sitecorp_auth.users`).
 *
 * - Todas las consultas son 100% parametrizadas ($1, $2...).
 * - Utiliza `db.getActiveExecutor()` para participar transparentemente en
 *   transacciones iniciadas por `PostgresTransactionManager`.
 * - Respeta el Nivel 1 de la jerarquía canónica de bloqueos (`users`).
 */
export class PostgresUserRepository implements IUserRepository {
  constructor(private readonly db: IDatabaseClient) {}

  private mapRowToDomain(row: UserRow): AuthUser {
    return AuthUser.reconstitute({
      id: createUserId(row.id),
      email: createEmail(row.email),
      status: row.status as AuthUserStatus,
      mustChangePassword: Boolean(row.must_change_password),
      failedLoginAttempts: Number(row.failed_login_attempts),
      lockedUntil: toNullableDate(row.locked_until),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      deletedAt: toNullableDate(row.deleted_at),
    });
  }

  async findById(id: UserId): Promise<AuthUser | null> {
    const result = await this.db.getActiveExecutor().query<UserRow>(
      `SELECT
         id, email, email_normalized, status, must_change_password,
         failed_login_attempts, locked_until, created_at, updated_at, deleted_at
       FROM sitecorp_auth.users
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? this.mapRowToDomain(row) : null;
  }

  /**
   * Adquiere bloqueo exclusivo de Nivel 1 (`SELECT ... FOR UPDATE`) sobre la fila del usuario
   * dentro de la transacción activa. Prohibido invocarlo fuera de `runInTransaction`.
   */
  async findByIdForUpdate(id: UserId): Promise<AuthUser | null> {
    if (!this.db.isInTransaction()) {
      throw new UnscopedTransactionalWriteError("PostgresUserRepository.findByIdForUpdate");
    }
    const result = await this.db.getActiveExecutor().query<UserRow>(
      `SELECT
         id, email, email_normalized, status, must_change_password,
         failed_login_attempts, locked_until, created_at, updated_at, deleted_at
       FROM sitecorp_auth.users
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    const row = result.rows[0];
    return row ? this.mapRowToDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<AuthUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.db.getActiveExecutor().query<UserRow>(
      `SELECT
         id, email, email_normalized, status, must_change_password,
         failed_login_attempts, locked_until, created_at, updated_at, deleted_at
       FROM sitecorp_auth.users
       WHERE email_normalized = $1`,
      [normalizedEmail]
    );
    const row = result.rows[0];
    return row ? this.mapRowToDomain(row) : null;
  }

  async save(user: AuthUser): Promise<void> {
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      await this.db.getActiveExecutor().query(
        `INSERT INTO sitecorp_auth.users (
           id, email, email_normalized, status, must_change_password,
           failed_login_attempts, locked_until, created_at, updated_at, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          user.id,
          user.email,
          normalizedEmail,
          user.status,
          user.mustChangePassword,
          user.failedLoginAttempts,
          user.lockedUntil,
          user.createdAt,
          user.updatedAt,
          user.deletedAt,
        ]
      );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new DuplicateEmailError(user.email);
      }
      throw error;
    }
  }

  async update(user: AuthUser): Promise<void> {
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      const result = await this.db.getActiveExecutor().query(
        `UPDATE sitecorp_auth.users
         SET
           email = $2,
           email_normalized = $3,
           status = $4,
           must_change_password = $5,
           failed_login_attempts = $6,
           locked_until = $7,
           updated_at = $8,
           deleted_at = $9
         WHERE id = $1`,
        [
          user.id,
          user.email,
          normalizedEmail,
          user.status,
          user.mustChangePassword,
          user.failedLoginAttempts,
          user.lockedUntil,
          user.updatedAt,
          user.deletedAt,
        ]
      );

      if (result.rowCount === 0) {
        throw new Error(`Usuario con ID '${user.id}' no encontrado para actualizar.`);
      }
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new DuplicateEmailError(user.email);
      }
      throw error;
    }
  }

  /**
   * Incrementa atómicamente en el motor SQL el contador de intentos fallidos (`failed_login_attempts + 1`),
   * serializando múltiples intentos fallidos concurrentes sobre la misma fila sin pérdida de actualizaciones.
   * Si existía un bloqueo temporal previo (`locked_until`) que ya expiró (`<= now`), reinicia el conteo a 1.
   */
  async incrementFailedAttemptsAtomic(
    id: UserId,
    maxAttempts: number,
    lockDurationMs: number,
    now: Date = new Date()
  ): Promise<IncrementFailedAttemptResult> {
    const lockUntilCandidate = new Date(now.getTime() + lockDurationMs);
    const result = await this.db.getActiveExecutor().query<{
      failed_login_attempts: number;
      locked_until: Date | string | null;
      updated_at: Date | string;
    }>(
      `UPDATE sitecorp_auth.users
       SET
         failed_login_attempts = CASE
           WHEN locked_until IS NOT NULL AND locked_until <= $4::timestamptz THEN 1
           ELSE failed_login_attempts + 1
         END,
         locked_until = CASE
           WHEN locked_until IS NOT NULL AND locked_until > $4::timestamptz THEN locked_until
           WHEN (
             CASE
               WHEN locked_until IS NOT NULL AND locked_until <= $4::timestamptz THEN 1
               ELSE failed_login_attempts + 1
             END
           ) >= $2 THEN $3::timestamptz
           ELSE NULL
         END,
         updated_at = GREATEST(created_at, $4::timestamptz)
       WHERE id = $1
       RETURNING failed_login_attempts, locked_until, updated_at`,
      [id, maxAttempts, lockUntilCandidate.toISOString(), now.toISOString()]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Usuario con ID '${id}' no encontrado para registrar intento fallido.`);
    }

    return {
      failedLoginAttempts: Number(row.failed_login_attempts),
      lockedUntil: toNullableDate(row.locked_until),
      updatedAt: toDate(row.updated_at),
    };
  }

  async delete(id: UserId): Promise<void> {
    await this.db.getActiveExecutor().query(
      `DELETE FROM sitecorp_auth.users WHERE id = $1`,
      [id]
    );
  }
}
