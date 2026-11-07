import { UserId, createUserId } from "../../domain";
import {
  ICredentialRepository,
  IDatabaseClient,
  UserCredential,
} from "../../interfaces";
import { UnscopedTransactionalWriteError } from "./postgres-transaction.manager";

interface CredentialRow {
  id: string;
  user_id: string;
  algorithm: "argon2id" | "bcrypt";
  password_hash: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  [column: string]: unknown;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/**
 * Repositorio PostgreSQL de Credenciales (`sitecorp_auth.user_credentials`).
 *
 * - Nivel 2 en la jerarquía canónica de bloqueos (`users` -> `user_credentials`).
 * - Soporta bloqueo pesimista `findByUserIdForUpdate` y verificación de versión
 *   para impedir condiciones de carrera al cambiar contraseñas concurrentemente.
 */
export class PostgresCredentialRepository implements ICredentialRepository {
  constructor(private readonly db: IDatabaseClient) {}

  private mapRow(row: CredentialRow): UserCredential {
    return {
      id: row.id,
      userId: createUserId(row.user_id),
      algorithm: row.algorithm,
      passwordHash: row.password_hash,
      version: Number(row.version),
      createdAt: toDate(row.created_at),
    };
  }

  async save(credential: UserCredential): Promise<void> {
    await this.db.getActiveExecutor().query(
      `INSERT INTO sitecorp_auth.user_credentials (
         id, user_id, algorithm, password_hash, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        credential.id,
        credential.userId,
        credential.algorithm,
        credential.passwordHash,
        credential.version,
        credential.createdAt,
      ]
    );
  }

  async findByUserId(userId: UserId): Promise<UserCredential | null> {
    const result = await this.db.getActiveExecutor().query<CredentialRow>(
      `SELECT id, user_id, algorithm, password_hash, version, created_at, updated_at
       FROM sitecorp_auth.user_credentials
       WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  /**
   * Bloquea la credencial del usuario (`SELECT ... FOR UPDATE`) dentro de la transacción activa.
   * Debe invocarse después de bloquear `sitecorp_auth.users` (Nivel 1 -> Nivel 2).
   */
  async findByUserIdForUpdate(userId: UserId): Promise<UserCredential | null> {
    if (!this.db.isInTransaction()) {
      throw new UnscopedTransactionalWriteError(
        "PostgresCredentialRepository.findByUserIdForUpdate"
      );
    }
    const result = await this.db.getActiveExecutor().query<CredentialRow>(
      `SELECT id, user_id, algorithm, password_hash, version, created_at, updated_at
       FROM sitecorp_auth.user_credentials
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : null;
  }

  async update(credential: UserCredential): Promise<void> {
    const result = await this.db.getActiveExecutor().query(
      `UPDATE sitecorp_auth.user_credentials
       SET
         algorithm = $2,
         password_hash = $3,
         version = $4,
         updated_at = GREATEST(created_at, $5::timestamptz)
       WHERE user_id = $1`,
      [
        credential.userId,
        credential.algorithm,
        credential.passwordHash,
        credential.version,
        credential.createdAt.toISOString(),
      ]
    );

    if (result.rowCount === 0) {
      throw new Error(`Credencial para usuario '${credential.userId}' no encontrada.`);
    }
  }

  async deleteByUserId(userId: UserId): Promise<void> {
    await this.db.getActiveExecutor().query(
      `DELETE FROM sitecorp_auth.user_credentials WHERE user_id = $1`,
      [userId]
    );
  }
}
