import { SecurityEvent, UserId } from "../domain";

export interface ISecurityAuditService {
  recordEvent(event: SecurityEvent): Promise<void>;
  findRecentByUserId(userId: UserId, limit?: number): Promise<readonly SecurityEvent[]>;
}
