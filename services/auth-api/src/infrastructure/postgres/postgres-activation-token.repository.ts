import {
  ActivationToken,
  ActivationTokenType,
  createUserId,
  UserId,
} from "../../domain";
import {
  IDatabaseClient,
  IActivationTokenRepository,
} from "../../interfaces";

interface ActivationTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  token_type: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
  created_by: string | null;
  consumed_ip: string | null;
  consumed_user_agent: string | null;
  [col: string]: unknown;
}

function toDate(val: Date | string): Date {
  return val instanceof Date ? new Date(val.getTime()) : new Date(val);
}

function toNullableDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  return toDate(val);
}

export class PostgresActivationTokenRepository implements IActivationTokenRepository {
  constructor(private readonly db: IDatabaseClient) {}

  private mapRowToDomain(row: ActivationTokenRow): ActivationToken {
    return ActivationToken.reconstitute({
      id: row.id,
      userId: createUserId(row.user_id),
      tokenHash: row.token_hash,
      tokenType: row.token_type as ActivationTokenType,
      expiresAt: toDate(row.expires_at),
      usedAt: toNullableDate(row.used_at),
      createdAt: toDate(row.created_at),
      createdBy: row.created_by ? createUserId(row.created_by) : null,
      consumedIp: row.consumed_ip,
      consumedUserAgent: row.consumed_user_agent,
    });
  }

  async save(token: ActivationToken): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      INSERT INTO sitecorp_auth.activation_tokens (
        id, user_id, token_hash, token_type, expires_at, used_at,
        created_at, created_by, consumed_ip, consumed_user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        used_at = EXCLUDED.used_at,
        consumed_ip = EXCLUDED.consumed_ip,
        consumed_user_agent = EXCLUDED.consumed_user_agent;
    `;
    await executor.query(sql, [
      token.id,
      token.userId,
      token.tokenHash,
      token.tokenType,
      token.expiresAt,
      token.usedAt,
      token.createdAt,
      token.createdBy ?? null,
      token.consumedIp ?? null,
      token.consumedUserAgent ?? null,
    ]);
  }

  async findByTokenHash(hash: string): Promise<ActivationToken | null> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, user_id, token_hash, token_type, expires_at, used_at,
             created_at, created_by, consumed_ip, consumed_user_agent
      FROM sitecorp_auth.activation_tokens
      WHERE token_hash = $1
      LIMIT 1;
    `;
    const res = await executor.query<ActivationTokenRow>(sql, [hash]);
    if (res.rows.length === 0) return null;
    return this.mapRowToDomain(res.rows[0]!);
  }

  async invalidatePendingForUser(userId: UserId, tokenType: ActivationTokenType): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      UPDATE sitecorp_auth.activation_tokens
      SET used_at = CURRENT_TIMESTAMP,
          consumed_user_agent = 'INVALIDATED_BY_SYSTEM'
      WHERE user_id = $1 AND token_type = $2 AND used_at IS NULL;
    `;
    await executor.query(sql, [userId, tokenType]);
  }

  async markUsed(
    tokenId: string,
    usedAt: Date,
    consumedIp?: string | null,
    consumedUserAgent?: string | null
  ): Promise<void> {
    const executor = this.db.getActiveExecutor();
    const sql = `
      UPDATE sitecorp_auth.activation_tokens
      SET used_at = $1,
          consumed_ip = $2,
          consumed_user_agent = $3
      WHERE id = $4 AND used_at IS NULL;
    `;
    await executor.query(sql, [
      usedAt,
      consumedIp ?? null,
      consumedUserAgent ?? null,
      tokenId,
    ]);
  }
}
