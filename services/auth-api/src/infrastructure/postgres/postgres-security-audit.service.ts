import {
  SecurityEvent,
  SecurityEventType,
  UserId,
  createUserId,
  sanitizeAuditMetadata,
} from "../../domain";
import { IDatabaseClient, ISecurityAuditService } from "../../interfaces";

interface AuditEventRow {
  id: string;
  event_type: string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | string | null;
  occurred_at: Date | string;
  [column: string]: unknown;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function parseMetadata(
  raw: Record<string, unknown> | string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  return { ...raw };
}

/**
 * Servicio PostgreSQL de Auditoría de Seguridad (`sitecorp_auth.security_audit_events`).
 *
 * - Registro inmutable (append-only) mediante `INSERT` parametrizado.
 * - Nivel 5 en la jerarquía transaccional: participa en la misma transacción activa
 *   del caso de uso o se confirma inmediatamente en eventos independientes de fallo.
 * - Sanitiza defensivamente cualquier campo sensible en `metadata` antes de persistir en JSONB.
 */
export class PostgresSecurityAuditService implements ISecurityAuditService {
  constructor(private readonly db: IDatabaseClient) {}

  private mapRow(row: AuditEventRow): SecurityEvent {
    return SecurityEvent.reconstitute({
      id: row.id,
      userId: row.user_id ? createUserId(row.user_id) : null,
      eventType: row.event_type as SecurityEventType,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      metadata: Object.freeze(parseMetadata(row.metadata)),
      createdAt: toDate(row.occurred_at),
    });
  }

  async recordEvent(event: SecurityEvent): Promise<void> {
    const safeMetadata = sanitizeAuditMetadata(event.metadata) ?? {};
    const metadataJson = JSON.stringify(safeMetadata);
    await this.db.getActiveExecutor().query(
      `INSERT INTO sitecorp_auth.security_audit_events (
         id, event_type, user_id, ip_address, user_agent, metadata, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        event.id,
        event.eventType,
        event.userId,
        event.ipAddress,
        event.userAgent,
        metadataJson,
        event.createdAt,
      ]
    );
  }

  async findRecentByUserId(
    userId: UserId,
    limit: number = 50
  ): Promise<readonly SecurityEvent[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.db.getActiveExecutor().query<AuditEventRow>(
      `SELECT
         id, event_type, user_id, ip_address, user_agent, metadata, occurred_at
       FROM sitecorp_auth.security_audit_events
       WHERE user_id = $1
       ORDER BY occurred_at DESC, id DESC
       LIMIT $2`,
      [userId, safeLimit]
    );

    return Object.freeze(result.rows.map((r) => this.mapRow(r)));
  }
}
