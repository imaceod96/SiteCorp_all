import {
  AuthUser,
  AuthUserProps,
  Email,
  UserId,
  DuplicateEmailError,
} from "../../domain";
import { IUserRepository, IncrementFailedAttemptResult } from "../../interfaces";
import { SnapshotableRepository } from "./in-memory-transaction.manager";

export class InMemoryUserRepository implements IUserRepository, SnapshotableRepository {
  private readonly usersById = new Map<string, AuthUserProps>();
  private readonly userIdByNormalizedEmail = new Map<string, string>();

  private cloneProps(user: AuthUser): AuthUserProps {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil ? new Date(user.lockedUntil.getTime()) : null,
      createdAt: new Date(user.createdAt.getTime()),
      updatedAt: new Date(user.updatedAt.getTime()),
      deletedAt: user.deletedAt ? new Date(user.deletedAt.getTime()) : null,
    };
  }

  async findById(id: UserId): Promise<AuthUser | null> {
    const props = this.usersById.get(id);
    if (!props) return null;
    return AuthUser.reconstitute({
      ...props,
      lockedUntil: props.lockedUntil ? new Date(props.lockedUntil.getTime()) : null,
      createdAt: new Date(props.createdAt.getTime()),
      updatedAt: new Date(props.updatedAt.getTime()),
      deletedAt: props.deletedAt ? new Date(props.deletedAt.getTime()) : null,
    });
  }

  async findByIdForUpdate(id: UserId): Promise<AuthUser | null> {
    return this.findById(id);
  }

  async findByEmail(email: Email): Promise<AuthUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const userId = this.userIdByNormalizedEmail.get(normalizedEmail);
    if (!userId) return null;
    return this.findById(userId as UserId);
  }

  async save(user: AuthUser): Promise<void> {
    const normalizedEmail = user.email.trim().toLowerCase();
    const existingUserId = this.userIdByNormalizedEmail.get(normalizedEmail);

    if (existingUserId && existingUserId !== user.id) {
      throw new DuplicateEmailError(user.email);
    }

    const cloned = this.cloneProps(user);
    this.usersById.set(user.id, cloned);
    this.userIdByNormalizedEmail.set(normalizedEmail, user.id);
  }

  async update(user: AuthUser): Promise<void> {
    const existing = this.usersById.get(user.id);
    if (!existing) {
      throw new Error(`Usuario con ID '${user.id}' no encontrado para actualizar.`);
    }

    const normalizedEmail = user.email.trim().toLowerCase();
    const existingEmailOwner = this.userIdByNormalizedEmail.get(normalizedEmail);
    if (existingEmailOwner && existingEmailOwner !== user.id) {
      throw new DuplicateEmailError(user.email);
    }

    const oldEmail = existing.email.trim().toLowerCase();
    if (oldEmail !== normalizedEmail) {
      this.userIdByNormalizedEmail.delete(oldEmail);
    }

    const cloned = this.cloneProps(user);
    this.usersById.set(user.id, cloned);
    this.userIdByNormalizedEmail.set(normalizedEmail, user.id);
  }

  async incrementFailedAttemptsAtomic(
    id: UserId,
    maxAttempts: number,
    lockDurationMs: number,
    now: Date = new Date()
  ): Promise<IncrementFailedAttemptResult> {
    const existing = this.usersById.get(id);
    if (!existing) {
      throw new Error(`Usuario con ID '${id}' no encontrado.`);
    }
    const nextAttempts = existing.failedLoginAttempts + 1;
    const nextLockedUntil =
      nextAttempts >= maxAttempts
        ? new Date(now.getTime() + lockDurationMs)
        : existing.lockedUntil;

    existing.failedLoginAttempts = nextAttempts;
    existing.lockedUntil = nextLockedUntil ? new Date(nextLockedUntil.getTime()) : null;
    existing.updatedAt = new Date(now.getTime());

    return {
      failedLoginAttempts: existing.failedLoginAttempts,
      lockedUntil: existing.lockedUntil ? new Date(existing.lockedUntil.getTime()) : null,
      updatedAt: new Date(existing.updatedAt.getTime()),
    };
  }

  async delete(id: UserId): Promise<void> {
    const existing = this.usersById.get(id);
    if (existing) {
      this.userIdByNormalizedEmail.delete(existing.email.trim().toLowerCase());
      this.usersById.delete(id);
    }
  }

  createSnapshot(): unknown {
    const users = new Map<string, AuthUserProps>();
    for (const [k, v] of this.usersById.entries()) {
      users.set(k, {
        ...v,
        lockedUntil: v.lockedUntil ? new Date(v.lockedUntil.getTime()) : null,
        createdAt: new Date(v.createdAt.getTime()),
        updatedAt: new Date(v.updatedAt.getTime()),
        deletedAt: v.deletedAt ? new Date(v.deletedAt.getTime()) : null,
      });
    }
    return {
      users,
      emails: new Map(this.userIdByNormalizedEmail),
    };
  }

  restoreSnapshot(snapshot: unknown): void {
    const state = snapshot as {
      users: Map<string, AuthUserProps>;
      emails: Map<string, string>;
    };
    this.usersById.clear();
    this.userIdByNormalizedEmail.clear();
    for (const [k, v] of state.users.entries()) {
      this.usersById.set(k, v);
    }
    for (const [k, v] of state.emails.entries()) {
      this.userIdByNormalizedEmail.set(k, v);
    }
  }

  clear(): void {
    this.usersById.clear();
    this.userIdByNormalizedEmail.clear();
  }
}

