import {
  AuthSession,
  AuthSessionProps,
  RefreshToken,
  RefreshTokenProps,
  UserId,
} from "../../domain";
import {
  ISessionRepository,
  AtomicRotateResult,
} from "../../interfaces";

export class InMemorySessionRepository implements ISessionRepository {
  private readonly sessionsById = new Map<string, AuthSessionProps>();
  private readonly refreshTokensByHash = new Map<string, RefreshTokenProps>();
  private readonly refreshTokensById = new Map<string, RefreshTokenProps>();
  private readonly tokenIdsByFamily = new Map<string, Set<string>>();
  private readonly sessionIdsByUserId = new Map<string, Set<string>>();

  private cloneSession(session: AuthSession): AuthSessionProps {
    return {
      id: session.id,
      userId: session.userId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      isRevoked: session.isRevoked,
      createdAt: new Date(session.createdAt.getTime()),
      lastActivityAt: new Date(session.lastActivityAt.getTime()),
      expiresAt: new Date(session.expiresAt.getTime()),
    };
  }

  private cloneToken(token: RefreshToken): RefreshTokenProps {
    return {
      id: token.id,
      sessionId: token.sessionId,
      tokenHash: token.tokenHash,
      familyId: token.familyId,
      isRevoked: token.isRevoked,
      replacedByTokenId: token.replacedByTokenId,
      createdAt: new Date(token.createdAt.getTime()),
      expiresAt: new Date(token.expiresAt.getTime()),
    };
  }

  async createSession(session: AuthSession): Promise<void> {
    const props = this.cloneSession(session);
    this.sessionsById.set(session.id, props);

    let userSessions = this.sessionIdsByUserId.get(session.userId);
    if (!userSessions) {
      userSessions = new Set<string>();
      this.sessionIdsByUserId.set(session.userId, userSessions);
    }
    userSessions.add(session.id);
  }

  async findSessionById(id: string): Promise<AuthSession | null> {
    const props = this.sessionsById.get(id);
    if (!props) return null;
    return AuthSession.reconstitute({
      ...props,
      createdAt: new Date(props.createdAt.getTime()),
      lastActivityAt: new Date(props.lastActivityAt.getTime()),
      expiresAt: new Date(props.expiresAt.getTime()),
    });
  }

  async updateSession(session: AuthSession): Promise<void> {
    if (!this.sessionsById.has(session.id)) {
      throw new Error(`Sesión '${session.id}' no encontrada para actualizar.`);
    }
    this.sessionsById.set(session.id, this.cloneSession(session));
  }

  async revokeSession(id: string): Promise<void> {
    const props = this.sessionsById.get(id);
    if (props) {
      props.isRevoked = true;
      // Revocar también todos los refresh tokens asociados a esta sesión
      for (const tokenProps of this.refreshTokensById.values()) {
        if (tokenProps.sessionId === id) {
          tokenProps.isRevoked = true;
        }
      }
    }
  }

  async revokeAllUserSessions(userId: UserId): Promise<void> {
    const sessionIds = this.sessionIdsByUserId.get(userId);
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        await this.revokeSession(sessionId);
      }
    }
  }

  async createRefreshToken(token: RefreshToken): Promise<void> {
    const props = this.cloneToken(token);
    this.refreshTokensByHash.set(token.tokenHash, props);
    this.refreshTokensById.set(token.id, props);

    let family = this.tokenIdsByFamily.get(token.familyId);
    if (!family) {
      family = new Set<string>();
      this.tokenIdsByFamily.set(token.familyId, family);
    }
    family.add(token.id);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    const props = this.refreshTokensByHash.get(tokenHash);
    if (!props) return null;
    return RefreshToken.reconstitute({
      ...props,
      createdAt: new Date(props.createdAt.getTime()),
      expiresAt: new Date(props.expiresAt.getTime()),
    });
  }

  async rotateRefreshToken(oldTokenId: string, newToken: RefreshToken): Promise<void> {
    const oldProps = this.refreshTokensById.get(oldTokenId);
    if (oldProps) {
      oldProps.isRevoked = true;
      oldProps.replacedByTokenId = newToken.id;
    }
    await this.createRefreshToken(newToken);
  }

  async rotateRefreshTokenAtomic(
    expectedOldTokenHash: string,
    newRawTokenHash: string,
    newTokenId: string,
    now: Date = new Date()
  ): Promise<AtomicRotateResult> {
    // 1. Buscar token por hash
    const oldTokenProps = this.refreshTokensByHash.get(expectedOldTokenHash);
    if (!oldTokenProps) {
      return { success: false, reason: "NOT_FOUND" };
    }

    const sessionProps = this.sessionsById.get(oldTokenProps.sessionId);

    // 2. Si el token ya fue revocado previamente: ALERTA DE REUSO
    if (oldTokenProps.isRevoked) {
      // Invalida inmediatamente toda la familia de tokens
      await this.revokeTokenFamily(oldTokenProps.familyId);
      // Invalida la sesión
      if (sessionProps) {
        sessionProps.isRevoked = true;
      }
      return {
        success: false,
        reason: "ALREADY_REVOKED",
        familyId: oldTokenProps.familyId,
        session: sessionProps
          ? AuthSession.reconstitute({
              ...sessionProps,
              createdAt: new Date(sessionProps.createdAt.getTime()),
              lastActivityAt: new Date(sessionProps.lastActivityAt.getTime()),
              expiresAt: new Date(sessionProps.expiresAt.getTime()),
            })
          : null,
      };
    }

    // 3. Comprobar expiración del token
    if (oldTokenProps.expiresAt.getTime() <= now.getTime()) {
      return {
        success: false,
        reason: "EXPIRED",
        familyId: oldTokenProps.familyId,
      };
    }

    // 4. Comprobar validez de la sesión
    if (!sessionProps || sessionProps.isRevoked) {
      return { success: false, reason: "SESSION_REVOKED" };
    }
    if (sessionProps.expiresAt.getTime() <= now.getTime()) {
      return { success: false, reason: "SESSION_EXPIRED" };
    }

    // 5. Rotación atómica exitosa
    const newToken = RefreshToken.create(
      newTokenId,
      oldTokenProps.sessionId,
      newRawTokenHash,
      oldTokenProps.familyId,
      { now }
    );

    oldTokenProps.isRevoked = true;
    oldTokenProps.replacedByTokenId = newToken.id;
    sessionProps.lastActivityAt = new Date(now.getTime());

    // Almacenar el nuevo token
    await this.createRefreshToken(newToken);

    const oldToken = RefreshToken.reconstitute({
      ...oldTokenProps,
      createdAt: new Date(oldTokenProps.createdAt.getTime()),
      expiresAt: new Date(oldTokenProps.expiresAt.getTime()),
    });

    const session = AuthSession.reconstitute({
      ...sessionProps,
      createdAt: new Date(sessionProps.createdAt.getTime()),
      lastActivityAt: new Date(sessionProps.lastActivityAt.getTime()),
      expiresAt: new Date(sessionProps.expiresAt.getTime()),
    });

    return {
      success: true,
      session,
      oldToken,
      newToken,
    };
  }

  async revokeTokenFamily(familyId: string): Promise<void> {
    const tokenIds = this.tokenIdsByFamily.get(familyId);
    if (tokenIds) {
      for (const tokenId of tokenIds) {
        const tokenProps = this.refreshTokensById.get(tokenId);
        if (tokenProps) {
          tokenProps.isRevoked = true;
        }
      }
    }
  }

  clear(): void {
    this.sessionsById.clear();
    this.refreshTokensByHash.clear();
    this.refreshTokensById.clear();
    this.tokenIdsByFamily.clear();
    this.sessionIdsByUserId.clear();
  }
}
