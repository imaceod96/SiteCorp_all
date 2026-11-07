import { randomUUID } from "node:crypto";
import { ForbiddenError, UserId, createUserId } from "../../domain";
import {
  GrantOperatorPermissionInput,
  IDatabaseClient,
  IOperatorPermissionRepository,
  isValidOperatorPermission,
  OperatorPermission,
  OperatorPermissionRecord,
  RevokeOperatorPermissionInput,
} from "../../interfaces";

interface OperatorPermissionRow {
  id: string;
  user_id: string;
  permission: string;
  granted_by: string | null;
  grant_reason: string | null;
  is_revoked: boolean;
  created_at: Date | string;
  revoked_at: Date | string | null;
  revoked_by: string | null;
  [column: string]: unknown;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return toDate(value);
}

/**
 * Repositorio PostgreSQL autoritativo para permisos administrativos de operadores
 * (`sitecorp_auth.operator_permissions`).
 *
 * - Consultas 100% parametrizadas (`$1`, `$2`...).
 * - Participa en transacciones activas a través de `db.getActiveExecutor()`.
 * - Refuerza en código y en base de datos la prohibición de auto-asignación (`granted_by <> user_id`).
 */
export class PostgresOperatorPermissionRepository
  implements IOperatorPermissionRepository
{
  constructor(private readonly db: IDatabaseClient) {}

  private mapRowToRecord(row: OperatorPermissionRow): OperatorPermissionRecord {
    if (!isValidOperatorPermission(row.permission)) {
      throw new Error(
        `Permiso inválido almacenado en sitecorp_auth.operator_permissions: '${row.permission}'.`
      );
    }

    return Object.freeze({
      id: row.id,
      userId: createUserId(row.user_id),
      permission: row.permission,
      grantedBy: row.granted_by ? createUserId(row.granted_by) : null,
      grantReason: row.grant_reason ?? null,
      isRevoked: Boolean(row.is_revoked),
      createdAt: toDate(row.created_at),
      revokedAt: toNullableDate(row.revoked_at),
      revokedBy: row.revoked_by ? createUserId(row.revoked_by) : null,
    });
  }

  async findActivePermissionsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermission[]> {
    const result = await this.db
      .getActiveExecutor()
      .query<{ permission: string }>(
        `SELECT permission
         FROM sitecorp_auth.operator_permissions
         WHERE user_id = $1
           AND is_revoked = FALSE
         ORDER BY permission ASC`,
        [userId]
      );

    const permissions: OperatorPermission[] = [];
    for (const row of result.rows) {
      if (isValidOperatorPermission(row.permission)) {
        permissions.push(row.permission);
      }
    }
    return Object.freeze(permissions);
  }

  async findActiveRecordsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermissionRecord[]> {
    const result = await this.db
      .getActiveExecutor()
      .query<OperatorPermissionRow>(
        `SELECT
           id, user_id, permission, granted_by, grant_reason,
           is_revoked, created_at, revoked_at, revoked_by
         FROM sitecorp_auth.operator_permissions
         WHERE user_id = $1
           AND is_revoked = FALSE
         ORDER BY created_at ASC`,
        [userId]
      );

    return Object.freeze(result.rows.map((r) => this.mapRowToRecord(r)));
  }

  async grantPermission(
    input: GrantOperatorPermissionInput
  ): Promise<OperatorPermissionRecord> {
    if (!isValidOperatorPermission(input.permission)) {
      throw new ForbiddenError(
        `Permiso administrativo inválido: '${String(input.permission)}'.`
      );
    }

    if (input.grantedBy === null && input.allowBootstrapNullGranter !== true) {
      throw new ForbiddenError(
        "Se requiere un operador autorizante ('grantedBy') para otorgar permisos."
      );
    }

    if (input.grantedBy !== null && input.grantedBy === input.userId) {
      throw new ForbiddenError(
        "Prohibida la auto-asignación de permisos administrativos ('grantedBy === userId')."
      );
    }

    const executor = this.db.getActiveExecutor();

    // Si ya cuenta con el permiso activo, devolverlo de forma idempotente
    const existing = await executor.query<OperatorPermissionRow>(
      `SELECT
         id, user_id, permission, granted_by, grant_reason,
         is_revoked, created_at, revoked_at, revoked_by
       FROM sitecorp_auth.operator_permissions
       WHERE user_id = $1
         AND permission = $2
         AND is_revoked = FALSE`,
      [input.userId, input.permission]
    );

    if (existing.rows[0]) {
      return this.mapRowToRecord(existing.rows[0]);
    }

    const id = input.id ?? randomUUID();
    const now = input.now ?? new Date();

    const inserted = await executor.query<OperatorPermissionRow>(
      `INSERT INTO sitecorp_auth.operator_permissions (
         id, user_id, permission, granted_by, grant_reason,
         is_revoked, created_at, revoked_at, revoked_by
       ) VALUES ($1, $2, $3, $4, $5, FALSE, $6, NULL, NULL)
       RETURNING
         id, user_id, permission, granted_by, grant_reason,
         is_revoked, created_at, revoked_at, revoked_by`,
      [
        id,
        input.userId,
        input.permission,
        input.grantedBy,
        input.grantReason ?? null,
        now,
      ]
    );

    const row = inserted.rows[0];
    if (!row) {
      throw new Error("No se pudo insertar el permiso de operador.");
    }
    return this.mapRowToRecord(row);
  }

  async revokePermission(input: RevokeOperatorPermissionInput): Promise<boolean> {
    const now = input.now ?? new Date();
    const result = await this.db.getActiveExecutor().query(
      `UPDATE sitecorp_auth.operator_permissions
       SET
         is_revoked = TRUE,
         revoked_at = $3,
         revoked_by = $4
       WHERE user_id = $1
         AND permission = $2
         AND is_revoked = FALSE`,
      [input.userId, input.permission, now, input.revokedBy]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllUserPermissions(
    userId: UserId,
    revokedBy: UserId | null,
    now: Date = new Date()
  ): Promise<number> {
    const result = await this.db.getActiveExecutor().query(
      `UPDATE sitecorp_auth.operator_permissions
       SET
         is_revoked = TRUE,
         revoked_at = $2,
         revoked_by = $3
       WHERE user_id = $1
         AND is_revoked = FALSE`,
      [userId, now, revokedBy]
    );

    return result.rowCount ?? 0;
  }

  async countActiveOperatorPermissions(): Promise<number> {
    const result = await this.db
      .getActiveExecutor()
      .query<{ total: string | number }>(
        `SELECT COUNT(*) AS total
         FROM sitecorp_auth.operator_permissions
         WHERE is_revoked = FALSE`
      );
    const total = result.rows[0]?.total ?? 0;
    return Number(total);
  }
}
