import { AuthUser, Email, UserId } from "../domain";

export interface IncrementFailedAttemptResult {
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly updatedAt: Date;
}

export interface IUserRepository {
  findById(id: UserId): Promise<AuthUser | null>;
  findByIdForUpdate?(id: UserId): Promise<AuthUser | null>;
  findByEmail(email: Email): Promise<AuthUser | null>;
  save(user: AuthUser): Promise<void>;
  update(user: AuthUser): Promise<void>;
  incrementFailedAttemptsAtomic?(
    id: UserId,
    maxAttempts: number,
    lockDurationMs: number,
    now?: Date
  ): Promise<IncrementFailedAttemptResult>;
  delete(id: UserId): Promise<void>;
}

