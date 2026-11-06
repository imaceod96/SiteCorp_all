import { UserId } from "../domain";

export interface AccessTokenPayload {
  readonly sub: UserId;
  readonly email: string;
  readonly role: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly [key: string]: unknown;
}

export interface SignedToken {
  readonly token: string;
  readonly tokenType: "Bearer";
  readonly expiresInSeconds: number;
}

export interface OpaqueToken {
  readonly rawToken: string;
  readonly tokenHash: string;
}

export interface ITokenService {
  signAccessToken(payload: Omit<AccessTokenPayload, "iat" | "exp">): Promise<SignedToken>;
  verifyAccessToken(token: string): Promise<AccessTokenPayload>;
  generateOpaqueToken(): OpaqueToken;
  hashOpaqueToken(rawToken: string): string;
}
