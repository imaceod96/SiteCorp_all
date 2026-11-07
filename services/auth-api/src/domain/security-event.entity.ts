import { UserId, SecurityEventType } from "./types";

export interface SecurityEventProps {
  id: string;
  userId: UserId | null;
  eventType: SecurityEventType;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  createdAt: Date;
}

const SENSITIVE_METADATA_KEY_PATTERN =
  /password|passwd|secret|token_hash|tokenhash|raw_?refresh_?token|refresh_?token|access_?token|authorization|cookie|private_?key|credential/i;

export function sanitizeAuditMetadata(
  input: Readonly<Record<string, unknown>> | null | undefined,
  depth: number = 0
): Readonly<Record<string, unknown>> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  if (depth > 4) {
    return Object.freeze({});
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      SENSITIVE_METADATA_KEY_PATTERN.test(key) &&
      key !== "attemptedTokenHashPrefix"
    ) {
      sanitized[key] = "[REDACTED]";
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      sanitized[key] = sanitizeAuditMetadata(
        value as Record<string, unknown>,
        depth + 1
      );
    } else {
      sanitized[key] = value;
    }
  }
  return Object.freeze(sanitized);
}

export class SecurityEvent {
  public readonly id: string;
  public readonly userId: UserId | null;
  public readonly eventType: SecurityEventType;
  public readonly ipAddress: string | null;
  public readonly userAgent: string | null;
  public readonly metadata: Readonly<Record<string, unknown>> | null;
  public readonly createdAt: Date;

  private constructor(props: SecurityEventProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.eventType = props.eventType;
    this.ipAddress = props.ipAddress;
    this.userAgent = props.userAgent;
    this.metadata = props.metadata;
    this.createdAt = props.createdAt;
  }

  public static create(
    id: string,
    eventType: SecurityEventType,
    options: {
      userId?: UserId | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: Readonly<Record<string, unknown>> | null;
      now?: Date;
    } = {}
  ): SecurityEvent {
    return new SecurityEvent({
      id,
      eventType,
      userId: options.userId ?? null,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      metadata: options.metadata ? sanitizeAuditMetadata(options.metadata) : null,
      createdAt: options.now ?? new Date(),
    });
  }

  public static reconstitute(props: SecurityEventProps): SecurityEvent {
    return new SecurityEvent({
      ...props,
      metadata: props.metadata ? sanitizeAuditMetadata(props.metadata) : null,
    });
  }
}
