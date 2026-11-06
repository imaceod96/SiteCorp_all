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
      metadata: options.metadata ? Object.freeze({ ...options.metadata }) : null,
      createdAt: options.now ?? new Date(),
    });
  }

  public static reconstitute(props: SecurityEventProps): SecurityEvent {
    return new SecurityEvent(props);
  }
}
