import {
  AuthUser,
  AuthUserProps,
  Email,
  UserId,
  DuplicateEmailError,
} from "../../domain";
import { IUserRepository } from "../../interfaces";

export class InMemoryUserRepository implements IUserRepository {
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

    // Si el email cambió, limpiar el índice anterior
    const oldEmail = existing.email.trim().toLowerCase();
    if (oldEmail !== normalizedEmail) {
      this.userIdByNormalizedEmail.delete(oldEmail);
    }

    const cloned = this.cloneProps(user);
    this.usersById.set(user.id, cloned);
    this.userIdByNormalizedEmail.set(normalizedEmail, user.id);
  }

  async delete(id: UserId): Promise<void> {
    const existing = this.usersById.get(id);
    if (existing) {
      this.userIdByNormalizedEmail.delete(existing.email.trim().toLowerCase());
      this.usersById.delete(id);
    }
  }

  // Utilidad de pruebas para vaciar el estado
  clear(): void {
    this.usersById.clear();
    this.userIdByNormalizedEmail.clear();
  }
}
