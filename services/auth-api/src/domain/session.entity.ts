import { UserId } from "./types";

export interface AuthSessionProps {
  id: string;
  userId: UserId;
  ipAddress: string | null;
  userAgent: string | null;
  isRevoked: boolean;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

export class AuthSession {
  private _isRevoked: boolean;
  private _lastActivityAt: Date;

  public readonly id: string;
  public readonly userId: UserId;
  public readonly ipAddress: string | null;
  public readonly userAgent: string | null;
  public readonly createdAt: Date;
  public readonly expiresAt: Date;

  private constructor(props: AuthSessionProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.ipAddress = props.ipAddress;
    this.userAgent = props.userAgent;
    this._isRevoked = props.isRevoked;
    this.createdAt = props.createdAt;
    this._lastActivityAt = props.lastActivityAt;
    this.expiresAt = props.expiresAt;
  }

  public static create(
    id: string,
    userId: UserId,
    options: {
      ipAddress?: string | null;
      userAgent?: string | null;
      lifetimeMs?: number;
      now?: Date;
    } = {}
  ): AuthSession {
    const now = options.now ?? new Date();
    const lifetimeMs = options.lifetimeMs ?? 30 * 24 * 60 * 60 * 1000; // 30 días
    return new AuthSession({
      id,
      userId,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      isRevoked: false,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + lifetimeMs),
    });
  }

  public static reconstitute(props: AuthSessionProps): AuthSession {
    return new AuthSession(props);
  }

  public get isRevoked(): boolean {
    return this._isRevoked;
  }

  public get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  public isValid(now: Date = new Date()): boolean {
    return !this._isRevoked && this.expiresAt.getTime() > now.getTime();
  }

  public revoke(): void {
    this._isRevoked = true;
  }

  public touch(now: Date = new Date()): void {
    this._lastActivityAt = now;
  }
}

export interface RefreshTokenProps {
  id: string;
  sessionId: string;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  replacedByTokenId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export class RefreshToken {
  private _isRevoked: boolean;
  private _replacedByTokenId: string | null;

  public readonly id: string;
  public readonly sessionId: string;
  public readonly tokenHash: string;
  public readonly familyId: string;
  public readonly createdAt: Date;
  public readonly expiresAt: Date;

  private constructor(props: RefreshTokenProps) {
    this.id = props.id;
    this.sessionId = props.sessionId;
    this.tokenHash = props.tokenHash;
    this.familyId = props.familyId;
    this._isRevoked = props.isRevoked;
    this._replacedByTokenId = props.replacedByTokenId;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
  }

  public static create(
    id: string,
    sessionId: string,
    tokenHash: string,
    familyId: string,
    options: {
      lifetimeMs?: number;
      now?: Date;
    } = {}
  ): RefreshToken {
    const now = options.now ?? new Date();
    const lifetimeMs = options.lifetimeMs ?? 14 * 24 * 60 * 60 * 1000; // 14 días
    return new RefreshToken({
      id,
      sessionId,
      tokenHash,
      familyId,
      isRevoked: false,
      replacedByTokenId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + lifetimeMs),
    });
  }

  public static reconstitute(props: RefreshTokenProps): RefreshToken {
    return new RefreshToken(props);
  }

  public get isRevoked(): boolean {
    return this._isRevoked;
  }

  public get replacedByTokenId(): string | null {
    return this._replacedByTokenId;
  }

  public isValid(now: Date = new Date()): boolean {
    return !this._isRevoked && this.expiresAt.getTime() > now.getTime();
  }

  public revoke(replacedByTokenId?: string): void {
    this._isRevoked = true;
    if (replacedByTokenId) {
      this._replacedByTokenId = replacedByTokenId;
    }
  }
}
