import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthUser,
  createUserId,
  createEmail,
  DuplicateEmailError,
  AuthSession,
  SecurityEvent,
} from "../../src/domain";
import {
  InMemoryUserRepository,
  InMemoryCredentialRepository,
  InMemorySessionRepository,
  InMemorySecurityAuditService,
} from "../../src/infrastructure";

describe("Infrastructure: In-Memory Repositories (Pruebas 1, 2, 3)", () => {
  let userRepo: InMemoryUserRepository;
  let credRepo: InMemoryCredentialRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditService: InMemorySecurityAuditService;

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
    credRepo = new InMemoryCredentialRepository();
    sessionRepo = new InMemorySessionRepository();
    auditService = new InMemorySecurityAuditService();
  });

  // PRUEBA 1: Registro y consulta de usuarios
  it("1. Registro y consulta de usuarios: guarda y recupera usuarios por ID y correo", async () => {
    const id = createUserId("550e8400-e29b-41d4-a716-446655440001");
    const email = createEmail("auditor@sitecorp.cu");
    const user = AuthUser.create(id, email);

    await userRepo.save(user);

    const byId = await userRepo.findById(id);
    expect(byId).not.toBeNull();
    expect(byId?.id).toBe(id);
    expect(byId?.email).toBe(email);
    expect(byId?.status).toBe("active");

    const byEmail = await userRepo.findByEmail(email);
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(id);
  });

  // PRUEBA 2: Normalización y unicidad del correo
  it("2. Normalización y unicidad del correo: rechaza usuarios con correo duplicado tras normalización", async () => {
    const id1 = createUserId("550e8400-e29b-41d4-a716-446655440001");
    const id2 = createUserId("550e8400-e29b-41d4-a716-446655440002");

    // Mismo correo pero con diferente capitalización y espacios
    const email1 = createEmail("  Operador.Seguridad@SiteCorp.CU  ");
    const email2 = createEmail("operador.seguridad@sitecorp.cu");

    const user1 = AuthUser.create(id1, email1);
    const user2 = AuthUser.create(id2, email2);

    await userRepo.save(user1);

    // Intentar registrar user2 con el mismo correo normalizado debe lanzar DuplicateEmailError
    await expect(userRepo.save(user2)).rejects.toThrow(DuplicateEmailError);

    // Consulta con cualquier variante de mayúsculas/minúsculas encuentra al usuario original
    const found = await userRepo.findByEmail(createEmail("OPERADOR.SEGURIDAD@SITECORP.CU"));
    expect(found?.id).toBe(id1);
  });

  // PRUEBA 3: Aislamiento de mutaciones (copias defensivas)
  it("3. Aislamiento de mutaciones: modificar un objeto devuelto no altera el estado interno del repositorio sin llamar a update", async () => {
    const id = createUserId("550e8400-e29b-41d4-a716-446655440003");
    const email = createEmail("inmutable@sitecorp.cu");
    const user = AuthUser.create(id, email);

    await userRepo.save(user);

    // Recuperar usuario y mutar su estado localmente
    const retrievedUser = await userRepo.findById(id);
    expect(retrievedUser).not.toBeNull();
    retrievedUser!.suspend();
    retrievedUser!.registerFailedAttempt(5, 60000);

    expect(retrievedUser!.status).toBe("suspended");
    expect(retrievedUser!.failedLoginAttempts).toBe(1);

    // Volver a consultar del repositorio: el estado interno debe permanecer INTACTO
    const freshUser = await userRepo.findById(id);
    expect(freshUser).not.toBeNull();
    expect(freshUser!.status).toBe("active");
    expect(freshUser!.failedLoginAttempts).toBe(0);

    // Solo al llamar a update() explícitamente se persiste la mutación
    await userRepo.update(retrievedUser!);
    const updatedUser = await userRepo.findById(id);
    expect(updatedUser!.status).toBe("suspended");
  });

  it("garantiza aislamiento defensivo en credenciales, sesiones y auditoría", async () => {
    const userId = createUserId("550e8400-e29b-41d4-a716-446655440004");
    const now = new Date("2026-11-06T10:00:00Z");

    // Credencial
    await credRepo.save({
      id: "cred_1",
      userId,
      algorithm: "argon2id",
      passwordHash: "hash_original",
      version: 1,
      createdAt: now,
    });
    const cred = await credRepo.findByUserId(userId);
    expect(cred?.passwordHash).toBe("hash_original");

    // Sesión
    const session = AuthSession.create("sess_1", userId, { now });
    await sessionRepo.createSession(session);
    const retrievedSession = await sessionRepo.findSessionById("sess_1");
    retrievedSession!.revoke(); // mutación local sin update

    const freshSession = await sessionRepo.findSessionById("sess_1");
    expect(freshSession?.isRevoked).toBe(false);

    // Auditoría
    const event = SecurityEvent.create("evt_1", "LOGIN_SUCCESS", { userId, now });
    await auditService.recordEvent(event);
    const events = await auditService.findRecentByUserId(userId);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("LOGIN_SUCCESS");
  });
});
