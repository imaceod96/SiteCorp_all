import { SecurityEvent, SecurityEventProps, UserId } from "../../domain";
import { ISecurityAuditService } from "../../interfaces";
import { SnapshotableRepository } from "./in-memory-transaction.manager";

export class InMemorySecurityAuditService
  implements ISecurityAuditService, SnapshotableRepository
{
  private readonly events: SecurityEventProps[] = [];

  private clone(event: SecurityEvent): SecurityEventProps {
    return {
      id: event.id,
      userId: event.userId,
      eventType: event.eventType,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata ? Object.freeze({ ...event.metadata }) : null,
      createdAt: new Date(event.createdAt.getTime()),
    };
  }

  async recordEvent(event: SecurityEvent): Promise<void> {
    this.events.push(this.clone(event));
  }

  async findRecentByUserId(
    userId: UserId,
    limit: number = 50
  ): Promise<readonly SecurityEvent[]> {
    const userEvents = this.events
      .filter((e) => e.userId === userId)
      .slice(-limit)
      .map((props) =>
        SecurityEvent.reconstitute({
          ...props,
          createdAt: new Date(props.createdAt.getTime()),
        })
      );
    return Object.freeze(userEvents);
  }

  getAllEvents(): readonly SecurityEvent[] {
    return Object.freeze(
      this.events.map((props) =>
        SecurityEvent.reconstitute({
          ...props,
          createdAt: new Date(props.createdAt.getTime()),
        })
      )
    );
  }

  createSnapshot(): unknown {
    return this.events.map((e) => ({
      ...e,
      metadata: e.metadata ? Object.freeze({ ...e.metadata }) : null,
      createdAt: new Date(e.createdAt.getTime()),
    }));
  }

  restoreSnapshot(snapshot: unknown): void {
    const saved = snapshot as SecurityEventProps[];
    this.events.length = 0;
    for (const item of saved) {
      this.events.push(item);
    }
  }

  clear(): void {
    this.events.length = 0;
  }
}

