import {
  UserId,
  Email,
  AuthUserStatus,
  AccountLockedError,
  UserSuspendedError,
  UserDeletedError,
} from "./types";

export interface AuthUserProps {
  id: UserId;
  email: Email;
  status: AuthUserStatus;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class AuthUser {
  private _status: AuthUserStatus;
  private _mustChangePassword: boolean;
  private _failedLoginAttempts: number;
  private _lockedUntil: Date | null;
  private _updatedAt: Date;
  private _deletedAt: Date | null;

  private constructor(
    public readonly id: UserId,
    public readonly email: Email,
    props: Omit<AuthUserProps, "id" | "email">
  ) {
    this._status = props.status;
    this._mustChangePassword = props.mustChangePassword;
    this._failedLoginAttempts = props.failedLoginAttempts;
    this._lockedUntil = props.lockedUntil;
    this._updatedAt = props.updatedAt;
    this._deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
  }

  public readonly createdAt: Date;

  public static create(
    id: UserId,
    email: Email,
    options: {
      status?: AuthUserStatus;
      mustChangePassword?: boolean;
      now?: Date;
    } = {}
  ): AuthUser {
    const now = options.now ?? new Date();
    return new AuthUser(id, email, {
      status: options.status ?? "active",
      mustChangePassword: options.mustChangePassword ?? false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  public static reconstitute(props: AuthUserProps): AuthUser {
    return new AuthUser(props.id, props.email, {
      status: props.status,
      mustChangePassword: props.mustChangePassword,
      failedLoginAttempts: props.failedLoginAttempts,
      lockedUntil: props.lockedUntil,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    });
  }

  public get status(): AuthUserStatus {
    return this._status;
  }

  public get mustChangePassword(): boolean {
    return this._mustChangePassword;
  }

  public get failedLoginAttempts(): number {
    return this._failedLoginAttempts;
  }

  public get lockedUntil(): Date | null {
    return this._lockedUntil;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public get deletedAt(): Date | null {
    return this._deletedAt;
  }

  public isActive(): boolean {
    return (
      (this._status === "active" || this._status === "pending_password_change") &&
      this._deletedAt === null
    );
  }

  public isLocked(now: Date = new Date()): boolean {
    if (!this._lockedUntil) return false;
    return this._lockedUntil.getTime() > now.getTime();
  }

  public ensureCanAuthenticate(now: Date = new Date()): void {
    if (this._deletedAt !== null || this._status === "deleted") {
      throw new UserDeletedError("La cuenta de usuario ha sido dada de baja.");
    }
    if (this._status === "suspended") {
      throw new UserSuspendedError("La cuenta de usuario se encuentra suspendida.");
    }
    if (this.isLocked(now) && this._lockedUntil) {
      throw new AccountLockedError(this._lockedUntil);
    }
  }

  public registerFailedAttempt(
    maxAttempts: number = 5,
    lockDurationMs: number = 15 * 60 * 1000,
    now: Date = new Date()
  ): void {
    if (this._lockedUntil && this._lockedUntil.getTime() <= now.getTime()) {
      this._failedLoginAttempts = 1;
      this._lockedUntil = null;
    } else {
      this._failedLoginAttempts += 1;
    }
    this._updatedAt = now;

    if (this._failedLoginAttempts >= maxAttempts) {
      this._lockedUntil = new Date(now.getTime() + lockDurationMs);
    }
  }

  public resetFailedAttempts(now: Date = new Date()): void {
    this._failedLoginAttempts = 0;
    this._lockedUntil = null;
    this._updatedAt = now;
  }

  public markPasswordChanged(now: Date = new Date()): void {
    this._mustChangePassword = false;
    if (this._status === "pending_password_change") {
      this._status = "active";
    }
    this._failedLoginAttempts = 0;
    this._lockedUntil = null;
    this._updatedAt = now;
  }

  public suspend(now: Date = new Date()): void {
    this._status = "suspended";
    this._updatedAt = now;
  }

  public reactivate(now: Date = new Date()): void {
    if (this._deletedAt !== null) {
      throw new UserDeletedError("No se puede reactivar un usuario marcado como eliminado.");
    }
    this._status = "active";
    this._failedLoginAttempts = 0;
    this._lockedUntil = null;
    this._updatedAt = now;
  }

  public softDelete(now: Date = new Date()): void {
    this._status = "deleted";
    this._deletedAt = now;
    this._updatedAt = now;
  }
}
