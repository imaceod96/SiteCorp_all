import { createHash } from "node:crypto";
import { UserId } from "./types";
import {
  TokenExpiredError,
  ActivationTokenAlreadyUsedError,
} from "./types";

export type ActivationTokenType = "activation" | "password_reset";

export interface ActivationTokenProps {
  readonly id: string;
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly tokenType: ActivationTokenType;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
  readonly createdBy?: UserId | null;
  readonly consumedIp?: string | null;
  readonly consumedUserAgent?: string | null;
}

export class ActivationToken {
  private _usedAt: Date | null;
  private _consumedIp: string | null;
  private _consumedUserAgent: string | null;

  private constructor(private readonly props: ActivationTokenProps) {
    this._usedAt = props.usedAt;
    this._consumedIp = props.consumedIp ?? null;
    this._consumedUserAgent = props.consumedUserAgent ?? null;
  }

  public static hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken.trim(), "utf8").digest("hex");
  }

  public static create(
    id: string,
    userId: UserId,
    rawToken: string,
    tokenType: ActivationTokenType = "activation",
    expiresAt: Date,
    now: Date = new Date(),
    createdBy?: UserId | null
  ): { token: ActivationToken; rawToken: string } {
    if (expiresAt <= now) {
      throw new TokenExpiredError("La fecha de caducidad del token debe ser futura.");
    }
    const tokenHash = ActivationToken.hashToken(rawToken);
    const token = new ActivationToken({
      id,
      userId,
      tokenHash,
      tokenType,
      expiresAt,
      usedAt: null,
      createdAt: now,
      createdBy: createdBy ?? null,
    });
    return { token, rawToken };
  }

  public static reconstitute(props: ActivationTokenProps): ActivationToken {
    return new ActivationToken(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get tokenType(): ActivationTokenType {
    return this.props.tokenType;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get usedAt(): Date | null {
    return this._usedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get createdBy(): UserId | null | undefined {
    return this.props.createdBy;
  }

  get consumedIp(): string | null {
    return this._consumedIp;
  }

  get consumedUserAgent(): string | null {
    return this._consumedUserAgent;
  }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isUsed(): boolean {
    return this._usedAt !== null;
  }

  public markUsed(now: Date = new Date(), ip?: string | null, userAgent?: string | null): void {
    if (this.isUsed()) {
      throw new ActivationTokenAlreadyUsedError();
    }
    if (this.isExpired(now)) {
      throw new TokenExpiredError("El enlace de activación ha caducado. Solicita un nuevo enlace.");
    }
    this._usedAt = now;
    this._consumedIp = ip ?? null;
    this._consumedUserAgent = userAgent ?? null;
  }
}
