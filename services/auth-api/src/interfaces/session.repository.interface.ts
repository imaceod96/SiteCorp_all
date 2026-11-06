import { AuthSession, RefreshToken, UserId } from "../domain";

export type AtomicRotateResult =
  | {
      readonly success: true;
      readonly session: AuthSession;
      readonly oldToken: RefreshToken;
      readonly newToken: RefreshToken;
    }
  | { readonly success: false; readonly reason: "NOT_FOUND" }
  | {
      readonly success: false;
      readonly reason: "ALREADY_REVOKED";
      readonly familyId: string;
      readonly session: AuthSession | null;
    }
  | { readonly success: false; readonly reason: "EXPIRED"; readonly familyId: string }
  | {
      readonly success: false;
      readonly reason: "SESSION_REVOKED" | "SESSION_EXPIRED";
    };

export interface ISessionRepository {
  createSession(session: AuthSession): Promise<void>;
  findSessionById(id: string): Promise<AuthSession | null>;
  updateSession(session: AuthSession): Promise<void>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: UserId): Promise<void>;

  createRefreshToken(token: RefreshToken): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  rotateRefreshToken(oldTokenId: string, newToken: RefreshToken): Promise<void>;
  rotateRefreshTokenAtomic(
    expectedOldTokenHash: string,
    newRawTokenHash: string,
    newTokenId: string,
    now?: Date
  ): Promise<AtomicRotateResult>;
  revokeTokenFamily(familyId: string): Promise<void>;
}
