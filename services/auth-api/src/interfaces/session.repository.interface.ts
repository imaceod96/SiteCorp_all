import { AuthSession, RefreshToken, UserId } from "../domain";

export interface ISessionRepository {
  createSession(session: AuthSession): Promise<void>;
  findSessionById(id: string): Promise<AuthSession | null>;
  updateSession(session: AuthSession): Promise<void>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: UserId): Promise<void>;

  createRefreshToken(token: RefreshToken): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  rotateRefreshToken(oldTokenId: string, newToken: RefreshToken): Promise<void>;
  revokeTokenFamily(familyId: string): Promise<void>;
}
