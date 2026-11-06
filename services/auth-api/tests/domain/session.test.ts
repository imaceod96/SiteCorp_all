import { describe, it, expect } from "vitest";
import {
  AuthSession,
  RefreshToken,
  SecurityEvent,
  createUserId,
} from "../../src/domain";

describe("Domain: Sessions, Refresh Tokens & Security Events", () => {
  const userId = createUserId("550e8400-e29b-41d4-a716-446655440000");

  describe("AuthSession Entity", () => {
    it("crea una sesión válida con valores temporales coherentes", () => {
      const now = new Date("2026-11-06T10:00:00Z");
      const session = AuthSession.create("sess_123", userId, {
        ipAddress: "192.168.1.100",
        userAgent: "SiteCorp-Client/1.0",
        lifetimeMs: 1000 * 60 * 60, // 1 hora
        now,
      });

      expect(session.id).toBe("sess_123");
      expect(session.userId).toBe(userId);
      expect(session.ipAddress).toBe("192.168.1.100");
      expect(session.userAgent).toBe("SiteCorp-Client/1.0");
      expect(session.isRevoked).toBe(false);
      expect(session.isValid(now)).toBe(true);

      // Verificación de expiración
      const future = new Date("2026-11-06T11:01:00Z");
      expect(session.isValid(future)).toBe(false);

      // Verificación de revocación
      session.revoke();
      expect(session.isRevoked).toBe(true);
      expect(session.isValid(now)).toBe(false);
    });

    it("actualiza la marca de última actividad con touch()", () => {
      const t0 = new Date("2026-11-06T10:00:00Z");
      const session = AuthSession.create("sess_456", userId, { now: t0 });

      const t1 = new Date("2026-11-06T10:30:00Z");
      session.touch(t1);
      expect(session.lastActivityAt).toEqual(t1);
    });
  });

  describe("RefreshToken Entity", () => {
    it("crea un refresh token activo vinculado a una sesión y familia", () => {
      const now = new Date("2026-11-06T10:00:00Z");
      const token = RefreshToken.create(
        "rt_1",
        "sess_123",
        "hash_sha256_mock_abc123",
        "fam_999",
        { lifetimeMs: 1000 * 60 * 60 * 24, now }
      );

      expect(token.id).toBe("rt_1");
      expect(token.sessionId).toBe("sess_123");
      expect(token.tokenHash).toBe("hash_sha256_mock_abc123");
      expect(token.familyId).toBe("fam_999");
      expect(token.isRevoked).toBe(false);
      expect(token.replacedByTokenId).toBeNull();
      expect(token.isValid(now)).toBe(true);

      // Rotación: revocar y vincular al reemplazo
      token.revoke("rt_2");
      expect(token.isRevoked).toBe(true);
      expect(token.replacedByTokenId).toBe("rt_2");
      expect(token.isValid(now)).toBe(false);
    });
  });

  describe("SecurityEvent Entity", () => {
    it("crea un evento de auditoría inmutable con metadatos protegidos", () => {
      const now = new Date("2026-11-06T10:00:00Z");
      const event = SecurityEvent.create("evt_001", "LOGIN_SUCCESS", {
        userId,
        ipAddress: "10.0.0.1",
        userAgent: "SiteCorp-App",
        metadata: { method: "password", browser: "Firefox" },
        now,
      });

      expect(event.id).toBe("evt_001");
      expect(event.eventType).toBe("LOGIN_SUCCESS");
      expect(event.userId).toBe(userId);
      expect(event.ipAddress).toBe("10.0.0.1");
      expect(event.metadata).toEqual({ method: "password", browser: "Firefox" });
      expect(Object.isFrozen(event.metadata)).toBe(true);
    });
  });
});
