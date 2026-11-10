import { describe, it, expect } from "vitest";
import {
  createUserId,
  isValidUserId,
  InvalidUserIdError,
  createEmail,
  isValidEmail,
  InvalidEmailError,
  AuthUser,
  AccountLockedError,
  UserSuspendedError,
  UserDeletedError,
} from "../../src/domain";

describe("Domain: User Invariants & Value Objects", () => {
  describe("UserId Value Object", () => {
    it("acepta un UUID v4 válido en minúsculas o mayúsculas y lo normaliza a minúsculas", () => {
      const validUuid = "550E8400-E29B-41D4-A716-446655440000";
      expect(isValidUserId(validUuid)).toBe(true);

      const userId = createUserId(validUuid);
      expect(userId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rechaza cadenas que no sean UUID v4", () => {
      expect(isValidUserId("not-a-uuid")).toBe(false);
      expect(isValidUserId("12345")).toBe(false);
      expect(isValidUserId("")).toBe(false);

      expect(() => createUserId("invalid-uuid")).toThrow(InvalidUserIdError);
    });
  });

  describe("Email Value Object", () => {
    it("valida y normaliza direcciones de correo válidas a minúsculas", () => {
      const input = "  Admin.Security@SiteCorp.CU  ";
      expect(isValidEmail(input)).toBe(true);

      const email = createEmail(input);
      expect(email).toBe("admin.security@sitecorp.cu");
    });

    it("rechaza correos malformados o vacíos", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("plainaddress")).toBe(false);
      expect(isValidEmail("@missingusername.com")).toBe(false);
      expect(isValidEmail("user@.com")).toBe(false);

      expect(() => createEmail("correo-invalido")).toThrow(InvalidEmailError);
    });
  });

  describe("AuthUser Entity Lifecycle", () => {
    const validId = createUserId("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    const validEmail = createEmail("operador@sitecorp.cu");

    it("crea un nuevo usuario con valores predeterminados seguros", () => {
      const now = new Date("2026-11-06T12:00:00Z");
      const user = AuthUser.create(validId, validEmail, { now });

      expect(user.id).toBe(validId);
      expect(user.email).toBe(validEmail);
      expect(user.status).toBe("active");
      expect(user.mustChangePassword).toBe(false);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
      expect(user.isActive()).toBe(true);
      expect(user.isLocked(now)).toBe(false);
    });

    it("bloquea temporalmente al usuario al alcanzar el límite de intentos fallidos", () => {
      const t0 = new Date("2026-11-06T12:00:00Z");
      const user = AuthUser.create(validId, validEmail, { now: t0 });

      // 4 intentos fallidos: no bloqueado aún
      for (let i = 0; i < 4; i++) {
        user.registerFailedAttempt(5, 15 * 60 * 1000, t0);
        expect(user.isLocked(t0)).toBe(false);
      }
      expect(user.failedLoginAttempts).toBe(4);

      // Quinto intento: debe bloquearse por 15 minutos
      user.registerFailedAttempt(5, 15 * 60 * 1000, t0);
      expect(user.failedLoginAttempts).toBe(5);
      expect(user.isLocked(t0)).toBe(true);
      expect(user.lockedUntil).toEqual(new Date("2026-11-06T12:15:00Z"));

      // Intentar autenticarse mientras está bloqueado debe lanzar AccountLockedError
      expect(() => user.ensureCanAuthenticate(t0)).toThrow(AccountLockedError);

      // Al expirar el tiempo de bloqueo, isLocked es false
      const tAfterLock = new Date("2026-11-06T12:16:00Z");
      expect(user.isLocked(tAfterLock)).toBe(false);

      // Un login exitoso restablece el contador
      user.resetFailedAttempts(tAfterLock);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it("impide autenticación con excepciones tipadas según el estado del usuario", () => {
      const t0 = new Date("2026-11-06T12:00:00Z");
      const user = AuthUser.create(validId, validEmail, { now: t0 });

      // Usuario activo puede autenticar
      expect(() => user.ensureCanAuthenticate(t0)).not.toThrow();

      // Usuario suspendido
      user.suspend(t0);
      expect(user.status).toBe("suspended");
      expect(user.isActive()).toBe(false);
      expect(() => user.ensureCanAuthenticate(t0)).toThrow(UserSuspendedError);

      // Reactivación
      user.reactivate(t0);
      expect(user.status).toBe("active");
      expect(() => user.ensureCanAuthenticate(t0)).not.toThrow();

      // Usuario dado de baja (soft delete)
      user.softDelete(t0);
      expect(user.status).toBe("deleted");
      expect(user.deletedAt).toEqual(t0);
      expect(() => user.ensureCanAuthenticate(t0)).toThrow(UserDeletedError);
      expect(() => user.reactivate(t0)).toThrow(UserDeletedError);
    });

    it("gestiona la transición de cambio obligatorio de contraseña", () => {
      const t0 = new Date("2026-11-06T12:00:00Z");
      const user = AuthUser.create(validId, validEmail, {
        status: "pending_password_change",
        mustChangePassword: true,
        now: t0,
      });

      expect(user.mustChangePassword).toBe(true);
      expect(user.status).toBe("pending_password_change");
      expect(user.isActive()).toBe(true);

      user.markPasswordChanged(new Date("2026-11-06T12:05:00Z"));
      expect(user.mustChangePassword).toBe(false);
      expect(user.status).toBe("active");
    });
  });
});
