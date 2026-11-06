import { describe, it, expect } from "vitest";
import {
  AuthUser,
  createUserId,
  createEmail,
  AuthSession,
  RefreshToken,
  SecurityEvent,
  UserId,
  Email,
} from "../../src/domain";
import {
  IUserRepository,
  ICredentialRepository,
  UserCredential,
  ISessionRepository,
  IPasswordHasher,
  ITokenService,
  ISecurityAuditService,
  AccessTokenPayload,
  SignedToken,
  OpaqueToken,
} from "../../src/interfaces";

class InMemoryUserRepository implements IUserRepository {
  private users = new Map<string, AuthUser>();

  async findById(id: UserId): Promise<AuthUser | null> {
    return this.users.get(id) ?? null;
  }
  async findByEmail(email: Email): Promise<AuthUser | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }
  async save(user: AuthUser): Promise<void> {
    this.users.set(user.id, user);
  }
  async update(user: AuthUser): Promise<void> {
    this.users.set(user.id, user);
  }
  async delete(id: UserId): Promise<void> {
    this.users.delete(id);
  }
}

class InMemoryCredentialRepository implements ICredentialRepository {
  private credentials = new Map<string, UserCredential>();

  async save(credential: UserCredential): Promise<void> {
    this.credentials.set(credential.userId, credential);
  }
  async findByUserId(userId: UserId): Promise<UserCredential | null> {
    return this.credentials.get(userId) ?? null;
  }
  async update(credential: UserCredential): Promise<void> {
    this.credentials.set(credential.userId, credential);
  }
  async deleteByUserId(userId: UserId): Promise<void> {
    this.credentials.delete(userId);
  }
}

class InMemorySessionRepository implements ISessionRepository {
  private sessions = new Map<string, AuthSession>();
  private refreshTokens = new Map<string, RefreshToken>();

  async createSession(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findSessionById(id: string): Promise<AuthSession | null> {
    return this.sessions.get(id) ?? null;
  }
  async updateSession(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async revokeSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) s.revoke();
  }
  async revokeAllUserSessions(userId: UserId): Promise<void> {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) s.revoke();
    }
  }
  async createRefreshToken(token: RefreshToken): Promise<void> {
    this.refreshTokens.set(token.tokenHash, token);
  }
  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.refreshTokens.get(tokenHash) ?? null;
  }
  async rotateRefreshToken(oldTokenId: string, newToken: RefreshToken): Promise<void> {
    for (const t of this.refreshTokens.values()) {
      if (t.id === oldTokenId) {
        t.revoke(newToken.id);
      }
    }
    this.refreshTokens.set(newToken.tokenHash, newToken);
  }
  async revokeTokenFamily(familyId: string): Promise<void> {
    for (const t of this.refreshTokens.values()) {
      if (t.familyId === familyId) {
        t.revoke();
      }
    }
  }
}

class MockPasswordHasher implements IPasswordHasher {
  public readonly algorithm = "argon2id" as const;

  async hash(plainText: string): Promise<string> {
    return `$argon2id$v=19$mock_${plainText}`;
  }
  async verify(plainText: string, hash: string): Promise<boolean> {
    return hash === `$argon2id$v=19$mock_${plainText}`;
  }
  needsRehash(_hash: string): boolean {
    return false;
  }
}

class MockTokenService implements ITokenService {
  async signAccessToken(payload: Omit<AccessTokenPayload, "iat" | "exp">): Promise<SignedToken> {
    return {
      token: `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`,
      tokenType: "Bearer",
      expiresInSeconds: 3600,
    };
  }
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      throw new Error("Token malformado");
    }
    return JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
  }
  generateOpaqueToken(): OpaqueToken {
    return {
      rawToken: "raw_token_mock_1234567890abcdef",
      tokenHash: "hash_token_mock_abcdef1234567890",
    };
  }
  hashOpaqueToken(rawToken: string): string {
    return `hash_of_${rawToken}`;
  }
}

class InMemorySecurityAuditService implements ISecurityAuditService {
  private events: SecurityEvent[] = [];

  async recordEvent(event: SecurityEvent): Promise<void> {
    this.events.push(event);
  }
  async findRecentByUserId(userId: UserId, limit = 50): Promise<readonly SecurityEvent[]> {
    return this.events.filter((e) => e.userId === userId).slice(-limit);
  }
}

describe("Interfaces & Contracts: In-Memory Implementation Verification", () => {
  const userId = createUserId("550e8400-e29b-41d4-a716-446655440000");
  const email = createEmail("usuario@sitecorp.cu");

  it("verifica el ciclo completo de IUserRepository y ICredentialRepository", async () => {
    const userRepo = new InMemoryUserRepository();
    const credRepo = new InMemoryCredentialRepository();
    const hasher = new MockPasswordHasher();

    const user = AuthUser.create(userId, email);
    await userRepo.save(user);

    const savedUser = await userRepo.findById(userId);
    expect(savedUser).not.toBeNull();
    expect(savedUser?.email).toBe(email);

    const hash = await hasher.hash("MiContraseñaSegura!2026");
    await credRepo.save({
      id: "cred_1",
      userId,
      algorithm: hasher.algorithm,
      passwordHash: hash,
      version: 1,
      createdAt: new Date(),
    });

    const savedCred = await credRepo.findByUserId(userId);
    expect(savedCred).not.toBeNull();
    expect(await hasher.verify("MiContraseñaSegura!2026", savedCred!.passwordHash)).toBe(true);
    expect(await hasher.verify("Erronea!2026", savedCred!.passwordHash)).toBe(false);
  });

  it("verifica el ciclo de ISessionRepository con rotación y detección de familia", async () => {
    const sessionRepo = new InMemorySessionRepository();

    const session = AuthSession.create("sess_001", userId);
    await sessionRepo.createSession(session);

    const token1 = RefreshToken.create("rt_1", session.id, "hash_1", "fam_A");
    await sessionRepo.createRefreshToken(token1);

    const retrieved1 = await sessionRepo.findRefreshTokenByHash("hash_1");
    expect(retrieved1?.isValid()).toBe(true);

    // Rotación atómica
    const token2 = RefreshToken.create("rt_2", session.id, "hash_2", "fam_A");
    await sessionRepo.rotateRefreshToken(token1.id, token2);

    expect(token1.isRevoked).toBe(true);
    expect(token1.replacedByTokenId).toBe(token2.id);

    const retrieved2 = await sessionRepo.findRefreshTokenByHash("hash_2");
    expect(retrieved2?.isValid()).toBe(true);

    // Revocación de toda la familia
    await sessionRepo.revokeTokenFamily("fam_A");
    expect(token2.isRevoked).toBe(true);
  });

  it("verifica ITokenService y ISecurityAuditService", async () => {
    const tokenService = new MockTokenService();
    const auditService = new InMemorySecurityAuditService();

    const signed = await tokenService.signAccessToken({
      sub: userId,
      email: email,
      role: "authenticated",
    });

    expect(signed.tokenType).toBe("Bearer");
    expect(signed.expiresInSeconds).toBe(3600);

    const verified = await tokenService.verifyAccessToken(signed.token);
    expect(verified.sub).toBe(userId);
    expect(verified.email).toBe(email);
    expect(verified.role).toBe("authenticated");

    const event = SecurityEvent.create("evt_1", "LOGIN_SUCCESS", { userId });
    await auditService.recordEvent(event);

    const userEvents = await auditService.findRecentByUserId(userId);
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]?.eventType).toBe("LOGIN_SUCCESS");
  });
});
